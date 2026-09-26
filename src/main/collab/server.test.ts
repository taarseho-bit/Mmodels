/**
 * 局域网协作服务（`src/main/collab/server.ts`）回归测试 —— **房间状态机 + HTTP 路由表**。
 *
 * ⚠️ 本文件**不起任何真 socket**：不调 `startHost` / `join` / `discover`，
 *    不占端口、不发 UDP、不连 ws。
 *    做法：`CollabService` 是导出的类，`private` 只在编译期生效 ——
 *    直接用「**假 req/res**」驱动 `handleHttp`（= 完整路由表），
 *    用「**假 ws**」驱动推送/清理（`pushSocket` / `closeSocket` 只用到
 *    `readyState` / `send` / `close` / `on`），房间对象是纯数据，自己造。
 *    ⇒ 房主侧那套「加入 → 审批 → 心跳 → 清理 → 共享文件读写 → 广播」的**真实实现**
 *      全部被跑到，而网络一层完全不碰。
 *
 * 为什么这层非测不可：
 *   1. 这是**局域网内无凭据**的 HTTP 服务（见 `handleHttp` 顶部注释：加入码是唯一门槛），
 *      所以"路径越界"「非成员不该看到项目里有什么文件」这类判据坏掉 = 真实的信息泄露。
 *   2. 共享文件是**房主权威 + 乐观并发**（`hostWrite` 的 `baseVersion`）：
 *      判错就等于**静默覆盖队友刚写的内容**（数据丢失），而且不会报错。
 *   3. 加入码有 **10 分钟有效期**（`COLLAB_CODE_TTL_MS`）—— 过期判据漏了，界面看不出来。
 *
 * ⚠️ 本文件原为"只加测试、不改产品代码"（验收包冻结期内）的产物。
 *    本批（team-lead 派单：collab 三处）**已解冻并修复**，因此：
 *      · 原「现状固化」用例已按**修复后判据**重写（并在注释里留原判据，便于回溯）；
 *      · 造数据的 helper 必须与产品不变量自洽（见 `addTask` 的注释）。
 *    其余缺陷仍见 `verify/func-gap-fixes.md`。
 *
 * ⚠️ 判据纪律：每条用例都要能回答
 *    「**如果这段逻辑是坏的，这个观测值会不一样吗？**」
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COLLAB_CODE_TTL_MS, COLLAB_PROTOCOL, CollabService, HOST_AUTHOR } from './server';

// ─────────────────────────────────────────────────────────────
// 房间对象与桩件（都是纯数据，不涉及网络）
// ─────────────────────────────────────────────────────────────

interface FakeWs {
  readyState: number;
  sent: unknown[];
  closed: boolean;
  handlers: Record<string, (() => void)[]>;
  send(s: string): void;
  close(): void;
  on(ev: string, fn: () => void): void;
  emit(ev: string): void;
}

/** 假 ws —— `WebSocket.OPEN === 1` */
function fakeWs(readyState = 1): FakeWs {
  const ws: FakeWs = {
    readyState,
    sent: [],
    closed: false,
    handlers: {},
    send(s) {
      ws.sent.push(JSON.parse(s));
    },
    close() {
      ws.closed = true;
    },
    on(ev, fn) {
      (ws.handlers[ev] ??= []).push(fn);
    },
    emit(ev) {
      for (const fn of ws.handlers[ev] ?? []) fn();
    },
  };
  return ws;
}

/** 房间对象：字段与 `HostRoom` 一致，但全是可造的纯数据 */
function makeRoom(root: string, over: Record<string, unknown> = {}): any {
  return {
    active: true,
    projectId: 'p1',
    projectRoot: root,
    projectName: '测试项目',
    ownerName: '房主',
    ownerAccount: 'acct-owner',
    port: 47820,
    code: '123456',
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
    ...over,
  };
}

/**
 * 往房间里塞一条任务。
 *
 * ⚠️ **必须同时登记作者身份**：产品代码里 `tasks` 与 `taskAuthors` 是一起写的
 *    （`addTask`），只塞 `tasks` 的话 `mine` 会恒为 false —— 那不是产品行为，
 *    是"我造的假数据不自洽"。
 */
function addTask(room: any, id: string, over: Record<string, unknown> = {}, author = HOST_AUTHOR): any {
  const t = {
    id,
    from: '房主',
    mine: false,
    title: 'a',
    prompt: '',
    status: 'queued',
    at: 1,
    ...over,
  };
  room.tasks.push(t);
  room.taskAuthors.set(id, author);
  return t;
}

function addMember(room: any, id: string, over: Record<string, unknown> = {}): any {
  const m = {
    id,
    name: `队友${id}`,
    role: 'editor',
    accountId: `acct-${id}`,
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    online: true,
    ws: null as FakeWs | null,
    ...over,
  };
  room.members.set(id, m);
  return m;
}

/** 假 res —— `writeHead` 必须能链式（`handleHttp` 里有 `writeHead(204).end()`） */
function fakeRes(): any {
  const res: any = {
    status: 0,
    body: '',
    headers: {} as Record<string, string>,
    ended: false,
    setHeader(k: string, v: string) {
      res.headers[k.toLowerCase()] = v;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      res.status = status;
      for (const [k, v] of Object.entries(headers ?? {})) res.headers[k.toLowerCase()] = v;
      return res;
    },
    end(body?: string) {
      res.ended = true;
      if (body !== undefined) res.body = body;
      return res;
    },
    json(): any {
      return res.body ? JSON.parse(res.body) : null;
    },
  };
  return res;
}

/** 假 req —— 只需 `method` / `url` / 可异步迭代（`readJson` 用 for await） */
function fakeReq(method: string, url: string, body?: unknown): any {
  return {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    },
  };
}

/** `private` 只在编译期生效 —— 这里显式声明我们借用的内部入口 */
interface Internals {
  host: any;
  handleHttp: (room: any, req: any, res: any) => Promise<void>;
  handleJoin: (room: any, body: Record<string, unknown>) => { status: number; payload: any };
  handleHeartbeat: (room: any, body: Record<string, unknown>) => any;
  hostRead: (room: any, rel: string) => any;
  hostWrite: (
    room: any,
    rel: string,
    content: string,
    baseVersion: number,
    actor: string,
    role: string,
  ) => any;
  hostCopy: (room: any, rel: string, content: string, actor: string, role: string) => any;
  ownerRoom: (room: any) => any;
  guestRoom: (room: any, viewerId: string) => any;
  sharedList: (room: any) => any[];
  housekeeping: (room: any) => void;
  bindHostSocket: (room: any, ws: FakeWs, id: string) => void;
}

let base = '';
let root = '';
// ⚠️ 这里刻意用 `any`：本文件要借 `CollabService` 的 **private** 成员来驱动状态机
// （`private` 只在编译期生效），用具体类型会被 `strictNullChecks` 挡住链式取值，
// 而给十几处加 `!` 只会让判据更难读。构造的仍然是**真类**，跑的是**真实现**。
let svc: any;
let rt: Internals;

