/**
 * 局域网协作服务 —— 房主侧与加入方侧都在这里。
 *
 * 项目契约的「局域网协作」不是云端功能：房主在自己机器上起一个服务，队友在**同一网段**
 * 里用「房主地址 + 6 位加入码」接入，成员、审批、Agent 任务共享全在局域网内流转。
 * 这里当前实现同一套语义：
 *
 *   房主：`http.createServer` 绑 `0.0.0.0` + 随机端口，暴露 REST（加入/心跳/离开/任务）
 *         与 WebSocket 推送（`/collab/ws`）；另外挂一个 UDP socket 监听固定发现端口，
 *         回答同网段的探测广播。加入码 6 位数字、10 分钟有效、可随时「换一个」。
 *   队员：HTTP 加入 → 进入待批准队列 → 房主批准后才成为成员；其间靠 WS 接推送、
 *         靠心跳（5s）保活并兜底拉状态；附近房间靠 UDP 广播发现。
 *
 * ⚠️ 本文件**不依赖 electron**（只用 node 内置模块 + ws）—— 这样
 *    `scripts/test-collab.cjs` 能直接起两个进程做真实联调，不靠 mock。
 *    因此这里不 import `@shared/types` 的运行时值，只用 `import type`（类型会被擦除）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { randomInt, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import type {
  CollabDiscoverResult,
  CollabEvent,
  CollabFileError,
  CollabFileResult,
  CollabJoinError,
  CollabJoinResult,
  CollabMember,
  CollabNearbyRoom,
  CollabPendingRequest,
  CollabRole,
  CollabRoomInfo,
  CollabSharedFile,
  CollabSharedTask,
  CollabTaskStatus,
} from '../../shared/types';

/** 协作协议版本 —— 两端必须一致；不一致时新端按项目契约提示「房主版本过旧」 */
export const COLLAB_PROTOCOL = 1;

/** 加入码有效期（项目契约文案：10 分钟有效） */
export const COLLAB_CODE_TTL_MS = 10 * 60 * 1000;

/** UDP 发现端口 —— 固定端口才能被同网段的队友广播找到 */
export const COLLAB_DISCOVERY_PORT = 47777;

/** 发现广播的魔数（防止撞上别的应用的 UDP 包） */
const DISCOVER_MAGIC = 'MMODELS-COLLAB/1';

/** 心跳间隔 / 判定离线 / 清理超时成员 */
const HEARTBEAT_MS = 5_000;
const OFFLINE_AFTER_MS = 20_000;
const DROP_AFTER_MS = 5 * 60_000;

/** 请求体上限（协作请求都不大，但要装得下一个共享文件的内容） */
const MAX_BODY = 2 * 1024 * 1024;

/** 单个共享文件的内容上限 —— 超过就不是「文本共同编辑」的场景了 */
const MAX_FILE_BYTES = 512 * 1024;

/** 「另存」副本的文件名后缀（中文界面下保持可读） */
const COPY_SUFFIX = '-副本';

/** 单次发现等待时长 */
const DISCOVER_WINDOW_MS = 1_200;

/**
 * 房主提交任务时的「作者身份」占位。
 * 成员 id 是 `randomUUID()`，永远不会等于这个带 `@` 前缀的字面量。
 * （导出是为了让测试能构造"作者是房主"的任务，而不必硬编码这个魔法串。）
 */
export const HOST_AUTHOR = '@host';

// ─────────────────────────────────────────────────────────────
// 内部记录
// ─────────────────────────────────────────────────────────────

interface HostMember {
  id: string;
  name: string;
  role: CollabRole;
  accountId: string;
  joinedAt: number;
  lastSeen: number;
  /** 心跳超时后置 false（前端显示「（离线）」） */
  online: boolean;
  ws: WebSocket | null;
}

interface PendingMember {
  id: string;
  name: string;
  accountId: string;
  at: number;
  ws: WebSocket | null;
}

interface HostRoom {
  active: boolean;
  projectId: string;
  /** 项目根目录 —— 共享文件的所有读写都被限制在这个目录内 */
  projectRoot: string;
  projectName: string;
  ownerName: string;
  ownerAccount: string;
  port: number;
  code: string;
  codeExpiresAt: number;
  members: Map<string, HostMember>;
  pending: Map<string, PendingMember>;
  tasks: CollabSharedTask[];
  /**
   * 任务 id → **提交者的稳定身份**（成员 id；房主是 `HOST_AUTHOR`）。
   *
   * ⚠️ 为什么不让 `tasks[].mine` / `from` 承担这件事：`from` 是**显示名**，
   *    而显示名可以重名（默认名就是「队友」）⇒ 用名字判「这条是不是我提的」
   *    会让两个同名成员**互相**看到对方的任务是「我的」。
   *    身份必须是稳定 id，显示名只用于展示。
   * ⚠️ 为什么是并行的 Map 而不是塞进 `tasks[]`：`tasks` 是**上线数据**
   *    （`ownerRoom` / `guestRoom` 直接 `{...t}` 发给渲染层），
   *    往里加字段会静默泄漏到协议里；分开存则"泄漏"在结构上不可能发生。
   */
  taskAuthors: Map<string, string>;
  /** 共享文件清单：相对路径 → {版本号, 最后改动者, 时间} */
  shared: Map<string, CollabSharedFile>;
  autoApproveTasks: boolean;
  http: Server | null;
  wss: WebSocketServer | null;
  udp: UdpSocket | null;
  timer: NodeJS.Timeout | null;
}

interface GuestState {
  baseUrl: string;
  address: string;
  /** 待批准阶段是 requestId，批准后**沿用同一个 id** 作为 memberId */
  id: string;
  name: string;
  accountId: string;
  ws: WebSocket | null;
  timer: NodeJS.Timeout | null;
  room: CollabRoomInfo | null;
  pending: boolean;
  reconnectLeft: number;
  closing: boolean;
}
export interface CollabHostOptions {
  projectId: string;
  /** 项目根目录（共享文件读写都被限制在这里面） */
  projectRoot: string;
  projectName: string;
  ownerName: string;
  /** 本机身份 id —— 用来挡「同一个账号重复加入」 */
  accountId: string;
}

