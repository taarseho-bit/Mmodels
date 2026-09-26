/**
 * 会话级「存活窗口」store —— 过程块（thinking / 工具卡片 / 正文）与任务面板数据的家。
 *
 * ## 为什么必须在组件外
 *
 * 这些数据原来活在 `ChatPage` 的 `useState` 里，只有一条命：**组件一卸载就没了**。
 * 于是用户看到两个症状（都是实测反馈）：
 *   ① 在会话 A 发一轮、切到 B、再切回 A —— A 这一轮的块**永久看不到**
 *      （旧代码 `ChatPage.tsx:493` 对非当前会话的事件直接 `return`，是"丢"不是"暂存"）；
 *   ② 点侧栏「设置 / 图库 / 数模广场」时 `ChatPage` 被卸载，回来是全新的空 state。
 *
 * 所以状态放在**模块级 Map**（组件之外），按 sessionId 分槽：
 *   切走 → 槽位还在；切回 → `snapshot(sessionId)` 原样取出（顺序、条数、每块内容都不变）。
 *
 * ## 与 DB 的分工（下一轮要做的事已留好口）
 *
 * 本 store 只保证**应用运行期内**的复原，重启后不保证 —— 那需要把块序列落库
 * （项目契约 `chat_messages.parts`）。`hydrate()` 就是为那条路径预留的入口：
 * 外部可以直接灌一份"来自库里的块"，内部逻辑**不假设**缓存一定是本地产生的
 * （`applyStreamEvent` 是纯函数、`hydrate` 与流式事件写的是同一种槽位）。
 *
 * ## 容量
 *
 * `MAX_CACHED_SESSIONS` / `MAX_BLOCKS_PER_SESSION` 都是硬上限：长时间使用不许把内存吃光。
 * 超限淘汰**最旧更新**的会话（按 `updatedAt`，不是按插入序 —— 正在用的会话
 * 可能插入得早但一直在更新，按插入序会把它误杀）。
 *
 * ⚠️ `error` 故意**不在** phase 里：一轮里可能先报错、后面才 session-end。
 *    如果把 error 当成 phase，`active` 会在回合中途变 false，而
 *    `ChatPage` 的追问队列正是拿 `isRunning` 当门槛（`pendingTurnRef` 那段注释记录了
 *    这个坑的运行测试证据）—— 队列会提前开火，撞上主进程「该会话已有正在执行的任务」，
 *    消息被静默丢弃。所以 phase 只管轮次生命周期，error 单独记。
 */
import type { AgentActivity, ContentBlock, ContextWindowUsage, InflightTurn, StreamEvent, TokenUsage } from '@shared/types';
import { EMPTY_TASK_STATE, extractTasks, type TaskState } from './tasks';

/** 最多同时缓存多少个会话的存活窗口 */
export const MAX_CACHED_SESSIONS = 8;

/** 单个会话最多保留多少个过程块（超了从头丢，见 withBlocks） */
export const MAX_BLOCKS_PER_SESSION = 400;

/** 轮次生命周期：idle(还没跑过) → running → stopping → done */
export type StreamPhase = 'idle' | 'running' | 'stopping' | 'done';

/** 一个会话的存活窗口 */
export interface SessionStream {
  sessionId: string;
  phase: StreamPhase;
  /** 用户已主动停止这一轮；下一轮 beginTurn 前不接受旧 runner 的迟到事件。 */
  interrupted: boolean;
  /** 本会话**尚未落库**（或刚落库但为了兜底仍留着）的过程块，按时间序 */
  blocks: ContentBlock[];
  usage: TokenUsage | null;
  /** SDK 实测的当前窗口用量；与账单 token 统计是两回事。 */
  contextUsage: ContextWindowUsage | null;
  /** 最近一次压缩，用于在界面明确告诉用户自动整理确实发生过。 */
  lastCompaction: { before: number; after?: number; trigger: 'manual' | 'auto'; at: number } | null;
  /** 当前一轮实际启动过的子智能体，按 taskId 合并最新状态。 */
  agents: AgentActivity[];
  /**
   * 最近一次任务工具活动（TaskCreate/TaskUpdate/TodoWrite 的调用或回执）时刻。
   * 面板用它显示「任务状态最后更新于 X 前」—— 滞后可被用户直接看见（A4）。
   */
  lastTaskActivityAt?: number;
  error: string | null;
  /**
   * `blocks[0]` 在事件 `index` 空间里的下标。
   * 容量裁剪只从头部丢块，丢完必须记住"偏移了多少"，否则后续
   * `text-delta` 的 `ev.index` 会写错位置（串块）。
   */
  firstIndex: number;
  /** 最后一次更新时刻（淘汰排序用，也是以后接 DB 做合并的判据） */
  updatedAt: number;
}

