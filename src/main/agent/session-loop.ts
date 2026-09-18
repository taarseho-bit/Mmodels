/**
 * 常驻会话的**输入队列** + **收尾判定** + **消费循环** —— 从 `agent/session.ts` 抽出的纯逻辑。
 *
 * ## 这个文件要防的是什么（实机观察到两次的缺陷）
 *
 * 模型在真正干活的中途把回合交还，等一个「后台任务跑完唤醒我」，而那个唤醒**永远不来**。
 *
 * 根因不在模型，在宿主怎么开这一次 query：
 *   · `query({ prompt: '<字符串>' })` ⇒ SDK 侧 `isSingleUserTurn: typeof prompt === 'string'`
 *     （`sdk.mjs` 的 `Qwt()`）⇒ 首个 `result` 一到就 `this.transport.endInput()`
 *     关掉 stdin（日志字面量 `First result received for single-turn query, closing stdin`）
 *     ⇒ CLI 随 stdin EOF 退出 ⇒ **后台任务被连坐收掉** ⇒ 唤醒不可能发生。
 *   · 传 `AsyncIterable<SDKUserMessage>`（`sdk.d.ts:2640`）才进多轮模式：stdin 保持打开，
 *     CLI 自己把后台任务完成的通知作为 machine-injected 回合续跑。
 *
 * 「保持打开」还不够 —— 还得有**真正的收尾条件**，否则要么退回「收到 result 就结束」，
 * 要么永远挂着。这里用的正规依据是 `background_tasks_changed`：
 *   `sdk.d.ts:3054` 原文写明它是 **level 信号、REPLACE 语义**
 *   （"consumers that only need 'is background work running' should replace their set
 *   with each payload rather than pairing edges, so a missed bookend cannot wedge a
 *   stale running indicator"）。
 *
 * ## ⚠️ 为什么判定只在 `result` 帧上做，而不是「集合同步为空那一帧」
 *
 * 同一段注释写明：level 与 bookend（`task_started`/`task_notification`）的**相对时序未定义**，
 * 「in practice the level precedes them」。也就是说，后台任务跑完那一刻的顺序常常是：
 *
 *     background_tasks_changed{tasks: []}   ← 集合先变空
 *     task_notification{status:'completed'} ← 通知后到
 *     （CLI 随后注入唤醒回合 → 新的 assistant 帧 → 新的 result）
 *
 * 如果在「集合变空」那一帧就收尾，正好把**接下来那次唤醒回合**掐掉 —— 与我们要修的缺陷同构。
 * 所以判定挂在 `result` 上：**只有「本轮最后一个 result 到达时集合已经是空的」才算这一轮结束**。
 *
 * 两种典型时序下的结果：
 *   · 没有后台任务：首个 result 时集合为空 ⇒ 立即收尾（**与改造前逐字一致**，见
 *     `session.test.ts` 的「默认路径不变」护栏）。
 *   · 有后台任务：result#1 时集合非空 ⇒ 不收尾；集合变空**不触发**收尾；
 *     唤醒回合的 result#2 时集合为空 ⇒ 收尾。
 */
/** 一个存活的后台任务的标识（`background_tasks_changed` 的 `tasks[]` 只带这几个字段） */
export interface BackgroundTaskInfo {
  taskId: string;
  taskType?: string;
  description?: string;
}

/**
 * 用户轮次的一条消息 —— 结构上等价于 SDK 的 `SDKUserMessage`（`sdk.d.ts:4748`）。
 *
 * ⚠️ 这里**不 import SDK 的类型**：`session.ts` 刻意让 SDK 按需加载（见该文件 `loadSdk()`），
 *    在类型层引入它会把"SDK 没装好"从运行期错误变成编译期错误。结构等价即可 ——
 *    真正的类型检查由 `query()` 的入参签名兜（见 `session.ts` 里那处赋值）。
 */
export interface QueuedUserMessage {
  type: 'user';
  message: { role: 'user'; content: Array<{ type: 'text'; text: string }> };
  parent_tool_use_id: string | null;
}

/**
 * 会话级输入队列：一个只会被消费一次的异步可迭代对象。
 *
 * 职责就是「让 `query()` 拿到 `AsyncIterable` 而不是 `string`」——
 * 这一件事直接决定 `isSingleUserTurn` 的取值，进而决定 CLI 会不会在首个 result 后自杀。
 *
 * 收尾靠 `close()`：把挂着的 `next()` 以 `done` 松开 ⇒ SDK 的 `streamInput()` 走完
 * `for await` ⇒ 调 `transport.endInput()` 关 stdin ⇒ CLI 正常退出。
 * （这就是改造前单轮模式下 SDK 自己走的那条路，不是新发明的退出方式。）
 */
