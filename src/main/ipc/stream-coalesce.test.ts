/**
 * B2 delta 合帧器的单测（2026-09-19 卡顿优化）。
 *
 * 合帧器只做一件事：把 24ms 窗口内同类同块的 delta 拼成一条，其余事件原样直发。
 * 正确性标准 = **转发序列与不装合帧器时逐位等价**（delta 拼接满足结合律）。
 * 下面每条用例都在验证「等价」的某个侧面：不丢字、不乱序、不越块合并、
 * 结构事件前冲净缓冲、flush 幂等。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { StreamEvent } from '@shared/types';
import { createDeltaCoalescer, DELTA_FRAME_MS } from './stream-coalesce';

describe('createDeltaCoalescer —— B2 主进程 delta 合帧', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** 收集转发出去的事件 */
  function harness(frameMs?: number) {
    const sent: StreamEvent[] = [];
    const c = createDeltaCoalescer((ev) => sent.push(ev), frameMs);
    return { c, sent };
  }

  it('同类同块的连续 delta 合并成一条，内容逐字不丢', () => {
    const { c, sent } = harness();
    c.accept({ type: 'text-delta', index: 0, delta: '你好' });
    c.accept({ type: 'text-delta', index: 0, delta: '，世界' });
    c.accept({ type: 'text-delta', index: 0, delta: '！' });
    expect(sent).toHaveLength(0); // 窗口内不直发
    vi.advanceTimersByTime(DELTA_FRAME_MS);
    expect(sent).toEqual([{ type: 'text-delta', index: 0, delta: '你好，世界！' }]);
  });

  it('thinking 与 text 互不合并；不同块的 delta 也不合并', () => {
    const { c, sent } = harness();
    c.accept({ type: 'thinking-delta', index: 0, delta: '想' });
    c.accept({ type: 'text-delta', index: 0, delta: '写' });
    c.accept({ type: 'text-delta', index: 1, delta: '另' });
    vi.advanceTimersByTime(DELTA_FRAME_MS);
    expect(sent.map((e) => (e as { delta: string }).delta)).toEqual(['想', '写', '另']);
    expect(sent.map((e) => e.type)).toEqual(['thinking-delta', 'text-delta', 'text-delta']);
  });

  it('结构事件到达时先冲缓冲再直发，总顺序与直发等价', () => {
    const { c, sent } = harness();
    c.accept({ type: 'text-delta', index: 0, delta: '前半' });
    c.accept({ type: 'block-start', index: 1, kind: 'text' }); // 结构事件
    c.accept({ type: 'text-delta', index: 1, delta: '后半' });
    vi.advanceTimersByTime(DELTA_FRAME_MS);
    // 期望序列：前半（被 block-start 冲出）→ block-start → 后半（timer 冲出）
    expect(sent.map((e) => e.type)).toEqual(['text-delta', 'block-start', 'text-delta']);
    expect((sent[0] as { delta: string }).delta).toBe('前半');
  });

  it('flush() 立即清空缓冲，且重复 flush 是 no-op', () => {
    const { c, sent } = harness();
    c.accept({ type: 'text-delta', index: 0, delta: '尾巴' });
    c.flush();
    expect(sent).toEqual([{ type: 'text-delta', index: 0, delta: '尾巴' }]);
    c.flush();
    expect(sent).toHaveLength(1); // 不重复发
    vi.advanceTimersByTime(DELTA_FRAME_MS);
    expect(sent).toHaveLength(1); // timer 已清，不会再发
  });

  it('session-end / tool-use / usage 等非 delta 事件原样直发', () => {
    const { c, sent } = harness();
    const end: StreamEvent = { type: 'session-end', sessionId: 's1' };
    c.accept(end);
    expect(sent).toEqual([end]); // 直发，不进缓冲
  });

  it('窗口可自定义（0ms = 每条必发，只合并同一 tick）', () => {
    const { c, sent } = harness(0);
    c.accept({ type: 'text-delta', index: 0, delta: 'a' });
    expect(sent).toHaveLength(0); // 0ms 也要等 timer（下一 macrotask）
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ type: 'text-delta', index: 0, delta: 'a' }]);
  });
});