/** 渲染 / 面板用的「窗口视图」—— 从 SessionStream 派生，不额外存状态 */
export interface LiveWindow {
  active: boolean;
  blocks: ContentBlock[];
  interrupted?: boolean;
}

/** `ChatPage` 的流式 state（原先是组件内的 `StreamState`，这里统一放 store 模块） */
export interface StreamView extends LiveWindow {
  sessionId: string | null;
  phase: StreamPhase;
  stopping: boolean;
  usage: TokenUsage | null;
  contextUsage: ContextWindowUsage | null;
  lastCompaction: SessionStream['lastCompaction'];
  agents: AgentActivity[];
  lastTaskActivityAt?: number;
  error: string | null;
}

/** 没有会话 / 没有存活窗口时的空视图（与旧组件内常量逐字段一致） */
export const EMPTY_STREAM: StreamView = {
  blocks: [],
  active: false,
  sessionId: null,
  phase: 'idle',
  interrupted: false,
  stopping: false,
  usage: null,
  contextUsage: null,
  lastCompaction: null,
  agents: [],
  error: null,
};

export function emptySessionStream(sessionId: string | null): SessionStream {
  return {
    sessionId: sessionId ?? '',
    phase: 'idle',
    interrupted: false,
    blocks: [],
    usage: null,
    contextUsage: null,
    lastCompaction: null,
    agents: [],
    error: null,
    firstIndex: 0,
    updatedAt: 0,
  };
}

/** 视图派生：`active` 的唯一判据是 phase === 'running' */
export function toView(entry: SessionStream | null | undefined): StreamView {
  if (!entry) return EMPTY_STREAM;
  return {
    blocks: entry.blocks,
    active: entry.phase === 'running' || entry.phase === 'stopping',
    sessionId: entry.sessionId || null,
    phase: entry.phase,
    interrupted: entry.interrupted,
    stopping: entry.phase === 'stopping',
    usage: entry.usage,
    contextUsage: entry.contextUsage,
    lastCompaction: entry.lastCompaction,
    agents: entry.agents,
    lastTaskActivityAt: entry.lastTaskActivityAt,
    error: entry.error,
  };
}

/** 任务面板相关的工具名（`mcp__server__TaskCreate` → `TaskCreate`） */
function isTaskTool(name: string | undefined): boolean {
  if (!name) return false;
  const short = name.split('__').pop() ?? name;
  return short === 'TaskCreate' || short === 'TaskUpdate' || short === 'TodoWrite';
}

/**
 * 数组里有没有"空洞"（`blocks[i] = x` 跳过某些下标会留 undefined）。
 * 有洞时数组位置 ≠ 事件 index - firstIndex，**此时不许裁剪**，否则偏移量算错。
 */
function isHoley(blocks: ContentBlock[]): boolean {
  return blocks.some((b) => !b);
}

/** 挂上新块序列（含容量裁剪 + 偏移量维护 + 更新时刻）；`extra` 允许同一事件顺带更新派生字段 */
function withBlocks(
  entry: SessionStream,
  blocks: ContentBlock[],
  now: number,
  extra?: Partial<Pick<SessionStream, 'lastTaskActivityAt'>>,
): SessionStream {
  let next = blocks;
  let firstIndex = entry.firstIndex;
  if (next.length > MAX_BLOCKS_PER_SESSION && !isHoley(next)) {
    const drop = next.length - MAX_BLOCKS_PER_SESSION;
    next = next.slice(drop);
    firstIndex += drop;
  }
  return { ...entry, blocks: next, firstIndex, updatedAt: now, ...extra };
}

