/**
 * 消息级操作的**渲染层纯逻辑** —— 把"接口错误码 → 该给用户看哪句话"这件事抽出来。
 *
 * ── 为什么要抽（不是为抽而抽） ────────────────────────────────
 * 回滚/分叉的错误码是**有语义区别**的，项目契约对每一个都给了一句单独的话：
 *   回合还在跑 / 这条消息没有检查点 / 恢复失败（检查点可能已被清理）/
 *   消息不存在 / 会话不存在。
 * 一律弹「操作失败」会把用户推向错误的自救方向 —— 例如看到"回滚失败"
 * 就去重启应用，而真实原因只是"这条消息发出时工作区本来就是干净的、
 * 所以没有可恢复的检查点"（这条**再点多少次都失败**）。
 *
 * 抽成纯函数还有第二个收益：`http.request` 在非 2xx 时把响应体拼进了
 * `Error.message` 里（`HTTP 400: {"error":"no_checkpoint"}`，见 preload/index.ts），
 * 这个"从消息里抠错误码"的解析**只靠字符串**，所以能在 node 环境下直接测
 * （无 DOM、无 jsdom），不必为了测它去装依赖。
 *
 * 错误码的**权威来源**是 `src/main/server/message-ops.ts`（项目契约直接采用），
 * 这里只是它的镜像；两边的字面量由本文件的单测与 `message-ops.test.ts` 各盯一半。
 */
import { tx } from '../i18n';

/** 当前渲染层的映射表（decoded renderer index  的 `Sue`），对应 */
const REVERT_MESSAGE_KEY: Record<string, string> = {
  turn_running: 'chat.useChat.revertTurnRunning',
  no_checkpoint: 'chat.useChat.revertNoCheckpoint',
  restore_failed: 'chat.useChat.revertRestoreFailed',
  message_not_found: 'chat.useChat.revertMessageNotFound',
  session_not_found: 'chat.useChat.revertSessionNotFound',
};

/** 当前渲染层的映射表（decoded renderer index  的 `kue`），对应 */
const FORK_MESSAGE_KEY: Record<string, string> = {
  session_not_found: 'chat.useChat.revertSessionNotFound',
  message_not_found: 'chat.useChat.revertMessageNotFound',
};

/**
 * 从 `http.request` 抛出来的错误里抠出服务端的 `{error: '...'}` 码。
 *
 * 形状是固定的：`HTTP 400: {"error":"no_checkpoint"}`（preload 里 `res.text()` 的原文）。
 * 抠不到就返回 null —— 调用方回落到通用文案，**不许**把整条 HTTP 文本原样弹给用户。
 *
 * ⚠️ 不做"把响应体 JSON.parse 一遍"这种重活：只要 `error` 字段，
 *    正则足够，也不会因为响应体里混了别的东西而抛。
 */
export function opsErrorCodeOf(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  // 不锚定 `HTTP \d+:` 前缀 —— 前缀变了不该让整个映射失效
  const m = /"error"\s*:\s*"([^"]+)"/.exec(raw);
  return m ? m[1] : null;
}

/**
 * 回滚失败时该显示哪句话。
 *
 * `confirm_required` / `bad_request` **故意不单独给文案**：这两个码意味着
 * "渲染层把请求拼错了"，是程序 bug 而不是用户处境的区别 —— 当前没有对应键，
 * 也不该在界面上给用户一句他无法理解的解释，所以回落到通用的「回滚失败」。
 */
export function revertErrorText(err: unknown): string {
  const code = opsErrorCodeOf(err);
  const key = code ? REVERT_MESSAGE_KEY[code] : undefined;
  return tx(key ?? 'chat.useChat.revertFailed');
}

/** 分叉失败时该显示哪句话（项目契约中的映射表只有两个码，其余回落通用文案） */
export function forkErrorText(err: unknown): string {
  const code = opsErrorCodeOf(err);
  const key = code ? FORK_MESSAGE_KEY[code] : undefined;
  return tx(key ?? 'chat.useChat.forkFailed');
}

/** 回滚成功的提示（项目契约 `chat.chatPage.revertSuccess`） */
export function revertSuccessText(): string {
  return tx('chat.chatPage.revertSuccess');
}

/**
 * 分叉成功的提示。
 *
 * ⚠️ 项目契约中的措辞分两支（`forkSuccess` / `forkSuccessWithCount`）：
 *    0 条继承时**不能**说"继承了 0 条消息" —— 那是"从第一条消息分叉"的正常结果，
 *    不是异常。这里的判据是"有没有继承消息"，与项目契约一致（`copiedMessages > 0`）。
 */
export function forkSuccessText(copiedMessages: number): string {
  return copiedMessages > 0
    ? tx('chat.chatPage.forkSuccessWithCount', { count: copiedMessages })
    : tx('chat.chatPage.forkSuccess');
}
