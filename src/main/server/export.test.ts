/**
 * 导出 JSON 的回归测试（P1）。
 *
 * 判据的两条主线：
 *   1. **形状按字段对齐应用约定** —— `gS()`（协议实现）产出的顶层与逐条消息
 *      的字段名/顺序/`null` 用法都要一样。应用约定那边是 zod `cs` 校验的（），
 *      我们自己多一个键、少一个键，用户拿着文件去应用约定导入就会失败 —— 而这种错
 *      只有真的去导一次才发现，所以必须在这里钉死。
 *   2. **回归护栏** —— 空字符串必须落成 `null`（不是 `''`）、缺失的 usage 落成 `null`
 *      （不是 `0`）、没结果的工具**不许**塞一个空 result。只看"导出没报错"是测不出这些的。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage, ContentBlock, SessionMeta } from '@shared/types';
import {
  blocksToContent,
  blocksToParts,
  buildExportPayload,
  flattenToolResult,
  type SessionPart,
} from './export';

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 's1',
    title: '2026 年 A 题',
    projectId: 'p1',
    providerId: 'deepseek',
    model: 'deepseek-chat',
    status: 'idle',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_100_000,
    messageCount: 2,
    ...over,
  };
}

function msg(blocks: ContentBlock[], over: Partial<ChatMessage> = {}): ChatMessage {
  return { id: 'm1', role: 'user', blocks, createdAt: 1_700_000_000_000, ...over };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('buildExportPayload —— 顶层形状按字段对齐应用约定 gS()', () => {
  it('顶层键与顺序 = format / version / exportedAt / session / messages', () => {
    const p = buildExportPayload(meta(), [], 123);

    expect(Object.keys(p)).toEqual(['format', 'version', 'exportedAt', 'session', 'messages']);
    expect(p.format).toBe('mathmodel-session'); // 应用约定 literal('mathmodel-session')
    expect(p.version).toBe(1); // 应用约定 literal(1)
    expect(p.exportedAt).toBe(123);
  });

  it('session 子对象键与顺序 = title / providerId / model / createdAt / updatedAt', () => {
    const p = buildExportPayload(meta(), [], 0);

    expect(Object.keys(p.session)).toEqual([
      'title',
      'providerId',
      'model',
      'createdAt',
      'updatedAt',
    ]);
    expect(p.session.title).toBe('2026 年 A 题');
    expect(p.session.createdAt).toBe(1_700_000_000_000);
    expect(p.session.updatedAt).toBe(1_700_000_100_000);
  });

  it('每条消息的键与顺序 = 应用约定 ls 的 10 个字段', () => {
    const p = buildExportPayload(meta(), [msg([{ kind: 'text', text: 'hi' }])], 0);

    expect(p.messages).toHaveLength(1);
    expect(Object.keys(p.messages[0])).toEqual([
      'role',
      'content',
      'parts',
      'durationMs',
      'model',
      'effort',
      'inputTokens',
      'outputTokens',
      'costUsd',
      'createdAt',
    ]);
  });

  it('当前实现没有的列一律填 null（不是 0、不是空串、不是省略键）', () => {
    const p = buildExportPayload(meta(), [msg([{ kind: 'text', text: 'hi' }])], 0);
    const m = p.messages[0];

    // 这三个键必须**存在**且为 null —— 应用约定 zod 里是 `number().nullable().optional()`，
    // 省略也算合法，但"键在、值为 null"更接近应用约定自己的产出，且 diff 更稳定。
    expect(m.durationMs).toBeNull();
    expect(m.effort).toBeNull();
    expect(m.costUsd).toBeNull();
    expect('durationMs' in m).toBe(true);
    expect('effort' in m).toBe(true);
    expect('costUsd' in m).toBe(true);
  });

  it('回归护栏：usage 缺失 → inputTokens 是 null，不是 0', () => {
    const p = buildExportPayload(meta(), [msg([{ kind: 'text', text: 'hi' }])], 0);

    // 0 与 null 在应用约定语义里不同（"没统计" vs "统计到 0"），不能混
    expect(p.messages[0].inputTokens).toBeNull();
    expect(p.messages[0].outputTokens).toBeNull();
  });

  it('回归护栏：空的 providerId / model → null，不是空字符串', () => {
    const p = buildExportPayload(meta({ providerId: '', model: '' }), [], 0);

    expect(p.session.providerId).toBeNull();
    expect(p.session.model).toBeNull();
  });

  it('有 usage 时按数落库（正向对照）', () => {
    const p = buildExportPayload(
      meta(),
      [msg([{ kind: 'text', text: 'hi' }], { usage: { inputTokens: 12, outputTokens: 34 } })],
      0,
    );

    expect(p.messages[0].inputTokens).toBe(12);
    expect(p.messages[0].outputTokens).toBe(34);
  });

  it('role 只输出 user / assistant（当前实现多一个 system 也要收敛）', () => {
    const p = buildExportPayload(
      meta(),
      [msg([{ kind: 'text', text: 'a' }]), msg([{ kind: 'text', text: 'b' }], { role: 'system' })],
      0,
    );

    expect(p.messages.map((m) => m.role)).toEqual(['user', 'user']);
  });
});

describe('blocksToContent / blocksToParts —— blocks → parts 映射', () => {
  it('content 只取 text part 并 trim（thinking 与工具不算正文）', () => {
    const blocks: ContentBlock[] = [
      { kind: 'thinking', text: '思考中' },
      { kind: 'text', text: ' 正文 ' },
      { kind: 'tool_use', toolName: 'Read', toolUseId: 't1', toolInput: { path: 'a.tex' } },
    ];

    expect(blocksToContent(blocks)).toBe('正文');
  });

  it('text / thinking 一对一映射', () => {
    const parts = blocksToParts([
      { kind: 'text', text: '你好' },
      { kind: 'thinking', text: '嗯' },
    ]);

    expect(parts).toEqual([
      { type: 'text', text: '你好' },
      { type: 'thinking', text: '嗯' },
    ]);
  });

  it('tool_use → tool-use，且 id/name/input 逐字搬家', () => {
    const parts = blocksToParts([
      { kind: 'tool_use', toolName: 'Bash', toolUseId: 'tu_1', toolInput: { command: 'ls' } },
    ]);

    expect(parts).toEqual([
      { type: 'tool-use', toolUse: { id: 'tu_1', name: 'Bash', input: { command: 'ls' } } },
    ]);
  });

  it('回归护栏：工具**没有结果**时不许塞空 result（否则"没返回"与"返回空"混淆）', () => {
    const parts = blocksToParts([
      { kind: 'tool_use', toolName: 'Bash', toolUseId: 'tu_1', toolInput: {} },
    ]);
    const toolUse = (parts[0] as Extract<SessionPart, { type: 'tool-use' }>).toolUse;

    expect('result' in toolUse).toBe(false);
  });

  it('工具**有结果**时把 SDK 的 content 数组压平成应用约定的 {text}', () => {
    const parts = blocksToParts([
      {
        kind: 'tool_use',
        toolName: 'Bash',
        toolUseId: 'tu_1',
        toolInput: {},
        toolResult: [{ type: 'text', text: 'a.txt\nb.txt' }],
      },
    ]);
    const toolUse = (parts[0] as Extract<SessionPart, { type: 'tool-use' }>).toolUse;

    expect(toolUse.result).toEqual({ text: 'a.txt\nb.txt' });
  });

  it('error block → 应用约定的 turn-end{state:failed}（借应用约定已有的语义，不新造类型）', () => {
    const parts = blocksToParts([{ kind: 'error', text: '模型连接中断' }]);

    expect(parts).toEqual([{ type: 'turn-end', state: 'failed', errorMessage: '模型连接中断' }]);
  });

  it('tool_result block 降级成 text（应用约定没有这种 part；**内容不丢**）', () => {
    const parts = blocksToParts([{ kind: 'tool_result', toolResult: '输出' }]);

    expect(parts).toEqual([{ type: 'text', text: '输出' }]);
  });

  it('空 blocks → 空 parts（不产出占位 part）', () => {
    expect(blocksToParts([])).toEqual([]);
    expect(blocksToContent([])).toBe('');
  });

  it('导出的 part 类型一定落在应用约定 Zn 的 7 个变体里', () => {
    const allowed = new Set([
      'text',
      'thinking',
      'tool-use',
      'attachment',
      'proposed-plan',
      'turn-diff',
      'turn-end',
    ]);
    const parts = blocksToParts([
      { kind: 'text', text: 'a' },
      { kind: 'thinking', text: 'b' },
      { kind: 'tool_use', toolName: 'X', toolUseId: 'i', toolInput: null },
      { kind: 'error', text: 'c' },
      { kind: 'tool_result', toolResult: 'd' },
    ]);

    for (const p of parts) expect(allowed.has(p.type), p.type).toBe(true);
  });
});

describe('flattenToolResult —— 原始结果 → 应用约定要求的 string', () => {
  it('字符串原样返回', () => {
    expect(flattenToolResult('abc')).toBe('abc');
  });

  it('SDK 的 content 数组逐块取 text 并用换行拼', () => {
    expect(flattenToolResult([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
  });

  it('对象带 text 字段时取它（导入回来的是应用约定的 {text} 形状）', () => {
    expect(flattenToolResult({ text: 'x' })).toBe('x');
  });

  it('不认识的结构退成 JSON 文本 —— **绝不返回 undefined/object**', () => {
    // 应用约定 Vn.text 是必填 string，返回非字符串会让应用约定 zod 直接拒收整个文件
    expect(typeof flattenToolResult({ a: 1 })).toBe('string');
    expect(flattenToolResult({ a: 1 })).toBe('{"a":1}');
    expect(flattenToolResult(null)).toBe('');
    expect(flattenToolResult(undefined)).toBe('');
    expect(typeof flattenToolResult([1, 2])).toBe('string');
  });

  it('循环引用不抛（JSON.stringify 会抛，必须有兜底）', () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;

    expect(() => flattenToolResult(cyc)).not.toThrow();
  });
});

describe('导出的 JSON 必须能被 JSON.stringify 往返（落盘前提）', () => {
  it('整体无 undefined（JSON 会把 undefined 键吞掉，导致往返后少键）', () => {
    const p = buildExportPayload(
      meta(),
      [
        msg([
          { kind: 'text', text: 'hi' },
          { kind: 'tool_use', toolName: 'Bash', toolUseId: 'tu', toolInput: {} },
        ]),
      ],
      1,
    );

    const round = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;

    // 键集合完全一致 —— 说明树里没有 undefined（有的话 stringify 会删键）
    expect(Object.keys(round)).toEqual(Object.keys(p));
    const m0 = (round.messages as Array<Record<string, unknown>>)[0];
    expect(Object.keys(m0)).toEqual(Object.keys(p.messages[0]));
  });
});