/**
 * 把一条 `StreamEvent` 折进某个会话的存活窗口（纯函数，返回新对象）。
 *
 * 语义与旧 `ChatPage.applyEvent` **逐条对齐**，只多了两样：
 *   ① `ev.index` 先减去 `firstIndex`（容量裁剪后的偏移还原）；
 *   ② 每条都会写 `updatedAt`（`message-stop` 例外：它本来就不改状态）。
 */
export function applyStreamEvent(
  entry: SessionStream,
  ev: StreamEvent,
  now: number = Date.now(),
): SessionStream {
  switch (ev.type) {
    case 'session-start':
      return { ...entry, phase: 'running', error: null, updatedAt: now };

    case 'session-stopping':
      return entry.phase === 'running'
        ? { ...entry, phase: 'stopping', updatedAt: now }
        : entry;

    case 'block-start': {
      if (ev.kind !== 'text' && ev.kind !== 'thinking') return { ...entry, updatedAt: now };
      const i = ev.index - entry.firstIndex;
      if (i < 0) return { ...entry, updatedAt: now }; // 这块已被容量裁掉
      const blocks = entry.blocks.slice();
      blocks[i] = { kind: ev.kind, text: '' };
      return withBlocks(entry, blocks, now);
    }

    case 'text-delta': {
      const i = ev.index - entry.firstIndex;
      if (i < 0) return { ...entry, updatedAt: now };
      const blocks = entry.blocks.slice();
      const cur = blocks[i];
      if (cur && cur.kind === 'text') {
        blocks[i] = { ...cur, text: (cur.text ?? '') + ev.delta };
      } else {
        // 模型没发 block-start 就直接发 delta —— 兜底补一个
        blocks[i] = { kind: 'text', text: ev.delta };
      }
      return withBlocks(entry, blocks, now);
    }

    case 'thinking-delta': {
      const i = ev.index - entry.firstIndex;
      if (i < 0) return { ...entry, updatedAt: now };
      const blocks = entry.blocks.slice();
      const cur = blocks[i];
      if (cur && cur.kind === 'thinking') {
        blocks[i] = { ...cur, text: (cur.text ?? '') + ev.delta };
      } else {
        blocks[i] = { kind: 'thinking', text: ev.delta };
      }
      return withBlocks(entry, blocks, now);
    }

    case 'tool-use': {
      const isTask = isTaskTool(ev.toolName);
      return withBlocks(
        entry,
        [
          ...entry.blocks.filter(Boolean),
          {
            kind: 'tool_use',
            toolName: ev.toolName,
            toolUseId: ev.toolUseId,
            toolInput: ev.input,
          },
        ],
        now,
        isTask ? { lastTaskActivityAt: now } : undefined,
      );
    }

    case 'tool-result': {
      // TaskCreate 的回执（"Task #N created successfully"）也是任务活动（A4 时间戳）。
      const target = entry.blocks.find((b) => b && b.kind === 'tool_use' && b.toolUseId === ev.toolUseId);
      const isTask = isTaskTool(target?.toolName);
      const blocks = entry.blocks.map((b) =>
        b && b.kind === 'tool_use' && b.toolUseId === ev.toolUseId
          ? { ...b, toolResult: ev.result, isError: ev.isError }
          : b,
      );
      const next = { ...entry, blocks, updatedAt: now };
      return isTask ? { ...next, lastTaskActivityAt: now } : next;
    }

    case 'usage':
      return { ...entry, usage: ev.usage, updatedAt: now };

    case 'context-usage':
      return { ...entry, contextUsage: ev.usage, updatedAt: now };

    case 'context-compacted':
      return {
        ...entry,
        lastCompaction: { before: ev.before, after: ev.after, trigger: ev.trigger, at: now },
        updatedAt: now,
      };

    case 'agent-start':
    case 'agent-progress':
    case 'agent-end': {
      const agents = entry.agents.slice();
      const index = agents.findIndex((agent) => agent.taskId === ev.activity.taskId);
      if (index >= 0) agents[index] = ev.activity;
      else agents.push(ev.activity);
      return { ...entry, agents, updatedAt: now };
    }

    case 'session-error':
      return { ...entry, error: ev.message, updatedAt: now };

    case 'message-stop':
      return entry; // 与早期实现一致：不改状态

    case 'session-end':
      // ⚠️ 刻意**保留** blocks：后台会话跑完时用户可能正在别的会话，
      //    这是他切回来唯一能看到过程的地方（主进程 catch 分支不落块）。
      //    块只有在"下一轮开始"(beginTurn) 或容量淘汰时才会消失。
      //    `error` 这里不动，由调用方在收尾处理里 `clearError()` 清掉
      //    （恢复"收尾就不挂红条"的原有行为，见 clearError 注释）。
      return { ...entry, phase: 'done', updatedAt: now };

    default:
      return entry;
  }
}

