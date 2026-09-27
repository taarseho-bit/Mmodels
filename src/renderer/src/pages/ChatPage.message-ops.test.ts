/**
 * `ChatPage` 的消息级操作接线 —— **结构断言**（读源码，不做真渲染）。
 *
 * ## 为什么不是真渲染
 *
 * 本仓 vitest 是 `environment: 'node'`，`node_modules` 里没有 jsdom / happy-dom
 * （已核实），补一个要动 `package.json` —— 超出本轮边界。所以退一步钉"接线"。
 *
 * ## 这个做法能证明什么、不能证明什么（别高估它）
 *
 * 能证明（都是**会改用户文件**这条链上的具体形态，改回去就会红）：
 *   ① 每条消息下面**确实**渲染了操作行（`msg-ops`），不是"只写了函数没挂上去"；
 *   ② 「回到此消息之前」的按钮**只**把状态置成"待确认"（`setRevertAsk`），
 *      **不直接**发请求 —— 这是渲染层的安全闸；
 *   ③ `POST /api/checkpoint/revert` 只允许从 `runRevert` 发出，且请求体里带 `confirm: true`；
 *   ④ 全文件里 `runRevert(` 只有**两处**：定义 + 确认弹窗的 `onConfirm`。
 *      多出第三处 = 有人绕过弹窗直接回滚（回归护栏里第 2 条就是这个改法）；
 *   ⑤ 弹窗的 `onCancel` 里**没有**任何 `http.request`（取消 = 什么都不发）；
 *   ⑥ 「编辑后重发」的提交走的是同一个确认弹窗（不是"改了就直接发"）；
 *   ⑦ 分叉成功后 `refreshSessions()` **先于** `selectSession(newId)`；
 *   ⑧ 失败文案走 `lib/session-ops.ts` 的映射，**不是**把 `e.message` 原样弹出来
 *      （原样弹会把 `HTTP 400: {"error":"no_checkpoint"}` 这种给用户看）；
 *   ⑨ 换会话时清掉 `revertAsk` / `editing`（否则用户会对着新会话确认旧消息的回滚）。
 *
 * **不能**证明：点击真的能走通、弹窗真的弹出来、请求真的到达主进程、文件真的回滚了。
 * 那一层由两部分承担，本文件替代不了：
 *   · 主进程的行为判据 → `src/main/server/message-ops.test.ts`（真 git、真文件）；
 *   · 界面与交互 → 运行测试点击。
 *
 * ## 反橡皮图章
 *
 * 末尾 8 条**回归护栏**用同一套检查器跑故意改坏的源码，每条断言都必须被抓出来。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_PATH = fileURLToPath(new URL('./ChatPage.tsx', import.meta.url));
// ⚠️ 必须归一化行尾（2026-09-25）：编辑器把源码重写成 CRLF 后，下面所有
// `\n` 手术串会静默落空 → 回归护栏假绿。这里统一成 LF 再做文本手术。
const RAW = readFileSync(SRC_PATH, 'utf8').replace(/\r\n/g, '\n');

/** 去掉注释：注释里出现 `confirm: true` 这类"说明性文字"不算接线 */
function stripComments(src: string): string {
  return src
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** 取某个 `useCallback(...)` 的整段源码（含参数与依赖数组） */
function callbackBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`锚点没找到：${anchor}`);
  const start = src.lastIndexOf('useCallback(', at);
  if (start < 0) throw new Error(`锚点前面没有 useCallback：${anchor}`);
  let depth = 0;
  let i = src.indexOf('(', start);
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`useCallback 括号没闭合：${anchor}`);
  return src.slice(start, i + 1);
}

/** 取 `<ConfirmDialog … />` 这一段 JSX */
function confirmDialogBody(src: string): string {
  const start = src.indexOf('<ConfirmDialog');
  if (start < 0) throw new Error('找不到 `<ConfirmDialog`');
  const end = src.indexOf('/>', start);
  if (end < 0) throw new Error('`<ConfirmDialog` 没有自闭合');
  return src.slice(start, end + 2);
}

