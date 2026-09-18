/**
 * SQLite 数据库层。
 *
 * 为什么用原生 SQL 而不是 drizzle 的迁移工具链：
 *   本项目的表结构是**我们自己定义的、不再变更的**内部约定，
 *   没有外部消费者，也没有多人协作改 schema 的需求。
 *   用 `CREATE TABLE IF NOT EXISTS` 一次建好，比背一整套迁移
 *   工具链简单得多，而且启动时零额外依赖。
 *
 * 为什么不用 drizzle-orm 的 query builder：
 *   drizzle 已经装好（它的类型推导很好用），但为了让
 *   原生模块的接入面尽可能小，这里直接用 better-sqlite3 的
 *   prepared statement。drizzle 保留给后续需要复杂查询时用。
 */
import { app } from 'electron';
import { join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { migrate } from './migrate';

let db: BetterSqlite3.Database | null = null;
let dbFilePath = '';

// ─────────────────────────────────────────────────────────────
// 建表语句
// ─────────────────────────────────────────────────────────────

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- 应用级键值元数据（原版叫 app_meta，键 project-bootstrap:v1 记录默认项目）
-- 用「有没有 meta 行」区分「全新库」与「老库」，是原版的判定方式，
-- 不要改成「projects 表是否为空」—— 用户把项目全删光时语义完全不同。
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 项目：一个项目 = 一个工作目录
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  root          TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL DEFAULT 0
);

-- 会话
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT '新会话',
  provider_id     TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'idle',
  sdk_session_id  TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  message_count   INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id, updated_at DESC);

-- 消息
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  blocks      TEXT NOT NULL DEFAULT '[]',
  model       TEXT,
  created_at  INTEGER NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  -- 回退（P6）与分叉（P7）的地基，语义照抄原版：
  --   checkpoint_ref —— 这条 **user** 消息发出【之前】的工作区快照 ref。
  --                     只有 user 行写；assistant 行恒为 NULL。
  --   agent_msg_uuid —— 这条 **assistant** 消息在 agent 侧的消息 id
  --                     （原版取 agent 回的 lastAssistantUuid）。只有 assistant 行写。
  -- ⚠️ 原版 /api/sessions/:id/fork 的 resumable 判据就是
  --    kept.some(m => m.role === 'assistant' && !!m.agentMsgUuid)，
  --    所以不加这一列，分叉只能"复制消息"，拿不到 agent 上下文的续传。
  -- ⚠️ 这里加了列**还不够** —— 老库的表是早先 IF NOT EXISTS 建出来的，
  --    不会因为这段 SQL 而补列。老库靠 initDb() 末尾的 migrate() 补，
  --    两份要一起改，见 db/migrate.ts 顶部的说明。
  checkpoint_ref TEXT,
  agent_msg_uuid TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

-- 进行中回合快照：**一会话最多一行**（session_id 主键）。
--
-- 原版有同名表 turn_spills(session_id PK, message_id, content, parts, created_at, updated_at)。
-- 这里把 content/parts 合并成 blocks 一列 —— 复刻的 messages 表本来就把正文和块序列
-- 存在同一个 JSON 里（文本是块的一种），再拆一列反而多一份要对齐的事实。
--
-- 为什么需要这张表：assistant 消息要等这一轮**跑完**才 insertMessage
-- （见 ipc/session.ts 的 SEND 处理），所以「跑着的时候切走、再切回来」
-- 这一轮在 messages 表里根本不存在 —— 渲染层再怎么按会话隔离缓存也无从复原。
-- 写入策略与收尾顺序见 db/turn-spills.ts 与 ipc/session.ts。
--
-- ⚠️ 崩溃/异常退出**不清理**：留着反而有用，下次启动能看到「上次没跑完的那一轮」。
CREATE TABLE IF NOT EXISTS turn_spills (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  -- 这一轮即将落库的 assistant 消息 id（回合开始时就定好，收尾用同一个 id 落库）
  message_id TEXT NOT NULL,
  blocks     TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- 自动化任务
CREATE TABLE IF NOT EXISTS automations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  cron         TEXT NOT NULL,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_run_at  INTEGER,
  next_run_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);

-- 自动化运行历史
CREATE TABLE IF NOT EXISTS automation_runs (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  session_id     TEXT,
  status         TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  finished_at    INTEGER,
  summary        TEXT,
  error          TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_automation ON automation_runs(automation_id, started_at DESC);
`;

// ─────────────────────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────────────────────

export function initDb(): string {
  if (db) return dbFilePath;

  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  dbFilePath = join(dir, 'mmodels.db');

  db = new Database(dbFilePath);
  // WAL 模式下读写并发更友好；busy_timeout 防止偶发 SQLITE_BUSY
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);

  // ⚠️ 建表是 `CREATE TABLE IF NOT EXISTS`，**不会给已存在的表补列**。
  //    老用户的库必须靠这一步拿到新列，否则第一次 INSERT 就
  //    `no such column` —— 表现是"会话打不开"，见 db/migrate.ts。
  const live = db;
  const applied = migrate({
    columnsOf: (table) =>
      (live.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name),
    exec: (sql) => live.exec(sql),
  });
  if (applied.length > 0) {
    console.log(`[db] 已补列：${applied.join(', ')}`);
  }

  return dbFilePath;
}

/** 拿数据库句柄。未初始化时直接抛错，避免调用方拿到 null 后到处判空。 */
export function getDb(): BetterSqlite3.Database {
  if (!db) throw new Error('数据库尚未初始化，请先调用 initDb()');
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.close();
  } finally {
    db = null;
  }
}

export function getDbPath(): string {
  return dbFilePath;
}