export class SessionInputQueue implements AsyncIterable<QueuedUserMessage> {
  private readonly backlog: QueuedUserMessage[] = [];
  private readonly waiters: Array<(r: IteratorResult<QueuedUserMessage>) => void> = [];
  private closed = false;

  get isClosed(): boolean {
    return this.closed;
  }

  /** 队列里还没被 SDK 取走的条数（不含已经被挂起等走的那条） */
  get backlogCount(): number {
    return this.backlog.length;
  }

  /** 推入用户消息。`close()` 之后再推是调用方的 bug，这里只丢弃并留痕，不抛。 */
  push(text: string): void {
    if (this.closed) {
      console.debug('[agent] 会话输入队列已关闭，丢弃一条迟到消息（长度 %d）', text.length);
      return;
    }
    const msg: QueuedUserMessage = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null,
    };
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ done: false, value: msg });
      return;
    }
    this.backlog.push(msg);
  }

  /** 关闭队列：松开所有挂起的 `next()`。幂等。 */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const resolve of waiters) resolve({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<QueuedUserMessage> {
    return {
      next: (): Promise<IteratorResult<QueuedUserMessage>> => {
        const head = this.backlog.shift();
        if (head) return Promise.resolve({ done: false, value: head });
        if (this.closed) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.waiters.push(resolve);
        });
      },
    };
  }
}

/**
 * 后台等待的**有界兜底**：从「本轮 result 已到、但仍有后台任务在跑」那一刻起算。
 *
 * 取值 30 分钟，理由：
 *   · 内嵌 CLI 自己的系统提示词给模型的建议是「外部/不可追踪的工作用 1200s+ 的兜底」
 *     （`resources/claude-code/claude.exe` 里可 grep 到
 *      "Instead schedule a long fallback (1200s+)"），也就是说**模型可能合法地等 20 分钟**；
 *   · 兜底上限必须显著高于它，否则会把「还在正常等唤醒」误判成「卡死」，退回原来的缺陷 ——
 *     30 分钟 = 1200s 的 1.5 倍；
 *   · 也不能无限等：CLI 若因为版本差异从不报告集合清空，这一轮就永远不结束，
 *     用户会看到界面一直"正在运行"。
 *   · 触发时**不静默**：发 `session-error` + `session-end{reason:'background-timeout'}`，
 *     并把当时存活的任务列进日志（可诊断）。
 */
export const BACKGROUND_WAIT_CAP_MS = 30 * 60 * 1000;

/**
 * 判定收尾之后，**排空事件流**的宽限。
 *
 * 为什么判定收尾后还要继续消费：收尾只是关掉我们的输入队列，CLI 还要把 stdout 收干净
 * 才退出（改造前单轮模式同样是"一直消费到流结束"，这里保持同一形态）。
 * 宽限只用来兜住"CLI 不退出"这种异常，不参与任何内容判定。
 */
export const DRAIN_GRACE_MS = 10_000;

/** 一轮运行的累积状态（跨自动续跑回合） */
export interface TurnState {
  /** 是否已经收到过 `result`（常驻会话下会收到多次：每次自动续跑一轮一次） */
  sawResult: boolean;
  /**
   * 当前**存活的后台任务**。
   * ⚠️ 只由 `background_tasks_changed` 整体替换，不用 `task_started`/`task_notification` 这些
   *    **边沿**信号增删 —— 边沿信号同时覆盖**前台**子代理（Task 工具），把它们算进来会让
   *    "有前台子代理在跑"的一轮永远收不了尾。SDK 的类型注释也是这么要求的（见文件头）。
   */
  backgroundTasks: Map<string, BackgroundTaskInfo>;
}

export function createTurnState(): TurnState {
  return { sawResult: false, backgroundTasks: new Map() };
}

/** `background_tasks_changed` 的 REPLACE 语义：整个换掉，不是增量合并。 */
export function replaceBackgroundTasks(state: TurnState, tasks: unknown): void {
  const list = Array.isArray(tasks) ? tasks : [];
  const next = new Map<string, BackgroundTaskInfo>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const taskId = typeof t.task_id === 'string' ? t.task_id : '';
    if (!taskId) continue;
    next.set(taskId, {
      taskId,
      ...(typeof t.task_type === 'string' ? { taskType: t.task_type } : {}),
      ...(typeof t.description === 'string' ? { description: t.description } : {}),
    });
  }
  state.backgroundTasks = next;
}

/**
 * 本轮的收尾判定。
 *
 * ⚠️ **只在收到 `result` 帧时调用**（理由见文件头「为什么判定只在 result 帧上做」）。
 *    把这一条挪到"集合变空"那一帧上，就等于把唤醒回合掐掉。
 *
 * 返回 `true` = 这一轮真的结束了，可以关队列收尾。
 */
