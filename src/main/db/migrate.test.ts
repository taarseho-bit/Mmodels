/**
 * 加列迁移的回归测试 —— 这条是 P0 的**验收核心**。
 *
 * 为什么值得单独测：这段逻辑**只在老库上生效**，而开发机上是新库
 * （从新 SCHEMA 建的，天然有列），**本地永远复现不出问题**。
 * 一旦写错，用户看到的是"会话打不开"，而不是一个能定位的报错。
 *
 * ⚠️ 这里**不 import better-sqlite3**：它是按 Electron ABI 编译的原生模块，
 *    在 vitest（纯 Node）里 require 会直接抛 NODE_MODULE_VERSION 不匹配。
 *    所以被测对象是 `migrate()` 的纯逻辑 + 一个模拟 SQLite 行为的假宿主。
 *    假宿主的 `exec` 会**真解析并应用** `ALTER TABLE … ADD COLUMN`，
 *    所以它能抓到"声明的列名和 DDL 里的列名对不上"这类错。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESSAGES_COLUMNS, migrate, type MigrationHost } from './migrate';

/** 假宿主：用 Map 存"表 → 列名"，并按 SQLite 的语义应用 ALTER TABLE */
function fakeHost(initial: Record<string, string[]>): {
  host: MigrationHost;
  tables: Map<string, string[]>;
  execd: string[];
} {
  const tables = new Map(Object.entries(initial).map(([t, cols]) => [t, [...cols]]));
  const execd: string[] = [];
  return {
    tables,
    execd,
    host: {
      columnsOf(table) {
        const cols = tables.get(table);
        if (!cols) throw new Error(`no such table: ${table}`);
        return [...cols];
      },
      exec(sql) {
        execd.push(sql);
        const m = /^ALTER TABLE\s+(\S+)\s+ADD COLUMN\s+(\S+)(?:\s+\S+)?$/i.exec(sql.trim());
        if (!m) throw new Error(`假宿主不认识这条 DDL：${sql}`);
        const [, table, column] = m;
        const cols = tables.get(table);
        if (!cols) throw new Error(`no such table: ${table}`);
        // SQLite 对重复加列会报 duplicate column name
        if (cols.includes(column)) throw new Error(`duplicate column name: ${column}`);
        cols.push(column);
      },
    },
  };
}

/** 加新列之前，messages 表本来的形状 */
const OLD_MESSAGES = [
  'id',
  'session_id',
  'role',
  'blocks',
  'model',
  'created_at',
  'input_tokens',
  'output_tokens',
];

const NEW_COLUMNS = MESSAGES_COLUMNS.map((c) => c.column);

describe('migrate —— 老库补列', () => {
  it('老库（两个新列都没有）→ 两条都补上，且列真的进了表结构', () => {
    const f = fakeHost({ messages: OLD_MESSAGES });

    const applied = migrate(f.host);

    expect(applied).toEqual(['messages.checkpoint_ref', 'messages.agent_msg_uuid']);
    // ★ 关键断言：不是"没抛错"，而是**列确实出现在表里了**
    expect(f.tables.get('messages')).toEqual([...OLD_MESSAGES, ...NEW_COLUMNS]);
    expect(f.execd).toHaveLength(2);
  });

  it('幂等：紧接着再跑一次 → 什么都不做（不报 duplicate column）', () => {
    const f = fakeHost({ messages: OLD_MESSAGES });

    expect(migrate(f.host)).toHaveLength(2);
    const second = migrate(f.host);
    const third = migrate(f.host);

    expect(second).toEqual([]);
    expect(third).toEqual([]);
    expect(f.execd).toHaveLength(2); // 仍然只有第一次那两条
  });

  it('新库（建表语句已经带列）→ 一条都不执行（反向对照）', () => {
    const f = fakeHost({ messages: [...OLD_MESSAGES, ...NEW_COLUMNS] });

    expect(migrate(f.host)).toEqual([]);
    expect(f.execd).toEqual([]);
    expect(f.tables.get('messages')).toEqual([...OLD_MESSAGES, ...NEW_COLUMNS]);
  });

  it('只缺其中一列 → 只补那一列（不做"全表重建"这类过度动作）', () => {
    const f = fakeHost({ messages: [...OLD_MESSAGES, 'checkpoint_ref'] });

    expect(migrate(f.host)).toEqual(['messages.agent_msg_uuid']);
    expect(f.execd).toEqual(['ALTER TABLE messages ADD COLUMN agent_msg_uuid TEXT']);
  });

  it('表还不存在时不抛（全新库的 exec(SCHEMA) 之前被调用也要安全）', () => {
    const f = fakeHost({});

    expect(() => migrate(f.host)).not.toThrow();
    expect(migrate(f.host)).toEqual([]);
  });

  it('DDL 本身是安全的：不许 NOT NULL（SQLite 给非空表加非空列会直接失败）', () => {
    for (const { column, ddl } of MESSAGES_COLUMNS) {
      expect(ddl.toUpperCase(), column).not.toContain('NOT NULL');
      expect(ddl, column).toMatch(/^ALTER TABLE messages ADD COLUMN /);
    }
  });
});

