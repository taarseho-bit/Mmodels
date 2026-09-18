/**
 * 消息级操作 —— 「编辑后重发 / 回到此消息之前 / 从此分叉」的业务核心。
 *
 * 原版把这三件事做成**两条本地 HTTP 路由**（不是 IPC 通道）：
 *   `POST /api/checkpoint/revert`      —— 回滚工作区 + 删掉这条及之后的消息
 *   `POST /api/sessions/:id/fork`      —— 从某条消息分叉出一个新会话
 * 「编辑后重发」没有独立路由：它是渲染层把「回退到这条之前 + 把改好的文本填回输入框」
 * 串起来的一次动作（原版渲染层就是这么组合的）。
 *
 * ── 原版证据（decoded main 的字符偏移，可 Read 复核；逐字原文见
 *    `.workbuddy/ui-audit/verify/original-code-dumps.md` 的 **§8**） ──
 *   `/api/checkpoint/revert` 路由体        @1589796
 *   `/api/sessions/:id/fork` 路由体        @1538120
 *   fork 的切片规则与 resumable 判据        @1538989
 *   revert 请求 schema（只有两个字段）      @389090
 *   fork 请求 schema / 响应 schema          @390090
 *   分叉标题后缀（7 字符）                   @1532301
 *
 * ── 复刻侧的三处**有意偏离**（每一处都必须写在这里，否则会被当成抄错） ──
 *
 *  ① **回滚必须带 `confirm: true`（加固，原版没有这个字段）。**
 *     原版的确认只在渲染层的对话框里 —— 路由本身对"没确认"的请求照做。
 *     对复刻这不够：`/api/*` 挂载点对**同机任何进程**开放（带 token 即可），
 *     而这条路由会**覆盖并删除用户的工作区文件**。所以复刻把确认位做成
 *     请求体的一部分：没有 `confirm: true` 一律 400，且**在读数据库/碰文件之前**返回。
 *     （同族先例：B19「拒绝覆盖用户手写文件」、`.broken.bak` 备份约定。）
 *
 *  ② **回滚的实现是「git 快照回滚」，不是"覆盖文件"。**
 *     复刻的 `checkpoint_ref` 存的是 `git/saveVersion()` 的 commit sha（P0 已落地），
 *     所以走 `restoreVersion()`：它**先写 restore-backup 备份**、再 checkout 目标版本、
 *     最后删掉「当时被跟踪、但目标版本里没有」的文件。见 `git/index.ts` 的注释。
 *     原版的 checkpoint 存在自己的 `project_versions` 表里，不碰项目目录 ——
 *     复刻复用 git 的副作用（会自动 git init）在 P0-5 已报备，这里不改行为。
 *
 *  ③ **fork 复制消息时保留 `checkpoint_ref` 原值，并显式清掉 `sdk_session_id`。**
 *     · ref：原版把 ref 复制进**新会话的命名空间**（`refFor(newId, msgId)`）。
 *       复刻的 ref 是仓库级 commit sha，对同一项目下的任何会话都直接有效 ——
 *       等价于原版的"remap"，而且是同一个快照本身。
 *     · sdk_session_id：原版在 `resumable === false` 时**原样复制** agentSessionId。
 *       复刻的 `agent_msg_uuid` 目前恒为 NULL（P0 只加列，值等 agent 侧接出来），
 *       即 resumable 恒为 false ⇒ 照抄就会把父会话的 SDK 会话 id 复制过去，
 *       两个会话**共用同一个 agent 上下文**：分叉后继续聊会把消息写进父会话的上下文里，
 *       而且 agent 看到的是**完整原文**、不是截断到分叉点的那一段 —— 与"分叉"的语义相反。
 *       所以复刻置空，新会话从零开始（消息历史仍在，用户看到的对话是完整的）。
 *
 * ── 最容易踩错的一句话 ──
 *   这三件事都会**改用户的文件**，所以：① 确认门槛必须排在**所有**副作用之前；
 *   ② 回滚失败时**不许**进入删消息那一步（原版的顺序就是"先恢复文件、再删消息"），
 *   否则用户会得到"文件没回来、对话却没了"的半改状态。
 */
import { z } from 'zod';
import type { ContentBlock } from '@shared/types';

