/**
 * 导入的回归测试（**P2 的验收核心**）。
 *
 * 这一节要钉死的三件事，每一件猜错的后果都比"功能不好用"严重：
 *
 *   1. **坏文件不能毁库** —— 校验必须在**动数据库之前**。所以这里正面测 schema 的拒绝面，
 *      并从结构上断言路由里 `safeParse` 出现在 `db.transaction` 之前。
 *   2. **冲突处理照抄原版** —— `cs` 里没有 `session.id`，导入一律新 uuid，**永不覆盖**。
 *      所以 `planImport` 必须用**传入的新 id**，而不是文件里的 id（文件里压根没有）。
 *   3. **装不下的 part 不静默丢** —— 复刻的 `ContentBlock` 只有 5 种 kind，
 *      原版有 7 种 part。降级的四种必须**内容可读**且**计数回报**。
 *
 * 另外还有一条最容易写错的：`providerId` / `model` 在复刻是 `NOT NULL DEFAULT ''`，
 * 原版可空 —— `null` 必须落成 `''`，不是字符串 `'null'`、也不是漏写。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatMessage, SessionMeta } from '@shared/types';
import {
  buildExportPayload,
  partsToBlocks,
  planImport,
  sessionImportSchema,
  type SessionExportPayload,
  type SessionPart,
} from './export';

/** 一份合法的导出文件（原版 `cs` 形状） */
function file(over: Partial<SessionExportPayload> = {}): SessionExportPayload {
  return {
    format: 'mathmodel-session',
    version: 1,
    exportedAt: 1_700_000_200_000,
    session: {
      title: '导入的会话',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
    },
    messages: [],
    ...over,
  };
}

function msg(parts: unknown[]): Record<string, unknown> {
  return {
    role: 'user',
    content: '',
    parts,
    durationMs: null,
    model: null,
    effort: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    createdAt: 1_700_000_000_000,
  };
}

/** 顺序 id 生成器（让 planImport 的输出可断言） */
function seqIds(prefix = 'n'): () => string {
  let i = 0;
  return () => `${prefix}${++i}`;
}

describe('sessionImportSchema —— 信封严格（坏文件必须在这里被挡住）', () => {
  it('接受合法文件', () => {
    expect(sessionImportSchema.safeParse(file()).success).toBe(true);
  });

  it('拒绝：format 不对 / version 不是 1', () => {
    expect(sessionImportSchema.safeParse({ ...file(), format: 'other' }).success).toBe(false);
    expect(sessionImportSchema.safeParse({ ...file(), version: 2 }).success).toBe(false);
    expect(sessionImportSchema.safeParse({ ...file(), version: '1' }).success).toBe(false);
  });

  it('拒绝：随便一个 JSON 对象（`{}`）', () => {
    expect(sessionImportSchema.safeParse({}).success).toBe(false);
    expect(sessionImportSchema.safeParse(null).success).toBe(false);
    expect(sessionImportSchema.safeParse('not json').success).toBe(false);
    expect(sessionImportSchema.safeParse([1, 2, 3]).success).toBe(false);
  });

  it('拒绝：session 缺字段 / messages 不是数组 / role 不在枚举内', () => {
    const bad1 = { ...file(), session: { title: 'x' } };
    const bad2 = { ...file(), messages: { not: 'an array' } };
    const bad3 = { ...file(), messages: [{ ...msg([]), role: 'system' }] };

    expect(sessionImportSchema.safeParse(bad1).success).toBe(false);
    expect(sessionImportSchema.safeParse(bad2).success).toBe(false);
    expect(sessionImportSchema.safeParse(bad3).success).toBe(false);
  });

  it('允许：providerId / model 为 null（原版是 nullable）', () => {
    const f = file({
      session: { ...file().session, providerId: null, model: null },
    });

    expect(sessionImportSchema.safeParse(f).success).toBe(true);
  });

  it('允许：空 messages（导出一个没说过话的会话也要能导回）', () => {
    expect(sessionImportSchema.safeParse(file({ messages: [] })).success).toBe(true);
  });

  it('**parts 逐段宽松**：不认识的一段不该让整个文件被拒（原版会拒，这里有意放宽）', () => {
    const f = file({ messages: [msg([{ type: 'brand-new-part-from-the-future', x: 1 }]) as never] });

    // 反向对照：原版是 z.array(Zn)，这一段会让整个文件 400
    expect(sessionImportSchema.safeParse(f).success).toBe(true);
  });
});

