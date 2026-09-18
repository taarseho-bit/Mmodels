/**
 * 任务进度面板的数据层 —— 从**工具调用流**里还原 agent 自己拆出的子任务。
 *
 * 事实来源（实机抓取，非猜测）：
 *   `.workbuddy/ui-audit/real-ds-t5b/mmodels.db` 的 messages.blocks 里有真实一轮：
 *     tool_use { toolName: 'TaskCreate', toolInput: {subject, description, activeForm} }
 *     tool_result "Task #1 created successfully: 修复并跑通 problem3/problem4 求解脚本"
 *     tool_use { toolName: 'TaskUpdate', toolInput: {taskId: '1', status: 'in_progress'} }
 *     tool_result "Updated task #1 status"
 *   → Tool 侧 task id 只出现在**工具结果文本**里（`Task #N`），input 里没有。
 *   → tool_result 实测恒为 string（7 条 TaskCreate + 8 条 TaskUpdate 全是 string）。
 *
 * 为什么做成纯函数 + 增量 fold：
 *   ① 可单测（不依赖 Electron / DOM）；
 *   ② 渲染层能**从历史消息重建**面板 —— 会话切走再回来、甚至重启应用，
 *      只要消息还在库里，面板就能复原，不需要额外持久化一份任务状态。
 *
 * ⚠️ 顺序即语义：列表**按 TaskCreate 的先后**排列，绝不按状态重排。
 *    用户要看的不是「哪些做完了」，而是「这件事做到第几步了」。
 */
import type { ContentBlock } from '@shared/types';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  /** 面板 / React 的稳定键（Tool 侧 task id，拿不到时用兜底键，见 createTask） */
  key: string;
  /** Tool 侧 task id（'1' / '2'…），拿不到时为 undefined */
  toolId?: string;
  subject: string;
  activeForm?: string;
  status: TaskStatus;
}

export interface TaskState {
  /** 有序任务列表（保持创建顺序） */
  list: TaskItem[];
  /**
   * Tool 侧 task id → 条目 key。
   * ⚠️ 已从 list 移除（deleted）的条目**仍留在这里** —— 否则一个迟到的
   *    TaskUpdate 会顺着序号兜底匹配到**另一条**任务上，把状态改错。
   */
  idToKey: Map<string, string>;
  /** 兜底 key 的自增序号 */
  seq: number;
}

export interface TaskProgress {
  /** 已完成条数（deleted 已不在 list 里，天然不进分母） */
  completed: number;
  /** 总条数 */
  total: number;
  /** 当前进行中的那条（没有则为 null） */
  current: TaskItem | null;
}

export const EMPTY_TASK_STATE: TaskState = { list: [], idToKey: new Map(), seq: 0 };

/**
 * 工具名简短化：`mcp__server__TaskCreate` → `TaskCreate`。
 * 认的三个名字：TaskCreate / TaskUpdate（实机长跑里的真名）
 * 与 TodoWrite（原版字符串表 `scripts/string-table.tsv` 里也有这一条）。
 */
function shortToolName(name: string): string {
  return name.split('__').pop() ?? name;
}

function asText(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v == null) return null;
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * 从 TaskCreate 的工具结果里抠出 Tool 侧 task id。
 * 实机格式：`Task #1 created successfully: <subject>`
 * 拿不到就返回 null —— 调用方走兜底键。
 */
function parseCreatedId(result: unknown): string | null {
  const text = asText(result);
  if (!text) return null;
  const m = /Task\s*#(\d+)/i.exec(text);
  return m ? m[1] : null;
}

function normStatus(v: unknown): TaskStatus {
  return v === 'completed' || v === 'in_progress' ? v : 'pending';
}