// ─────────────────────────────────────────────────────────────
// 契约
// ─────────────────────────────────────────────────────────────

/** 分叉出来的会话标题后缀 —— 与原版逐字一致（原版这个常量是 7 个字符） */
export const FORK_TITLE_SUFFIX = ' · fork';

/**
 * `POST /api/checkpoint/revert` 的请求体。
 *
 * ⚠️ `confirm: z.literal(true)` 是**复刻的加固**，不是原版字段（见文件头 ①）。
 * 用 `literal(true)` 而不是 `boolean()` 是刻意的：`confirm: false` 必须**解析失败**，
 * 不能出现"传了 confirm 就算数"的漏洞。
 */
export const revertRequestSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  confirm: z.literal(true),
});

/** `POST /api/sessions/:id/fork` 的请求体 —— 与原版 `ds` 逐字一致（只有 messageId） */
export const forkRequestSchema = z.object({ messageId: z.string().min(1) });

export type RevertRequest = z.infer<typeof revertRequestSchema>;
export type ForkRequest = z.infer<typeof forkRequestSchema>;

/** 原版的错误码，逐字照抄（渲染层按这些字符串查 i18n，见 `chat.useChat.revert*`） */
export type RevertErrorCode =
  | 'confirm_required'
  | 'bad_request'
  | 'session_not_found'
  | 'turn_running'
  | 'message_not_found'
  | 'no_checkpoint'
  | 'restore_failed';

export type ForkErrorCode = 'bad_request' | 'session_not_found' | 'message_not_found';

/**
 * 一条消息在**本模块内的口径**。
 *
 * ⚠️ 与 `ChatMessage` 的差别只有一处：`content` 是**派生**出来的（由 text 块拼成），
 *    因为原版的 `messages` 有 `content` 与 `parts` 两列，复刻只有 `blocks` 一列。
 *    fork 要把整块负载原样复制给新会话，所以 `blocks` 也一起带着。
 */
export interface OpsMessage {
  id: string;
  role: 'user' | 'assistant';
  /** 原版 `content` 列：只含 text 块（不含 thinking / 工具） */
  content: string;
  /** 原样复制给新会话的负载 */
  blocks: ContentBlock[];
  createdAt: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  /** 这条消息发出**之前**的工作区快照 ref（只有 user 行有值） */
  checkpointRef: string | null;
  /** agent 侧的消息 id（只有 assistant 行有值）；fork 的 resumable 判据要用 */
  agentMsgUuid: string | null;
}

// ─────────────────────────────────────────────────────────────
// 确认门槛（纯函数）—— 这是"会改用户文件"的唯一入口闸
// ─────────────────────────────────────────────────────────────

export type RevertGate =
  | { ok: true; value: { sessionId: string; messageId: string } }
  | { ok: false; status: 400; error: 'confirm_required' | 'bad_request' };

/**
 * 判断一次 revert 请求能不能往下走。
 *
 * ⚠️ **这个函数必须被路由在"读会话 / 读消息 / 碰文件"之前调用**，它是安全底线：
 *    · 不是对象（null / 数组 / 字符串）        → bad_request
 *    · `confirm !== true`（含 false、缺失、1、"true"）→ **confirm_required**
 *    · 形状不对（缺 sessionId / messageId）    → bad_request
 *
 * 抽成纯函数是为了能在 node 环境下对"没确认时零改动"这条判据做**真反例**：
 * 把 `confirm !== true` 这一句去掉，测试必须变红（见 message-ops.test.ts 的反向对照）。
 */
export function checkRevertRequest(body: unknown): RevertGate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: 'bad_request' };
  }
  const b = body as Record<string, unknown>;
  // 先判确认位：这一步在解析之前，所以缺字段的请求也一定会被记成 confirm_required
  if (b.confirm !== true) return { ok: false, status: 400, error: 'confirm_required' };
  const parsed = revertRequestSchema.safeParse(b);
  if (!parsed.success) return { ok: false, status: 400, error: 'bad_request' };
  return { ok: true, value: { sessionId: parsed.data.sessionId, messageId: parsed.data.messageId } };
}

