/**
 * `isError` 透传的回归测试（任务 A）。
 *
 * ## 这条测试要防的是什么
 *
 * `ipc/session.ts` 组装待落库的 tool_use 块时，曾经**只写 `toolResult`、
 * 把 `ev.isError` 丢掉**（`StreamEvent` 与 `ContentBlock` 都早就有这个字段，
 * agent 侧也一直在填）。后果不是崩溃，而是**静默**：
 * 失败的 Bash / Write 在界面上、在数据库里、在导出的 JSON 里，
 * 全都和成功的长得一模一样 —— 用户看不出"这条命令其实没跑通"。
 *
 * ## 为什么这条测试现在才可能有
 *
 * 这段逻辑原先内联在 IPC handler 的 `runner.on('event')` 回调里，要跑它就得
 * 拉起 electron + 真 SDK。抽成 `applyStreamEvent` 纯函数之后才可测。
 */
import { describe, expect, it } from 'vitest';
import type { ContentBlock, StreamEvent } from '@shared/types';
import { applyStreamEvent } from './stream-blocks';

describe('applyStreamEvent —— tool-result 的 isError 透传', () => {
  /** 造一个"已经有一个 tool_use 块"的现场 */
  function seed(): ContentBlock[] {
    const collected: ContentBlock[] = [];
    applyStreamEvent(collected, {
      type: 'tool-use',
      toolName: 'Bash',
      toolUseId: 'tu1',
      input: { command: 'python run.py' },
    });
    return collected;
  }

  it('isError:true → 块里是 `true`（**不是 undefined**）', () => {
    const collected = seed();
    applyStreamEvent(collected, {
      type: 'tool-result',
      toolUseId: 'tu1',
      result: 'Traceback (most recent call last): …',
      isError: true,
    });

    expect(collected[0].isError).toBe(true);
    // 反向对照：`undefined` 与 `false` 都该被这条断言挡住
    expect(collected[0].isError).not.toBeUndefined();
    expect(collected[0].isError).not.toBe(false);
    // 结果本身照旧要落到 toolResult（别为了加字段把原来那半弄丢）
    expect(collected[0].toolResult).toBe('Traceback (most recent call last): …');
  });

  it('isError:false → 明确的 `false`（不是 undefined）', () => {
    const collected = seed();
    applyStreamEvent(collected, {
      type: 'tool-result',
      toolUseId: 'tu1',
      result: 'ok',
      isError: false,
    });

    // 收紧成 boolean 的意义：下游 `if (block.isError)` 与 `=== true` 都成立，
    // 不需要再区分"没这个字段"和"字段是 false"。
    expect(collected[0].isError).toBe(false);
  });

  it('事件里没带 isError（老 emitter）→ 落成 `false`，不抛', () => {
    const collected = seed();
    applyStreamEvent(collected, { type: 'tool-result', toolUseId: 'tu1', result: 'ok' });
    expect(collected[0].isError).toBe(false);
  });

  it('toolUseId 对不上 → 一个字段都不写（不误挂到别的工具上）', () => {
    const collected = seed();
    applyStreamEvent(collected, {
      type: 'tool-result',
      toolUseId: 'nope',
      result: 'x',
      isError: true,
    });

    expect(collected).toHaveLength(1);
    expect(collected[0].toolResult).toBeUndefined();
    expect(collected[0].isError).toBeUndefined();
  });

  it('两个工具交替：结果与错误标记各自归位（反恒真：不是"全都写第一个"）', () => {
    const collected: ContentBlock[] = [];
    applyStreamEvent(collected, { type: 'tool-use', toolName: 'Bash', toolUseId: 'a', input: {} });
    applyStreamEvent(collected, { type: 'tool-use', toolName: 'Read', toolUseId: 'b', input: {} });
    applyStreamEvent(collected, { type: 'tool-result', toolUseId: 'b', result: 'ENOENT', isError: true });
    applyStreamEvent(collected, { type: 'tool-result', toolUseId: 'a', result: 'done', isError: false });

    expect(collected[0]).toMatchObject({ toolUseId: 'a', toolResult: 'done', isError: false });
    expect(collected[1]).toMatchObject({ toolUseId: 'b', toolResult: 'ENOENT', isError: true });
  });
});

describe('applyStreamEvent —— 其余事件类型（防"抽函数时搬漏"）', () => {
  it('text / thinking 按 index 写下标并累加 delta', () => {
    const collected: ContentBlock[] = [];
    applyStreamEvent(collected, { type: 'block-start', index: 0, kind: 'thinking' });
    applyStreamEvent(collected, { type: 'block-start', index: 1, kind: 'text' });
    applyStreamEvent(collected, { type: 'thinking-delta', index: 0, delta: '先看' });
    applyStreamEvent(collected, { type: 'thinking-delta', index: 0, delta: '目录' });
    applyStreamEvent(collected, { type: 'text-delta', index: 1, delta: '好的' });

    expect(collected[0]).toEqual({ kind: 'thinking', text: '先看目录' });
    expect(collected[1]).toEqual({ kind: 'text', text: '好的' });
  });

  it('没有 block-start 就打 delta → 不抛、不凭空造块', () => {
    const collected: ContentBlock[] = [];
    applyStreamEvent(collected, { type: 'text-delta', index: 3, delta: 'x' });
    expect(collected).toHaveLength(0);
  });

  it('纯通知事件是 no-op', () => {
    const collected: ContentBlock[] = [];
    const notifications: StreamEvent[] = [
      { type: 'session-start', sessionId: 's' },
      { type: 'message-start', messageId: 'm' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'message-stop', messageId: 'm' },
      { type: 'session-error', message: 'x' },
      { type: 'session-end', sessionId: 's' },
    ];
    for (const ev of notifications) applyStreamEvent(collected, ev);
    expect(collected).toHaveLength(0);
  });
});