/**
 * ⚠️ 目录布局是有讲究的：`root` **不是** mkdtemp 出来的那一层，而是它的子目录 `proj`。
 * 于是 `root/..` 正好是**我自己的** `base` —— 「越界」类用例要往"项目外"写文件时，
 * 写到的就是 `base`，而 `afterEach` 会把整个 `base` 删掉。
 *
 * 为什么必须这样：最初我让 `root` 直接是 mkdtemp 的目录，`root/..` 就落到了系统 `%TEMP%` 根上。
 * 跑变异探针时，"拿掉越界防护"的那条变异**真的**在 `%TEMP%` 里留下了一个文件，
 * 而后面每一条探针都会因此多出一条**假的**失败 —— 观测工具污染了结论。
 * 现在越界写只会落在 `base` 里，随用例一起销毁。
 */
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'mm-collab-'));
  root = join(base, 'proj');
  mkdirSync(root);
  svc = new CollabService();
  rt = svc as unknown as Internals;
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** 真实写一个项目内文件 */
function put(rel: string, content = 'hello'): string {
  const abs = join(root, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

/** 走真实路由表发一个 POST —— 全程零 socket */
async function post(room: any, url: string, body: unknown): Promise<any> {
  const res = fakeRes();
  await rt.handleHttp(room, fakeReq('POST', url, body), res);
  return { status: res.status, body: res.json(), headers: res.headers };
}

async function req(room: any, method: string, url: string): Promise<any> {
  const res = fakeRes();
  await rt.handleHttp(room, fakeReq(method, url), res);
  return { status: res.status, body: res.json(), headers: res.headers };
}

// ─────────────────────────────────────────────────────────────

describe('HTTP 路由表（假 req/res，零 socket）', () => {
  it('OPTIONS 预检 → 204 且不回 body（webview 里跨源请求靠它）', async () => {
    const r = await req(makeRoom(root), 'OPTIONS', '/collab/join');
    expect(r.status).toBe(204);
    expect(r.body).toBe(null);
  });

  it('每个响应都带 CORS + no-store（判据：漏掉 no-store 观测值就变）', async () => {
    const r = await req(makeRoom(root), 'GET', '/collab/hello');
    expect(r.headers['access-control-allow-origin']).toBe('*');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['content-type']).toContain('application/json');
  });

  it('GET /collab/hello → 成员数 = 成员 + 1（房主自己）', async () => {
    const room = makeRoom(root);
    expect((await req(room, 'GET', '/collab/hello')).body).toMatchObject({
      ok: true,
      protocol: COLLAB_PROTOCOL,
      roomName: '房主',
      members: 1,
    });
    addMember(room, 'm1');
    addMember(room, 'm2');
    // 回归护栏：真加两个成员后必须变成 3 —— 否则上面那个 1 只是巧合
    expect((await req(room, 'GET', '/collab/hello')).body.members).toBe(3);
  });

  it('未知路径 → 404 not-found', async () => {
    expect((await post(makeRoom(root), '/collab/nope', {})).body).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('/collab/state：成员 → 房间快照；待批准 → pending；都没有 → joinRoomClosed', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    room.pending.set('r1', { id: 'r1', name: 'x', accountId: '', at: 1, ws: null });

    expect((await post(room, '/collab/state', { id: 'm1' })).body).toMatchObject({
      ok: true,
      room: { self: 'guest' },
    });
    expect((await post(room, '/collab/state', { id: 'r1' })).body).toEqual({
      ok: true,
      pending: true,
    });
    expect((await post(room, '/collab/state', { id: 'ghost' })).body).toEqual({
      ok: false,
      error: 'joinRoomClosed',
    });
  });

  it('/collab/leave 删成员或待批准，并且都回 ok:true（幂等）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    room.pending.set('r1', { id: 'r1', name: 'x', accountId: '', at: 1, ws: null });
    expect((await post(room, '/collab/leave', { id: 'm1' })).body).toEqual({ ok: true });
    expect((await post(room, '/collab/leave', { id: 'r1' })).body).toEqual({ ok: true });
    expect(room.members.size).toBe(0);
    expect(room.pending.size).toBe(0);
    expect((await post(room, '/collab/leave', { id: 'nobody' })).body).toEqual({ ok: true });
  });

  it('房间已关闭（active=false）→ /collab/hello 仍然应答，但加入会被拒', async () => {
    const room = makeRoom(root, { active: false });
    expect((await req(room, 'GET', '/collab/hello')).status).toBe(200);
    const j = await post(room, '/collab/join', {
      protocol: COLLAB_PROTOCOL,
      code: '123456',
      name: 'A',
      accountId: 'a',
    });
    expect(j.body.error).toBe('joinRoomClosed');
  });
});

describe('加入流程（handleJoin）：协议 / 加入码 / 有效期 / 同账号', () => {
  const good = () => ({
    protocol: COLLAB_PROTOCOL,
    code: '123456',
    name: '小李',
    accountId: 'acct-li',
  });

  it('协议版本不符 → joinIncompatibleRoom，且**不**留待批准记录', async () => {
    const room = makeRoom(root);
    const r = await post(room, '/collab/join', { ...good(), protocol: COLLAB_PROTOCOL + 1 });
    expect(r.body).toEqual({ ok: false, error: 'joinIncompatibleRoom' });
    expect(room.pending.size).toBe(0);
  });

  it('加入码错 / 空 → joinInvalidCode', async () => {
    const room = makeRoom(root);
    expect((await post(room, '/collab/join', { ...good(), code: '000000' })).body.error).toBe(
      'joinInvalidCode',
    );
    expect((await post(room, '/collab/join', { ...good(), code: '   ' })).body.error).toBe(
      'joinInvalidCode',
    );
  });

  it('★ 加入码**过期**（10 分钟）后被拒 —— 这条漏了界面完全看不出来', async () => {
    const room = makeRoom(root, { codeExpiresAt: Date.now() - 1 });
    expect((await post(room, '/collab/join', good())).body.error).toBe('joinInvalidCode');
    // 回归护栏：只把过期时间挪回未来，同一个 code 就必须放行
    room.codeExpiresAt = Date.now() + 1000;
    expect((await post(room, '/collab/join', good())).body.ok).toBe(true);
  });

  it('加入码前后空格会被 trim（用户复制粘贴常带空格）', async () => {
    const room = makeRoom(root);
    expect((await post(room, '/collab/join', { ...good(), code: ' 123456 ' })).body.ok).toBe(true);
  });

  it('同一个身份三处都算重复：房主自己 / 已在房间 / 已在待批准', async () => {
    const room = makeRoom(root);
    expect((await post(room, '/collab/join', { ...good(), accountId: 'acct-owner' })).body.error).toBe(
      'joinSameAccountNotAllowed',
    );

    const room2 = makeRoom(root);
    addMember(room2, 'm1', { accountId: 'acct-li' });
    expect((await post(room2, '/collab/join', good())).body.error).toBe('joinSameAccountNotAllowed');

    const room3 = makeRoom(root);
    room3.pending.set('r1', { id: 'r1', name: 'x', accountId: 'acct-li', at: 1, ws: null });
    expect((await post(room3, '/collab/join', good())).body.error).toBe('joinSameAccountNotAllowed');
  });

  it('★ 已修复：accountId 为空串时**也要**做同账号判定（身份退化成显示名）', async () => {
    // 原判据（现状固化）：`if (accountId) { ... }` ⇒ 空 accountId 整段跳过，
    //   一个没带安装 id 的客户端可以反复申请、`pending` 堆成一串（= 假守卫）。
    // 修法：身份键 `identityKey(accountId, name)` —— 有 id 用 `acct:<id>`，
    //   没有就退化成 `name:<显示名>`。带 id 的行为**完全不变**（见上一条）。
    const room = makeRoom(root);
    const a = await post(room, '/collab/join', { ...good(), accountId: '' });
    expect(a.body).toMatchObject({ ok: true, pending: true });
    expect(room.pending.size).toBe(1);

    // 回归护栏①：同一身份（同名 + 无 id）再申请 → 挡回，且**没有**多出一条
    const again = await post(room, '/collab/join', { ...good(), accountId: '' });
    expect(again.body).toEqual({ ok: false, error: 'joinSameAccountNotAllowed' });
    expect(room.pending.size).toBe(1);

    // 回归护栏②：**不同名**的无 id 客户端仍然放行（否则就是"把匿名端一刀切封掉"，
    //   那是另一个 bug：房间里本来就可以有多个人）
    const other = await post(room, '/collab/join', { ...good(), accountId: '', name: '另一个名字' });
    expect(other.body).toMatchObject({ ok: true, pending: true });
    expect(room.pending.size).toBe(2);
  });

  it('★ 匿名端的去重只发生在**匿名端之间**（有 id 的一律按 id 判，互不干扰）', async () => {
    // 这不是"没修好"，而是"没有稳定身份"的**固有边界**，必须如实钉住：
    //   房主的身份键是 `acct:<安装 id>`（`startHost` 必传非空 accountId），
    //   匿名端是 `name:房主` —— 两者**不可能相等**，所以匿名端冒用房主名混进来时，
    //   服务端**无法识别**（除非改用"按名字比房主名"这种启发式，那会误伤一个
    //   真的把自己命名为「房主」的队友）。已在报告里单列，不假装能判。
    const room = makeRoom(root);
    const impersonate = await post(room, '/collab/join', {
      protocol: COLLAB_PROTOCOL,
      code: '123456',
      name: '房主',
      accountId: '',
    });
    expect(impersonate.body).toMatchObject({ ok: true, pending: true });

    // 但"有 id 的房主自己"仍然被挡（上一条用例的三处判定里的第一处）
    expect(
      (await post(room, '/collab/join', { ...good(), code: '123456', accountId: 'acct-owner' })).body,
    ).toEqual({ ok: false, error: 'joinSameAccountNotAllowed' });

    // 回归护栏：匿名端撞的是**匿名端**时挡得住（上一条用例已覆盖，这里再钉一次不同名放行）
    expect(room.pending.size).toBe(1);
  });

  it('★ 重复点「请求加入」：两种身份**都被挡回**，都不堆待批准记录', async () => {
    // 原判据：带 accountId 时被挡回；不带的走「复用同一条待批准」。
    // 那个"复用"分支与"同身份不能重复加入"**语义互斥** —— `taken` 已经把 pending
    // 算进去了，所以它在**任何**输入下都不可达（带 id 时早就不可达了），故本次一并删除。
    // ⚠️ 如果产品其实想要"重复点 = 静默复用（不报错）"，要改的是 `taken` 的次序，
    //    那属于产品决策 —— 已在报告里单列，不在这批里私自定。
    const room = makeRoom(root);
    expect((await post(room, '/collab/join', good())).body).toMatchObject({ ok: true, pending: true });
    const again = await post(room, '/collab/join', good());
    expect(again.body).toEqual({ ok: false, error: 'joinSameAccountNotAllowed' });
    expect(room.pending.size).toBe(1); // 关键：没有堆成两条

    const room2 = makeRoom(root);
    await post(room2, '/collab/join', { ...good(), accountId: '' });
    const b2 = await post(room2, '/collab/join', { ...good(), accountId: '' });
    expect(b2.body).toEqual({ ok: false, error: 'joinSameAccountNotAllowed' });
    expect(room2.pending.size).toBe(1);
  });

  it('★ 身份键的两个命名空间不能互相冒充（`acct:` / `name:` 前缀）', async () => {
    // 匿名端（没有安装 id）拿**别人的 accountId 原文**当自己的显示名 ——
    // 不能因此被当成那个人（挡回），也不能反过来把那个人挤掉。
    // 回归护栏：若去掉前缀（`return a || name`），两者的身份键都变成 `acct-li` → 这条会红。
    const room = makeRoom(root);
    addMember(room, 'm1', { name: '小李', accountId: 'acct-li' });
    const r = await post(room, '/collab/join', {
      protocol: COLLAB_PROTOCOL,
      code: '123456',
      name: 'acct-li',
      accountId: '',
    });
    expect(r.body).toMatchObject({ ok: true, pending: true });
    expect(room.pending.size).toBe(1);
  });

  it('名字空白 → 默认「队友」', async () => {
    const room = makeRoom(root);
    await post(room, '/collab/join', { ...good(), name: '   ' });
    expect([...room.pending.values()][0]!.name).toBe('队友');
  });

  it('新申请：requestId 是 UUID、pending 里 ws 为 null（等 WS 连上才绑）', async () => {
    const room = makeRoom(root);
    const r = await post(room, '/collab/join', good());
    expect(r.body).toMatchObject({ ok: true, pending: true });
    expect(r.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const p = room.pending.get(r.body.requestId);
    expect(p.name).toBe('小李');
    expect(p.accountId).toBe('acct-li');
    expect(p.ws).toBe(null);
  });
});

describe('审批与成员状态机', () => {
  /** 造一个「房主 + 一条待批准」的房间，并把 svc 挂上去 */
  function hostWithPending(): { room: any; requestId: string; ws: FakeWs } {
    const room = makeRoom(root);
    const ws = fakeWs();
    room.pending.set('r1', { id: 'r1', name: '小李', accountId: 'acct-li', at: Date.now(), ws });
    rt.host = room;
    return { room, requestId: 'r1', ws };
  }

  it('没有房间时，所有房主操作都返回 null（不抛）', () => {
    expect(rt.host).toBe(null);
    expect(svc.approve('r1', 'editor')).toBe(null);
    expect(svc.reject('r1')).toBe(null);
    expect(svc.removeMember('m1')).toBe(null);
    expect(svc.setAutoApproveTasks(true)).toBe(null);
    expect(svc.decideTask('t1', true)).toBe(null);
    expect(svc.setTaskStatus('t1', 'queued')).toBe(null);
    expect(svc.refreshCode()).toBe(null);
    expect(svc.shareFile('a.txt')).toBe(null);
    expect(svc.unshareFile('a.txt')).toBe(null);
    expect(svc.snapshot()).toBe(null);
    expect(svc.currentProjectId()).toBe(null);
    expect(svc.isHosting()).toBe(false);
    expect(svc.isJoining()).toBe(false);
  });

  it('批准 → 待批准转成员，角色 owner 被降级成 editor（房主唯一）', () => {
    const { room, requestId } = hostWithPending();
    const info = svc.approve(requestId, 'owner');
    expect(room.pending.size).toBe(0);
    expect(room.members.size).toBe(1);
    const m = room.members.get('r1');
    expect(m.role).toBe('editor');
    expect(m.id).toBe('r1'); // 沿用待批准阶段的 id
    expect(m.online).toBe(true);
    expect(typeof m.joinedAt).toBe('number');
    expect(info.members.map((x: any) => x.role)).toEqual(['owner', 'editor']);
  });

  it('批准 viewer 保持 viewer；批准 editor 保持 editor', () => {
    const a = hostWithPending();
    expect(svc.approve('r1', 'viewer').members[1].role).toBe('viewer');
    expect(a.room.members.get('r1').role).toBe('viewer');

    const b = hostWithPending();
    expect(svc.approve('r1', 'editor').members[1].role).toBe('editor');
    expect(b.room.members.size).toBe(1);
  });

  it('批准不存在的 requestId → 返回当前快照，不新增成员、不抛', () => {
    const { room } = hostWithPending();
    const info = svc.approve('ghost', 'editor');
    expect(room.members.size).toBe(0);
    expect(info.members).toHaveLength(1);
  });

  it('★ 同一个 requestId 批准两次是幂等的（第二次不会多出一个人）', () => {
    const { room, requestId } = hostWithPending();
    svc.approve(requestId, 'editor');
    svc.approve(requestId, 'editor');
    expect(room.members.size).toBe(1);
  });

  it('批准时把房间快照推给该成员那条 ws（沿用连接，客户端不用重连）', () => {
    const { requestId, ws } = hostWithPending();
    svc.approve(requestId, 'editor');
    const rooms = ws.sent.filter((e: any) => e.type === 'room');
    expect(rooms[0]).toMatchObject({ type: 'room', room: { self: 'guest', active: true } });
    // ★ 观察项：新成员实际会收到**两条一模一样**的快照 ——
    //   `pushAll(room)` 已经覆盖了刚加入的他，后面那次显式 `pushSocket` 是冗余的。
    //   幂等（UI 只是重复 setState），无害；只是别把这里当"必须推两次"。
    expect(rooms).toHaveLength(2);
  });

  it('拒绝 → 删待批准 + 给对端发 rejected 帧并关连接', () => {
    const { room, requestId, ws } = hostWithPending();
    const info = svc.reject(requestId);
    expect(room.pending.size).toBe(0);
    expect(room.members.size).toBe(0);
    expect(ws.sent.at(-1)).toEqual({ type: 'rejected' });
    expect(ws.closed).toBe(true);
    expect(info.pending).toHaveLength(0);
  });

  it('移除成员 → 成员消失 + 对端收到 closed/joinRoomClosed', () => {
    const { room } = hostWithPending();
    svc.approve('r1', 'editor');
    const ws = room.members.get('r1').ws as FakeWs;
    svc.removeMember('r1');
    expect(room.members.size).toBe(0);
    // 批准时已经推过一条房间快照，所以要取**最后**一条
    expect(ws.sent.at(-1)).toEqual({ type: 'closed', error: 'joinRoomClosed' });
    expect(ws.closed).toBe(true);
  });

  it('「换一个」加入码：旧码立刻失效、有效期重置', () => {
    const { room } = hostWithPending();
    const old = room.code;
    const before = room.codeExpiresAt;
    const info = svc.refreshCode();
    expect(info.code).toBe(room.code);
    expect(room.code).toMatch(/^\d{6}$/);
    expect(room.code).not.toBe(old);
    expect(room.codeExpiresAt).toBeGreaterThanOrEqual(before);
  });

  it('★ 换码后旧码真的用不了（判据必须走真实的加入流程，不能只看 code 变了）', async () => {
    const { room } = hostWithPending();
    const old = room.code;
    svc.refreshCode();
    const r = await post(room, '/collab/join', {
      protocol: COLLAB_PROTOCOL,
      code: old,
      name: 'X',
      accountId: 'acct-x',
    });
    expect(r.body.error).toBe('joinInvalidCode');
  });

  it('开着「自动批准任务」时，已有的待批准任务一起转成 queued', () => {
    const { room } = hostWithPending();
    addTask(room, 't1', { from: '队友A', status: 'pending' });
    addTask(room, 't2', { from: '队友B', title: 'b', status: 'rejected', at: 2 });
    const info = svc.setAutoApproveTasks(true);
    expect(room.tasks.map((t: any) => t.status)).toEqual(['queued', 'rejected']);
    expect(info.autoApproveTasks).toBe(true);
  });

  it('关掉自动批准不会把已 queued 的任务退回 pending', () => {
    const { room } = hostWithPending();
    addTask(room, 't1', { from: 'A' });
    svc.setAutoApproveTasks(false);
    expect(room.tasks[0].status).toBe('queued');
    expect(room.autoApproveTasks).toBe(false);
  });

  it('房主批准/拒绝队员任务；不存在的 taskId → 不抛、不新增', () => {
    const { room } = hostWithPending();
    addTask(room, 't1', { from: 'A', status: 'pending' });
    svc.decideTask('t1', false);
    expect(room.tasks[0].status).toBe('rejected');
    svc.decideTask('t1', true);
    expect(room.tasks[0].status).toBe('queued');
    expect(svc.decideTask('ghost', true).tasks).toHaveLength(1);
  });

  it('回写任务执行状态：done / failed 之类都能落', () => {
    const { room } = hostWithPending();
    addTask(room, 't1', { from: 'A' });
    svc.setTaskStatus('t1', 'done');
    expect(room.tasks[0].status).toBe('done');
    expect(svc.setTaskStatus('ghost', 'done').tasks[0].status).toBe('done');
  });
});

describe('房间视图（房主 / 队员看到的东西不一样）', () => {
  function twoMemberRoom(): any {
    const room = makeRoom(root);
    addMember(room, 'm1', { name: '小李' });
    addMember(room, 'm2', { name: '小王', role: 'viewer', online: false });
    room.pending.set('r9', { id: 'r9', name: '待批准的人', accountId: '', at: 1, ws: null });
    return room;
  }

  it('房主视图：self=host，成员第 0 条是自己（id=owner / role=owner / self=true）', () => {
    const info = rt.ownerRoom(twoMemberRoom());
    expect(info.self).toBe('host');
    expect(info.active).toBe(true);
    expect(info.members[0]).toMatchObject({ id: 'owner', name: '房主', role: 'owner', self: true });
    expect(info.members.map((m: any) => m.self)).toEqual([true, false, false]);
  });

  it('房主视图带待批准名单，队员视图**恒为空**（队员不该看到谁在申请）', () => {
    const room = twoMemberRoom();
    expect(rt.ownerRoom(room).pending.map((p: any) => p.name)).toEqual(['待批准的人']);
    expect(rt.guestRoom(room, 'm1').pending).toEqual([]);
  });

  it('队员视图：self=guest，只有 viewerId 那一条 self=true；离线成员 online=false', () => {
    const info = rt.guestRoom(twoMemberRoom(), 'm2');
    expect(info.self).toBe('guest');
    expect(info.members.map((m: any) => m.self)).toEqual([false, false, true]);
    expect(info.members.map((m: any) => m.online)).toEqual([true, true, false]);
    expect(info.members.find((m: any) => m.id === 'm2').role).toBe('viewer');
  });

  it('队员视图不带「加入码」（码只在房主界面显示，队员不需要）', () => {
    const info = rt.guestRoom(twoMemberRoom(), 'm1');
    expect(info.code).toBeUndefined();
    expect(info.codeExpiresAt).toBeUndefined();
    expect(rt.ownerRoom(twoMemberRoom()).code).toBe('123456');
  });

  it('address 是 `主机:端口` 形状（界面把它展示给队友抄）', () => {
    const info = rt.ownerRoom(twoMemberRoom());
    expect(info.address).toMatch(/^[0-9.]+:\d+$/);
  });

  it('共享清单在两个视图里顺序一致（按路径排序，界面顺序才不会跳）', () => {
    const room = twoMemberRoom();
    room.shared.set('b.txt', { path: 'b.txt', version: 1, by: 'x', updatedAt: 1 });
    room.shared.set('a.txt', { path: 'a.txt', version: 1, by: 'x', updatedAt: 1 });
    room.shared.set('a/z.txt', { path: 'a/z.txt', version: 1, by: 'x', updatedAt: 1 });
    expect(rt.sharedList(room).map((s: any) => s.path)).toEqual(['a.txt', 'a/z.txt', 'b.txt']);
    expect(rt.ownerRoom(room).sharedFiles.map((s: any) => s.path)).toEqual(
      rt.guestRoom(room, 'm1').sharedFiles.map((s: any) => s.path),
    );
  });

  it('任务快照的「我的」按**身份**判，且是**拷贝**（改快照不会污染房间状态）', () => {
    const room = makeRoom(root);
    addTask(room, 't1', { from: '房主' }); // 作者默认 = 房主
    const info = rt.ownerRoom(room);
    expect(info.tasks[0].mine).toBe(true);
    info.tasks[0].title = '被改了';
    expect(room.tasks[0].title).toBe('a');
    // 反恒真：同一条任务，对**别人**看不是「我的」
    addMember(room, 'm1');
    expect(rt.guestRoom(room, 'm1').tasks[0].mine).toBe(false);
  });
});

describe('★ 已修复：任务的「我的」按**稳定身份**判，不按名字', () => {
  it('两个同名队员各建一条任务 → **各自只看到自己的**（默认名都是「队友」也一样）', () => {
    // 原判据（现状固化）：`from` 记 `member.name`、`mine` 比 `member.name`
    //   ⇒ 两人都看到 mine=true（`from` 同为「队友」）。
    // 修法：作者身份记 `member.id`（`room.taskAuthors`），显示名只用于展示。
    const room = makeRoom(root);
    addMember(room, 'm1', { name: '队友' });
    addMember(room, 'm2', { name: '队友' });
    addTask(room, 't1', { from: '队友', status: 'pending' }, 'm1');
    addTask(room, 't2', { from: '队友', title: 'b', status: 'pending' }, 'm2');

    expect(rt.guestRoom(room, 'm1').tasks.map((t: any) => [t.id, t.mine])).toEqual([
      ['t1', true],
      ['t2', false],
    ]);
    expect(rt.guestRoom(room, 'm2').tasks.map((t: any) => [t.id, t.mine])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
  });

  it('房主与队员**同名**时也能分清：队员的任务对房主不是「我的」', () => {
    const room = makeRoom(root); // ownerName = '房主'
    addMember(room, 'm1', { name: '房主' });
    addTask(room, 't1', { from: '房主', status: 'pending' }, 'm1'); // 队员提的（名字与房主撞）
    addTask(room, 't2', { from: '房主', title: 'b', status: 'pending' }); // 房主自己提的

    expect(rt.ownerRoom(room).tasks.map((t: any) => [t.id, t.mine])).toEqual([
      ['t1', false],
      ['t2', true],
    ]);
    // 回归护栏：队员看这两条，只有 t1 是自己的
    expect(rt.guestRoom(room, 'm1').tasks.map((t: any) => [t.id, t.mine])).toEqual([
      ['t1', true],
      ['t2', false],
    ]);
  });

  it('走**真实路径**（房主 submitTask / 队员 POST /collab/task）时身份也是对的', async () => {
    // 上面两条是直接造数据；这条走产品代码，证明写身份那一步真的接上了
    const room = makeRoom(root);
    addMember(room, 'm1', { name: '队友' });
    addMember(room, 'm2', { name: '队友' });
    rt.host = room;
    await svc.submitTask({ title: '房主提的', prompt: '' });
    await post(room, '/collab/task', { id: 'm1', title: 'm1 提的', prompt: '' });
    await post(room, '/collab/task', { id: 'm2', title: 'm2 提的', prompt: '' });

    expect(room.tasks.map((t: any) => t.title)).toEqual(['房主提的', 'm1 提的', 'm2 提的']);
    expect(rt.ownerRoom(room).tasks.map((t: any) => t.mine)).toEqual([true, false, false]);
    expect(rt.guestRoom(room, 'm1').tasks.map((t: any) => t.mine)).toEqual([false, true, false]);
    expect(rt.guestRoom(room, 'm2').tasks.map((t: any) => t.mine)).toEqual([false, false, true]);
    // ★ 身份**没有**泄漏到上线数据里（`tasks` 是直接 `{...t}` 发给渲染层的）
    expect(Object.keys(room.tasks[0]).sort()).toEqual(['at', 'from', 'id', 'mine', 'prompt', 'status', 'title']);
  });
});

describe('共享文件 · 加入共享清单（shareFile）', () => {
  it('共享一个真实文本文件 → 进清单、version=1、by 是房主名', () => {
    put('a.txt', 'hi');
    const room = makeRoom(root);
    rt.host = room;
    const info = svc.shareFile('a.txt');
    expect(info.sharedFiles).toEqual([
      { path: 'a.txt', version: 1, by: '房主', updatedAt: expect.any(Number) },
    ]);
  });

  it('★ 幂等：重复共享**不会**把版本号重置回 1（否则队友手上的基版本会瞬间失效）', () => {
    put('a.txt', 'hi');
    const room = makeRoom(root);
    rt.host = room;
    svc.shareFile('a.txt');
    room.shared.get('a.txt').version = 7;
    svc.shareFile('a.txt');
    expect(room.shared.get('a.txt').version).toBe(7);
    expect(room.shared.size).toBe(1);
  });

  it('反斜杠写法归一成正斜杠（Windows 上界面传过来的是反斜杠）', () => {
    put('sub/a.txt', 'hi');
    const room = makeRoom(root);
    rt.host = room;
    expect(svc.shareFile('sub\\a.txt').sharedFiles.map((s: any) => s.path)).toEqual(['sub/a.txt']);
  });

  it('拒绝共享：不存在的文件 / 目录 / 二进制 / 过大 / 越界', () => {
    put('ok.txt', 'x');
    mkdirSync(join(root, 'adir'));
    writeFileSync(join(root, 'bin.txt'), Buffer.from([0x41, 0x00, 0x42]));
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(512 * 1024 + 1));
    writeFileSync(join(root, 'edge.txt'), 'x'.repeat(512 * 1024)); // 正好卡在上限上
    const room = makeRoom(root);
    rt.host = room;

    for (const bad of ['nope.txt', 'adir', 'bin.txt', 'big.txt', '../outside.txt', 'C:/x.txt']) {
      svc.shareFile(bad);
    }
    expect(room.shared.size).toBe(0);

    // 回归护栏：正好等于上限的要能共享（> 才拒）
    svc.shareFile('edge.txt');
    svc.shareFile('ok.txt');
    expect([...room.shared.keys()].sort()).toEqual(['edge.txt', 'ok.txt']);
  });

  it('unshareFile 移出清单但**不动磁盘上的文件**', () => {
    const abs = put('a.txt', 'hi');
    const room = makeRoom(root);
    rt.host = room;
    svc.shareFile('a.txt');
    svc.unshareFile('a.txt');
    expect(room.shared.size).toBe(0);
    expect(readFileSync(abs, 'utf8')).toBe('hi'); // 回归护栏：文件还在
    expect(svc.unshareFile('a.txt').sharedFiles).toEqual([]); // 幂等
  });
});

describe('共享文件 · 读（经真实路由 /collab/file-read）', () => {
  function sharedRoom(rel: string, content = 'disk-content'): { room: any; abs: string } {
    const abs = put(rel, content);
    const room = makeRoom(root);
    addMember(room, 'm1');
    room.shared.set(rel, { path: rel, version: 3, by: '房主', updatedAt: 1 });
    return { room, abs };
  }

  it('成员读已共享文件 → ok + 磁盘上的版本与内容', async () => {
    const { room } = sharedRoom('a.txt');
    const r = await post(room, '/collab/file-read', { id: 'm1', path: 'a.txt' });
    expect(r.body).toEqual({ ok: true, path: 'a.txt', version: 3, content: 'disk-content' });
  });

  it('★ 非成员（未批准/已被移除）→ fileFailed，**不泄露「未共享」这个区别**', async () => {
    // 若这里回了 fileNotShared，就等于告诉没进门的人"项目里确实有 a.txt"
    const { room } = sharedRoom('a.txt');
    const r = await post(room, '/collab/file-read', { id: 'ghost', path: 'a.txt' });
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe('fileFailed');
  });

  it('成员读未共享的文件 → fileNotShared', async () => {
    const { room } = sharedRoom('a.txt');
    put('secret.txt', 's');
    expect((await post(room, '/collab/file-read', { id: 'm1', path: 'secret.txt' })).body.error).toBe(
      'fileNotShared',
    );
  });

  it('★ 路径越界一律 fileFailed（哪怕清单里被人塞了越界键）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    writeFileSync(join(root, '..', 'outside-collab.txt'), 'TOP SECRET');
    for (const evil of ['../outside-collab.txt', 'a/../../outside-collab.txt', '/etc/passwd', 'C:/Windows/win.ini']) {
      room.shared.set(evil, { path: evil, version: 1, by: 'x', updatedAt: 1 });
      const r = await post(room, '/collab/file-read', { id: 'm1', path: evil });
      expect(r.body).toMatchObject({ ok: false, error: 'fileFailed' });
      expect(r.body.content).toBe('');
    }
  });

  it('共享条目还在但文件被删了 → fileFailed（不是 ok+空内容）', async () => {
    const { room, abs } = sharedRoom('a.txt');
    rmSync(abs);
    expect((await post(room, '/collab/file-read', { id: 'm1', path: 'a.txt' })).body).toMatchObject({
      ok: false,
      error: 'fileFailed',
      content: '',
    });
  });

  it('二进制（含 NUL）与超 512KB 的文件读不了', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    writeFileSync(join(root, 'bin.txt'), Buffer.from([0x41, 0x00, 0x42]));
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(512 * 1024 + 1));
    for (const f of ['bin.txt', 'big.txt']) {
      room.shared.set(f, { path: f, version: 1, by: 'x', updatedAt: 1 });
    }
    expect((await post(room, '/collab/file-read', { id: 'm1', path: 'bin.txt' })).body.error).toBe(
      'fileFailed',
    );
    expect((await post(room, '/collab/file-read', { id: 'm1', path: 'big.txt' })).body.error).toBe(
      'fileFailed',
    );
  });

  it('路径是目录 → fileFailed（只共享文本文件）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    mkdirSync(join(root, 'adir'));
    room.shared.set('adir', { path: 'adir', version: 1, by: 'x', updatedAt: 1 });
    expect((await post(room, '/collab/file-read', { id: 'm1', path: 'adir' })).body.error).toBe(
      'fileFailed',
    );
  });

  it('中文与空格路径能正常读（真落盘真读回）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    put('文档 目录/我的 论文.tex', '\\documentclass{article}');
    room.shared.set('文档 目录/我的 论文.tex', {
      path: '文档 目录/我的 论文.tex',
      version: 1,
      by: 'x',
      updatedAt: 1,
    });
    const r = await post(room, '/collab/file-read', {
      id: 'm1',
      path: '文档 目录/我的 论文.tex',
    });
    expect(r.body.ok).toBe(true);
    expect(r.body.content).toBe('\\documentclass{article}');
  });
});