export interface CollabJoinOptions {
  address: string;
  code: string;
  name: string;
  accountId: string;
}

export interface CollabTaskInput {
  title: string;
  prompt: string;
}

// ─────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────

/** 本机所有非回环 IPv4 */
function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

/** 给队友报的地址 —— 取第一块网卡；没有网卡（离线调试）就退回回环 */
function primaryAddress(): string {
  return localAddresses()[0] ?? '127.0.0.1';
}

/** 广播目标：各网段的广播地址 + 受限广播。回环单列，保证「同机双实例」也能发现 */
function broadcastTargets(): string[] {
  const targets = new Set<string>(['255.255.255.255', '127.0.0.1']);
  for (const list of Object.values(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const addr = info.address.split('.').map(Number);
      const mask = (info.netmask ?? '255.255.255.0').split('.').map(Number);
      if (addr.length !== 4 || mask.length !== 4) continue;
      const bcast = addr.map((n, i) => (n | (~mask[i] & 0xff)) & 0xff);
      targets.add(bcast.join('.'));
    }
  }
  return [...targets];
}

function isLocalAddress(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || localAddresses().includes(ip);
}

/** 6 位数字加入码 */
function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function safeParse(buf: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(buf.toString('utf8')) as unknown;
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** ws 的 message 载荷可能是 Buffer / ArrayBuffer / Buffer[]，统一成 Buffer */
function toBuffer(raw: unknown): Buffer {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.concat(raw as Buffer[]);
  return Buffer.from(String(raw));
}

/** `192.168.1.5:47820` / `http://192.168.1.5:47820/` → 规范化 baseUrl */
function normalizeBase(input: string): string | null {
  let raw = input.trim();
  if (!raw) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!url.port) return null;
  return `${url.protocol}//${url.host}`;
}

/** 加入者的**身份键** —— 优先稳定 id；没有稳定 id 时退化到显示名（见其调用点） */
function identityKey(accountId: string, name: string): string {
  const a = accountId.trim();
  return a ? `acct:${a}` : `name:${name}`;
}

/**
 * 任务标题归一化。
 *
 * ⚠️ 原实现是 `String(x ?? '').slice(0, 200) || 'Agent 任务'`，漏了 `trim()`：
 *    **纯空白是 truthy**，于是标题 `'   '` 会原样入库 ⇒ 任务列表里出现一条
 *    看起来"没有标题"的空行，而且和 `handleJoin` 的 `trim() || 默认` 口径不一致。
 */
function taskTitle(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 200) || 'Agent 任务';
}

// ─────────────────────────────────────────────────────────────
// 共享文件 · 路径与内容处理
// ─────────────────────────────────────────────────────────────