/**
 * 任务进度面板的数据 = 已落库历史 + 本会话存活窗口。
 *
 * 与旧 `ChatPage` 的 memo **逐行等价**（含收尾那一两帧的 toolUseId 去重）：
 *   - 正在流式：存活窗口增量折在历史之上；
 *   - 已收尾且有存活块：按 toolUseId 去重（窗口那份带着更新的 tool_result）。
 */
export function panelTasks(
  historyBlocks: ContentBlock[],
  live: LiveWindow | null | undefined,
): TaskState {
  if (live?.interrupted) return EMPTY_TASK_STATE;
  const liveBlocks = (live?.blocks ?? []).filter(Boolean);

  // 新一轮就是新的“当前计划”。旧历史不能再次混进来，否则用户追问修改论文时，
  // 上一轮已经完成的任务会永久钉在输入框上方。
  if (live?.active) return extractTasks(liveBlocks);
  if (liveBlocks.length === 0) {
    const historical = extractTasks(historyBlocks);
    return historical.list.length > 0 && historical.list.every((task) => task.status === 'completed')
      ? EMPTY_TASK_STATE
      : historical;
  }

  const liveIds = new Set(
    liveBlocks.map((b) => b.toolUseId).filter((id): id is string => !!id),
  );
  const hist = historyBlocks.filter(
    (b) => !(b.kind === 'tool_use' && b.toolUseId && liveIds.has(b.toolUseId)),
  );
  const current = extractTasks([...hist, ...liveBlocks]);
  return current.list.length > 0 && current.list.every((task) => task.status === 'completed')
    ? EMPTY_TASK_STATE
    : current;
}

/**
 * 按会话隔离的存活窗口表。
 *
 * 读 (`get`/`snapshot`) **不**提升淘汰序：淘汰只看 `updatedAt`（谁最后被写过），
 * 不做 LRU 触达 —— 只看了一眼的会话不该挤掉真正在跑的那个。
 */
export class ChatStreamStore {
  private readonly map = new Map<string, SessionStream>();

  get size(): number {
    return this.map.size;
  }

  sessionIds(): string[] {
    return [...this.map.keys()];
  }

  /** 拿槽位（没有就 undefined）—— 不创建、不提升 */
  get(sessionId: string | null): SessionStream | undefined {
    if (!sessionId) return undefined;
    return this.map.get(sessionId);
  }

  /**
   * 切会话时的**恢复入口**：有存活窗口就用它，没有才给一个空窗口。
   * （`ChatPage.tsx` 切会话那一行调的就是它 —— 恢复逻辑只此一处。）
   */
  snapshot(sessionId: string | null): SessionStream {
    return this.get(sessionId) ?? emptySessionStream(sessionId);
  }

  /**
   * 收流事件。**不做任何"是不是当前会话"的判断** ——
   * 判断在调用方（`ChatPage`），这里一律照单收下，这是"切走不丢块"的关键。
   */
  apply(sessionId: string, ev: StreamEvent, now: number = Date.now()): SessionStream {
    const prev = this.map.get(sessionId) ?? emptySessionStream(sessionId);
    // 停止是本轮的终态。SDK/IPC 队列里已经在路上的旧事件不能把它重新点亮，
    // 尤其不能让迟到的 session-start 再显示“正在思考”。
    if (prev.interrupted && ev.type !== 'session-end') return prev;
    const next = applyStreamEvent(prev, ev, now);
    this.put(sessionId, next);
    return next;
  }