describe('结构级判据 —— 新库的建表语句必须和迁移清单一致', () => {
  const DB_SRC = readFileSync(join(process.cwd(), 'src', 'main', 'db', 'index.ts'), 'utf8');

  it('CREATE TABLE IF NOT EXISTS messages 里带上了这两个新列', () => {
    // 只在 messages 的建表段里找，避免匹配到别处
    const start = DB_SRC.indexOf('CREATE TABLE IF NOT EXISTS messages');
    expect(start).toBeGreaterThan(-1);
    const block = DB_SRC.slice(start, DB_SRC.indexOf(');', start));

    for (const col of NEW_COLUMNS) {
      expect(block, `SCHEMA 缺列 ${col}`).toContain(col);
    }
  });

  it('initDb() 真的调用了 migrate()（写在 exec(SCHEMA) 之后）', () => {
    const schemaAt = DB_SRC.indexOf('db.exec(SCHEMA)');
    const migrateAt = DB_SRC.indexOf('migrate({');
    expect(schemaAt).toBeGreaterThan(-1);
    expect(migrateAt).toBeGreaterThan(schemaAt);
  });
});

describe('结构级判据 —— 写入侧真的把新列写进去了', () => {
  const SESSION_SRC = readFileSync(
    join(process.cwd(), 'src', 'main', 'ipc', 'session.ts'),
    'utf8',
  );

  it('insertMessage 的 INSERT 列表里有这两个列名（否则列永远为 NULL）', () => {
    for (const col of NEW_COLUMNS) {
      expect(SESSION_SRC, `INSERT 缺列 ${col}`).toContain(col);
    }
  });

  it('先保存用户消息和可取消回合，再拍快照；仍在模型/项目写入前记录快照引用', () => {
    const snapshotAt = SESSION_SRC.indexOf('await captureCheckpoint(');
    const insertAt = SESSION_SRC.indexOf('insertMessage(sessionId, userMsg');
    const turnAt = SESSION_SRC.indexOf('activeTurns.set(sessionId, activeTurn)');
    const checkpointAt = SESSION_SRC.indexOf('UPDATE messages SET checkpoint_ref');
    const prepareAt = SESSION_SRC.indexOf('opts = await buildRunOptions');
    expect(insertAt).toBeGreaterThan(-1);
    expect(turnAt).toBeGreaterThan(insertAt);
    expect(snapshotAt).toBeGreaterThan(turnAt);
    expect(checkpointAt).toBeGreaterThan(snapshotAt);
    expect(prepareAt).toBeGreaterThan(checkpointAt);
    expect(SESSION_SRC.slice(snapshotAt, prepareAt)).toContain('activeTurn.finalized');
  });
});