/** 统一成「项目内相对路径」写法（正斜杠） */
function normRel(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * 相对路径 → 项目内绝对路径。
 * 越界（绝对路径、`..`、盘符）一律返回 null —— 协作写入绝不能碰到项目外的文件。
 */
function resolveInRoot(root: string, rel: string): string | null {
  const clean = normRel(rel);
  if (!clean || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null;
  if (clean.split('/').includes('..')) return null;
  const abs = resolve(root, clean);
  const back = relative(root, abs);
  if (!back || back.startsWith('..') || isAbsolute(back)) return null;
  return abs;
}

/** 读文本文件；二进制 / 过大 / 不存在都当作读不了 */
function readTextFile(abs: string): { ok: true; content: string } | { ok: false } {
  try {
    const st = statSync(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return { ok: false };
    const content = readFileSync(abs, 'utf8');
    if (content.includes('\u0000')) return { ok: false };
    return { ok: true, content };
  } catch {
    return { ok: false };
  }
}

function fileFail(path: string, error: CollabFileError): CollabFileResult {
  return { ok: false, error, path, version: 0, content: '' };
}

/** HTTP 回来的裸 JSON → 强类型的 CollabFileResult */
function toFileResult(raw: Record<string, unknown> | null, path: string): CollabFileResult {
  if (!raw) return fileFail(path, 'fileFailed');
  return {
    ok: raw.ok === true,
    error: typeof raw.error === 'string' ? (raw.error as CollabFileError) : undefined,
    path: typeof raw.path === 'string' && raw.path ? raw.path : path,
    version: Number(raw.version ?? 0),
    content: typeof raw.content === 'string' ? raw.content : '',
    diskVersion: raw.diskVersion === undefined ? undefined : Number(raw.diskVersion),
    savedAs: typeof raw.savedAs === 'string' ? raw.savedAs : undefined,
  };
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error('请求体过大');
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  return safeParse(Buffer.concat(chunks)) ?? {};
}

// ─────────────────────────────────────────────────────────────
// 服务
// ─────────────────────────────────────────────────────────────

export class CollabService extends EventEmitter {
  private host: HostRoom | null = null;
  private guest: GuestState | null = null;

  // ── 对外查询 ──────────────────────────────────────────────

  /** 当前房间快照；没有房间返回 null（渲染层据此显示「未开房」视图） */
  snapshot(): CollabRoomInfo | null {
    if (this.host) return this.ownerRoom(this.host);
    if (this.guest?.room) return this.guest.room;
    return null;
  }

  /** 正在协作的项目 id（渲染层判断 `otherProjectHint` 用） */
  currentProjectId(): string | null {
    return this.host?.projectId ?? this.guest?.room?.projectId ?? null;
  }

  isHosting(): boolean {
    return this.host !== null;
  }

  isJoining(): boolean {
    return this.guest !== null;
  }

  // ── 房主 ──────────────────────────────────────────────────

  async startHost(opts: CollabHostOptions): Promise<CollabRoomInfo> {
    if (this.host) return this.ownerRoom(this.host);
    if (this.guest) await this.leave();

    const room: HostRoom = {
      active: true,
      projectId: opts.projectId,
      projectRoot: opts.projectRoot,
      projectName: opts.projectName,
      ownerName: opts.ownerName || '房主',
      ownerAccount: opts.accountId,
      port: 0,
      code: newCode(),
      codeExpiresAt: Date.now() + COLLAB_CODE_TTL_MS,
      members: new Map(),
      pending: new Map(),
      tasks: [],
      taskAuthors: new Map(),
      shared: new Map(),
      autoApproveTasks: false,
      http: null,
      wss: null,
      udp: null,
      timer: null,
    };

    const http = createServer((req, res) => {
      void this.handleHttp(room, req, res);
    });
    room.http = http;
    room.wss = new WebSocketServer({ noServer: true });
    http.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/collab/ws') {
        socket.destroy();
        return;
      }
      const id = url.searchParams.get('id') ?? '';
      room.wss?.handleUpgrade(req, socket, head, (ws) => this.bindHostSocket(room, ws, id));
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => reject(err);
      http.once('error', onError);
      http.listen(0, '0.0.0.0', () => {
        http.off('error', onError);
        resolve();
      });
    });

    const addr = http.address();
    room.port = typeof addr === 'object' && addr ? addr.port : 0;
    if (!room.port) throw new Error('协作服务端口分配失败');

    this.host = room;
    this.listenDiscovery(room);
    room.timer = setInterval(() => this.housekeeping(room), HEARTBEAT_MS);
    room.timer.unref?.();

    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  async stopHost(): Promise<void> {
    const room = this.host;
    if (!room) return;
    room.active = false;
    this.host = null;

    if (room.timer) clearInterval(room.timer);
    for (const m of room.members.values()) this.closeSocket(m.ws, { type: 'closed' });
    for (const p of room.pending.values()) this.closeSocket(p.ws, { type: 'closed' });
    room.members.clear();
    room.pending.clear();
    room.wss?.close();
    try {
      room.udp?.close();
    } catch {
      /* 已经关了 */
    }
    await new Promise<void>((resolve) => {
      if (!room.http) return resolve();
      room.http.close(() => resolve());
      // 长连接可能拖住 close，兜底放行
      setTimeout(resolve, 300).unref?.();
    });

    this.emit('event', { type: 'closed' } satisfies CollabEvent);
  }

  /** 「换一个」加入码 —— 旧的立即作废 */
  refreshCode(): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    room.code = newCode();
    room.codeExpiresAt = Date.now() + COLLAB_CODE_TTL_MS;
    const info = this.ownerRoom(room);
    this.pushAll(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  /** 批准待批准请求：`editor`（可改文件、可下任务）/ `viewer`（只看） */
  approve(requestId: string, role: CollabRole): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const req = room.pending.get(requestId);
    if (!req) return this.ownerRoom(room);

    room.pending.delete(requestId);
    const member: HostMember = {
      id: req.id,
      name: req.name,
      role: role === 'owner' ? 'editor' : role,
      accountId: req.accountId,
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      online: true,
      // 沿用待批准阶段那条 WS —— 批准后立刻推成员快照，客户端不用重连
      ws: req.ws,
    };
    room.members.set(member.id, member);

    this.pushAll(room);
    this.pushSocket(member.ws, { type: 'room', room: this.guestRoom(room, member.id) } satisfies CollabEvent);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  reject(requestId: string): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const req = room.pending.get(requestId);
    if (!req) return this.ownerRoom(room);
    room.pending.delete(requestId);
    this.closeSocket(req.ws, { type: 'rejected' });
    this.pushAll(room);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  removeMember(memberId: string): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const member = room.members.get(memberId);
    if (!member) return this.ownerRoom(room);
    room.members.delete(memberId);
    // 字典里没有「你已被移除」的文案，用「房间已不存在」这层语义（对端确实再也连不上）
    this.closeSocket(member.ws, { type: 'closed', error: 'joinRoomClosed' });
    this.pushAll(room);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  setAutoApproveTasks(value: boolean): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    room.autoApproveTasks = value;
    if (value) {
      for (const t of room.tasks) if (t.status === 'pending') t.status = 'queued';
    }
    this.pushAll(room);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  /** 房主批准/拒绝队员提交的 Agent 任务 */
  decideTask(taskId: string, approve: boolean): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const task = room.tasks.find((t) => t.id === taskId);
    if (!task) return this.ownerRoom(room);
    task.status = approve ? 'queued' : 'rejected';
    this.pushAll(room);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  /** 房主（或房主的渲染层）回写任务执行状态 */
  setTaskStatus(taskId: string, status: CollabTaskStatus): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const task = room.tasks.find((t) => t.id === taskId);
    if (!task) return this.ownerRoom(room);
    task.status = status;
    this.pushAll(room);
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  /** 提交 Agent 任务：房主本人直接排队；队员经 HTTP 转给房主等待批准 */
  async submitTask(input: CollabTaskInput): Promise<boolean> {
    const room = this.host;
    if (room) {
      this.addTask(
        room,
        {
          id: randomUUID(),
          from: room.ownerName,
          mine: true,
          title: taskTitle(input.title),
          prompt: input.prompt,
          status: room.autoApproveTasks ? 'queued' : 'pending',
          at: Date.now(),
        },
        HOST_AUTHOR,
      );
      this.pushAll(room);
      this.emitOwner(room);
      return true;
    }
    const guest = this.guest;
    if (!guest?.room) return false;
    const res = await this.postJson(`${guest.baseUrl}/collab/task`, {
      id: guest.id,
      title: input.title,
      prompt: input.prompt,
    });
    return res?.ok === true;
  }

  /**
   * 记一条任务。**必须走这里**（而不是直接 `room.tasks.push`）：
   * `tasks` 存上线数据、`taskAuthors` 存提交者身份，两者必须同时写入 ——
   * 少了身份那条，`mine` 就会对所有人为 false（界面表现为"谁都批不了自己的任务"）。
   */
  private addTask(room: HostRoom, task: CollabSharedTask, authorId: string): void {
    room.tasks.push(task);
    room.taskAuthors.set(task.id, authorId);
  }

  // ── 共享文件（项目文件协作编辑）───────────────────────────
  //
  // **房主权威**模型：文件只有一份 —— 在房主的项目目录里。所有写入（含队员的）
  // 都送到房主落盘，房主落盘成功后把「新版本号 + 全文」广播给全房间，队员界面
  // 因此能实时看到别人改后的内容。
  //
  // 版本号单调递增，写入必须带「我改之前看到的版本号」（基版本）：
  //   基版本 === 当前版本 → 落盘，版本 +1
  //   基版本 !== 当前版本 → 拒绝（fileConflict），回磁盘上的最新版本 + 全文，
  //                        界面据此给出「覆盖 / 放弃 / 另存」三条路，三条都真实生效
  //   角色是查看者       → 拒绝（fileReadOnly）

  /** 房主把项目内的一个文件加入共享清单（队员看不到这个入口） */
  shareFile(path: string): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    const rel = normRel(path);
    const abs = resolveInRoot(room.projectRoot, rel);
    // 只有能当文本读出来的项目内文件才值得共享（越界 / 二进制 / 过大一律拒绝）
    if (!abs || !readTextFile(abs).ok) return this.ownerRoom(room);
    if (!room.shared.has(rel)) {
      room.shared.set(rel, { path: rel, version: 1, by: room.ownerName, updatedAt: Date.now() });
    }
    this.pushAll(room);
    return this.emitOwner(room);
  }

  /** 房主把文件移出共享（磁盘上的文件不动） */
  unshareFile(path: string): CollabRoomInfo | null {
    const room = this.host;
    if (!room) return null;
    if (room.shared.delete(normRel(path))) {
      this.pushAll(room);
      return this.emitOwner(room);
    }
    return this.ownerRoom(room);
  }

  /** 读共享文件：房主直接读磁盘，队员走房主权威（房主那边才知道最新版本） */
  async readFile(path: string): Promise<CollabFileResult> {
    const rel = normRel(path);
    const room = this.host;
    if (room) return this.hostRead(room, rel);

    const guest = this.guest;
    if (!guest?.room || guest.pending) return fileFail(rel, 'fileFailed');
    const res = await this.postJson(`${guest.baseUrl}/collab/file-read`, { id: guest.id, path: rel });
    return toFileResult(res, rel);
  }

  /** 写共享文件（相对路径 + 内容 + 基版本号）—— 队员的写也先送到房主校验 */
  async writeFile(path: string, content: string, baseVersion: number): Promise<CollabFileResult> {
    const rel = normRel(path);
    const room = this.host;
    if (room) return this.hostWrite(room, rel, content, baseVersion, room.ownerName, 'owner');

    const guest = this.guest;
    if (!guest?.room || guest.pending) return fileFail(rel, 'fileFailed');
    const res = await this.postJson(`${guest.baseUrl}/collab/file-write`, {
      id: guest.id,
      path: rel,
      content,
      baseVersion,
    });
    return toFileResult(res, rel);
  }

  /** 冲突处置之「另存」：把我手上的内容写成一份副本文件，原文件不动 */
  async saveCopy(path: string, content: string): Promise<CollabFileResult> {
    const rel = normRel(path);
    const room = this.host;
    if (room) return this.hostCopy(room, rel, content, room.ownerName, 'owner');

    const guest = this.guest;
    if (!guest?.room || guest.pending) return fileFail(rel, 'fileFailed');
    const res = await this.postJson(`${guest.baseUrl}/collab/file-copy`, {
      id: guest.id,
      path: rel,
      content,
    });
    return toFileResult(res, rel);
  }

  /** 房主侧读：没共享过的不给读，越界/二进制/过大一律 fileFailed */
  private hostRead(room: HostRoom, rel: string): CollabFileResult {
    const entry = room.shared.get(rel);
    if (!entry) return fileFail(rel, 'fileNotShared');
    const abs = resolveInRoot(room.projectRoot, rel);
    if (!abs) return fileFail(rel, 'fileFailed');
    const read = readTextFile(abs);
    if (!read.ok) return fileFail(rel, 'fileFailed');
    return { ok: true, path: rel, version: entry.version, content: read.content };
  }

  private hostWrite(
    room: HostRoom,
    rel: string,
    content: string,
    baseVersion: number,
    actor: string,
    role: CollabRole,
  ): CollabFileResult {
    const entry = room.shared.get(rel);
    if (!entry) return fileFail(rel, 'fileNotShared');
    if (role === 'viewer') return fileFail(rel, 'fileReadOnly');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return fileFail(rel, 'fileFailed');
    const abs = resolveInRoot(room.projectRoot, rel);
    if (!abs) return fileFail(rel, 'fileFailed');

    // 乐观并发控制：基版本对不上说明期间有人改过 —— 拒绝，并把磁盘现状带回去
    if (baseVersion !== entry.version) {
      const cur = readTextFile(abs);
      return {
        ok: false,
        error: 'fileConflict',
        path: rel,
        version: entry.version,
        diskVersion: entry.version,
        content: cur.ok ? cur.content : '',
      };
    }

    try {
      writeFileSync(abs, content, 'utf8');
    } catch {
      return fileFail(rel, 'fileFailed');
    }
    entry.version += 1;
    entry.by = actor;
    entry.updatedAt = Date.now();
    this.broadcastFile(room, rel, entry.version, content, actor);
    return { ok: true, path: rel, version: entry.version, content };
  }

  /**
   * 「另存」到 `名字-副本.ext`（同名再撞就 `名字-副本2.ext`），副本自动进共享清单。
   *
   * ⚠️ 与 `hostRead` / `hostWrite` 同一条规矩：**先查共享**。
   * 少了这一步，「另存」就成了绕过共享边界的旁路 —— 编辑者能对房主**没有共享**的
   * 路径写一份副本出来（虽然只能新建、不能覆盖），而"共享"这个授权模型就形同虚设。
   */
  private hostCopy(
    room: HostRoom,
    rel: string,
    content: string,
    actor: string,
    role: CollabRole,
  ): CollabFileResult {
    const entry = room.shared.get(rel);
    if (!entry) return fileFail(rel, 'fileNotShared');
    if (role === 'viewer') return fileFail(rel, 'fileReadOnly');
    if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) return fileFail(rel, 'fileFailed');
    if (!resolveInRoot(room.projectRoot, rel)) return fileFail(rel, 'fileFailed');

    const dir = dirname(rel);
    const base = basename(rel);
    const ext = extname(base);
    const stem = ext && ext !== base ? base.slice(0, base.length - ext.length) : base;

    let target = '';
    for (let i = 1; i <= 99; i += 1) {
      const fileName = i === 1 ? `${stem}${COPY_SUFFIX}${ext}` : `${stem}${COPY_SUFFIX}${i}${ext}`;
      const candidate = normRel(join(dir, fileName));
      const abs = resolveInRoot(room.projectRoot, candidate);
      if (!abs) break;
      if (!existsSync(abs)) {
        try {
          writeFileSync(abs, content, 'utf8');
        } catch {
          return fileFail(rel, 'fileFailed');
        }
        target = candidate;
        break;
      }
    }
    if (!target) return fileFail(rel, 'fileFailed');

    room.shared.set(target, { path: target, version: 1, by: actor, updatedAt: Date.now() });
    this.broadcastFile(room, target, 1, content, actor);
    return { ok: true, path: target, version: 1, content, savedAs: target };
  }

  /** 落盘之后：推队员 WS + 刷新房间快照 + 通知房主本机界面（文件事件） */
  private broadcastFile(room: HostRoom, path: string, version: number, content: string, by: string): void {
    const ev: CollabEvent = { type: 'file', path, version, content, by };
    for (const m of room.members.values()) this.pushSocket(m.ws, ev);
    this.pushAll(room);
    this.emit('event', ev);
    this.emitOwner(room);
  }

  // ── 队员侧 ────────────────────────────────────────────────

  async join(opts: CollabJoinOptions): Promise<CollabJoinResult> {
    if (this.host) return { ok: false, error: 'joinRoomClosed' };
    if (this.guest) await this.leave();

    const base = normalizeBase(opts.address);
    if (!base) return { ok: false, error: 'joinFailed' };

    // 1) 先握手：区分「地址不通」「地址上没有房间」「房主版本过旧」
    const hello = await this.reqJson(`${base}/collab/hello`, 'GET');
    if (hello === null) return { ok: false, error: 'joinFailed' };
    if (hello.ok !== true) {
      // 地址上确实有个 HTTP 服务，但它不认识 /collab/hello → 其他版本房主（或根本不是 MModels）
      return {
        ok: false,
        error: hello.error === 'not-found' ? 'joinIncompatibleRoom' : 'joinRoomClosed',
      };
    }
    if (Number(hello.protocol) !== COLLAB_PROTOCOL) return { ok: false, error: 'joinIncompatibleRoom' };

    // 2) 交申请 —— 房主批准前只能等
    const res = await this.reqJson(`${base}/collab/join`, 'POST', {
      protocol: COLLAB_PROTOCOL,
      code: opts.code.trim(),
      name: opts.name.trim(),
      accountId: opts.accountId,
    });
    if (res === null) return { ok: false, error: 'joinFailed' };
    if (res.ok !== true) {
      const err = typeof res.error === 'string' ? (res.error as CollabJoinError) : 'joinFailed';
      return { ok: false, error: err };
    }

    const id = String(res.requestId ?? '');
    if (!id) return { ok: false, error: 'joinFailed' };

    this.guest = {
      baseUrl: base,
      address: base.replace(/^https?:\/\//, ''),
      id,
      name: opts.name.trim(),
      accountId: opts.accountId,
      ws: null,
      timer: null,
      room: null,
      pending: res.pending === true,
      reconnectLeft: 3,
      closing: false,
    };
    this.openGuestSocket();
    this.startHeartbeat();
    return { ok: true, pending: this.guest.pending };
  }

  async leave(): Promise<void> {
    const guest = this.guest;
    if (!guest) return;
    guest.closing = true;
    this.guest = null;
    if (guest.timer) clearInterval(guest.timer);
    try {
      this.closeSocket(guest.ws, null);
    } catch {
      /* 已经断了 */
    }
    await this.postJson(`${guest.baseUrl}/collab/leave`, { id: guest.id });
  }

  // ── 发现 ──────────────────────────────────────────────────

  /** UDP 广播找附近房间；广播被系统拦掉时返回 `available:false`（面板提示手动输入地址） */
  async discover(timeoutMs = DISCOVER_WINDOW_MS): Promise<CollabDiscoverResult> {
    let sock: UdpSocket | null = null;
    try {
      const s = createSocket({ type: 'udp4', reuseAddr: true });
      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error): void => reject(err);
        s.once('error', onError);
        s.bind(0, () => {
          s.off('error', onError);
          resolve();
        });
      });
      s.setBroadcast(true);
      sock = s;
    } catch {
      try {
        sock?.close();
      } catch {
        /* ignore */
      }
      return { available: false, rooms: [] };
    }

    if (!sock) return { available: false, rooms: [] };
    const udp = sock;
    const found = new Map<string, CollabNearbyRoom>();
    udp.on('error', () => {
      /* 运行中出错按「没发现」处理，不打断 UI */
    });
    udp.on('message', (msg, rinfo) => {
      const data = safeParse(msg);
      if (!data || data.magic !== DISCOVER_MAGIC) return;
      const port = Number(data.port ?? 0);
      if (!port) return;
      // 自己开的房不进「附近」列表
      if (this.host && port === this.host.port && isLocalAddress(rinfo.address)) return;
      const address = `${rinfo.address}:${port}`;
      found.set(address, {
        name: String(data.roomName ?? ''),
        address,
        projectName: String(data.projectName ?? ''),
      });
    });

    const probe = Buffer.from(
      JSON.stringify({ magic: DISCOVER_MAGIC, protocol: COLLAB_PROTOCOL, from: primaryAddress() }),
    );
    const targets = broadcastTargets();
    const fire = (): void => {
      for (const t of targets) {
        try {
          udp.send(probe, COLLAB_DISCOVERY_PORT, t, () => {
            /* 广播发不出去不报错，等超时即可 */
          });
        } catch {
          /* ignore */
        }
      }
    };
    fire();
    const repeat = setInterval(fire, 350);
    repeat.unref?.();

    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      t.unref?.();
    });
    clearInterval(repeat);
    try {
      udp.close();
    } catch {
      /* ignore */
    }
    return { available: true, rooms: [...found.values()] };
  }

  // ── HTTP ──────────────────────────────────────────────────

  private async handleHttp(room: HostRoom, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = (req.method ?? 'GET').toUpperCase();

    // 局域网内调用，无凭据；加入码就是唯一门槛
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
    res.setHeader('cache-control', 'no-store');

    if (method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const send = (status: number, payload: unknown): void => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(body);
    };

    try {
      if (method === 'GET' && path === '/collab/hello') {
        send(200, {
          ok: true,
          protocol: COLLAB_PROTOCOL,
          roomName: room.ownerName,
          projectName: room.projectName,
          members: room.members.size + 1,
        });
        return;
      }

      const body = method === 'POST' ? await readJson(req) : {};

      if (method === 'POST' && path === '/collab/join') {
        const payload = this.handleJoin(room, body);
        send(payload.status, payload.payload);
        return;
      }

      if (method === 'POST' && path === '/collab/heartbeat') {
        send(200, this.handleHeartbeat(room, body));
        return;
      }

      if (method === 'POST' && path === '/collab/state') {
        const id = String(body.id ?? '');
        const member = room.members.get(id);
        if (member) send(200, { ok: true, room: this.guestRoom(room, member.id) });
        else if (room.pending.has(id)) send(200, { ok: true, pending: true });
        else send(200, { ok: false, error: 'joinRoomClosed' });
        return;
      }

      if (method === 'POST' && path === '/collab/leave') {
        const id = String(body.id ?? '');
        if (room.members.delete(id) || room.pending.delete(id)) {
          this.pushAll(room);
          // 队员自己退了，房主界面必须立刻少一个人（否则成员数一直挂着旧的）
          this.emitOwner(room);
        }
        send(200, { ok: true });
        return;
      }

      if (method === 'POST' && path === '/collab/task') {
        const id = String(body.id ?? '');
        const member = room.members.get(id);
        if (!member) {
          send(200, { ok: false, error: 'joinRoomClosed' });
          return;
        }
        const task: CollabSharedTask = {
          id: randomUUID(),
          from: member.name,
          mine: false,
          title: taskTitle(body.title),
          prompt: String(body.prompt ?? ''),
          status: room.autoApproveTasks ? 'queued' : 'pending',
          at: Date.now(),
        };
        // ⚠️ 作者身份用 `member.id`（稳定），**不是** `member.name` —— 见 `HostRoom.taskAuthors`
        this.addTask(room, task, member.id);
        this.pushAll(room);
        this.emitOwner(room);
        send(200, { ok: true, task });
        return;
      }

      // ── 共享文件：队员的读/写/另存全部经房主权威 ──
      // 非成员（未批准/已被移除）一律 fileFailed，不泄露项目里有什么文件
      if (path === '/collab/file-read' || path === '/collab/file-write' || path === '/collab/file-copy') {
        const rel = normRel(String(body.path ?? ''));
        const member = room.members.get(String(body.id ?? ''));
        if (!member) {
          send(200, fileFail(rel, 'fileFailed'));
          return;
        }
        if (path === '/collab/file-read') {
          send(200, this.hostRead(room, rel));
          return;
        }
        const content = String(body.content ?? '');
        if (path === '/collab/file-copy') {
          send(200, this.hostCopy(room, rel, content, member.name, member.role));
          return;
        }
        send(
          200,
          this.hostWrite(room, rel, content, Number(body.baseVersion ?? 0), member.name, member.role),
        );
        return;
      }

      send(404, { ok: false, error: 'not-found' });
    } catch {
      send(400, { ok: false, error: 'bad-request' });
    }
  }

  private handleJoin(
    room: HostRoom,
    body: Record<string, unknown>,
  ): { status: number; payload: unknown } {
    const protocol = Number(body.protocol ?? 0);
    const code = String(body.code ?? '').trim();
    const name = String(body.name ?? '').trim() || '队友';
    const accountId = String(body.accountId ?? '');

    if (protocol !== COLLAB_PROTOCOL) {
      return { status: 200, payload: { ok: false, error: 'joinIncompatibleRoom' } };
    }
    if (!room.active) {
      return { status: 200, payload: { ok: false, error: 'joinRoomClosed' } };
    }
    if (!code || code !== room.code || Date.now() > room.codeExpiresAt) {
      return { status: 200, payload: { ok: false, error: 'joinInvalidCode' } };
    }

    // 同一个身份不能重复加入同一房间。
    //
    // ⚠️ 原实现是 `if (accountId) { ... }` —— **空 accountId 整段跳过**，
    //    于是"不许重复加入"这条守卫对任何不带安装 id 的客户端**永远不会触发**
    //    （= 假守卫：可以无限次申请、`pending` 堆成一串）。
    //    现在把身份**退化**成显示名（`name:` 前缀，避免与真 accountId 撞车）：
    //    带 id 的行为完全不变；不带 id 的至少挡住"同名重复申请"。
    const identity = identityKey(accountId, name);
    const taken =
      identity === identityKey(room.ownerAccount, room.ownerName) ||
      [...room.members.values()].some((m) => identityKey(m.accountId, m.name) === identity) ||
      [...room.pending.values()].some((p) => identityKey(p.accountId, p.name) === identity);
    if (taken) return { status: 200, payload: { ok: false, error: 'joinSameAccountNotAllowed' } };

    const id = randomUUID();
    room.pending.set(id, { id, name, accountId, at: Date.now(), ws: null });
    this.pushAll(room);
    this.emitOwner(room);
    return { status: 200, payload: { ok: true, pending: true, requestId: id } };
  }

  private handleHeartbeat(room: HostRoom, body: Record<string, unknown>): unknown {
    const id = String(body.id ?? '');
    const member = room.members.get(id);
    if (member) {
      member.lastSeen = Date.now();
      if (!member.online) {
        member.online = true;
        this.pushAll(room);
        this.emitOwner(room);
      }
      return { ok: true, room: this.guestRoom(room, member.id) };
    }
    if (room.pending.has(id)) return { ok: true, pending: true };
    return { ok: false, error: 'joinRoomClosed' };
  }

  // ── WS ────────────────────────────────────────────────────

  private bindHostSocket(room: HostRoom, ws: WebSocket, id: string): void {
    const member = room.members.get(id);
    const pending = room.pending.get(id);
    if (!member && !pending) {
      this.pushSocket(ws, { type: 'closed', error: 'joinRoomClosed' } satisfies CollabEvent);
      ws.close();
      return;
    }
    if (member) {
      member.ws = ws;
      member.lastSeen = Date.now();
      this.pushSocket(ws, { type: 'room', room: this.guestRoom(room, member.id) } satisfies CollabEvent);
    } else if (pending) {
      pending.ws = ws;
    }
    ws.on('close', () => {
      const m = room.members.get(id);
      if (m && m.ws === ws) m.ws = null;
      const p = room.pending.get(id);
      if (p && p.ws === ws) p.ws = null;
    });
    ws.on('error', () => {
      /* 客户端断网很常见，不记日志刷屏 */
    });
  }

  private openGuestSocket(): void {
    const guest = this.guest;
    if (!guest) return;
    const url = `${guest.baseUrl.replace(/^http/, 'ws')}/collab/ws?id=${encodeURIComponent(guest.id)}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleGuestReconnect();
      return;
    }
    guest.ws = ws;
    ws.on('message', (raw) => {
      const data = safeParse(toBuffer(raw));
      if (!data) return;
      const g = this.guest;
      if (!g) return;
      if (data.type === 'room' && data.room) {
        const room = data.room as CollabRoomInfo;
        g.pending = false;
        g.room = { ...room, self: 'guest' };
        g.reconnectLeft = 3;
        this.emit('event', { type: 'room', room: g.room } satisfies CollabEvent);
      } else if (data.type === 'rejected') {
        const g2 = this.guest;
        this.guest = null;
        if (g2?.timer) clearInterval(g2.timer);
        this.emit('event', { type: 'rejected' } satisfies CollabEvent);
      } else if (data.type === 'file' && typeof data.path === 'string') {
        // 房主刚落了盘 —— 本机界面立刻看到新内容（这是「别人改了我这边实时变」的那一步）
        const g0 = this.guest;
        const path = data.path;
        const version = Number(data.version ?? 0);
        const by = String(data.by ?? '');
        const content = String(data.content ?? '');
        if (g0?.room) {
          const others = g0.room.sharedFiles.filter((f) => f.path !== path);
          g0.room = {
            ...g0.room,
            sharedFiles: [...others, { path, version, by, updatedAt: Date.now() }].sort((a, b) =>
              a.path.localeCompare(b.path),
            ),
          };
        }
        this.emit('event', { type: 'file', path, version, content, by } satisfies CollabEvent);
      } else if (data.type === 'closed') {
        void this.handleGuestClosed((data.error as CollabJoinError) ?? undefined);
      }
    });
    ws.on('close', () => {
      const g = this.guest;
      if (!g || g.closing || g.ws !== ws) return;
      g.ws = null;
      this.scheduleGuestReconnect();
    });
    ws.on('error', () => {
      /* close 里统一处理 */
    });
  }

  private scheduleGuestReconnect(): void {
    const guest = this.guest;
    if (!guest || guest.closing) return;
    if (guest.reconnectLeft <= 0) {
      void this.handleGuestClosed('joinRoomClosed');
      return;
    }
    guest.reconnectLeft -= 1;
    const t = setTimeout(() => this.openGuestSocket(), 1_500);
    t.unref?.();
  }

  private startHeartbeat(): void {
    const guest = this.guest;
    if (!guest) return;
    guest.timer = setInterval(() => {
      void this.guestHeartbeat();
    }, HEARTBEAT_MS);
    guest.timer.unref?.();
  }

  private async guestHeartbeat(): Promise<void> {
    const guest = this.guest;
    if (!guest) return;
    const res = await this.postJson(`${guest.baseUrl}/collab/heartbeat`, { id: guest.id });
    const g = this.guest;
    if (!g) return;
    if (res === null) return; // 偶发丢包不算退出，交给 WS 重连与下一次心跳
    if (res.ok !== true) {
      await this.handleGuestClosed(
        typeof res.error === 'string' ? (res.error as CollabJoinError) : 'joinRoomClosed',
      );
      return;
    }
    if (res.room) {
      g.pending = false;
      g.room = { ...(res.room as CollabRoomInfo), self: 'guest' };
      this.emit('event', { type: 'room', room: g.room } satisfies CollabEvent);
    }
  }

  private async handleGuestClosed(error?: CollabJoinError): Promise<void> {
    const guest = this.guest;
    if (!guest) return;
    guest.closing = true;
    this.guest = null;
    if (guest.timer) clearInterval(guest.timer);
    this.closeSocket(guest.ws, null);
    this.emit('event', { type: 'closed', error } satisfies CollabEvent);
  }

  // ── 房间视图 ──────────────────────────────────────────────

  private ownerRoom(room: HostRoom): CollabRoomInfo {
    const members: CollabMember[] = [
      {
        id: 'owner',
        name: room.ownerName,
        role: 'owner',
        online: true,
        self: true,
        joinedAt: 0,
      },
    ];
    for (const m of room.members.values()) {
      members.push({
        id: m.id,
        name: m.name,
        role: m.role,
        online: m.online,
        self: false,
        joinedAt: m.joinedAt,
      });
    }
    const pending: CollabPendingRequest[] = [...room.pending.values()].map((p) => ({
      id: p.id,
      name: p.name,
      at: p.at,
    }));
    return {
      active: true,
      self: 'host',
      roomName: room.ownerName,
      projectId: room.projectId,
      projectName: room.projectName,
      address: `${primaryAddress()}:${room.port}`,
      code: room.code,
      codeExpiresAt: room.codeExpiresAt,
      members,
      pending,
      tasks: room.tasks.map((t) => ({ ...t, mine: room.taskAuthors.get(t.id) === HOST_AUTHOR })),
      sharedFiles: this.sharedList(room),
      autoApproveTasks: room.autoApproveTasks,
    };
  }

  private guestRoom(room: HostRoom, viewerId: string): CollabRoomInfo {
    const members: CollabMember[] = [
      {
        id: 'owner',
        name: room.ownerName,
        role: 'owner',
        online: true,
        self: false,
        joinedAt: 0,
      },
    ];
    for (const m of room.members.values()) {
      members.push({
        id: m.id,
        name: m.name,
        role: m.role,
        online: m.online,
        self: m.id === viewerId,
        joinedAt: m.joinedAt,
      });
    }
    return {
      active: true,
      self: 'guest',
      roomName: room.ownerName,
      projectId: room.projectId,
      projectName: room.projectName,
      address: `${primaryAddress()}:${room.port}`,
      members,
      pending: [],
      // `mine` 按**稳定身份**（成员 id）判，不按显示名 —— 两个都叫「队友」的成员
      // 各自只会看到自己提的那条，见 `HostRoom.taskAuthors`
      tasks: room.tasks.map((t) => ({ ...t, mine: room.taskAuthors.get(t.id) === viewerId })),
      sharedFiles: this.sharedList(room),
      autoApproveTasks: room.autoApproveTasks,
    };
  }

  /** 共享清单按路径排序，保证两侧界面的顺序一致（也便于联调断言） */
  private sharedList(room: HostRoom): CollabSharedFile[] {
    return [...room.shared.values()].sort((a, b) => a.path.localeCompare(b.path));
  }

  private pushAll(room: HostRoom): void {
    for (const m of room.members.values()) {
      this.pushSocket(m.ws, { type: 'room', room: this.guestRoom(room, m.id) } satisfies CollabEvent);
    }
  }

  /** 把房间快照发给房主界面（成员进出、审批、任务状态变化都要走这里） */
  private emitOwner(room: HostRoom): CollabRoomInfo {
    const info = this.ownerRoom(room);
    this.emit('event', { type: 'room', room: info } satisfies CollabEvent);
    return info;
  }

  private pushSocket(ws: WebSocket | null, event: CollabEvent): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(event));
    } catch {
      /* 发送失败说明连接已经不行了，等 close 处理 */
    }
  }

  private closeSocket(ws: WebSocket | null, event: CollabEvent | null): void {
    if (!ws) return;
    try {
      if (event && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
      ws.close();
    } catch {
      /* ignore */
    }
  }

  /** 心跳超时 → 标记离线；长期不回来 → 清出房间 */
  private housekeeping(room: HostRoom): void {
    if (!room.active) return;
    const now = Date.now();
    let changed = false;
    for (const [id, m] of [...room.members.entries()]) {
      if (now - m.lastSeen > DROP_AFTER_MS) {
        room.members.delete(id);
        this.closeSocket(m.ws, { type: 'closed', error: 'joinRoomClosed' });
        changed = true;
      } else if (m.online !== false && now - m.lastSeen > OFFLINE_AFTER_MS) {
        m.online = false;
        changed = true;
      }
    }
    if (changed) {
      this.pushAll(room);
      this.emitOwner(room);
    }
  }

  // ── 发现端口上的应答 ─────────────────────────────────────

  private listenDiscovery(room: HostRoom): void {
    try {
      const sock = createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('error', () => {
        // 例如本机已有另一个实例占着发现端口：不影响 HTTP 加入，只是发现少一份应答
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        if (room.udp === sock) room.udp = null;
      });
      sock.on('message', (msg, rinfo) => {
        const data = safeParse(msg);
        if (!data || data.magic !== DISCOVER_MAGIC) return;
        const reply = Buffer.from(
          JSON.stringify({
            magic: DISCOVER_MAGIC,
            protocol: COLLAB_PROTOCOL,
            roomName: room.ownerName,
            projectName: room.projectName,
            port: room.port,
            address: `${primaryAddress()}:${room.port}`,
          }),
        );
        try {
          sock.send(reply, rinfo.port, rinfo.address, () => {
            /* ignore */
          });
        } catch {
          /* ignore */
        }
      });
      sock.bind(COLLAB_DISCOVERY_PORT, () => {
        try {
          sock.setBroadcast(true);
        } catch {
          /* ignore */
        }
      });
      room.udp = sock;
    } catch {
      room.udp = null;
    }
  }

  // ── HTTP 客户端 ───────────────────────────────────────────

  private async reqJson(
    url: string,
    method: 'GET' | 'POST',
    body?: unknown,
  ): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'GET' ? 3_000 : 5_000),
      });
      const text = await res.text();
      const parsed = safeParse(Buffer.from(text));
      if (parsed) return parsed;
      // 有 HTTP 响应但不是本协议的 JSON —— 其他版本房主或不是 MModels 的地址
      return { ok: false, error: 'not-found' };
    } catch {
      return null;
    }
  }

  private async postJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
    return this.reqJson(url, 'POST', body);
  }
}

/** 进程内唯一实例（IPC 层与联调脚本共用） */
export const collabService = new CollabService();