describe('共享文件 · 写（房主权威 + 乐观并发）', () => {
  function writableRoom(role = 'editor'): { room: any; abs: string } {
    const abs = put('a.txt', 'v1-content');
    const room = makeRoom(root);
    addMember(room, 'm1', { role });
    room.shared.set('a.txt', { path: 'a.txt', version: 1, by: '房主', updatedAt: 1 });
    return { room, abs };
  }

  it('基版本对上 → 落盘、版本 +1、返回新内容', async () => {
    const { room, abs } = writableRoom();
    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: 'a.txt',
      content: 'mine',
      baseVersion: 1,
    });
    expect(r.body).toEqual({ ok: true, path: 'a.txt', version: 2, content: 'mine' });
    expect(readFileSync(abs, 'utf8')).toBe('mine'); // ★ 真的写进磁盘了
    expect(room.shared.get('a.txt').version).toBe(2);
  });

  it('★ 基版本对不上 → fileConflict，带回**磁盘上的**最新内容（界面据此给三选一）', async () => {
    const { room, abs } = writableRoom();
    // 别人先写了一次：v1 → v2，磁盘变成 other
    room.shared.get('a.txt').version = 2;
    writeFileSync(abs, 'other', 'utf8');

    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: 'a.txt',
      content: 'mine',
      baseVersion: 1,
    });
    expect(r.body).toMatchObject({ ok: false, error: 'fileConflict', version: 2, diskVersion: 2 });
    expect(r.body.content).toBe('other'); // 不是 'mine'
    // ★ 回归护栏：冲突时**绝不能**碰磁盘 —— 否则就是静默覆盖队友刚写的内容
    expect(readFileSync(abs, 'utf8')).toBe('other');
  });

  it('查看者写入 → fileReadOnly，且磁盘一字未改', async () => {
    const { room, abs } = writableRoom('viewer');
    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: 'a.txt',
      content: 'mine',
      baseVersion: 1,
    });
    expect(r.body).toMatchObject({ ok: false, error: 'fileReadOnly' });
    expect(readFileSync(abs, 'utf8')).toBe('v1-content');
    expect(room.shared.get('a.txt').version).toBe(1);
  });

  it('未共享 → fileNotShared；非成员 → fileFailed（不泄露文件是否存在）', async () => {
    const { room } = writableRoom();
    put('other.txt', 'x');
    expect(
      (
        await post(room, '/collab/file-write', {
          id: 'm1',
          path: 'other.txt',
          content: 'a',
          baseVersion: 1,
        })
      ).body.error,
    ).toBe('fileNotShared');
    expect(
      (
        await post(room, '/collab/file-write', {
          id: 'ghost',
          path: 'a.txt',
          content: 'a',
          baseVersion: 1,
        })
      ).body.error,
    ).toBe('fileFailed');
  });

  it('越界路径写入 → fileFailed，且项目外那个文件**没被动过**', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    // 「项目外」= `base`（root 的父目录），随 afterEach 一起删掉，不会漏到 %TEMP%
    writeFileSync(join(root, '..', 'outside-write.txt'), 'ORIGINAL');
    room.shared.set('../outside-write.txt', { path: '../outside-write.txt', version: 1, by: 'x', updatedAt: 1 });
    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: '../outside-write.txt',
      content: 'PWNED',
      baseVersion: 1,
    });
    expect(r.body).toMatchObject({ ok: false, error: 'fileFailed' });
    expect(readFileSync(join(root, '..', 'outside-write.txt'), 'utf8')).toBe('ORIGINAL');
  });

  it('内容超 512KB → fileFailed（不是在磁盘上留半个文件）', async () => {
    const { room, abs } = writableRoom();
    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: 'a.txt',
      content: 'x'.repeat(512 * 1024 + 1),
      baseVersion: 1,
    });
    expect(r.body).toMatchObject({ ok: false, error: 'fileFailed' });
    expect(readFileSync(abs, 'utf8')).toBe('v1-content');
  });

  it('连续写入：版本号单调递增，且 by / updatedAt 被更新', async () => {
    const { room } = writableRoom();
    let base = 1;
    for (const v of [2, 3, 4]) {
      const r = await post(room, '/collab/file-write', {
        id: 'm1',
        path: 'a.txt',
        content: `c${v}`,
        baseVersion: base,
      });
      expect(r.body.version).toBe(v);
      base = v;
    }
    expect(room.shared.get('a.txt').by).toBe('队友m1');
    expect(room.shared.get('a.txt').updatedAt).toBeGreaterThan(1);
  });

  it('★ 落盘后把 {type:file} 帧广播给房间里每个人（队员界面实时看到别人改的内容）', async () => {
    const { room } = writableRoom();
    const ws1 = fakeWs();
    const ws2 = fakeWs();
    room.members.set('m1', { ...room.members.get('m1'), ws: ws1 });
    addMember(room, 'm2', { ws: ws2 });

    await post(room, '/collab/file-write', { id: 'm1', path: 'a.txt', content: 'new', baseVersion: 1 });
    for (const ws of [ws1, ws2]) {
      const fileFrames = ws.sent.filter((e: any) => e.type === 'file');
      expect(fileFrames).toHaveLength(1);
      expect(fileFrames[0]).toMatchObject({ type: 'file', path: 'a.txt', version: 2, content: 'new', by: '队友m1' });
    }
  });

  it('离线成员（readyState 不是 OPEN）不会被推、也不会抛', async () => {
    const { room } = writableRoom();
    const dead = fakeWs(3 /* CLOSED */);
    room.members.set('m1', { ...room.members.get('m1'), ws: dead });
    const r = await post(room, '/collab/file-write', { id: 'm1', path: 'a.txt', content: 'n', baseVersion: 1 });
    expect(r.body.ok).toBe(true);
    expect(dead.sent).toEqual([]);
  });

  it('baseVersion 传成非数字（NaN）→ 判为冲突，不会误写', async () => {
    const { room, abs } = writableRoom();
    const r = await post(room, '/collab/file-write', {
      id: 'm1',
      path: 'a.txt',
      content: 'mine',
      baseVersion: 'abc',
    });
    expect(r.body.error).toBe('fileConflict');
    expect(readFileSync(abs, 'utf8')).toBe('v1-content');
  });

  it('缺 baseVersion 字段 → Number(0)，与 version=1 对不上 → 冲突（不是静默覆盖）', async () => {
    const { room, abs } = writableRoom();
    const r = await post(room, '/collab/file-write', { id: 'm1', path: 'a.txt', content: 'mine' });
    expect(r.body.error).toBe('fileConflict');
    expect(readFileSync(abs, 'utf8')).toBe('v1-content');
  });
});

