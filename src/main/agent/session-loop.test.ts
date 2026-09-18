/**
 * 常驻会话循环（`session-loop.ts`）的判据 —— 直接对着**实机复现过两次**的缺陷写。
 *
 * ## 缺陷回顾（判定为什么长这样）
 *
 * 模型在干活中途交还回合去等「后台任务跑完唤醒我」，而唤醒永远不来。
 * 宿主侧的根因有两层，这个文件把第二层（收尾条件）钉死：
 *   · 传输层：prompt 传字符串 ⇒ SDK `isSingleUserTurn=true` ⇒ 首个 result 就关 stdin；
 *   · 会话层：即便 stdin 不关，也**不能**用「收到 result 就结束」当收尾条件 ——
 *     那等于把「后台任务还在跑 → CLI 稍后会注入唤醒回合」这条路掐断。
 *
 * ## A 组是护栏（默认路径不许变）
 *
 * 没有后台任务的一轮：首个 result 到达即可收尾，帧数、收尾次数、事件条数全与改造前一致。
 * 把 prompt 改回字符串（或把 `shouldConcludeTurn` 改回 `sawResult`）**不影响**这组 ——
 * 它是"默认路径不变"的护栏，不是新功能的判据。
 *
 * ## B 组才是新功能的判据，并且做了**反向对照**
 *
 * 断言「后台任务集合非空时收尾被推迟、集合清空+新 result 才收尾」。
 * 把 `shouldConcludeTurn` 改成 `return state.sawResult`，B 组必须真红
 * （红证据见汇报；本文件里那条断言的措辞就是为这个反向对照写的）。
 */
import { describe, expect, it } from 'vitest';
import {
  BACKGROUND_WAIT_CAP_MS,
  SessionInputQueue,
  applyTurnFrame,
  createTurnState,
  replaceBackgroundTasks,
  runSessionLoop,
  shouldConcludeTurn,
  type SessionLoopOutcome,
  type TurnState,
} from './session-loop';

// ─────────────────────────────────────────────────────────────
// 测试用假事件流
// ─────────────────────────────────────────────────────────────

/** 按脚本逐帧吐出，吐完就 done —— 模拟"CLI 收干净后退出"。 */
function scriptedStream(script: unknown[], onPull?: (index: number) => void) {
  let i = 0;
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          if (i >= script.length) return { done: true, value: undefined };
          onPull?.(i);
          const value = script[i];
          i += 1;
          return { done: false, value };
        },
      };
    },
  };
}

/** 吐完脚本就**永不给下一帧** —— 用来逼出兜底上限（模拟"集合永不清空、CLI 也不退出"）。 */
function streamThatHangsAfter(script: unknown[]) {
  let i = 0;
  return {
    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      return {
        next: async (): Promise<IteratorResult<unknown>> => {
          if (i >= script.length) return new Promise<IteratorResult<unknown>>(() => {});
          const value = script[i];
          i += 1;
          return { done: false, value };
        },
      };
    },
  };
}

/** 跑一次循环并记录可观测的行为（不依赖日志文本，只依赖调用序列）。 */
async function drive(
  script: unknown[],
  overrides: Partial<Parameters<typeof runSessionLoop>[0]> = {},
): Promise<{
  outcome: SessionLoopOutcome;
  delivered: unknown[];
  concludeCalls: number;
  /** 收尾那一刻「已经交付了几帧」——反向对照就卡在这个数上 */
  concludedAfterFrame: number;
  state: TurnState;
}> {
  const delivered: unknown[] = [];
  let concludeCalls = 0;
  let concludedAfterFrame = -1;
  let captured: TurnState | null = null;
  const stream = overrides.stream ?? scriptedStream(script);

  const outcome = await runSessionLoop({
    stream,
    onMessage: (m) => {
      delivered.push(m);
    },
    onConclude: (state) => {
      concludeCalls += 1;
      concludedAfterFrame = delivered.length;
      captured = state;
    },
    isAborted: () => false,
    log: () => {},
    ...overrides,
  });

  return {
    outcome,
    delivered,
    concludeCalls,
    concludedAfterFrame,
    state: captured ?? createTurnState(),
  };
}

