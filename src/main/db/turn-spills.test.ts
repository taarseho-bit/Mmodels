/**
 * `turn_spills`（进行中回合快照）的回归测试。
 *
 * 这条链要修的是用户实机反馈的 bug：**切换会话/项目后再切回来，
 * 助手回复的「过程」（思考块、工具调用块）和任务清单就没了**。
 * 渲染层已经按会话隔离缓存修过一轮，这里是**数据源层**：
 * 进行中的那一轮在 `messages` 表里根本不存在（assistant 消息是跑完才落库的），
 * 所以要靠 `turn_spills` 让 `session.get` 把进行中的块序列带出来。
 *
 * ⚠️ 这里**不 import better-sqlite3**：它按 Electron ABI 编译，在 vitest（纯 Node）
 *    里 require 会抛 NODE_MODULE_VERSION 不匹配。测试用 **`node:sqlite` 的
 *    `DatabaseSync`**（Node 22 内置）跑**真的 SQLite**：
 *      · 建表语句是从 `db/index.ts` 的 SCHEMA 里**逐字取出来的**，
 *        所以"DDL 写错了 / 表名拼错了"这类错会被真跑出来，而不是被假宿主放过；
 *      · UPSERT、主键冲突、外键级联这些语义都是真的（假宿主演不出来）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { ContentBlock, StreamEvent } from '@shared/types';
import { applyStreamEvent } from '../ipc/stream-blocks';
import {
  SPILL_THROTTLE_MS,
  clearSpill,
  inflightOf,
  isStaleSpill,
  readSpill,
  shouldFlushSpill,
  writeSpill,
} from './turn-spills';

/**
 * `node:sqlite` 走 createRequire 而不是 `import`：
 *   vitest 底下的 vite 5 不认识 `node:sqlite` 这个还带实验标记的内置模块，
 *   静态 import 会被它当普通依赖去解析，报
 *   `Failed to load url sqlite (resolved id: sqlite). Does the file exist?`。
 *   这里绕开 vite 的静态解析，拿到的仍是 Node 内置的那份。
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type SqliteDb = InstanceType<typeof DatabaseSync>;

// ─────────────────────────────────────────────────────────────
// 测试脚手架：从源码里取真实建表语句，跑真 SQLite
// ─────────────────────────────────────────────────────────────

const DB_SRC = readFileSync(join(process.cwd(), 'src', 'main', 'db', 'index.ts'), 'utf8');
const SESSION_SRC = readFileSync(join(process.cwd(), 'src', 'main', 'ipc', 'session.ts'), 'utf8');

/** 从 `db/index.ts` 源码里抠出 SCHEMA 常量（与 initDb() 实际 exec 的是同一份字符串） */
function schemaSql(): string {
  const marker = 'const SCHEMA = `';
  const start = DB_SRC.indexOf(marker);
  const end = DB_SRC.indexOf('`;', start);
  expect(start, 'db/index.ts 里找不到 SCHEMA 常量').toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const sql = DB_SRC.slice(start + marker.length, end);
  // 模板字符串里出现反引号会把常量提前截断 —— 这里顺手把这条"静默截断"钉住
  expect(sql).not.toContain('`');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS turn_spills');
  return sql;
}

/** 去掉 `turn_spills` 的建表段 = 老库的形状（升级前） */
function schemaWithoutTurnSpills(): string {
  const sql = schemaSql();
  const start = sql.indexOf('CREATE TABLE IF NOT EXISTS turn_spills');
  const end = sql.indexOf(');', start);
  return sql.slice(0, start) + sql.slice(end + 2);
}

function hasTable(db: SqliteDb, name: string): boolean {
  return (
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name) !== undefined
  );
}

function countOf(db: SqliteDb, table: string): number {
  return (db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as { c: number }).c;
}