describe('共享文件 · 另存（hostCopy，「覆盖 / 放弃 / 另存」里的第三条路）', () => {
  function copyRoom(role = 'editor'): { room: any } {
    const room = makeRoom(root);
    addMember(room, 'm1', { role });
    put('a.txt', 'disk');
    room.shared.set('a.txt', { path: 'a.txt', version: 1, by: '房主', updatedAt: 1 });
    return { room };
  }

  it('另存 → 生成 a-副本.txt、内容是我手上的、自动进共享清单', async () => {
    const { room } = copyRoom();
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: 'MINE' });
    expect(r.body).toMatchObject({ ok: true, path: 'a-副本.txt', version: 1 });
    expect(r.body.savedAs).toBe('a-副本.txt');
    expect(readFileSync(join(root, 'a-副本.txt'), 'utf8')).toBe('MINE');
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('disk'); // ★ 原文件没被动
    expect(room.shared.get('a-副本.txt').version).toBe(1);
  });

  it('同名副本已存在 → 依次 -副本2 / -副本3（序号连排，不覆盖已有的副本）', async () => {
    const { room } = copyRoom();
    put('a-副本.txt', 'first');
    const r1 = await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: '2' });
    expect(r1.body.savedAs).toBe('a-副本2.txt');
    const r2 = await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: '3' });
    expect(r2.body.savedAs).toBe('a-副本3.txt');
    expect(readFileSync(join(root, 'a-副本.txt'), 'utf8')).toBe('first'); // 老副本原样
  });

  it('子目录里的文件 → 副本落在同一层（sub/a-副本.txt）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    put('sub/a.txt', 'disk');
    room.shared.set('sub/a.txt', { path: 'sub/a.txt', version: 1, by: 'x', updatedAt: 1 });
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: 'sub/a.txt', content: 'M' });
    expect(r.body.savedAs).toBe('sub/a-副本.txt');
    expect(readFileSync(join(root, 'sub/a-副本.txt'), 'utf8')).toBe('M');
  });

  it('查看者另存 → fileReadOnly，磁盘上**不会**多出副本', async () => {
    const { room } = copyRoom('viewer');
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: 'M' });
    expect(r.body).toMatchObject({ ok: false, error: 'fileReadOnly' });
    expect(() => readFileSync(join(root, 'a-副本.txt'), 'utf8')).toThrow();
  });

  it('编辑者另存未共享的文件 → fileNotShared，磁盘上不会多出副本', async () => {
    // 回归守卫：`hostCopy` 曾经**漏**了 `room.shared` 检查（read/write 都有），
    // 于是「另存」成了绕过共享边界的旁路 —— 编辑者能给房主没共享的路径写一份副本。
    // 上面那 3 条另存用例全用共享过的 a.txt，所以这个洞穿了 94 条测试。
    const room = makeRoom(root);
    addMember(room, 'm1', { role: 'editor' });
    put('secret.txt', 'disk');
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: 'secret.txt', content: 'M' });
    expect(r.body).toMatchObject({ ok: false, error: 'fileNotShared' });
    expect(() => readFileSync(join(root, 'secret-副本.txt'), 'utf8')).toThrow();
  });

  it('★ 现状固化：无扩展名 / 点文件 / 多段扩展的副本命名', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    for (const f of ['README', '.env', 'a.tar.gz']) put(f, 'x');
    const got: Record<string, string> = {};
    for (const f of ['README', '.env', 'a.tar.gz']) {
      room.shared.set(f, { path: f, version: 1, by: 'x', updatedAt: 1 });
      got[f] = (await post(room, '/collab/file-copy', { id: 'm1', path: f, content: 'M' })).body.savedAs;
    }
    // 无扩展名 → 后缀直接接在名字后面；点文件 extname 为空 → 同理；gz 是"扩展名"
    expect(got).toEqual({ README: 'README-副本', '.env': '.env-副本', 'a.tar.gz': 'a.tar-副本.gz' });
  });

  it('原名里已经含「-副本」也能另存（候选名不同，不会自我冲突）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    put('a-副本.txt', 'x');
    room.shared.set('a-副本.txt', { path: 'a-副本.txt', version: 1, by: 'x', updatedAt: 1 });
    expect(
      (await post(room, '/collab/file-copy', { id: 'm1', path: 'a-副本.txt', content: 'M' })).body
        .savedAs,
    ).toBe('a-副本-副本.txt');
  });

  it('越界路径另存 → fileFailed，项目外不生成任何文件', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    room.shared.set('../evil.txt', { path: '../evil.txt', version: 1, by: 'x', updatedAt: 1 });
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: '../evil.txt', content: 'M' });
    expect(r.body).toMatchObject({ ok: false, error: 'fileFailed' });
    // 用 existsSync 而不是 `expect(fn).toThrow()`：报错信息直接说明"文件被造出来了"，
    // 也让"越界防护被拿掉"这条变异一眼可读
    expect(existsSync(join(root, '..', 'evil-副本.txt'))).toBe(false);
    expect(existsSync(join(root, '..', 'evil.txt'))).toBe(false);
  });

  it('★ 99 个副本都占满 → 放弃并回 fileFailed（上限边界，不无限试）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    put('a.txt', 'disk');
    put('a-副本.txt', 'x');
    for (let i = 2; i <= 99; i += 1) put(`a-副本${i}.txt`, 'x');
    room.shared.set('a.txt', { path: 'a.txt', version: 1, by: 'x', updatedAt: 1 });
    const r = await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: 'M' });
    expect(r.body).toMatchObject({ ok: false, error: 'fileFailed' });
    // 回归护栏：删掉一个号，立刻就能用上那个号（说明是"找空位"而不是"随机撞"
    rmSync(join(root, 'a-副本50.txt'));
    expect(
      (await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: 'M' })).body.savedAs,
    ).toBe('a-副本50.txt');
  });

  it('另存也算一次文件事件（队员界面能看到新副本出现）', async () => {
    const { room } = copyRoom();
    const ws = fakeWs();
    room.members.set('m1', { ...room.members.get('m1'), ws });
    await post(room, '/collab/file-copy', { id: 'm1', path: 'a.txt', content: 'M' });
    expect(ws.sent.filter((e: any) => e.type === 'file')).toHaveLength(1);
  });
});

