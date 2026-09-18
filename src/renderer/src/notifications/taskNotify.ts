/**
 * 任务完成类**系统通知**的渲染层实现 —— 原版四个调用点 + 它们的门控。
 *
 * 行号出自 `.baseline/readable/index-OYc102qC.js`（原版 renderer bundle 的还原产物）；
 * 逐字原文另存 `.workbuddy/ui-audit/verify/original-code-dumps.md`，**不写在本文件的注释里**
 * （理由见 `WRITE-RULES.md §8`：注释里的逐字引用会被 `grep -c` 一起数上，给出假数字）。
 *
 * ── 原版取证（函数名 @ 行号）───────────────────────────────────
 *   `t4`  @19701  压成一行 / ≤140 字 / 空串 → null
 *   `ZI`  @19705  `visibilityState === "visible" && hasFocus()`
 *   `YI`  @19708  `settings?.notifications ?? true`
 *   `n4`  @19711  `YI ? !(ZI() && hash.startsWith('#/chat/'+sid)) : false`
 *   `i4`  @19714  会话标题，空 → 「未命名会话」
 *   `Ice` @19718  最后一条 assistant 正文（≤140 字），没有 → null
 *   `Fce` @19728  一轮完成
 *   `zce` @19731  审批类别 → 文案键
 *   `jce` @19741  待审批
 *   `Bce` @19744  Agent 提问
 *   `Uce` @19747  自动化（**少一项 hash 判断**）
 *
 * ── 原版挂载点（都在 stream event 的 switch 里）────────────────
 *   `case "done"`              @20133  → `Fce`，前置条件 `!stream.error`
 *   `case "approval-request"`  @20141  → `jce`
 *   `case "user-input-request"`@20147  → `Bce`
 *
 * ⚠️ **复刻的流事件类型与原版不同**（见 `src/shared/types.ts:139`）：复刻的 `StreamEvent`
 *    只有 11 种，**没有** `approval-request` / `user-input-request` —— 这两种在复刻里
 *    走**独立 IPC**（`session:approval-ask` / `session:ask-user`，见 `src/main/ipc/session.ts:520,527`）。
 *    所以本文件这三个函数在 `pages/ChatPage.tsx` 里的挂载点相应换成 IPC 订阅。
 *
 * ⚠️ 为什么单独一个文件、为什么全是纯函数：
 *    本仓**没有 jsdom**（`vitest.config.ts` 是 `environment: 'node'`），组件里的
 *    `useEffect` 接线测不到；把「该不该弹」「文案怎么拼」抽成纯函数才测得到
 *    （见同目录 `taskNotify.test.ts`）。接线本身在 `pages/ChatPage.tsx`。
 *
 * ⚠️ 主进程那侧还有**另一道**门禁（`src/main/notify.ts`：「允许系统通知」+ 系统是否支持）。
 *    与本文件的 `enabled` **重复但不冲突** —— 原版渲染层也是先判 `YI(t)` 再调 `show`。
 */
import type { ApprovalKind, ChatMessage, SessionMeta } from '@shared/types';
import { tx } from '../i18n';

/** 通知正文最大长度 —— 逐字取自原版 `bR`（@19700） */
export const MAX_NOTIFY_BODY = 140;

/** 递给 `notifications.show` 的载荷。三个字段**全部必填** —— `sessionId` 缺了点击就不跳会话 */
export interface NotifyShowPayload {
  title: string;
  body: string;
  sessionId: string;
}

/** 一次通知所需的全部环境量（由调用方在事件发生时取快照，避免读到过期的 state） */
export interface TaskNotifyContext {
  /** 设置里「允许系统通知」——原版 `YI` */
  enabled: boolean;
  /** 窗口可见且有焦点 —— 原版 `ZI()` */
  attentive: boolean;
  /** 用户此刻正看着**这个**会话 —— 原版 `hash.startsWith('#/chat/'+sid)` */
  sameChat: boolean;
  /** 会话标题来源 —— 原版 `i4` 读的 `["sessions"]` 查询缓存 */
  sessions: readonly SessionMeta[];
  /** 真正把通知递出去（渲染层实现 = `window.mathmodel.notifications.show`） */
  show: (payload: NotifyShowPayload) => unknown;
}

/**
 * 原版 `YI(t)`（@19708）的逐字翻译：**未设置视为开启**，只有显式 `false` 才拦。
 * ⚠️ 老用户设置里没有这个字段时不能因为"读不到"就把通知全掐了。
 */
export function notificationsEnabledFromSettings(
  settings: { notifyEnabled?: boolean } | null | undefined,
): boolean {
  return settings?.notifyEnabled !== false;
}

/** 原版 `ZI()`（@19705）：窗口可见且有焦点 */
export function windowAttentive(): boolean {
  // ⚠️ `typeof document` 这道保护**是我们加的**（原版跑在渲染进程里，`document` 一定存在）。
  //    为了在没有 DOM 的环境（vitest 的 node 环境）里也能安全调用；语义一致 ——
  //    没有 document 就不可能有"可见且有焦点的窗口"，返回 false。
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'visible' && document.hasFocus();
}

/**
 * 原版 `n4(t,e)`（@19711）的逐字翻译：
 *   `YI(t) ? !(ZI() && hash.startsWith('#/chat/'+e)) : false`
 *
 * 复刻没有 hash 路由，`sameChat` 由调用方算（`route === 'chat' && activeSessionId === sid`）。
 */
export function shouldNotifyForSession(o: {
  enabled: boolean;
  attentive: boolean;
  sameChat: boolean;
}): boolean {
  if (!o.enabled) return false;
  return !(o.attentive && o.sameChat);
}