function addSession(db: SqliteDb, id: string): void {
  db.prepare(
    `INSERT INTO sessions (id, project_id, title, provider_id, model, status, created_at, updated_at, message_count)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, 'p1', 'T', '', '', 'running', 1, 1, 0);
}

/** 一个"会话已存在、可以往里写"的库。`withTurnSpills:false` 用来演老库 */
function freshDb(withTurnSpills = true): SqliteDb {
  const db = new DatabaseSync(':memory:');
  db.exec(withTurnSpills ? schemaSql() : schemaWithoutTurnSpills());
  db.prepare(
    `INSERT INTO projects (id, name, root, created_at, updated_at, last_opened_at)
     VALUES (?,?,?,?,?,?)`,
  ).run('p1', 'P', 'C:/tmp/p1', 1, 1, 1);
  addSession(db, 's1');
  return db;
}

/**
 * 落一条 assistant 消息 —— 形状与 `ipc/session.ts` 的 `insertMessage` 一致。
 * 测试自己插是为了能控制 `created_at`（陈旧判定要按时间戳对比）。
 */
function insertAssistant(
  db: SqliteDb,
  sessionId: string,
  id: string,
  blocks: ContentBlock[],
  createdAt: number,
): void {
  db.prepare(
    `INSERT INTO messages (id, session_id, role, blocks, created_at, input_tokens, output_tokens)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, sessionId, 'assistant', JSON.stringify(blocks), createdAt, 0, 0);
}

// ─────────────────────────────────────────────────────────────
// 写侧 / 读侧的真实 SQL 语义
// ─────────────────────────────────────────────────────────────

describe('turn_spills —— 一会话一行', () => {
  it('同一会话写两次只剩一行，且内容是最新那次（不是追加）', () => {
    const db = freshDb();
    const first: ContentBlock[] = [{ kind: 'thinking', text: '想' }];
    const second: ContentBlock[] = [
      { kind: 'thinking', text: '想' },
      { kind: 'text', text: '答' },
    ];

    writeSpill(db, 's1', 'm-1', first, 1_000);
    writeSpill(db, 's1', 'm-1', second, 1_300);

    expect(countOf(db, 'turn_spills')).toBe(1);
    const row = readSpill(db, 's1')!;
    expect(row.updated_at).toBe(1_300);
    // ★ 关键断言：是**覆盖**而不是追加 —— 快照的语义是"现在屏幕上是什么"
    expect(JSON.parse(row.blocks)).toEqual(second);
  });

  it('不同会话各占一行，互不覆盖', () => {
    const db = freshDb();
    addSession(db, 's2');

    writeSpill(db, 's1', 'm-1', [{ kind: 'text', text: 'A' }], 1_000);
    writeSpill(db, 's2', 'm-2', [{ kind: 'text', text: 'B' }], 1_100);

    expect(countOf(db, 'turn_spills')).toBe(2);
    expect(JSON.parse(readSpill(db, 's1')!.blocks)).toEqual([{ kind: 'text', text: 'A' }]);
    expect(JSON.parse(readSpill(db, 's2')!.blocks)).toEqual([{ kind: 'text', text: 'B' }]);
  });

  it('会话被删时快照跟着走（否则会留下永久读不到的孤儿行）', () => {
    const db = freshDb();
    writeSpill(db, 's1', 'm-1', [{ kind: 'text', text: 'A' }], 1_000);

    db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');

    expect(countOf(db, 'turn_spills')).toBe(0);
  });

  it('空块序列不写 —— 否则 session.get 会返回一个空的 inflight', () => {
    const db = freshDb();

    writeSpill(db, 's1', 'm-1', [], 1_000);

    expect(readSpill(db, 's1')).toBeUndefined();
    expect(inflightOf(db, 's1')).toBeUndefined();
  });
});