export function shouldConcludeTurn(state: TurnState): boolean {
  return state.sawResult && state.backgroundTasks.size === 0;
}

/** 一帧 SDK 消息对「本轮是否收尾」的影响 */
export type FrameEffect = 'conclude' | 'continue';

/**
 * 把一帧消息折进 `TurnState`，并回答「这一帧之后能不能收尾」。
 *
 * 纯函数：不 emit、不 IO、不动 `abortController`。事件派发仍由
 * `AgentSession.handleSdkMessage()` 负责（那是它的既有职责）。
 */
export function applyTurnFrame(state: TurnState, msg: unknown): FrameEffect {
  if (!msg || typeof msg !== 'object') return 'continue';
  const m = msg as Record<string, any>;

  if (m.type === 'system' && m.subtype === 'background_tasks_changed') {
    replaceBackgroundTasks(state, m.tasks);
    return 'continue';
  }

  if (m.type === 'result') {
    state.sawResult = true;
    // 只在这里判收尾 —— 见 shouldConcludeTurn 的注释
    return shouldConcludeTurn(state) ? 'conclude' : 'continue';
  }

  return 'continue';
}

/** 消费循环的终局 */
export type SessionLoopOutcome =
  | { kind: 'settled' }
  | { kind: 'aborted' }
  | { kind: 'stream-ended' }
  | { kind: 'capped'; waitedMs: number };

export interface SessionLoopOptions {
  /** SDK 的事件流（`query()` 的返回值） */
  stream: AsyncIterable<unknown>;
  /** 每一帧的回调；`AgentSession.handleSdkMessage` 挂在这里 */
  onMessage: (msg: unknown) => void;
  /** 收尾判定通过时调用 —— 调用方在这里关掉输入队列 */
  onConclude: (state: TurnState) => void;
  /** 取消检查（abortController） */
  isAborted: () => boolean;
  /** 取消信号用于唤醒正在等待下一帧的循环，不能只在下一帧到达后轮询。 */
  signal?: AbortSignal;
  /** 诊断日志出口，默认 `console.debug` */
  log?: (message: string) => void;
  /** 兜底上限，默认 `BACKGROUND_WAIT_CAP_MS` */
  capMs?: number;
  /** 收尾后排空流的宽限，默认 `DRAIN_GRACE_MS` */
  drainGraceMs?: number;
  /** 注入时钟（测试用） */
  now?: () => number;
}

type Wake =
  | { kind: 'msg'; result: IteratorResult<unknown> }
  | { kind: 'error'; error: unknown }
  | { kind: 'abort' }
  | { kind: 'timer' };

/** 一个可取消的定时器 —— 必须可取消，否则长上限会把测试进程钉住不退出。 */
function armTimer(ms: number): { promise: Promise<Wake>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<Wake>((resolve) => {
    handle = setTimeout(() => resolve({ kind: 'timer' }), ms);
  });
  return {
    promise,
    cancel: () => {
      if (handle !== undefined) clearTimeout(handle);
    },
  };
}

function armAbort(signal?: AbortSignal): { promise: Promise<Wake>; cancel: () => void } {
  if (!signal) return { promise: new Promise<Wake>(() => undefined), cancel: () => undefined };
  if (signal.aborted) return { promise: Promise.resolve({ kind: 'abort' }), cancel: () => undefined };
  let listener: (() => void) | null = null;
  const promise = new Promise<Wake>((resolve) => {
    listener = () => resolve({ kind: 'abort' });
    signal.addEventListener('abort', listener, { once: true });
  });
  return {
    promise,
    cancel: () => {
      if (listener) signal.removeEventListener('abort', listener);
      listener = null;
    },
  };
}

/**
 * 消费一整轮（可能包含若干次自动续跑）的事件流。
 *
 * 循环骨架：
 *   1. 只有在「本轮 result 已到 + 还有后台任务在跑」时才武装兜底定时器；
 *      其余时间**不设上限**（一次正常的模型回合时长不可预估，不该被这个兜底误伤）。
 *   2. 每收到一帧 → `applyTurnFrame` 折状态 → `onMessage` 派发。
 *   3. 判定为 `conclude` → 调 `onConclude`（关队列）→ 进入排空阶段，
 *      继续把剩下的帧派发出去（**不丢内容**），直到流结束或超出宽限。
 */