/** fork 请求体的校验（fork **不改任何文件**，所以不需要确认位） */
export function checkForkRequest(body: unknown):
  | { ok: true; value: { messageId: string } }
  | { ok: false; status: 400; error: 'bad_request' } {
  const parsed = forkRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false, status: 400, error: 'bad_request' };
  return { ok: true, value: parsed.data };
}

// ─────────────────────────────────────────────────────────────
// 回滚目标解析（纯函数）
// ─────────────────────────────────────────────────────────────

export type RevertPlan =
  | {
      ok: true;
      /** 目标消息在数组里的下标 */
      index: number;
      /** 要恢复到的快照 ref */
      checkpointRef: string;
      /** 这条消息（含）之后的全部消息 —— 恢复成功后要删掉的就是它们 */
      removed: OpsMessage[];
      /** 这条消息之前保留的消息 */
      kept: OpsMessage[];
    }
  | { ok: false; status: 404 | 400; error: 'message_not_found' | 'no_checkpoint' };

/**
 * 找出「回到此消息之前」的目标与要删的消息。
 *
 * 与原版逐条一致的三处判断：
 *   1. 下标 < 0（消息不存在）            → 404 message_not_found
 *   2. role 不是 user（含下标为 -1 时取到 undefined 的情况）→ 404 message_not_found
 *      —— 原版对"非 user 行"和对"没有这条"用的是**同一个错误码**，照抄。
 *   3. `checkpointRef` 为空              → 400 no_checkpoint
 *      —— 这一条是 P0 的设计判断：工作区干净时 `saveVersion()` 返回 `committed:false`
 *         且没有 sha，`captureCheckpoint` 会记 `null`。**不能**退用更早的快照当目标，
 *         否则恢复出来的工作区会比用户预期的还早一步（静默的错误结果）。
 */
export function planRevert(messages: OpsMessage[], messageId: string): RevertPlan {
  const index = messages.findIndex((m) => m.id === messageId);
  const target: OpsMessage | undefined = index >= 0 ? messages[index] : undefined;
  if (!target || target.role !== 'user') {
    return { ok: false, status: 404, error: 'message_not_found' };
  }
  if (!target.checkpointRef) return { ok: false, status: 400, error: 'no_checkpoint' };
  return {
    ok: true,
    index,
    checkpointRef: target.checkpointRef,
    removed: messages.slice(index),
    kept: messages.slice(0, index),
  };
}

// ─────────────────────────────────────────────────────────────
// 分叉计划（纯函数）
// ─────────────────────────────────────────────────────────────

export type ForkPlan =
  | {
      ok: true;
      index: number;
      /** 复制给新会话的消息（顺序不变） */
      kept: OpsMessage[];
      /** 用户消息分叉时要预填到输入框的原文；助手消息分叉时为 null */
      draft: string | null;
      /** agent 上下文能不能续上 —— 原版判据：kept 里有带 agentMsgUuid 的 assistant 行 */
      resumable: boolean;
    }
  | { ok: false; status: 404; error: 'message_not_found' };

/**
 * 算出分叉要保留哪些消息。
 *
 * 原版的切片规则（**两个方向不对称，这是刻意的**）：
 *   · 从**用户**消息分叉 → `slice(0, idx)`：本条**不含**，它的原文作为 `draft` 预填输入框
 *     （用户接下来要改一改再发，所以不能已经出现在历史里）；
 *   · 从**助手**回复分叉 → `slice(0, idx + 1)`：本条**含**（"从此回复分叉"就是要带上这条回复）。
 */
export function planFork(messages: OpsMessage[], messageId: string): ForkPlan {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index < 0) return { ok: false, status: 404, error: 'message_not_found' };
  const target = messages[index];
  const kept = target.role === 'user' ? messages.slice(0, index) : messages.slice(0, index + 1);
  return {
    ok: true,
    index,
    kept,
    draft: target.role === 'user' ? target.content : null,
    resumable: kept.some((m) => m.role === 'assistant' && !!m.agentMsgUuid),
  };
}

/**
 * 分叉会话的标题。
 *
 * 原版：`title.endsWith(SUFFIX) ? title.slice(0, -7) : title` 再拼 `SUFFIX`。
 * 用 `SUFFIX.length` 而不是硬编码的 7（等价，但后缀改了不会跟着错）。
 * 净效果 = 「结尾没有后缀才追加」——连分叉两次不会得到 `· fork · fork`。
 */