describe('turn_spills —— 收尾', () => {
  it('收尾路径（先落最终消息、再删快照）之后：行没了，且最终消息的 blocks 与快照逐块一致', () => {
    const db = freshDb();

    // 用**真实的流事件**喂出块序列，而不是手搓一个期望值 —— 这样
    // "快照存的东西"与"最终落库的东西"是同一份来源，比对才有意义
    const collected: ContentBlock[] = [];
    const frames: StreamEvent[] = [
      { type: 'block-start', index: 0, kind: 'thinking' },
      { type: 'thinking-delta', index: 0, delta: '先看题目' },
      { type: 'block-start', index: 1, kind: 'text' },
      { type: 'text-delta', index: 1, delta: '我打算' },
      { type: 'text-delta', index: 1, delta: '先读配置' },
      { type: 'tool-use', toolName: 'TaskCreate', toolUseId: 'tu1', input: { subject: '读配置' } },
      { type: 'tool-result', toolUseId: 'tu1', result: 'Task #1 created successfully: 读配置' },
    ];
    let at = 2_000;
    for (const ev of frames) {
      applyStreamEvent(collected, ev);
      writeSpill(db, 's1', 'm-fin', collected.filter(Boolean), at);
      at += 10;
    }
    const snapshot = JSON.parse(readSpill(db, 's1')!.blocks) as ContentBlock[];
    expect(snapshot.map((b) => b.kind)).toEqual(['thinking', 'text', 'tool_use']);
    // 工具结果也进了快照（任务面板就是从这类块折出来的）
    expect(snapshot[2].toolResult).toBe('Task #1 created successfully: 读配置');

    // ── 收尾（顺序与 ipc/session.ts 的 `.then()` 一致）──
    insertAssistant(db, 's1', 'm-fin', snapshot, at);
    clearSpill(db, 's1');

    expect(readSpill(db, 's1')).toBeUndefined();
    expect(countOf(db, 'turn_spills')).toBe(0);
    expect(inflightOf(db, 's1')).toBeUndefined();

    const stored = JSON.parse(
      (db.prepare('SELECT blocks FROM messages WHERE id = ?').get('m-fin') as { blocks: string })
        .blocks,
    ) as ContentBlock[];
    // ★ 逐块比对（不是"长度对得上"）
    expect(stored).toEqual(snapshot);
    expect(stored.map((b) => b.kind)).toEqual(['thinking', 'text', 'tool_use']);
  });

  /**
   * ★ 这条是**反向对照的靶子**（详见文件末尾"反向对照"一节）。
   *
   * 上面那条断言的是 store 的语义，它不可能因为"session.ts 里删快照那一行没了"而红；
   * 真正会漏的是**收尾没删**——库里留下一行陈旧快照，用户切回来会看到
   * "已完成的消息旁边又挂了一份重复的过程和任务清单"。
   * 那件事只发生在 `ipc/session.ts` 的 `.then()` 里，所以这里对它做结构断言
   * （本仓库既有模式，见 `db/migrate.test.ts` 的两条"结构级判据"）。
   */
  it('session.ts 的收尾真的删了快照，而且是「先落库、再删」（这两点漏一个就有重复过程）', () => {
    const finish = finishBlockSource();

    expect(finish, '收尾块里没有 insertMessage —— 提取锚点漂了？').toContain('insertMessage(');
    expect(finish, '★ 收尾没有删进行中快照：切回来会看到重复的过程').toContain('clearSpill(');
    expect(
      finish.indexOf('insertMessage('),
      '顺序反了：先删快照再落库，两步之间被杀会同时丢过程与消息',
    ).toBeLessThan(finish.indexOf('clearSpill('));
    // 空 blocks 时也要删（这一轮已经结束，就不该再有"进行中回合"）：
    // clearSpill 必须在 `if (blocks.length)` 那个分支**外面**
    const ifAt = finish.indexOf('if (blocks.length)');
    expect(ifAt).toBeGreaterThan(-1);
    const closeAt = matchingBrace(finish, finish.indexOf('{', ifAt));
    expect(closeAt).toBeGreaterThan(ifAt);
    expect(finish.indexOf('clearSpill('), '本轮没有输出时快照也必须删掉').toBeGreaterThan(closeAt);
  });
});

