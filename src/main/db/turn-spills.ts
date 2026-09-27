/**
 * 「进行中回合」快照的落盘与读取 —— 表 `turn_spills`，**一会话最多一行**。
 *
 * ## 它解决的是什么
 *
 * assistant 消息是这一轮**跑完那一刻**才 `insertMessage` 的（见 `ipc/session.ts`
 * 的 SEND 处理）。所以「跑着的时候切走、再切回来」这一轮在 `messages` 表里
 * 根本不存在 —— 渲染层再怎么按会话隔离缓存，也复原不出过程块与任务面板。
 * 主进程在这一轮进行中把块序列节流写进 `turn_spills`，切回来时由
 * `SESSION_GET` 带出（`InflightTurn`），这就是应用约定 `session_tasks` /
 * `turn_spills` 三件套里 `turn_spills` 的作用。
 *
 * ## 为什么单独一个文件、且不 import electron / better-sqlite3
 *
 *   与 `db/migrate.ts` 同一个理由：`better-sqlite3` 是按 **Electron 的 ABI**
 *   编译的原生模块，在 vitest（纯 Node）里 require 会直接抛
 *   `NODE_MODULE_VERSION` 不匹配。而"陈旧快照要能被识别并删掉"这类逻辑
 *   是本模块里**最需要单测**的部分（它只在异常路径上生效，人肉验证成本极高），
 *   所以这里只依赖一个最小的 `SpillDb` 接口（`prepare(sql)` + 变参 `run/get`），
 *   真实实现是 better-sqlite3 的 `Database`，测试里换成 `node:sqlite` 的
 *   `DatabaseSync`（两者都是 SQLite，SQL 语义一致）。
 */
import type { ContentBlock, InflightTurn, StreamEvent } from '@shared/types';

/** 快照写入的最小节流间隔（毫秒）。结构事件不受它限制，见 shouldFlushSpill */
export const SPILL_THROTTLE_MS = 300;

/** 一条 prepared statement 的最小形状（better-sqlite3 与 node:sqlite 都满足） */
export interface SpillStatement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
}

/** 快照逻辑需要数据库提供的最小能力 */
export interface SpillDb {
  prepare(sql: string): SpillStatement;
}

/** `turn_spills` 的一行（列名与建表语句按语义对应） */
export interface TurnSpillRow {
  session_id: string;
  message_id: string;
  blocks: string;
  updated_at: number;
}

/**
 * 这个流事件是不是**结构事件** —— 到了就必须立刻落盘，不能等节流窗口。
 *
 * 认三种：
 *   · `block-start`  块边界（一段思考/正文开始了）
 *   · `tool-use`     工具调用开始
 *   · `tool-result`  工具结果回来（**这一条最要紧**：任务面板是从
 *                    TaskCreate/TaskUpdate 的工具结果里折出状态的）
 * 纯 `text-delta` / `thinking-delta` 是高频增量，攒着走节流。
 *
 * ⚠️ 这个判断必须和渲染层"过程块长什么样"对齐：只按时间节流的话，
 *    一次长文本流里工具块可能被推迟几百毫秒才可见 —— 切走再切回就会
 *    看到"工具调用了但结果没了"这种半截状态。
 */
export function isStructuralSpillEvent(ev: StreamEvent): boolean {
  return ev.type === 'block-start' || ev.type === 'tool-use' || ev.type === 'tool-result';
}

/**
 * 该不该现在写快照。
 *
 * @param lastFlushAt 上一次写入的时间（`Date.now()`；从未写过传 0）
 * @param now         当前时间
 * @param ev          刚处理完的流事件
 */
export function shouldFlushSpill(lastFlushAt: number, now: number, ev: StreamEvent): boolean {
  return isStructuralSpillEvent(ev) || now - lastFlushAt >= SPILL_THROTTLE_MS;
}

/**
 * 写（或覆盖）该会话的进行中快照。
 *
 * `session_id` 是主键 ⇒ 同一会话**永远只有一行**，新的覆盖旧的（UPSERT）。
 * 这一点是有意的：快照的意义是"现在屏幕上是什么"，不是"曾经发生过什么"；
 * 后者由收尾时的 `messages.blocks` 负责。
 *
 * ⚠️ 空块序列**不写**：空快照在库里等于"没有进行中回合"，写了会让
 *    `SESSION_GET` 返回一个空的 `inflight`，渲染层会多渲染一个空气泡。
 */