/** 检查器：返回空数组 = 接线正确 */
function checkMsgOps(raw: string): string[] {
  const src = stripComments(raw);
  const problems: string[] = [];

  if (!src.includes('export function ChatPage')) {
    problems.push('找不到 `export function ChatPage` —— 锚点可能已失效，本检查不再成立');
    return problems;
  }

  // ① 操作行确实渲染出来了（枚举 messages 的那段里要有 msg-ops）
  if (!src.includes('className="msg-ops"')) {
    problems.push('没有任何 `className="msg-ops"`：操作行没渲染');
  }
  if (!src.includes('className="msg-op"') && !src.includes('className="msg-op ')) {
    problems.push('操作行里没有任何 `className="msg-op"` 按钮');
  }

  // ② 回滚按钮只置"待确认"，不直接发请求
  if (!src.includes('onClick={() => setRevertAsk({ messageId: m.id })}')) {
    problems.push('回滚按钮没有走 `setRevertAsk({ messageId: m.id })`（是不是直接回滚了？）');
  }

  /**
   * ③④ **唯一的发请求点，且唯一的调用点。**
   *
   * `runRevert(` 在**去掉注释后**必须恰好出现 **1** 次 —— 就是确认弹窗
   * `onConfirm` 里的那句 `void runRevert(ask)`（定义处是
   * `const runRevert = useCallback(`，没有 `runRevert(`）。
   *
   * ⚠️ 这个计数就是"有没有人能绕过弹窗回滚"的判据：只要多出一处调用
   *    （比如某个按钮直接 `runRevert(...)`），计数变 2 ⇒ 报红。
   */
  const runRevertUses = src.split('runRevert(').length - 1;
  if (runRevertUses !== 1) {
    problems.push(
      `\`runRevert(\` 出现 ${runRevertUses} 次（应恰好 1：确认弹窗 onConfirm）—— 多出来的那处绕过了二次确认`,
    );
  }

  try {
    const run = callbackBody(src, "window.mathmodel.http.request('/api/checkpoint/revert'");
    if (!run.includes("'/api/checkpoint/revert'")) {
      problems.push('runRevert 里没有 `POST /api/checkpoint/revert`');
    }
    if (!/method:\s*'POST'/.test(run)) {
      problems.push("revert 请求的 method 不是 'POST'");
    }
    // ★ 安全底线：请求体里必须有 confirm: true
    if (!/confirm:\s*true/.test(run)) {
      problems.push('★ revert 请求体里没有 `confirm: true` —— 没有它主进程会 400，界面等于摆设');
    }
    if (!/sessionId:\s*sid/.test(run) || !/messageId:\s*ask\.messageId/.test(run)) {
      problems.push('revert 请求体里没有同时带上 sessionId（当前会话）与 messageId');
    }
    // 回滚之后界面必须跟着回退
    if (!run.includes('loadHistory(sid)')) {
      problems.push('runRevert 成功后没有重新拉历史：消息少掉的那几条还画在屏幕上');
    }
    // 失败文案必须走映射，不许把 e.message 原样弹给用户
    if (!run.includes('revertErrorText(e)')) {
      problems.push('runRevert 的失败文案没走 `revertErrorText(e)`（会把 HTTP 原文给用户看）');
    }
  } catch (e) {
    problems.push(`runRevert 读不出来：${(e as Error).message}`);
  }

  // ⑤ 确认弹窗：onCancel 不许发请求 + onConfirm 调 runRevert
  try {
    const dlg = confirmDialogBody(src);
    if (!/open=\{revertAsk !== null\}/.test(dlg)) {
      problems.push('确认弹窗的 open 不是 `revertAsk !== null`');
    }
    if (!/onConfirm=\{\(\) => \{[\s\S]*void runRevert\(ask\)/.test(dlg)) {
      problems.push('确认弹窗的 onConfirm 没有调 `void runRevert(ask)`');
    }
    if (!/onCancel=\{\(\) => setRevertAsk\(null\)\}/.test(dlg)) {
      problems.push('确认弹窗的 onCancel 不是 `setRevertAsk(null)`');
    }
    if (dlg.includes('http.request')) {
      problems.push('★ 确认弹窗里出现了 `http.request`：取消/关闭路径可能也在发请求');
    }
    if (!dlg.includes('revertDialogBody')) {
      problems.push('确认弹窗没有用 `chat.messageList.revertDialogBody` 说明后果');
    }
  } catch (e) {
    problems.push(`确认弹窗读不出来：${(e as Error).message}`);
  }

  // ⑥ 编辑重发：只对最后一条用户消息开放，且提交走确认弹窗
  if (!src.includes('m.id === lastUserId')) {
    problems.push('「编辑后重发」没有用 `m.id === lastUserId` 收口（会出现在每条用户消息上）');
  }
  if (!/setRevertAsk\(\{ messageId: m\.id, editedText: text \}\)/.test(src)) {
    problems.push('内联编辑器的提交没有走 `setRevertAsk({ messageId, editedText })`（是不是直接发了？）');
  }
  if (!src.includes('chat.messageList.editResendDialogBody')) {
    problems.push('编辑重发没有用专门的确认文案（用户不知道"会重发"）');
  }

  // ⑦ 分叉：先刷新会话列表再切过去
  try {
    const fork = callbackBody(src, 'window.mathmodel.http.request(`/api/sessions/${sid}/fork`');
    if (!fork.includes('refreshSessions()')) {
      problems.push('分叉后没有 `refreshSessions()`：新会话不在 sessions 里，切过去会是空的');
    }
    if (!fork.includes('selectSession(newId)')) {
      problems.push('分叉后没有 `selectSession(newId)`：不会跳到新会话');
    }
    const iRefresh = fork.indexOf('refreshSessions()');
    const iSelect = fork.indexOf('selectSession(newId)');
    if (iRefresh >= 0 && iSelect >= 0 && iRefresh > iSelect) {
      problems.push('分叉后先 selectSession 再 refreshSessions：切过去时列表里还没有这条会话');
    }
    if (!fork.includes('forkErrorText(e)')) {
      problems.push('分叉的失败文案没走 `forkErrorText(e)`');
    }
    /**
     * 分叉**刻意**不需要确认（它不改任何文件）—— 要求源码里能读出这个判断。
     *
     * ⚠️ 这一条要看**带注释的原文**（`raw`）：它断言的是"有人写下了理由"，
     *    而理由只存在于注释里 —— 用去掉注释的 `src` 查会永远查不到（第一版就踩了）。
     */
    if (!raw.includes('没有二次确认，这是刻意的')) {
      problems.push('分叉没有说明"为什么不需要二次确认"');
    }
  } catch (e) {
    problems.push(`forkFromMessage 读不出来：${(e as Error).message}`);
  }

  // ⑧ 回合运行中禁用（应用约定 `ie` 门槛）
  if (!src.includes('disabled={isRunning || opsBusy}')) {
    problems.push('操作按钮没有 `disabled={isRunning || opsBusy}`：回合跑着也能点，会和 agent 抢工作区');
  }

  // ⑨ 换会话清掉临时状态
  if (!src.includes('setRevertAsk(null)') || !src.includes('setEditing(null)')) {
    problems.push('没有清理 `revertAsk` / `editing`');
  }
  const resetIdx = src.indexOf('setEditing(null);');
  if (resetIdx < 0 || !/activeSessionId, loadHistory\]/.test(src.slice(resetIdx, resetIdx + 400))) {
    problems.push('换会话的 effect 里没有清 `revertAsk` / `editing`：会对新会话确认旧消息的回滚');
  }

  return problems;
}

describe('ChatPage 消息级操作接线（结构断言）', () => {
  it('真实源码里 0 问题', () => {
    expect(checkMsgOps(RAW)).toEqual([]);
  });

  it('防恒真：检查器至少能读到它该读的那几段（否则锚点失效会静默全绿）', () => {
    const src = stripComments(RAW);
    expect(src).toContain('runRevert');
    expect(src).toContain('/api/checkpoint/revert');
    expect(src).toContain('/fork');
    expect(src).toContain('<ConfirmDialog');
    expect(src.split('runRevert(').length - 1).toBe(1);
  });

  // ── 回归护栏：每种改法对应上面一条断言，必须被抓出来 ──────────

  it('回归护栏 ①②：回滚按钮直接调 runRevert（绕过确认弹窗）必须报红', () => {
    const broken = RAW.replace(
      'onClick={() => setRevertAsk({ messageId: m.id })}',
      'onClick={() => void runRevert({ messageId: m.id })}',
    );
    const found = checkMsgOps(broken);
    expect(found.some((p) => p.includes('setRevertAsk({ messageId: m.id })'))).toBe(true);
    // ⚠️ 这里必须与 checkMsgOps 里那句文案**逐字**一致（第一版写成"绕过二次确认"
    //    而文案是"绕过了二次确认"，漏了个「了」→ 回归护栏假绿，白测了一轮）
    expect(found.some((p) => p.includes('多出来的那处绕过了二次确认'))).toBe(true);
  });

  it('回归护栏 ③：请求体里去掉 confirm: true 必须报红', () => {
    const broken = RAW.replace(
      'body: { sessionId: sid, messageId: ask.messageId, confirm: true },',
      'body: { sessionId: sid, messageId: ask.messageId },',
    );
    expect(checkMsgOps(broken).some((p) => p.includes('confirm: true'))).toBe(true);
  });

  it('回归护栏 ⑤：onCancel 里也发请求必须报红', () => {
    const broken = RAW.replace(
      'onCancel={() => setRevertAsk(null)}',
      'onCancel={() => { void window.mathmodel.http.request("/api/checkpoint/revert"); setRevertAsk(null); }}',
    );
    expect(checkMsgOps(broken).some((p) => p.includes('取消/关闭路径可能也在发请求'))).toBe(true);
  });

  it('回归护栏 ⑥：编辑提交直接发送（不经确认）必须报红', () => {
    // ⚠️ 用 replaceAll：这句在源码里出现**两次**（textarea 的 Enter 与按钮的 onClick），
    //    只换第一处的话第二处还在，检查器照样能找到它 —— 那条回归护栏就成了假绿。
    const broken = RAW.replaceAll(
      'if (text) setRevertAsk({ messageId: m.id, editedText: text });',
      'if (text) void dispatch(text);',
    );
    expect(broken).not.toBe(RAW);
    expect(
      checkMsgOps(broken).some((p) => p.includes('setRevertAsk({ messageId, editedText })')),
    ).toBe(true);
  });

  it('回归护栏 ⑥b：编辑按钮不按 lastUserId 收口必须报红', () => {
    const broken = RAW.replaceAll('m.id === lastUserId', 'true');
    expect(checkMsgOps(broken).some((p) => p.includes('m.id === lastUserId'))).toBe(true);
  });

  it('回归护栏 ⑦：分叉后不刷新会话列表必须报红', () => {
    const broken = RAW.replace('        await refreshSessions();\n        selectSession(newId);', '        selectSession(newId);');
    const found = checkMsgOps(broken);
    // 至少命中"切过去时列表里还没有这条会话"或"没有 refreshSessions()"
    expect(found.some((p) => p.includes('refreshSessions'))).toBe(true);
  });

  it('回归护栏 ⑧：去掉 disabled 门槛必须报红', () => {
    const broken = RAW.replaceAll('disabled={isRunning || opsBusy}', 'disabled={false}');
    expect(checkMsgOps(broken).some((p) => p.includes('isRunning || opsBusy'))).toBe(true);
  });

  it('回归护栏 ⑨：换会话不清 revertAsk 必须报红', () => {
    const broken = RAW.replace(
      '    setEditing(null);\n    setRevertAsk(null);\n    setOpsNotice(null);\n    void loadHistory(activeSessionId);',
      '    void loadHistory(activeSessionId);',
    );
    const found = checkMsgOps(broken);
    expect(found.some((p) => p.includes('没有清理') || p.includes('没有清 `revertAsk`'))).toBe(
      true,
    );
  });

  it('回归护栏 ⑩：失败文案直接弹 e.message 必须报红', () => {
    const broken = RAW.replace('text: revertErrorText(e)', 'text: e instanceof Error ? e.message : String(e)');
    expect(checkMsgOps(broken).some((p) => p.includes('revertErrorText(e)'))).toBe(true);
  });
});