describe('turn_spills —— 陈旧快照必须被当成不存在', () => {
  it('消息已落库 ⇒ 快照是残留：session.get 不返回 inflight，且那行被清掉', () => {
    const db = freshDb();
    const snap: ContentBlock[] = [{ kind: 'text', text: '半截' }];
    writeSpill(db, 's1', 'm-old', snap, 5_000);
    // 收尾落了消息（created_at 晚于最后一次快照写入），但快照没删干净
    insertAssistant(db, 's1', 'm-old', snap, 5_400);

    expect(inflightOf(db, 's1')).toBeUndefined(); // 当不存在
    expect(readSpill(db, 's1')).toBeUndefined(); // 且顺手删了
    expect(countOf(db, 'turn_spills')).toBe(0);
  });

  it('边界：消息落库与最后一次快照写入落在**同一毫秒**时也算残留（用 < 会漏判）', () => {
    const db = freshDb();
    const snap: ContentBlock[] = [{ kind: 'text', text: '半截' }];
    writeSpill(db, 's1', 'm-same', snap, 6_000);
    insertAssistant(db, 's1', 'm-same', snap, 6_000);

    expect(inflightOf(db, 's1')).toBeUndefined();
    expect(readSpill(db, 's1')).toBeUndefined();
  });

  it('反向对照的另一半：**真正进行中**的一轮不会被误判成残留，也不会被删', () => {
    const db = freshDb();
    const snap: ContentBlock[] = [
      { kind: 'thinking', text: '想' },
      { kind: 'tool_use', toolName: 'Bash', toolUseId: 'tu9', toolInput: { command: 'ls' } },
    ];
    writeSpill(db, 's1', 'm-live', snap, 7_000);

    expect(inflightOf(db, 's1')).toEqual({ blocks: snap, messageId: 'm-live', updatedAt: 7_000 });
    expect(readSpill(db, 's1')).toBeDefined();
  });

  it('isStaleSpill 的三条边界', () => {
    const row = { session_id: 's', message_id: 'm', blocks: '[]', updated_at: 1_000 };
    expect(isStaleSpill(row, null), '消息还没落库 = 正在跑').toBe(false);
    expect(isStaleSpill(row, 999), '消息比最后一次快照还早 —— 快照更新，留着').toBe(false);
    expect(isStaleSpill(row, 1_000), '同毫秒也要判为残留').toBe(true);
    expect(isStaleSpill(row, 1_001)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 迁移：老库升级
// ─────────────────────────────────────────────────────────────

describe('迁移 —— 老库（没有 turn_spills）升级后表存在且不丢数据', () => {
  it('跑一次建表语句表就有；再跑一次不报错、不重复建、数据不动', () => {
    const db = freshDb(false); // 老库形状
    // 老库里的真实数据：一条用户消息
    db.prepare(
      `INSERT INTO messages (id, session_id, role, blocks, created_at, input_tokens, output_tokens)
       VALUES (?,?,?,?,?,?,?)`,
    ).run('m-old', 's1', 'user', JSON.stringify([{ kind: 'text', text: '旧数据' }]), 5, 0, 0);

    expect(hasTable(db, 'turn_spills'), '老库本来不该有这张表').toBe(false);

    // ★ 升级：initDb() 对老库做的就是这个 exec（CREATE TABLE IF NOT EXISTS 补表）
    db.exec(schemaSql());
    expect(hasTable(db, 'turn_spills')).toBe(true);

    // 幂等：再跑一次不报错（表已存在也不重复建）
    expect(() => db.exec(schemaSql())).not.toThrow();
    expect(hasTable(db, 'turn_spills')).toBe(true);

    // 数据一条不少、内容不变
    expect(countOf(db, 'messages')).toBe(1);
    const kept = db.prepare('SELECT blocks FROM messages WHERE id = ?').get('m-old') as {
      blocks: string;
    };
    expect(JSON.parse(kept.blocks)).toEqual([{ kind: 'text', text: '旧数据' }]);

    // 升级后的表真能用（不是"建了个空壳、一写就 no such column"）
    writeSpill(db, 's1', 'm-new', [{ kind: 'text', text: '升级后' }], 9_000);
    expect(readSpill(db, 's1')!.message_id).toBe('m-new');
  });

  it('新库（建表语句已带该表）跑一次什么都不用做，但表必须在', () => {
    const db = freshDb(true);
    expect(hasTable(db, 'turn_spills')).toBe(true);
    expect(() => db.exec(schemaSql())).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────
// 节流策略（纯函数）
// ─────────────────────────────────────────────────────────────

describe('节流策略', () => {
  it('结构事件（块边界 / 工具调用 / 工具结果）立即写，不看节流窗口', () => {
    const structural: StreamEvent[] = [
      { type: 'block-start', index: 0, kind: 'text' },
      { type: 'tool-use', toolName: 'Bash', toolUseId: 't1', input: { command: 'ls' } },
      { type: 'tool-result', toolUseId: 't1', result: 'ok' },
    ];
    for (const ev of structural) {
      // now - lastFlushAt = 1ms，远小于窗口，仍然必须写
      expect(shouldFlushSpill(1_000, 1_001, ev), ev.type).toBe(true);
    }
  });

  it('纯文本/思考增量攒够 300ms 才写', () => {
    const delta: StreamEvent = { type: 'text-delta', index: 0, delta: 'x' };
    const think: StreamEvent = { type: 'thinking-delta', index: 0, delta: 'y' };
    const notify: StreamEvent = { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };

    expect(shouldFlushSpill(1_000, 1_000 + SPILL_THROTTLE_MS - 1, delta)).toBe(false);
    expect(shouldFlushSpill(1_000, 1_000 + SPILL_THROTTLE_MS, delta)).toBe(true);
    expect(shouldFlushSpill(1_000, 1_200, think)).toBe(false);
    expect(shouldFlushSpill(1_000, 1_200, notify)).toBe(false);
    // 从没写过（lastSpillAt=0）时第一个事件就写，否则"开头几秒"切走必丢过程
    // （真实时间戳是 Date.now() 量级，now-0 远大于窗口）
    expect(shouldFlushSpill(0, 1_700_000_000_000, delta)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 结构级判据（源码扫描）
// ─────────────────────────────────────────────────────────────

/** 去掉整行注释 —— 否则"把某一行注释掉"也能让下面的断言通过，反向对照就假红了 */
function stripCommentLines(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

/** 从 `openAt` 处的 `{` 开始配对，返回与之匹配的 `}` 的下标 */
function matchingBrace(src: string, openAt: number): number {
  let depth = 0;
  for (let i = openAt; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** `ipc/session.ts` 里 SEND 处理的 `.then()` 段（收尾序列所在处） */
function finishBlockSource(): string {
  const runAt = SESSION_SRC.indexOf('void runner');
  const thenAt = SESSION_SRC.indexOf('.then(() => {', runAt);
  const catchAt = SESSION_SRC.indexOf('.catch((err: unknown) => {', thenAt);
  expect(runAt, 'session.ts 里找不到 `void runner`').toBeGreaterThan(-1);
  expect(thenAt, 'session.ts 里找不到收尾的 .then()').toBeGreaterThan(-1);
  expect(catchAt).toBeGreaterThan(thenAt);
  return stripCommentLines(SESSION_SRC.slice(thenAt, catchAt));
}

describe('结构级判据 —— 快照的 message_id 与最终落库的消息必须同源', () => {
  it('两处用的是同一个 assistantMsgId（陈旧判定的全部依据）', () => {
    const code = stripCommentLines(SESSION_SRC);

    // 写快照用的是回合开头生成的 id
    expect(code).toMatch(/writeSpill\(getDb\(\), sessionId, assistantMsgId,/);
    // 收尾落库也用同一个 id
    expect(finishBlockSource()).toContain('id: assistantMsgId');
    // ⚠️ 收尾如果又现 randomUUID()，两处就不同源了：
    //    "消息已存在"不再等价于"这一轮已收尾"，陈旧快照永远判不出来，
    //    表现为"已完成的消息旁边挂着一份重复的过程"。
    expect(finishBlockSource()).not.toContain('id: randomUUID()');
    // id 只生成一次
    expect(code.match(/assistantMsgId = randomUUID\(\)/g)).toHaveLength(1);
  });

  it('SESSION_GET 只在真有进行中回合时才带上 inflight 字段', () => {
    const code = stripCommentLines(SESSION_SRC);
    expect(code).toContain('inflightOf(getDb(), id)');
    // 写成 `inflight: undefined` / `{ blocks: [] }` 都是错的
    expect(code).not.toMatch(/inflight:\s*undefined/);
    expect(code).toMatch(/if \(inflight\) res\.inflight = inflight;/);
  });
});

/**
 * ─────────────────────────────────────────────────────────────
 * 反向对照（必须真的红过才算数）
 * ─────────────────────────────────────────────────────────────
 *
 * 把 `ipc/session.ts` 收尾里的 `clearSpill(getDb(), sessionId);` 那一行
 * **注释掉**再跑本文件，`turn_spills —— 收尾` 里的第二条必须失败，
 * 报 `★ 收尾没有删进行中快照：切回来会看到重复的过程`。
 *
 * ⚠️ 注意 `stripCommentLines` 的作用：把行注释掉之后，剩下的代码里不该再出现
 *    `clearSpill(` —— 否则"注释掉也算数"，这条反向对照就是假的。
 */