export async function runSessionLoop(o: SessionLoopOptions): Promise<SessionLoopOutcome> {
  const now = o.now ?? Date.now;
  const capMs = o.capMs ?? BACKGROUND_WAIT_CAP_MS;
  const drainGraceMs = o.drainGraceMs ?? DRAIN_GRACE_MS;
  const log = o.log ?? ((m: string) => console.debug(m));

  const state = createTurnState();
  const iterator = o.stream[Symbol.asyncIterator]();
  const abortWake = armAbort(o.signal);

  /**
   * 只发一次、可跨轮复用的 `next()`。
   * 与定时器赛跑时，定时器可能先赢 —— 那一次 `next()` 必须留着继续用，
   * 否则它之后吐出来的那一帧会被丢掉（内容缺口，比卡死更难发现）。
   */
  let pending: Promise<Wake> | null = null;
  const takeNext = (): Promise<Wake> => {
    if (!pending) {
      pending = iterator.next().then(
        (result): Wake => ({ kind: 'msg', result }),
        (error): Wake => ({ kind: 'error', error }),
      );
      void pending.finally(() => {
        pending = null;
      });
    }
    return pending;
  };

  /** 本轮从「result 已到但后台任务未清空」开始等的时刻；null = 不在等 */
  let waitStartedAt: number | null = null;
  let concluded = false;

  /**
   * 与「截止时刻」赛跑着取下一帧。
   * 单独抽成函数（而不是在循环里用 `let wake: Wake` 赋值）是为了让类型收窄成立 ——
   * 赋值式收窄在 if/else 合并后会丢。
   */
  const takeNextBefore = async (deadlineAt: number): Promise<Wake> => {
    const remaining = deadlineAt - now();
    if (remaining <= 0) return { kind: 'timer' };
    const timer = armTimer(remaining);
    try {
      return await Promise.race([takeNext(), timer.promise, abortWake.promise]);
    } finally {
      timer.cancel();
    }
  };

  const capReached = (): SessionLoopOutcome => {
    log(
      `[agent] ⚠️ 后台任务等待超过兜底上限 ${capMs}ms，强制收尾。` +
        `当时仍在跑的后台任务：${describeTasks(state)}`,
    );
    o.onConclude(state);
    return { kind: 'capped', waitedMs: waitStartedAt === null ? 0 : now() - waitStartedAt };
  };

  try {
    for (;;) {
      if (o.isAborted()) {
        log('[agent] 会话被中断，停止消费事件流');
        return { kind: 'aborted' };
      }

      const waiting = !concluded && waitStartedAt !== null;
      const wake = waiting
        ? await takeNextBefore((waitStartedAt as number) + capMs)
        : await Promise.race([takeNext(), abortWake.promise]);

      if (wake.kind === 'abort') {
        log('[agent] 会话被中断，停止消费事件流');
        return { kind: 'aborted' };
      }
      if (wake.kind === 'timer') return capReached();
      if (wake.kind === 'error') throw wake.error;
      if (wake.result.done) {
        if (!concluded) log('[agent] 事件流在收尾条件达成前就结束了（CLI 提前退出？）');
        return { kind: 'stream-ended' };
      }

      const msg = wake.result.value;
      const effect = applyTurnFrame(state, msg);
      o.onMessage(msg);

      if (effect === 'conclude') {
        concluded = true;
        waitStartedAt = null;
        log(
          `[agent] 本轮收尾：收到 result 且后台任务集合为空（${state.backgroundTasks.size} 个），关闭输入队列`,
        );
        o.onConclude(state);
        // 进入排空阶段：继续把剩下的帧派发出去，直到流结束或超出宽限
        const drainDeadline = now() + drainGraceMs;
        for (;;) {
          const drained = await takeNextBefore(drainDeadline);
          if (drained.kind === 'abort') return { kind: 'aborted' };
          if (drained.kind === 'timer') {
            log(`[agent] 排空超过 ${drainGraceMs}ms，提前结束消费（CLI 未按时退出）`);
            return { kind: 'settled' };
          }
          if (drained.kind === 'error') throw drained.error;
          if (drained.result.done) return { kind: 'settled' };
          o.onMessage(drained.result.value);
        }
      }

      if (state.sawResult && state.backgroundTasks.size > 0 && waitStartedAt === null) {
        waitStartedAt = now();
        log(
          `[agent] 本轮 result 已到，但仍有 ${state.backgroundTasks.size} 个后台任务在跑 → ` +
            `不关队列，等唤醒（兜底上限 ${capMs}ms）：${describeTasks(state)}`,
        );
      }
    }
  } finally {
    abortWake.cancel();
  }
}

function describeTasks(state: TurnState): string {
  if (state.backgroundTasks.size === 0) return '(无)';
  return [...state.backgroundTasks.values()]
    .map((t) => `${t.taskId}${t.description ? `=${t.description}` : ''}`)
    .join(', ');
}
