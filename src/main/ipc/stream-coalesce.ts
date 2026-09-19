/**
 * B2 主进程侧 delta 合帧（2026-09-19 卡顿优化）。
 *
 * 问题：SDK 每吐一小段文本就发一条 text-delta/thinking-delta，逐条 IPC 直发渲染层。
 *       DeepSeek 长输出时每秒几十条，渲染端每条都要走一遍 withBlocks 不可变更新 ——
 *       主线程被切得粉碎，这就是「流式输出时界面卡」的主因之一。
 *
 * 方案：在 IPC 转发层把 24ms（≈一帧半）窗口内的**同类同块** delta 合并成一条再发。
 *       结构事件（块边界/工具/usage/session-end）永远先 flush 缓冲再原样转发 ——
 *       合并只发生在 delta 链内部，事件总顺序与拆分前**逐位等价**：
 *       delta 拼接满足结合律，结构事件位置不变。
 *
 * ⚠️ 只收窄渲染端粒度：落库（applyStreamEvent）与进行中快照仍用原始事件流，
 *    主进程内部其它订阅者（workflow trace / usage 统计）完全不受影响。
 */
import type { StreamEvent } from '@shared/types';

type DeltaEvent = Extract<StreamEvent, { type: 'text-delta' | 'thinking-delta' }>;

/** 合帧窗口：24ms 感知上不可察（16.7ms 一帧的 1.5 倍），足够把 2-4 条相邻 delta 并成一条 */
export const DELTA_FRAME_MS = 24;

export interface DeltaCoalescer {
  /** 喂入原始事件：delta 进缓冲，其它事件先 flush 再直发 */
  accept: (ev: StreamEvent) => void;
  /** 立即把缓冲中的 delta 发出去（回合收尾/停止路径必须调用，不能留尾巴） */
  flush: () => void;
}

export function createDeltaCoalescer(
  push: (ev: StreamEvent) => void,
  frameMs: number = DELTA_FRAME_MS,
): DeltaCoalescer {
  let pending: DeltaEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) {
      const ev = pending;
      pending = null;
      push(ev);
    }
  };

  const accept = (ev: StreamEvent): void => {
    if (ev.type !== 'text-delta' && ev.type !== 'thinking-delta') {
      flush();
      push(ev);
      return;
    }
    // 同类同块的连续 delta → 原地累加；换了块/换了类型 → 先冲再开新缓冲
    if (pending && pending.type === ev.type && pending.index === ev.index) {
      pending.delta += ev.delta;
      return;
    }
    flush();
    // 浅拷贝：上游可能复用事件对象，落库侧与转发侧各持一份
    pending = { ...ev };
    if (timer === null) timer = setTimeout(flush, frameMs);
  };

  return { accept, flush };
}