/**
 * 原版 `Uce`（@19748）的门控。原版写法是 `!YI(t) || ZI() || show(...)`，
 * 短路后等价于 `YI && !ZI` —— 注意**少一项 hash 判断**（自动化通知不看当前在哪个会话）。
 *
 * ⚠️ 复刻的自动化通知**落在主进程**（`src/main/ipc/automation.ts`），不走本函数；
 *    这里保留它是为了把「四类通知的门控口径」写在一处，且单测能钉住这条差异。
 */
export function shouldNotifyGlobally(o: { enabled: boolean; attentive: boolean }): boolean {
  return o.enabled && !o.attentive;
}

/** 原版 `t4`（@19701）：压成一行、去首尾空白、超长截断加 `...`；空串 → `null` */
export function condense(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (s.length === 0) return null;
  return s.length <= MAX_NOTIFY_BODY ? s : `${s.slice(0, MAX_NOTIFY_BODY - 3)}...`;
}

/** 原版 `i4(t,e)`（@19714）：会话标题；空串或找不到 → 「未命名会话」 */
export function sessionTitleFor(sessions: readonly SessionMeta[], sessionId: string): string {
  const t = sessions.find((s) => s.id === sessionId)?.title?.trim();
  return t && t.length > 0 ? t : tx('integrations.taskCompletion.untitledChat');
}

/**
 * 复刻的 assistant 消息是 **blocks 数组**（原版是扁平 `content` 字符串），
 * 拼出纯文本才能套 `condense`。只取 `text` 块 —— thinking / tool_use 不是"回答"。
 */
export function messageText(m: ChatMessage): string {
  return m.blocks
    .filter((b) => b.kind === 'text')
    .map((b) => b.text ?? '')
    .join(' ')
    .trim();
}

/**
 * 原版 `Ice(t,e)`（@19718）：从后往前找第一条**非空**的 assistant 正文；
 * 一条都没有 → `null`（调用方用 `finishedWorking` 兜底）。
 */
export function lastAssistantText(messages: readonly ChatMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'assistant') continue;
    const r = condense(messageText(m));
    if (r) return r;
  }
  return null;
}

/**
 * 原版 `zce(t)`（@19731）：审批类别 → 文案键。
 *
 * ⚠️ 原版这个 `switch` **没有 `default`** —— 未知类别会返回 `undefined`，
 *    调用方用模板字符串拼出字面量 `"undefined"`。本实现**照抄这个行为**（不加兜底）：
 *    类别是新旧版本之间的协议值，真出现未知值说明协议漂移了，
 *    显示一个突兀的 `undefined` 比静默换成通用文案**更容易被发现**。
 *    `ApprovalKind` 是封闭联合（`command` / `file-read` / `file-change`），
 *    TS 层面走不到 `return undefined`；只在运行时数据异常时才可能。
 */
export function approvalKindKey(kind: ApprovalKind): string | undefined {
  switch (kind) {
    case 'command':
      return 'integrations.taskCompletion.approvalCommand';
    case 'file-read':
      return 'integrations.taskCompletion.approvalFileRead';
    case 'file-change':
      return 'integrations.taskCompletion.approvalFileChange';
  }
  return undefined;
}

/**
 * ①「一轮完成」（原版 `Fce` @19728，挂在 `case "done"` 上）。
 *
 * `loadMessages` 是**惰性**的：不弹的时候**一次都不调** —— 这样"后台会话跑完"也可以
 * 交给它去拉历史，而"用户正看着这个会话"时不会白白多打一次 IPC。
 *
 * ⚠️ 拉历史失败不抛：原版对"没有消息缓存的会话"也是走 `finishedWorking` 兜底，
 *    我们这里等价地吞掉异常用兜底文案 —— 通知本身不值得让调用方去 try/catch。
 */
export async function notifyTurnFinished(
  ctx: TaskNotifyContext,
  sessionId: string,
  loadMessages: () => Promise<readonly ChatMessage[]>,
): Promise<boolean> {
  if (!shouldNotifyForSession(ctx)) return false;

  let body: string | null = null;
  try {
    body = lastAssistantText(await loadMessages());
  } catch {
    body = null;
  }

  ctx.show({
    title: sessionTitleFor(ctx.sessions, sessionId),
    body: body ?? tx('integrations.taskCompletion.finishedWorking'),
    sessionId,
  });
  return true;
}

/** ②「待审批」（原版 `jce` @19741，挂在 `case "approval-request"` 上） */
export function notifyApprovalNeeded(
  ctx: TaskNotifyContext,
  sessionId: string,
  kind: ApprovalKind,
): boolean {
  if (!shouldNotifyForSession(ctx)) return false;

  const key = approvalKindKey(kind);
  ctx.show({
    title: tx('integrations.taskCompletion.inputNeeded'),
    // ⚠️ `key === undefined` 时拼字面量 `"undefined"` —— 照抄原版，理由见 `approvalKindKey`
    body: `${sessionTitleFor(ctx.sessions, sessionId)}: ${key === undefined ? 'undefined' : tx(key)}`,
    sessionId,
  });
  return true;
}

/** ③「Agent 提问」（原版 `Bce` @19744，挂在 `case "user-input-request"` 上） */
export function notifyAgentQuestion(
  ctx: TaskNotifyContext,
  sessionId: string,
  question: string,
): boolean {
  if (!shouldNotifyForSession(ctx)) return false;

  ctx.show({
    title: tx('integrations.taskCompletion.questionFromAgent'),
    body: `${sessionTitleFor(ctx.sessions, sessionId)}: ${
      condense(question) ?? tx('integrations.taskCompletion.waitingForAnswer')
    }`,
    sessionId,
  });
  return true;
}