// ─────────────────────────────────────────────────────────────
// 帧样式（逐字对齐 sdk.d.ts 的字段名）
// ─────────────────────────────────────────────────────────────

const bgChanged = (ids: string[]) => ({
  type: 'system',
  subtype: 'background_tasks_changed',
  tasks: ids.map((id) => ({ task_id: id, task_type: 'bash', description: `任务 ${id}` })),
  uuid: 'u',
  session_id: 's',
});
const taskStarted = (id: string) => ({
  type: 'system',
  subtype: 'task_started',
  task_id: id,
  description: `任务 ${id}`,
  uuid: 'u',
  session_id: 's',
});
const taskNotification = (id: string, status = 'completed') => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: id,
  status,
  output_file: '/tmp/out.txt',
  summary: `${id} 跑完了`,
  uuid: 'u',
  session_id: 's',
});
const taskProgress = (id: string) => ({
  type: 'system',
  subtype: 'task_progress',
  task_id: id,
  description: `任务 ${id}`,
  usage: { total_tokens: 1, tool_uses: 1, duration_ms: 1 },
  uuid: 'u',
  session_id: 's',
});
const taskUpdated = (id: string, status: string) => ({
  type: 'system',
  subtype: 'task_updated',
  task_id: id,
  patch: { status },
  uuid: 'u',
  session_id: 's',
});
const result = (subtype = 'success') => ({
  type: 'result',
  subtype,
  usage: { input_tokens: 1, output_tokens: 1 },
  session_id: 's',
});
const assistant = (text: string) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }], usage: {} },
  session_id: 's',
});

// ─────────────────────────────────────────────────────────────
// 0. 输入队列
// ─────────────────────────────────────────────────────────────