describe('partsToBlocks —— 7 种 part 的映射与降级', () => {
  it('text / thinking 无损（不计数降级）', () => {
    const r = partsToBlocks([{ type: 'text', text: 'hi' }, { type: 'thinking', text: '嗯' }]);

    expect(r.blocks).toEqual([
      { kind: 'text', text: 'hi' },
      { kind: 'thinking', text: '嗯' },
    ]);
    expect(r.degraded).toBe(0);
  });

  it('tool-use：id/name/input 搬家，有 result 时带上（无损）', () => {
    const r = partsToBlocks([
      { type: 'tool-use', toolUse: { id: 't1', name: 'Bash', input: { cmd: 'ls' }, result: { text: 'ok' } } },
    ]);

    expect(r.blocks).toEqual([
      { kind: 'tool_use', toolName: 'Bash', toolUseId: 't1', toolInput: { cmd: 'ls' }, toolResult: { text: 'ok' } },
    ]);
    expect(r.degraded).toBe(0);
  });

  it('tool-use：没有 result 时不写 toolResult 键（与导出侧对称）', () => {
    const r = partsToBlocks([{ type: 'tool-use', toolUse: { id: 't1', name: 'Bash', input: {} } }]);

    expect('toolResult' in (r.blocks[0] as object)).toBe(false);
    expect(r.degraded).toBe(0);
  });

  it('attachment → `📎 {name}`（降级，但名字还在）', () => {
    const r = partsToBlocks([
      { type: 'attachment', path: '/p/a.png', name: 'a.png', mediaType: 'image/png', kind: 'image' },
    ]);

    expect(r.blocks).toEqual([{ kind: 'text', text: '📎 a.png' }]);
    expect(r.degraded).toBe(1);
  });

  it('proposed-plan → 正文完整保留（降级，但计划一个字不丢）', () => {
    const plan = '# 计划\n\n1. 读数据\n2. 建模';
    const r = partsToBlocks([{ type: 'proposed-plan', planMarkdown: plan }]);

    expect(r.blocks).toHaveLength(1);
    expect((r.blocks[0] as { text: string }).text).toContain(plan);
    expect(r.degraded).toBe(1);
  });

  it('turn-diff → 文件名与增删行数都在（降级，但不只剩一句"改动了 N 个文件"）', () => {
    const r = partsToBlocks([
      {
        type: 'turn-diff',
        files: [
          { path: 'a.tex', status: 'modified', additions: 3, deletions: 1 },
          { path: 'b.py', status: 'added', additions: 9, deletions: 0 },
        ],
      },
    ]);

    const text = (r.blocks[0] as { text: string }).text;
    expect(text).toContain('✎ File changes ×2');
    expect(text).toContain('a.tex');
    expect(text).toContain('b.py');
    expect(text).toContain('+3');
    expect(text).toContain('−1'); // U+2212，与原版 share HTML 一致
    expect(r.degraded).toBe(1);
  });

  it('turn-end：interrupted → `_Stopped_`；failed → 带错误信息（逐字用原版字面量）', () => {
    const a = partsToBlocks([{ type: 'turn-end', state: 'interrupted' }]);
    const b = partsToBlocks([{ type: 'turn-end', state: 'failed', errorMessage: '连接中断' }]);
    const c = partsToBlocks([{ type: 'turn-end', state: 'failed' }]);

    expect((a.blocks[0] as { text: string }).text).toBe('_Stopped_');
    expect((b.blocks[0] as { text: string }).text).toBe('> ⚠️ Turn failed: 连接中断');
    // 反向对照：没有 errorMessage 时不该留下一个孤零零的冒号
    expect((c.blocks[0] as { text: string }).text).toBe('> ⚠️ Turn failed');
    expect(a.degraded + b.degraded + c.degraded).toBe(3);
  });

  it('**完全无法识别的一段**：降级成它的原文，绝不丢、绝不抛', () => {
    const r = partsToBlocks([{ whatever: '这个结构我不认识' }]);

    expect(r.blocks).toHaveLength(1);
    expect((r.blocks[0] as { text: string }).text).toContain('这个结构我不认识');
    expect(r.degraded).toBe(1);
  });

  it('非对象的一段（字符串 / null）也不抛', () => {
    const r = partsToBlocks(['裸字符串', null, 42]);

    expect(r.blocks).toHaveLength(3);
    expect(r.degraded).toBe(3);
  });

  it('降级计数按"段"算，不按 block 算（一段 turn-diff 只算 1）', () => {
    const r = partsToBlocks([
      { type: 'text', text: 'a' },
      { type: 'attachment', path: 'p', name: 'n', mediaType: 'm', kind: 'file' },
      { type: 'turn-diff', files: [{ path: 'x', status: 's', additions: 1, deletions: 1 }] },
      { type: 'turn-end', state: 'interrupted' },
    ]);

    expect(r.degraded).toBe(3);
    expect(r.blocks).toHaveLength(4);
  });
});