describe('心跳与清理（handleHeartbeat / housekeeping）', () => {
  it('成员心跳 → ok + 房间快照，并刷新 lastSeen', async () => {
    const room = makeRoom(root);
    const m = addMember(room, 'm1');
    m.lastSeen = 1;
    const r = await post(room, '/collab/heartbeat', { id: 'm1' });
    expect(r.body).toMatchObject({ ok: true, room: { self: 'guest' } });
    expect(room.members.get('m1').lastSeen).toBeGreaterThan(1);
  });

  it('★ 掉线后回来的成员：online 从 false 变回 true 并推送（界面「（离线）」消失）', async () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    const m = addMember(room, 'm1', { online: false, ws });
    const events: any[] = [];
    svc.on('event', (e: any) => events.push(e));

    const r = await post(room, '/collab/heartbeat', { id: 'm1' });
    expect(room.members.get('m1').online).toBe(true);
    expect(r.body.room.members.find((x: any) => x.id === 'm1').online).toBe(true);
    expect(events.some((e) => e.type === 'room')).toBe(true);
    expect(ws.sent.some((e: any) => e.type === 'room')).toBe(true);
    expect(m.online).toBe(true);
  });

  it('已经是 online 的成员心跳不再重复推送（省流量）', async () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    addMember(room, 'm1', { ws });
    await post(room, '/collab/heartbeat', { id: 'm1' });
    expect(ws.sent).toEqual([]);
  });

  it('待批准阶段的心跳 → {ok:true, pending:true}；未知 id → joinRoomClosed', async () => {
    const room = makeRoom(root);
    room.pending.set('r1', { id: 'r1', name: 'x', accountId: '', at: 1, ws: null });
    expect((await post(room, '/collab/heartbeat', { id: 'r1' })).body).toEqual({ ok: true, pending: true });
    expect((await post(room, '/collab/heartbeat', { id: 'ghost' })).body).toEqual({
      ok: false,
      error: 'joinRoomClosed',
    });
  });

  it('housekeeping：超过 20s 没心跳 → 标离线（成员仍在房间里）', () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    addMember(room, 'm2');
    room.members.get('m1').lastSeen = Date.now() - 21_000;
    room.members.get('m2').lastSeen = Date.now() - 19_000; // 边界内侧

    rt.housekeeping(room);
    expect(room.members.get('m1').online).toBe(false);
    expect(room.members.get('m2').online).toBe(true); // 回归护栏
    expect(room.members.size).toBe(2);
  });

  it('housekeeping：超过 5 分钟 → 移出房间并关连接', () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    addMember(room, 'm1', { ws });
    room.members.get('m1').lastSeen = Date.now() - 5 * 60_000 - 1;

    rt.housekeeping(room);
    expect(room.members.size).toBe(0);
    expect(ws.sent[0]).toEqual({ type: 'closed', error: 'joinRoomClosed' });
    expect(ws.closed).toBe(true);
  });

  it('housekeeping：4 分钟（离 5 分钟还差一点）不踢人，只标离线', () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    room.members.get('m1').lastSeen = Date.now() - 4 * 60_000;
    rt.housekeeping(room);
    expect(room.members.size).toBe(1);
    expect(room.members.get('m1').online).toBe(false);
  });

  it('housekeeping 幂等：已离线的不会被反复推送', () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    addMember(room, 'm1', { online: false, ws });
    room.members.get('m1').lastSeen = Date.now() - 60_000;
    rt.housekeeping(room);
    rt.housekeeping(room);
    expect(ws.sent).toEqual([]);
  });

  it('★ 房间已关闭时 housekeeping 直接返回（不会去动一个已经结束的房间）', () => {
    const room = makeRoom(root, { active: false });
    const ws = fakeWs();
    addMember(room, 'm1', { ws });
    room.members.get('m1').lastSeen = 0; // 早就该被踢了
    rt.housekeeping(room);
    expect(room.members.size).toBe(1);
    expect(ws.sent).toEqual([]);
  });

  it('WS 断开：对应成员的 ws 置回 null（重连后才能重新绑上）', () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    const ws2 = fakeWs();
    addMember(room, 'm1');
    addMember(room, 'm2');
    rt.bindHostSocket(room, ws, 'm1');
    rt.bindHostSocket(room, ws2, 'm2');
    expect(room.members.get('m1').ws).toBe(ws);

    ws.emit('close');
    expect(room.members.get('m1').ws).toBe(null);
    // 回归护栏：另一个人的连接不受影响（否则两个人会一起掉线）
    expect(room.members.get('m2').ws).toBe(ws2);
  });

  it('WS 连接的 id 既不是成员也不是待批准 → 立刻推开并关掉（防伪造 id 白嫖推送）', () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    rt.bindHostSocket(room, ws, 'ghost');
    expect(ws.sent[0]).toEqual({ type: 'closed', error: 'joinRoomClosed' });
    expect(ws.closed).toBe(true);
  });

  it('待批准成员连上 WS → 只绑 ws，不发房间快照（还没被批准，不该看到房间内容）', () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    room.pending.set('r1', { id: 'r1', name: 'x', accountId: '', at: 1, ws: null });
    rt.bindHostSocket(room, ws, 'r1');
    expect(room.pending.get('r1').ws).toBe(ws);
    expect(ws.sent).toEqual([]);
  });
});