/** TaskCreate：追加一条（必要时开新一批） */
function createTask(state: TaskState, input: Record<string, unknown>, toolId: string | null): TaskState {
  const subject =
    asString(input.subject) ?? asString(input.content) ?? asString(input.activeForm) ?? '未命名任务';

  // ── 「下一批」规则 ─────────────────────────────────────────
  // 上一批**全部完成**之后再出现 TaskCreate → 说明 agent 开了新活，
  // 面板换成新一批（此时旧批次的 x/y 已经没有信息量了）。
  // 没全完成时只追加，绝不重置 —— 那会丢掉用户正在看的进度。
  const stale = state.list.length > 0 && state.list.every((t) => t.status === 'completed');
  const list = stale ? [] : state.list.slice();

  const seq = state.seq + 1;
  /**
   * 兜底键：Tool 侧 id 通常在同一条 block 的 tool_result 里（正常路径）。
   * ⚠️ 流式途中 tool-result 还没回来时会短暂拿不到 id —— 这时用「创建序号」
   *    兜底，而不是用 subject：同名子任务（"跑测试"出现两次）会撞 key。
   */
  const key = toolId ? `t${toolId}` : `k${seq}`;

  const item: TaskItem = { key, toolId: toolId ?? undefined, subject, activeForm: asString(input.activeForm), status: 'pending' };
  list.push(item);

  const idToKey = stale ? new Map<string, string>() : new Map(state.idToKey);
  if (toolId) idToKey.set(toolId, key);

  return { list, idToKey, seq };
}

/** TaskUpdate：改一条的状态；deleted 直接移出列表 */
function updateTask(state: TaskState, input: Record<string, unknown>): TaskState {
  const id = asString(input.taskId) ?? asString(input.id);
  const rawStatus = asString(input.status);
  if (!id || !rawStatus) return state;

  let idx = -1;
  const key = state.idToKey.get(id);
  if (key) idx = state.list.findIndex((t) => t.key === key);
  if (idx < 0 && /^\d+$/.test(id)) {
    // 兜底：创建结果还没回来（条目还没有 toolId）时，按创建序号对号入座。
    const n = Number(id) - 1;
    if (state.list[n] && !state.list[n].toolId) idx = n;
  }
  if (idx < 0) return state; // 匹配不上（比如已被 deleted 摘掉）—— 忽略，不猜

  if (rawStatus === 'deleted') {
    const list = state.list.slice();
    list.splice(idx, 1);
    return { ...state, list }; // idToKey 保留，见 TaskState.idToKey 注释
  }

  const list = state.list.slice();
  list[idx] = { ...list[idx], status: normStatus(rawStatus) };
  return { ...state, list };
}

/** TodoWrite：input.todos 是整张表，直接替换 */
function replaceWithTodos(state: TaskState, raw: unknown): TaskState {
  const arr = Array.isArray(raw) ? raw : [];
  const list: TaskItem[] = [];
  arr.forEach((td, i) => {
    const o = (td ?? {}) as Record<string, unknown>;
    const subject = asString(o.content) ?? asString(o.activeForm);
    if (!subject) return;
    list.push({
      key: `todo${i}`,
      subject,
      activeForm: asString(o.activeForm),
      status: o.status === 'cancelled' ? 'pending' : normStatus(o.status),
    });
  });
  return { list, idToKey: new Map(), seq: state.seq + list.length };
}

/**
 * 把一段**有序的**内容块折叠成任务状态。
 *
 * @param blocks  按时间顺序排列的内容块（历史消息在前、流式块在后）
 * @param initial 起点 —— 增量折叠时传入「历史部分算出来的状态」
 */
export function extractTasks(blocks: ContentBlock[], initial: TaskState = EMPTY_TASK_STATE): TaskState {
  let state = initial;
  for (const b of blocks) {
    if (!b || b.kind !== 'tool_use' || !b.toolName) continue;
    const name = shortToolName(b.toolName);
    if (name !== 'TaskCreate' && name !== 'TaskUpdate' && name !== 'TodoWrite') continue;

    const input = (b.toolInput ?? {}) as Record<string, unknown>;
    if (name === 'TodoWrite') state = replaceWithTodos(state, input.todos);
    else if (name === 'TaskCreate') state = createTask(state, input, parseCreatedId(b.toolResult));
    else state = updateTask(state, input);
  }
  return state;
}

/** 多条消息的块拼成一条有序流 */
export function blocksOf(messages: Array<{ blocks: ContentBlock[] }>): ContentBlock[] {
  return messages.flatMap((m) => m.blocks ?? []);
}

/** x/y 计数与「当前进行中」 */
export function progressOf(state: TaskState): TaskProgress {
  let completed = 0;
  let current: TaskItem | null = null;
  for (const t of state.list) {
    if (t.status === 'completed') completed++;
    else if (t.status === 'in_progress' && !current) current = t;
  }
  return { completed, total: state.list.length, current };
}
