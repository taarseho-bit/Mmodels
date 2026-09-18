/**
 * 数据库**加列迁移** —— 幂等，可反复执行。
 *
 * ⚠️ 为什么必须有这个文件，而不是只改 `db/index.ts` 的建表语句：
 *
 *   建表用的是 `CREATE TABLE IF NOT EXISTS`。它**只保证表存在**，
 *   对**已经建好的表不会补列**。所以老用户升级到带新列的版本后，
 *   表还是老结构，第一条 `INSERT INTO messages (…, checkpoint_ref, …)`
 *   就会 `SqliteError: no such column: checkpoint_ref` ——
 *   **表现是"会话打不开发不出消息"**，而不是一个显眼的报错。
 *
 *   这类 bug 在开发机上永远复现不了（新库是从新 SCHEMA 建的，天然有列），
 *   只在真实用户的库上炸。所以两条都要做：
 *     1. `db/index.ts` 的 SCHEMA 里加上新列（新库）
 *     2. 这里补老库（本文件）
 *   改 SCHEMA 时**顺手改这里**，否则就是"新库好、老库坏"。
 *
 * ── 为什么单独一个文件、且不 import electron / better-sqlite3 ──
 *
 *   `better-sqlite3` 是原生模块，本仓库里它是按 **Electron 的 ABI** 编译的
 *   （见 scripts/ensure-native.cjs），在纯 Node（vitest 跑的环境）下
 *   `require` 会直接抛 `NODE_MODULE_VERSION` 不匹配。
 *   迁移这段逻辑是本项目里**最需要单测**的部分（它只在老库上生效，
 *   人肉验证成本极高），所以把它写成**零原生依赖**的纯逻辑，
 *   由 `MigrationHost` 这个最小接口接真实数据库 —— 测试里换成假的宿主即可。
 */

/** 迁移逻辑需要数据库提供的最小能力 */
export interface MigrationHost {
  /** 该表当前的列名。真实实现对应 `PRAGMA table_info(<table>)` */
  columnsOf(table: string): string[];
  /** 执行一条 DDL */
  exec(sql: string): void;
}

/**
 * `messages` 表要补的列。
 *
 * 列名用**原版的 snake_case**（证据：原版 drizzle schema
 * `messages` 表里是 `checkpointRef: text('checkpoint_ref')` /
 * `agentMsgUuid: text('agent_msg_uuid')`，decoded main @428503）。
 * 复刻的内部约定本来就是 snake_case，正好一致。
 */
export const MESSAGES_COLUMNS: ReadonlyArray<{ column: string; ddl: string }> = [
  {
    column: 'checkpoint_ref',
    ddl: 'ALTER TABLE messages ADD COLUMN checkpoint_ref TEXT',
  },
  {
    column: 'agent_msg_uuid',
    ddl: 'ALTER TABLE messages ADD COLUMN agent_msg_uuid TEXT',
  },
];

/** 待执行的迁移清单（表名 + 列定义） */
export const MIGRATIONS: ReadonlyArray<{ table: string; columns: typeof MESSAGES_COLUMNS }> = [
  { table: 'messages', columns: MESSAGES_COLUMNS },
];

/**
 * 幂等补列。返回**本次真正执行**的 `表.列` 列表（空数组 = 无需迁移）。
 *
 * 幂等性靠"先查列再决定"实现，不靠版本号表 —— 版本表本身也要迁移，
 * 反而是多余的复杂度。
 */
export function migrate(host: MigrationHost): string[] {
  const applied: string[] = [];
  for (const { table, columns } of MIGRATIONS) {
    let existing: string[];
    try {
      existing = host.columnsOf(table);
    } catch {
      // 表还不存在（全新库在 exec(SCHEMA) 之前调用）—— 交给建表语句负责，跳过
      continue;
    }
    const present = new Set(existing);
    for (const { column, ddl } of columns) {
      if (present.has(column)) continue;
      host.exec(ddl);
      present.add(column);
      applied.push(`${table}.${column}`);
    }
  }
  return applied;
}