describe('任务提交（经真实路由 /collab/task）', () => {
  it('非成员提交 → joinRoomClosed（未批准的人不能给房主的 Agent 派活）', async () => {
    const room = makeRoom(root);
    expect((await post(room, '/collab/task', { id: 'ghost', title: 't', prompt: 'p' })).body).toEqual({
      ok: false,
      error: 'joinRoomClosed',
    });
    expect(room.tasks).toHaveLength(0);
  });

  it('成员提交 → 任务入库，from 是成员名字，状态取决于「自动批准」开关', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1', { name: '小李' });
    const a = await post(room, '/collab/task', { id: 'm1', title: '算一下', prompt: 'p' });
    expect(a.body.task).toMatchObject({ from: '小李', status: 'pending', mine: false });
    expect(a.body.task.id).toMatch(/^[0-9a-f-]{36}$/);

    room.autoApproveTasks = true;
    const b = await post(room, '/collab/task', { id: 'm1', title: '再来', prompt: 'p' });
    expect(b.body.task.status).toBe('queued');
  });

  it('标题超 200 字符被截断；空标题 / **纯空白**标题都回落到默认文案', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    const big = await post(room, '/collab/task', { id: 'm1', title: 'x'.repeat(500), prompt: '' });
    expect(big.body.task.title).toHaveLength(200);
    const empty = await post(room, '/collab/task', { id: 'm1', title: '', prompt: '' });
    expect(empty.body.task.title).toBe('Agent 任务');
    // 原判据（现状固化）：纯空白**不**回落（`slice(...) || 默认` 里 `'   '` 是 truthy）
    //   ⇒ 任务列表里出现一条看着"没有标题"的空行，且与 `handleJoin` 的
    //   `String(...).trim() || '队友'` 口径不一致。已修：先 `trim()` 再判空。
    const blank = await post(room, '/collab/task', { id: 'm1', title: '   ', prompt: '' });
    expect(blank.body.task.title).toBe('Agent 任务');
    // 回归护栏 + 反恒真：不是"一律回落"，真标题必须原样（只去掉首尾空白）
    const real = await post(room, '/collab/task', { id: 'm1', title: '  算一下  ', prompt: '' });
    expect(real.body.task.title).toBe('算一下');
  });

  it('房主自己提交也走同一套标题口径（本地路径与 HTTP 路径不能两条标准）', async () => {
    const room = makeRoom(root);
    rt.host = room;
    await svc.submitTask({ title: '   ', prompt: '' });
    await svc.submitTask({ title: '  来自房主  ', prompt: '' });
    await svc.submitTask({ title: 'y'.repeat(300), prompt: '' });
    expect(room.tasks.map((t: any) => t.title)).toEqual(['Agent 任务', '来自房主', 'y'.repeat(200)]);
  });

  it('prompt 原样保存（Agent 真拿它去跑，不能被截）', async () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    const long = 'p'.repeat(5000);
    const r = await post(room, '/collab/task', { id: 'm1', title: 't', prompt: long });
    expect(r.body.task.prompt).toBe(long);
  });

  it('任务提交后也给房主推了快照（房主界面要立刻出现待批准条目）', async () => {
    const room = makeRoom(root);
    const ws = fakeWs();
    addMember(room, 'm1', { ws });
    const events: any[] = [];
    svc.on('event', (e: any) => events.push(e));
    await post(room, '/collab/task', { id: 'm1', title: 't', prompt: 'p' });
    expect(events.filter((e) => e.type === 'room')).toHaveLength(1);
    expect(ws.sent.some((e: any) => e.type === 'room')).toBe(true);
  });
});