  /**
   * 「收一条流事件 + 判断要不要重渲染」—— `ChatPage` 订阅回调的**唯一入口**。
   *
   * 把这一步放进 store（而不是留在组件里写 `if (sid !== activeSessionId) return`）
   * 是为了让这条不变量**可被测试**：
   *   「事件属于别的会话时，槽位照样写，只是不触发重渲染」。
   * 谁要是改回"提前 return"，`chat-stream.test.ts` 里
   * 「当前会话 = B，来了 A 的事件」那条立刻变红。
   */
  receive(
    sessionId: string,
    ev: StreamEvent,
    currentSessionId: string | null,
    now: number = Date.now(),
  ): { entry: SessionStream; isCurrent: boolean } {
    const entry = this.apply(sessionId, ev, now);
    return { entry, isCurrent: sessionId === currentSessionId };
  }

  /** 新一轮开始：清空上一轮的窗口（对应旧代码 dispatch 里那句 `{...EMPTY_STREAM, active:true}`） */
  beginTurn(sessionId: string, now: number = Date.now()): SessionStream {
    const previous = this.snapshot(sessionId);
    const next: SessionStream = {
      ...emptySessionStream(sessionId),
      phase: 'running',
      interrupted: false,
      contextUsage: previous.contextUsage,
      lastCompaction: previous.lastCompaction,
      agents: [],
      updatedAt: now,
    };
    this.put(sessionId, next);
    return next;
  }

  /**
   * 这一轮不会再有事件了（用户点停止 / 发送失败）→ 置为收尾态。
   * **保留**已经产生的块：用户没理由因为点了停止就看不到刚才的过程。
   */
  interrupt(sessionId: string, now: number = Date.now()): SessionStream {
    const next: SessionStream = {
      ...this.snapshot(sessionId),
      phase: 'done',
      interrupted: true,
      updatedAt: now,
    };
    this.put(sessionId, next);
    return next;
  }

  /** 用户点了停止：冻结现有内容，但在主进程真正收尾前仍视为本轮进行中。 */
  requestStop(sessionId: string, now: number = Date.now()): SessionStream {
    const previous = this.snapshot(sessionId);
    if (previous.phase !== 'running') return previous;
    const next: SessionStream = { ...previous, phase: 'stopping', updatedAt: now };
    this.put(sessionId, next);
    return next;
  }

  /**
   * 最终历史已经读回后，原子移交给数据库消息，清掉同一轮的临时窗口。
   * 用量与最近一次压缩信息继续保留，模型旁的圆环不会因此跳回空值。
   */
  settleFromHistory(sessionId: string, now: number = Date.now()): SessionStream {
    const previous = this.snapshot(sessionId);
    const next: SessionStream = {
      ...previous,
      phase: 'done',
      blocks: [],
      firstIndex: 0,
      error: null,
      updatedAt: now,
    };
    this.put(sessionId, next);
    return next;
  }

  /**
   * 轮次收尾时清掉内联错误面板 —— 与改动前的行为一致（收尾就不再挂红条）。
   * **只清 error**，`blocks` 继续留着：那才是"切走再切回还能看到过程"的正题。
   */
  clearError(sessionId: string, now: number = Date.now()): SessionStream {
    const prev = this.snapshot(sessionId);
    if (prev.error === null) return prev; // 本来就没错 → 不白写一次（免得无谓改动 updatedAt）
    const next: SessionStream = { ...prev, error: null, updatedAt: now };
    this.put(sessionId, next);
    return next;
  }

  /**
   * 从外部灌一份块序列 —— 给"从 DB 复原"那条路留的口。
   * 与流式写入共用同一个槽位结构，所以调用方不需要区分"这份块是本地产的还是库里来的"。
   */
  hydrate(
    sessionId: string,
    blocks: ContentBlock[],
    opts?: {
      phase?: StreamPhase;
      usage?: TokenUsage | null;
      contextUsage?: ContextWindowUsage | null;
      lastCompaction?: SessionStream['lastCompaction'];
      error?: string | null;
      updatedAt?: number;
    },
  ): SessionStream {
    const base = emptySessionStream(sessionId);
    const entry: SessionStream = {
      ...base,
      blocks: blocks.filter(Boolean),
      phase: opts?.phase ?? 'done',
      usage: opts?.usage ?? null,
      contextUsage: opts?.contextUsage ?? null,
      lastCompaction: opts?.lastCompaction ?? null,
      error: opts?.error ?? null,
      updatedAt: opts?.updatedAt ?? Date.now(),
    };
    this.put(sessionId, entry);
    return entry;
  }