export function forkTitle(title: string): string {
  const base = title.trim() || '新会话';
  const stripped = base.endsWith(FORK_TITLE_SUFFIX)
    ? base.slice(0, -FORK_TITLE_SUFFIX.length)
    : base;
  return stripped + FORK_TITLE_SUFFIX;
}

/**
 * 「编辑后重发」只对**最后一条用户消息**开放。
 *
 * 原版渲染层的判据是 `canEdit: message.id === <某个单一 id>`（不是"所有用户消息"）——
 * 因为编辑重发会删掉这条之后的全部对话，只有尾部那条才符合直觉。
 * 这里把这个 id 的算法抽出来：**最后一条 role === 'user' 的消息**。
 *
 * ⚠️ 不要求"这条之后没有 assistant 消息"：原版也不要求。若它后面已有回复，
 *    那条回复会一并被移除 —— 这正是 `revertDialogBody` 那句话要写清楚的事
 *    （"这条消息及之后的对话也会一并移除"）。
 */
export function editableUserMessageId(messages: OpsMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return messages[i].id;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// 回滚编排（**唯一会碰用户文件的函数**）
// ─────────────────────────────────────────────────────────────

export interface RestoreOutcome {
  ok: boolean;
  /** 恢复前自动写下的备份版本 sha（有改动时才有） */
  backupSha?: string;
  reason?: string;
}

/** 把工作区恢复到某个快照。真实实现是 `git/restoreVersion()`（**先备份再覆盖**） */
export type RestoreFn = (cwd: string, ref: string) => Promise<RestoreOutcome>;

export type RevertResult =
  | {
      ok: true;
      status: 200;
      /** 恢复到的快照 */
      checkpointRef: string;
      /** 恢复前自动备份出来的版本（失败时 undefined） */
      backupSha?: string;
      /** 需要从数据库删掉的消息（含目标那条） */
      removed: OpsMessage[];
      /** 保留下来的消息 */
      kept: OpsMessage[];
    }
  | { ok: false; status: 400 | 404 | 409 | 500; error: RevertErrorCode };

export interface RevertContext {
  /** 目标会话是否存在；存在则带上它的工作区根目录 */
  session: { cwd: string } | null;
  /** 该会话是否正在跑一轮（原版在这里回 409 turn_running） */
  running: boolean;
  /** 该会话的全部消息，按 createdAt 升序 */
  messages: OpsMessage[];
}

/**
 * 执行回滚：**先过确认门槛 → 再检会话/回合/消息 → 最后才碰文件**。
 *
 * 返回 `ok: true` 时**文件已经改完**了，调用方接着做数据库侧的收尾（删消息、清 agent 会话 id）。
 * 返回 `ok: false` 时**一个文件都没动**（除非 restore 自己做到一半炸了 —— 那种情况
 * `restoreVersion` 会回 `ok:false`，此时它已经写下的 restore-backup 备份是只增不减的，
 * 不会丢用户数据；见 git/index.ts 的三条注释）。
 *
 * 顺序与原版逐条一致（原版也是 session → turn_running → message → restore）：
 *   ① 确认门槛（**复刻新增，排在最前**）
 *   ② 会话不存在            → 404 session_not_found
 *   ③ 回合在跑              → 409 turn_running
 *   ④ 消息找不到 / 不是 user → 404 message_not_found
 *   ⑤ 没有 checkpoint       → 400 no_checkpoint
 *   ⑥ 恢复失败              → 500 restore_failed（**此时还没删任何消息**）
 */
export async function revertToMessage(
  body: unknown,
  ctx: RevertContext,
  restore: RestoreFn,
): Promise<RevertResult> {
  const gate = checkRevertRequest(body);
  if (!gate.ok) return { ok: false, status: gate.status, error: gate.error };

  if (!ctx.session) return { ok: false, status: 404, error: 'session_not_found' };
  if (ctx.running) return { ok: false, status: 409, error: 'turn_running' };

  const plan = planRevert(ctx.messages, gate.value.messageId);
  if (!plan.ok) return { ok: false, status: plan.status, error: plan.error };

  const restored = await restore(ctx.session.cwd, plan.checkpointRef);
  if (!restored.ok) return { ok: false, status: 500, error: 'restore_failed' };

  return {
    ok: true,
    status: 200,
    checkpointRef: plan.checkpointRef,
    backupSha: restored.backupSha,
    removed: plan.removed,
    kept: plan.kept,
  };
}

// ─────────────────────────────────────────────────────────────
// 分叉编排（**不改任何文件**）
// ─────────────────────────────────────────────────────────────

/** 父会话里 fork 需要的那几项 */
export interface ForkSource {
  id: string;
  title: string;
  projectId: string;
  providerId: string;
  model: string;
}

export interface ForkSessionRow {
  id: string;
  projectId: string;
  title: string;
  providerId: string;
  model: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ForkMessageRow {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  model: string | null;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  checkpointRef: string | null;
  agentMsgUuid: string | null;
}

/** 落库端口 —— 抽出来是为了能用**内存实现**做"原会话逐条不变"的断言 */
export interface ForkPorts {
  createSession(row: ForkSessionRow): void;
  insertMessages(rows: ForkMessageRow[]): void;
}

export interface ForkResult {
  session: {
    id: string;
    projectId: string;
    title: string;
    providerId: string;
    model: string;
    createdAt: number;
    updatedAt: number;
  };
  /** 复制过来的消息条数（原版响应字段名逐字一致） */
  copiedMessages: number;
  /** 从用户消息分叉时预填输入框的原文（原版响应字段名逐字一致） */
  draft: string | null;
  /**
   * ⚠️ 复刻**多加**的一个字段（原版响应只有上面三项）。
   * 它回答"新会话能不能接上 agent 上下文"——复刻的 `agent_msg_uuid` 目前恒为 NULL，
   * 所以恒为 false。加出来是为了让渲染层/排查的人**不必去读代码才知道**这件事。
   */
  resumable: boolean;
}

export type ForkOutcome =
  | { ok: true; status: 201; result: ForkResult }
  | { ok: false; status: 400 | 404; error: ForkErrorCode };

/**
 * 执行分叉。
 *
 * ⚠️ 两条硬约束：
 *   · **原会话一个字节都不许变**：新会话是一行新的 session + 一批**新 id** 的 message，
 *     消息对象是**新建的副本**（不是在 `from` 上改 id —— 那样会连带改掉父会话那一行）。
 *   · 新会话的 `message_count` = 复制过来的条数（不是父会话的计数）。
 */
export function executeFork(
  input: { session: ForkSource; messages: OpsMessage[]; body: unknown },
  ports: ForkPorts,
  newId: () => string,
  now: number,
): ForkOutcome {
  const gate = checkForkRequest(input.body);
  if (!gate.ok) return { ok: false, status: 400, error: 'bad_request' };

  const plan = planFork(input.messages, gate.value.messageId);
  if (!plan.ok) return { ok: false, status: 404, error: 'message_not_found' };

  const sessionId = newId();
  const ts = now;
  const session: ForkSessionRow = {
    id: sessionId,
    projectId: input.session.projectId,
    title: forkTitle(input.session.title),
    providerId: input.session.providerId,
    model: input.session.model,
    messageCount: plan.kept.length,
    createdAt: ts,
    updatedAt: ts,
  };

  // 每复制一条就换一个新 id —— 用 map 产出**新对象**，绝不原地改 `from.id`
  const rows: ForkMessageRow[] = plan.kept.map((from) => ({
    id: newId(),
    sessionId,
    role: from.role,
    blocks: from.blocks,
    model: from.model,
    createdAt: from.createdAt,
    inputTokens: from.inputTokens,
    outputTokens: from.outputTokens,
    // 见文件头 ③：ref 是仓库级 sha，原样带过去就是原版 remap 的等价物
    checkpointRef: from.checkpointRef,
    agentMsgUuid: from.agentMsgUuid,
  }));

  ports.createSession(session);
  ports.insertMessages(rows);

  return {
    ok: true,
    status: 201,
    result: {
      session: {
        id: session.id,
        projectId: session.projectId,
        title: session.title,
        providerId: session.providerId,
        model: session.model,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      copiedMessages: rows.length,
      draft: plan.draft,
      resumable: plan.resumable,
    },
  };
}