describe('planImport —— 冲突处理与列换算（照抄原版的"只增不改"）', () => {
  it('会话 id 用**传入的新 id**（文件里根本没有 id ⇒ 永不覆盖）', () => {
    const plan = planImport(file(), 'brand-new-id', seqIds(), 999);

    expect(plan.session.id).toBe('brand-new-id');
  });

  it('每条消息都拿新 id（不去重、不改条数）', () => {
    const f = file({
      messages: [
        msg([{ type: 'text', text: 'a' }]) as never,
        msg([{ type: 'text', text: 'b' }]) as never,
        msg([{ type: 'text', text: 'a' }]) as never, // 内容重复也要三条
      ],
    });

    const plan = planImport(f, 's', seqIds('m'), 1);

    expect(plan.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('createdAt 保留文件里的值；updatedAt 用传入的 now（⇒ 导入后排在列表最前）', () => {
    const plan = planImport(file(), 's', seqIds(), 1_800_000_000_000);

    expect(plan.session.createdAt).toBe(1_700_000_000_000);
    expect(plan.session.updatedAt).toBe(1_800_000_000_000);
    expect(plan.session.updatedAt).not.toBe(plan.session.createdAt);
  });

  it('**反向对照**：providerId/model 为 null → 落成空串 `\'\'`，不是字符串 `\'null\'`', () => {
    const f = file({ session: { ...file().session, providerId: null, model: null } });
    const plan = planImport(f, 's', seqIds(), 1);

    // 复刻的列是 `TEXT NOT NULL DEFAULT ''` —— 落 null 会直接违反约束
    expect(plan.session.providerId).toBe('');
    expect(plan.session.model).toBe('');
    expect(plan.session.providerId).not.toBe('null');
  });

  it('**反向对照**：用量为 null → 落 0（列是 NOT NULL）', () => {
    const plan = planImport(file({ messages: [msg([{ type: 'text', text: 'a' }]) as never] }), 's', seqIds(), 1);

    expect(plan.messages[0].inputTokens).toBe(0);
    expect(plan.messages[0].outputTokens).toBe(0);
  });

  it('有用量时按数落库（正向对照）', () => {
    const m = { ...msg([{ type: 'text', text: 'a' }]), inputTokens: 7, outputTokens: 8 };
    const plan = planImport(file({ messages: [m as never] }), 's', seqIds(), 1);

    expect(plan.messages[0].inputTokens).toBe(7);
    expect(plan.messages[0].outputTokens).toBe(8);
  });

  it('degradedParts 汇总全文件的降级段数', () => {
    const f = file({
      messages: [
        msg([{ type: 'text', text: 'a' }]) as never,
        msg([
          { type: 'attachment', path: 'p', name: 'n', mediaType: 'm', kind: 'file' },
          { type: 'turn-end', state: 'interrupted' },
        ]) as never,
      ],
    });

    const plan = planImport(f, 's', seqIds(), 1);

    expect(plan.degradedParts).toBe(2);
    expect(plan.messages[0].degraded).toBe(0);
    expect(plan.messages[1].degraded).toBe(2);
  });

  it('空文件的会话：0 条消息、0 降级（不报错）', () => {
    const plan = planImport(file({ messages: [] }), 's', seqIds(), 1);

    expect(plan.messages).toEqual([]);
    expect(plan.degradedParts).toBe(0);
  });
});

describe('往返：导出的文件能被导入，且从第二次导出起是不动点', () => {
  const meta: SessionMeta = {
    id: 's1',
    title: 'T',
    projectId: 'p1',
    providerId: 'deepseek',
    model: 'deepseek-chat',
    status: 'idle',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    messageCount: 2,
  };

  /** 把 planImport 的结果当成"库里读出来的消息"，供再次导出 */
  function toChatMessages(plan: ReturnType<typeof planImport>): ChatMessage[] {
    return plan.messages.map((m) => ({
      id: m.id,
      role: m.role,
      blocks: m.blocks,
      createdAt: m.createdAt,
      model: m.model ?? undefined,
      usage: { inputTokens: m.inputTokens, outputTokens: m.outputTokens },
    }));
  }

  it('只含 text/thinking/tool-use 时：内容无损，且从第二次导出起是不动点', () => {
    const original: ChatMessage[] = [
      {
        id: 'a',
        role: 'user',
        blocks: [{ kind: 'text', text: '帮我读数据' }],
        createdAt: 1_700_000_000_000,
      },
      {
        id: 'b',
        role: 'assistant',
        blocks: [
          { kind: 'thinking', text: '先看看目录' },
          { kind: 'text', text: '好的' },
          {
            kind: 'tool_use',
            toolName: 'Bash',
            toolUseId: 'tu1',
            toolInput: { command: 'ls' },
            toolResult: [{ type: 'text', text: 'a.csv' }],
          },
        ],
        createdAt: 1_700_000_001_000,
      },
    ];

    const first = buildExportPayload(meta, original, 1);
    const plan1 = planImport(first, 's2', seqIds('row'), 2);
    const second = buildExportPayload(meta, toChatMessages(plan1), 1);
    const plan2 = planImport(second, 's2', seqIds('row'), 2);
    const third = buildExportPayload(meta, toChatMessages(plan2), 1);

    // 第一次往返是有损的：见下一条断言。从第二次起才稳定。
    expect(third.messages).toEqual(second.messages);

    // 反向对照：把"损失"钉在测试里，避免它悄悄变大 ——
    // parts/content/durationMs/effort/costUsd 之外，只有 token 数会从
    // null 变成 0（复刻的 messages.input_tokens / output_tokens 是
    // NOT NULL DEFAULT 0，读回来必然是数字，无法还原成 null）。
    for (let i = 0; i < first.messages.length; i++) {
      expect(second.messages[i].parts).toEqual(first.messages[i].parts);
      expect(second.messages[i].content).toEqual(first.messages[i].content);
      if (first.messages[i].inputTokens === null) {
        expect(second.messages[i].inputTokens).toBe(0);
      } else {
        expect(second.messages[i].inputTokens).toBe(first.messages[i].inputTokens);
      }
    }
    // 除 token 列外，其余 8 个字段逐字相同
    const strip = (msgs: typeof first.messages) =>
      msgs.map((m) => ({ ...m, inputTokens: 0, outputTokens: 0 }));
    expect(strip(second.messages)).toEqual(strip(first.messages));
  });

  it('含装不下的 part 时：第二次导出之后稳定（内容是第一次降级后的样子）', () => {
    const original: ChatMessage[] = [
      {
        id: 'a',
        role: 'assistant',
        blocks: [{ kind: 'text', text: '改完了' }],
        createdAt: 1_700_000_000_000,
      },
    ];
    // 手工往导出结果里塞一段 attachment，模拟"原版导出的文件"
    const first = buildExportPayload(meta, original, 1);
    first.messages[0].parts.unshift({
      type: 'attachment',
      path: '/p/fig.png',
      name: 'fig.png',
      mediaType: 'image/png',
      kind: 'image',
    });

    const plan1 = planImport(first, 's', seqIds('r'), 2);
    const second = buildExportPayload(meta, toChatMessages(plan1), 1);
    const plan2 = planImport(second, 's', seqIds('r'), 2);
    const third = buildExportPayload(meta, toChatMessages(plan2), 1);

    // 第一次降级把 attachment 变成了文本 ⇒ 从第二次起不再变化
    expect(third.messages).toEqual(second.messages);
    // 而且文件名还在（没有静默丢内容）
    expect(JSON.stringify(second.messages)).toContain('fig.png');
    // 反向对照：降级确实发生了 —— 第二次导出里已经没有 attachment 这个 type
    expect(JSON.stringify(second.messages)).not.toContain('"attachment"');
  });

  it('导出的 parts 全部能在导入侧被识别（除 4 种已知降级）—— 无"未知段"', () => {
    const parts: SessionPart[] = [
      { type: 'text', text: 'a' },
      { type: 'thinking', text: 'b' },
      { type: 'tool-use', toolUse: { id: 'i', name: 'X', input: null } },
    ];
    const r = partsToBlocks(parts);

    // 我们自己产出的 parts 不该产生任何降级
    expect(r.degraded).toBe(0);
  });
});

describe('结构级判据 —— 路由里"先校验、后动库"', () => {
  const ROUTES_SRC = readFileSync(join(process.cwd(), 'src', 'main', 'server', 'routes.ts'), 'utf8');

  it('safeParse 出现在 db.transaction 之前（坏文件绝不能碰到数据库）', () => {
    const parseAt = ROUTES_SRC.indexOf('sessionImportSchema.safeParse(raw)');
    const guardAt = ROUTES_SRC.indexOf("return c.json({ error: 'invalid_import_file' }, 400)");
    const txAt = ROUTES_SRC.indexOf('db.transaction(');

    expect(parseAt).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(parseAt);
    expect(txAt).toBeGreaterThan(guardAt);
  });

  it('导入包在事务里（原版没包；中途失败会留半条会话）', () => {
    expect(ROUTES_SRC).toContain('db.transaction(');
    expect(ROUTES_SRC).toContain("})();");
  });

  it('导入的消息不写 checkpoint_ref / agent_msg_uuid（那是本机快照与 agent 上下文）', () => {
    const at = ROUTES_SRC.indexOf('app.post(\'/api/sessions/import\'');
    const body = ROUTES_SRC.slice(at);
    const insertAt = body.indexOf('insertMessage.run(');
    const call = body.slice(insertAt, insertAt + 500);

    expect(call).toContain('null,');
    expect(call).toContain('null,\n        );');
  });
});