describe('SessionInputQueue —— 让 query() 拿到 AsyncIterable 而不是 string', () => {
  it('先 push 后消费：拿到的是 SDK 认得的 user 消息形状', async () => {
    const q = new SessionInputQueue();
    q.push('帮我跑个模型');
    const it = q[Symbol.asyncIterator]();
    const first = await it.next();
    expect(first.done).toBe(false);
    expect(first.value).toEqual({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: '帮我跑个模型' }] },
      parent_tool_use_id: null,
    });
  });

  it('先挂着 next() 再 push：挂起的那一个被唤醒（不能丢唤醒信号）', async () => {
    const q = new SessionInputQueue();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.push('第二条');
    const got = await pending;
    expect(got.done).toBe(false);
    expect(got.value?.message.content[0].text).toBe('第二条');
  });

  it('close() 松开挂起的 next()，之后一律 done；重复 close 幂等', async () => {
    const q = new SessionInputQueue();
    const it = q[Symbol.asyncIterator]();
    const pending = it.next();
    q.close();
    expect((await pending).done).toBe(true);
    expect((await it.next()).done).toBe(true);
    q.close();
    expect(q.isClosed).toBe(true);
  });

  it('close() 之后 push：丢弃而不是抛（收尾和迟到消息的竞态不该炸掉会话）', () => {
    const q = new SessionInputQueue();
    q.close();
    expect(() => q.push('迟到的')).not.toThrow();
    expect(q.backlogCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 1. 收尾判定 + 帧折叠（纯函数）
// ─────────────────────────────────────────────────────────────

describe('shouldConcludeTurn / applyTurnFrame', () => {
  it('没见过 result 就不收尾（哪怕集合是空的）', () => {
    expect(shouldConcludeTurn(createTurnState())).toBe(false);
  });

  it('见过 result 且集合为空 → 收尾', () => {
    const s = createTurnState();
    applyTurnFrame(s, result());
    expect(shouldConcludeTurn(s)).toBe(true);
  });

  it('见过 result 但集合非空 → 不收尾（这就是缺陷的核心那一条）', () => {
    const s = createTurnState();
    applyTurnFrame(s, bgChanged(['a']));
    applyTurnFrame(s, result());
    expect(s.sawResult).toBe(true);
    expect(s.backgroundTasks.size).toBe(1);
    expect(shouldConcludeTurn(s)).toBe(false);
  });

  it('background_tasks_changed 是 REPLACE 语义，不是增量合并', () => {
    const s = createTurnState();
    replaceBackgroundTasks(s, bgChanged(['a', 'b']).tasks);
    expect([...s.backgroundTasks.keys()]).toEqual(['a', 'b']);
    replaceBackgroundTasks(s, bgChanged([]).tasks);
    expect(s.backgroundTasks.size).toBe(0);
    replaceBackgroundTasks(s, bgChanged(['a']).tasks);
    replaceBackgroundTasks(s, bgChanged(['c']).tasks);
    expect([...s.backgroundTasks.keys()]).toEqual(['c']);
  });

  it('畸形 payload 不抛、不产生幽灵任务', () => {
    const s = createTurnState();
    replaceBackgroundTasks(s, undefined);
    expect(s.backgroundTasks.size).toBe(0);
    replaceBackgroundTasks(s, [{ description: '没有 id' }, null, 42]);
    expect(s.backgroundTasks.size).toBe(0);
  });

  it('task_started / task_notification 这类**边沿**帧不参与集合维护（它们也覆盖前台子代理）', () => {
    const s = createTurnState();
    applyTurnFrame(s, taskStarted('f1'));
    applyTurnFrame(s, taskNotification('f1'));
    applyTurnFrame(s, taskProgress('f1'));
    applyTurnFrame(s, taskUpdated('f1', 'completed'));
    // 集合仍为空 —— 判定不会被前台子代理拖住
    expect(s.backgroundTasks.size).toBe(0);
  });

  it('非对象/未知帧一律 continue', () => {
    const s = createTurnState();
    expect(applyTurnFrame(s, null)).toBe('continue');
    expect(applyTurnFrame(s, 'nope')).toBe('continue');
    expect(applyTurnFrame(s, { type: 'auth_status' })).toBe('continue');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. A 组护栏：默认路径（没有后台任务）行为不变
// ─────────────────────────────────────────────────────────────

describe('A 组护栏 —— 一轮里没有后台任务时，收尾条件与改造前等价', () => {
  it('首个 result 到达即收尾；帧照单全收；收尾只发生一次', async () => {
    const r = await drive([assistant('你好'), result()]);
    expect(r.outcome).toEqual({ kind: 'settled' });
    expect(r.delivered).toHaveLength(2);
    expect(r.concludeCalls).toBe(1);
    // 收尾发生在**第 2 帧（result）处理完之后**，不是第 1 帧
    expect(r.concludedAfterFrame).toBe(2);
  });

  it('一轮里塞满与后台任务无关的帧（工具结果、错误 result 之前的多条 assistant）也不改变收尾点', async () => {
    const r = await drive([assistant('a'), assistant('b'), result()]);
    expect(r.outcome).toEqual({ kind: 'settled' });
    expect(r.concludeCalls).toBe(1);
    expect(r.concludedAfterFrame).toBe(3);
  });

  it('事件流提前结束（CLI 先退）→ stream-ended，且绝不误报收尾', async () => {
    const r = await drive([assistant('半截')]);
    expect(r.outcome).toEqual({ kind: 'stream-ended' });
    expect(r.concludeCalls).toBe(0);
  });

  it('abort 生效：立刻返回 aborted，不触发收尾判定', async () => {
    const r = await drive([assistant('x'), result()], { isAborted: () => true });
    expect(r.outcome).toEqual({ kind: 'aborted' });
    expect(r.concludeCalls).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
// 3. B 组：新功能的判据（后台任务在跑 ⇒ 收尾推迟）
// ─────────────────────────────────────────────────────────────

describe('B 组 —— 后台任务未清空时，本轮不结束（唤醒才有机会发生）', () => {
  /**
   * 实机时序（与 `sdk.d.ts:3054` 的注释一致：level 常常**先于** bookend 到）：
   *   result#1（后台任务还在跑）→ 集合清空 → task_notification → 唤醒回合 → result#2
   */
  const WAKEUP_SCRIPT = [
    bgChanged(['bg1']), // 后台任务开始
    assistant('我先交还，等它跑完'),
    result(), // ← 改造前就在这里被收尾（缺陷）
    bgChanged([]), // ← 集合变空；**不能**在这一帧收尾，否则掐掉下面的唤醒
    taskNotification('bg1'),
    assistant('它跑完了，我接着做'),
    result(),
  ];

  it('推迟到「集合为空之后的那个 result」才收尾', async () => {
    const r = await drive(WAKEUP_SCRIPT);
    expect(r.outcome).toEqual({ kind: 'settled' });
    // 全部 7 帧都被交付 —— 收尾没有把唤醒回合吃掉
    expect(r.delivered).toHaveLength(7);
    expect(r.concludeCalls).toBe(1);
    // ⚠️ 反向对照的锚点：把 shouldConcludeTurn 改回 `return state.sawResult`，
    //    这个数会变成 3（在第 3 帧 result#1 上就收尾），本断言随即变红。
    expect(r.concludedAfterFrame).toBe(7);
    // 唤醒回合的文本确实走到了调用方
    const texts = r.delivered
      .filter((m: any) => m?.type === 'assistant')
      .map((m: any) => m.message.content[0].text);
    expect(texts).toEqual(['我先交还，等它跑完', '它跑完了，我接着做']);
  });

  it('「集合变空」这一帧本身不触发收尾（时序未定义时最容易错的那一步）', async () => {
    const seen: number[] = [];
    const r = await drive([bgChanged(['bg1']), result(), bgChanged([])], {
      onConclude: () => seen.push(1),
    });
    // 集合已经空了，但还没有"集合为空之后的新 result" ⇒ 不能收尾
    expect(seen).toHaveLength(0);
    expect(r.outcome).toEqual({ kind: 'stream-ended' });
  });

  it('唤醒之后又起了新的后台任务 → 继续等下一轮唤醒（不会提前收尾）', async () => {
    const r = await drive([
      bgChanged(['bg1']),
      result(), // 等 bg1
      bgChanged([]),
      taskNotification('bg1'),
      assistant('接着做，又起了 bg2'),
      bgChanged(['bg2']),
      result(), // 仍有 bg2 → 继续等
      bgChanged([]),
      taskNotification('bg2'),
      assistant('bg2 也完了'),
      result(), // 这才收尾
    ]);
    expect(r.outcome).toEqual({ kind: 'settled' });
    expect(r.concludedAfterFrame).toBe(11);
  });

  it('兜底上限：集合迟迟不清空 → 有界收尾（capped），并带上等待时长', async () => {
    const r = await drive([bgChanged(['hang']), result()], {
      stream: streamThatHangsAfter([bgChanged(['hang']), result()]),
      capMs: 40,
    });
    expect(r.outcome.kind).toBe('capped');
    expect(r.concludeCalls).toBe(1);
    const outcome = r.outcome as Extract<SessionLoopOutcome, { kind: 'capped' }>;
    expect(outcome.waitedMs).toBeGreaterThanOrEqual(40);
  });

  it('兜底上限默认值必须显著高于 CLI 自己建议的 1200s，否则会误杀正常等待', () => {
    expect(BACKGROUND_WAIT_CAP_MS).toBeGreaterThanOrEqual(1200_000 * 1.5);
  });
});