  /**
   * 读取会话时，把主进程给的**「进行中那一轮」快照**灌进槽位。
   *
   * 场景：用户在 A 发一轮、跑到一半切到 B、再切回 A。
   * 那一轮的 assistant 消息要等跑完才落库，`messages` 里根本没有它 ——
   * 快照（`turn_spills`）是唯一的过程来源，见 `shared/types.ts` 的 `InflightTurn`。
   *
   * ## 取舍规则（防同一过程画两遍）：**库里的那份优先**
   *
   * `inflight.messageId` 就是这一轮**收尾时会写进 messages 表**的那个 id，所以：
   *   · 历史里**没有**这条 id → 这一轮确实还没落库 → 灌快照，phase 标 `running`
   *     （它确实还在跑，界面因此显示"正在思考/流式中"，并允许后续事件续写）；
   *   · 历史里**已经有**这条 id → 快照是收尾路径漏删的残留（或"收尾与读取撞上了
   *     那一下"）→ **整份丢掉、一个字节都不写**。此时那一批块已经作为正式消息
   *     在历史里，再灌一遍就会出现"同一个过程两块"。
   *
   * ⚠️ 续写：灌进去的块序列与后续 `StreamEvent.index` 处在**同一个 index 空间**
   *    （两边都来自主进程同一轮的 `collected` 数组，见 `main/db/turn-spills.ts`），
   *    且这里把 `firstIndex` 归零 —— 所以之后 `receive()` 来的 delta/tool-use 都
   *    会**追加/续写**在同一批块上，不会把它当成一份冻结的历史副本。
   *
   * @param historyMessageIds 该会话历史消息的 id（用来判陈旧）
   * @returns 灌好后的槽位；判定为"陈旧 / 比槽位落后 / 空快照"时返回 null（此时槽位不动）
   */
  adoptInflight(
    sessionId: string,
    inflight: InflightTurn,
    historyMessageIds: Iterable<string>,
  ): SessionStream | null {
    for (const id of historyMessageIds) {
      if (id === inflight.messageId) return null; // 陈旧：库里那份优先，不重复渲染
    }

    /**
     * 反方向的"落后"：槽位里**已经在跑的同一轮**比这份快照还新 → 不许灌。
     *
     * 快照落库有节流（`turn-spills.ts` 的 `SPILL_THROTTLE_MS = 300`），最多能落后
     * 几百毫秒；而这几百毫秒里的 delta 已经通过 `pushToRenderer` 写进槽位了。
     * 用旧快照覆盖 = 把最后那段回答/最后一个工具卡片**截掉** —— 那正是这个 bug 的形态。
     * `blocks.length > 0` 是必须的：刚 `beginTurn` 的空槽位没什么可丢的，该灌就灌。
     */
    const prev = this.map.get(sessionId);
    if (prev?.interrupted) return null;
    if (
      prev &&
      prev.phase === 'running' &&
      prev.blocks.length > 0 &&
      prev.updatedAt >= inflight.updatedAt
    ) {
      return null;
    }

    // 空快照不灌：`InflightTurn` 的契约是"没有内容就别挂这个字段"，
    // 灌一个空的 running 槽位会凭空多出一个空气泡（见 shared/types.ts:109-112）。
    if (inflight.blocks.length === 0) return null;

    return this.hydrate(sessionId, inflight.blocks, {
      phase: 'running',
      updatedAt: inflight.updatedAt,
    });
  }

  reset(): void {
    this.map.clear();
  }

  clear(sessionId: string): void {
    this.map.delete(sessionId);
  }

  private put(sessionId: string, entry: SessionStream): void {
    this.map.set(sessionId, entry);
    if (this.map.size > MAX_CACHED_SESSIONS) this.evictOldest(sessionId);
  }

  /** 淘汰 `updatedAt` 最小的那个；**跳过刚写入的这个**（它可能有测试指定的较小时刻） */
  private evictOldest(protect: string): void {
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [key, value] of this.map) {
      if (key === protect) continue;
      if (value.updatedAt < oldestAt) {
        oldestAt = value.updatedAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) this.map.delete(oldestKey);
  }
}

/** 应用级单例 —— 模块级（组件之外），所以 `ChatPage` 卸载重建后数据还在 */
export const chatStreamStore = new ChatStreamStore();