describe('真运行测试器状态：没连上任何人时的行为（不联网、不抛）', () => {
  it('既是房主也不是队员时读/写/另存都回 fileFailed（不会去 postJson 打网络）', async () => {
    // 判据：若这里漏了 `!this.guest` 守卫，就会对 undefined.baseUrl 取属性而抛
    await expect(svc.readFile('a.txt')).resolves.toMatchObject({ ok: false, error: 'fileFailed' });
    await expect(svc.writeFile('a.txt', 'x', 1)).resolves.toMatchObject({
      ok: false,
      error: 'fileFailed',
    });
    await expect(svc.saveCopy('a.txt', 'x')).resolves.toMatchObject({ ok: false, error: 'fileFailed' });
  });

  it('没有房间时 submitTask 回 false（不会尝试推送）', async () => {
    await expect(svc.submitTask({ title: 't', prompt: 'p' })).resolves.toBe(false);
  });

  it('房主提交任务 → 立刻入库，mine=true，且不经过网络', async () => {
    const room = makeRoom(root);
    rt.host = room;
    await expect(svc.submitTask({ title: '来自房主', prompt: 'p' })).resolves.toBe(true);
    expect(room.tasks).toHaveLength(1);
    expect(room.tasks[0]).toMatchObject({ from: '房主', mine: true, status: 'pending' });
    // 回归护栏：开着自动批准时房主自己的任务直接 queued
    room.autoApproveTasks = true;
    await svc.submitTask({ title: '第二个', prompt: '' });
    expect(room.tasks[1].status).toBe('queued');
  });

  it('快照里的成员数、当前项目 id 与房间一致（渲染层用它们判断「协作中的是别的项目」）', () => {
    const room = makeRoom(root);
    addMember(room, 'm1');
    rt.host = room;
    expect(svc.isHosting()).toBe(true);
    expect(svc.currentProjectId()).toBe('p1');
    expect(svc.snapshot().members).toHaveLength(2);
  });

  it('共享清单里的 updatedAt / mtime 是真实时间戳（界面按它排序显示）', () => {
    put('a.txt', 'x');
    const room = makeRoom(root);
    rt.host = room;
    svc.shareFile('a.txt');
    const entry = room.shared.get('a.txt');
    expect(entry.updatedAt).toBeGreaterThan(Date.now() - 5000);
    // 文件本身的时间戳也真实（供将来做「磁盘比共享版本新」提示）
    const t = Date.now() - 60_000;
    utimesSync(join(root, 'a.txt'), t / 1000, t / 1000);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('x');
  });
});