export function writeSpill(
  db: SpillDb,
  sessionId: string,
  messageId: string,
  blocks: ContentBlock[],
  updatedAt: number,
): void {
  if (!blocks.length) return;
  db.prepare(
    `INSERT INTO turn_spills (session_id, message_id, blocks, updated_at)
     VALUES (?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       message_id = excluded.message_id,
       blocks     = excluded.blocks,
       updated_at = excluded.updated_at`,
  ).run(sessionId, messageId, JSON.stringify(blocks), updatedAt);
}

/** 读该会话的快照行；没有返回 undefined */
export function readSpill(db: SpillDb, sessionId: string): TurnSpillRow | undefined {
  return db
    .prepare('SELECT session_id, message_id, blocks, updated_at FROM turn_spills WHERE session_id = ?')
    .get(sessionId) as TurnSpillRow | undefined;
}

/** 删该会话的快照行（收尾时调用，见 ipc/session.ts 的收尾顺序） */
export function clearSpill(db: SpillDb, sessionId: string): void {
  db.prepare('DELETE FROM turn_spills WHERE session_id = ?').run(sessionId);
}

/**
 * 陈旧快照判定。
 *
 * 判据：**这一轮要落的那条 assistant 消息已经在 `messages` 表里了**。
 *   消息 id 在回合开始时就定好（`ipc/session.ts` 的 `assistantMsgId`），
 *   收尾时用同一个 id 落库 ⇒「消息已存在」⟺「这一轮已经收尾过」⟺
 *   这行快照是收尾路径漏删的残留（收尾是"先 insertMessage 再删快照"，
 *   两步之间进程被杀就会留下它）。
 *
 * ⚠️ 时间戳比较用 `<=` 而不是 `<`：收尾很快时 `insertMessage` 的 `created_at`
 *    会和最后一次快照写入落在**同一毫秒**，用 `<` 会判不出来。
 *    那种残留的坏处比丢过程更难排查 —— 界面上是"已完成的消息旁边
 *    又挂了一份重复的过程和任务清单"。
 *
 * @param landedCreatedAt 该 `message_id` 在 `messages` 里的 `created_at`；不存在传 null
 */
export function isStaleSpill(row: TurnSpillRow, landedCreatedAt: number | null): boolean {
  if (landedCreatedAt === null) return false;
  return row.updated_at <= landedCreatedAt;
}

/**
 * 取该会话的进行中回合快照（给 `SESSION_GET` 用）。
 *
 * 三件事一次做完，调用方不用关心细节：
 *   1. 没有快照行 → undefined（**不是**空对象，调用方据此决定"不带这个键"）
 *   2. 快照已陈旧 → **顺手删掉**并返回 undefined（否则界面会重复显示过程）
 *   3. 否则反序列化块序列返回
 */
export function inflightOf(db: SpillDb, sessionId: string): InflightTurn | undefined {
  const row = readSpill(db, sessionId);
  if (!row) return undefined;

  const landed = db
    .prepare('SELECT created_at FROM messages WHERE id = ?')
    .get(row.message_id) as { created_at: number } | undefined;

  if (isStaleSpill(row, landed ? landed.created_at : null)) {
    // 正常收尾路径漏删的残留（收尾两步之间被杀、或历史版本没删干净）。
    // 必须当它不存在，且顺手清掉 —— 留着就会一直被判为陈旧，每读一次白跑一次。
    clearSpill(db, sessionId);
    return undefined;
  }

  let blocks: ContentBlock[];
  try {
    blocks = JSON.parse(row.blocks) as ContentBlock[];
  } catch {
    // 写到一半被杀导致 JSON 截断：当作没有进行中回合，而不是把坏数据抛给渲染层
    return undefined;
  }
  if (!Array.isArray(blocks) || !blocks.length) return undefined;

  return { blocks, messageId: row.message_id, updatedAt: row.updated_at };
}
