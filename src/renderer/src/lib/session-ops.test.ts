/**
 * 消息级操作渲染层纯逻辑的判据（`lib/session-ops.ts`）。
 *
 * 覆盖的是两件**会真的影响用户自救方向**的事：
 *   ① `http.request` 抛出来的 `HTTP 400: {"error":"no_checkpoint"}` 能不能被解析；
 *   ② 每个错误码是不是落到了**那句话**上（而不是统统"操作失败"）。
 *
 * 证伪边界：本文件不覆盖"这句话有没有被渲染到界面上"—— 那需要 DOM，
 * 环境里没有 jsdom/happy-dom（且本轮不许装依赖）。界面的结构断言见
 * `pages/ChatPage.message-ops.test.ts`。
 */
import { describe, expect, it } from 'vitest';
import { setLang, tx, zh } from '../i18n';
import {
  forkErrorText,
  forkSuccessText,
  opsErrorCodeOf,
  revertErrorText,
  revertSuccessText,
} from './session-ops';

setLang('zh-CN');

describe('opsErrorCodeOf：从 HTTP 错误文本里抠错误码', () => {
  it('解析 preload 的真实形状（`HTTP <status>: <body>`）', () => {
    expect(opsErrorCodeOf(new Error('HTTP 400: {"error":"no_checkpoint"}'))).toBe('no_checkpoint');
    expect(opsErrorCodeOf(new Error('HTTP 404: {"error":"session_not_found"}'))).toBe(
      'session_not_found',
    );
    expect(opsErrorCodeOf(new Error('HTTP 409: {"error":"turn_running"}'))).toBe('turn_running');
    expect(opsErrorCodeOf(new Error('HTTP 500: {"error":"restore_failed"}'))).toBe(
      'restore_failed',
    );
  });

  it('不依赖 `HTTP <status>:` 前缀（前缀变了映射不该整体失效）', () => {
    expect(opsErrorCodeOf(new Error('{"error":"no_checkpoint"}'))).toBe('no_checkpoint');
    expect(opsErrorCodeOf(new Error('boom {"error": "message_not_found"} tail'))).toBe(
      'message_not_found',
    );
  });

  it('抠不到就返回 null（不许瞎猜码）', () => {
    for (const bad of [
      new Error('本地服务未启动'),
      new Error('HTTP 500: '),
      new Error('{"ok":false}'),
      new Error(''),
      'not an error',
      null,
      undefined,
      42,
    ]) {
      expect(opsErrorCodeOf(bad)).toBeNull();
    }
  });
});

describe('错误码 → 文案：每个码都要落到它自己那句话上', () => {
  it('★ 五个回滚错误码各自有独立文案，且都**不是**通用兜底', () => {
    const generic = tx('chat.useChat.revertFailed');
    const pairs: Array<[string, string]> = [
      ['turn_running', tx('chat.useChat.revertTurnRunning')],
      ['no_checkpoint', tx('chat.useChat.revertNoCheckpoint')],
      ['restore_failed', tx('chat.useChat.revertRestoreFailed')],
      ['message_not_found', tx('chat.useChat.revertMessageNotFound')],
      ['session_not_found', tx('chat.useChat.revertSessionNotFound')],
    ];
    const seen = new Set<string>();
    for (const [code, expected] of pairs) {
      const got = revertErrorText(new Error(`HTTP 400: {"error":"${code}"}`));
      expect(got).toBe(expected);
      expect(got).not.toBe(generic);
      seen.add(got);
    }
    // 五句话互不相同 —— 否则"分得清"就是自我安慰
    expect(seen.size).toBe(5);
    expect(seen.has(generic)).toBe(false);
  });

  it('未知码 / 解析失败 → 通用「回滚失败」', () => {
    const generic = tx('chat.useChat.revertFailed');
    expect(revertErrorText(new Error('HTTP 400: {"error":"who_knows"}'))).toBe(generic);
    expect(revertErrorText(new Error('本地服务未启动'))).toBe(generic);
    // 渲染层拼错请求（confirm 缺失 / 形状不对）是程序 bug，不单独给用户一句他看不懂的话
    expect(revertErrorText(new Error('HTTP 400: {"error":"confirm_required"}'))).toBe(generic);
    expect(revertErrorText(new Error('HTTP 400: {"error":"bad_request"}'))).toBe(generic);
  });

  it('分叉的错误映射表只有两个码（与主进程的 ForkErrorCode 一致）', () => {
    expect(forkErrorText(new Error('HTTP 404: {"error":"session_not_found"}'))).toBe(
      tx('chat.useChat.revertSessionNotFound'),
    );
    expect(forkErrorText(new Error('HTTP 404: {"error":"message_not_found"}'))).toBe(
      tx('chat.useChat.revertMessageNotFound'),
    );
    // turn_running / no_checkpoint 不属于分叉的码表 → 回落「分叉失败」
    for (const code of ['turn_running', 'no_checkpoint', 'restore_failed']) {
      expect(forkErrorText(new Error(`HTTP 400: {"error":"${code}"}`))).toBe(
        tx('chat.useChat.forkFailed'),
      );
    }
  });

  it('★ 错误码集合与主进程字段一致（防两边表漂移）', () => {
    // 主进程 message-ops.ts 里的 RevertErrorCode / ForkErrorCode 字面量
    const mainRevert = [
      'confirm_required',
      'bad_request',
      'session_not_found',
      'turn_running',
      'message_not_found',
      'no_checkpoint',
      'restore_failed',
    ];
    const mainFork = ['bad_request', 'session_not_found', 'message_not_found'];
    // 每个主进程码都必须**能被解析出来**（不能因为正则写窄了而漏）
    for (const code of mainRevert) {
      expect(opsErrorCodeOf(new Error(`HTTP 400: {"error":"${code}"}`))).toBe(code);
    }
    for (const code of mainFork) {
      expect(opsErrorCodeOf(new Error(`HTTP 400: {"error":"${code}"}`))).toBe(code);
    }
    // 反向：映射表里提到的每个键都必须**真的存在于字典**
    // （`tx` 取不到键时会原样返回路径字符串 —— 那会把 `chat.useChat.xxx` 显示给用户）
    for (const key of [
      'chat.useChat.revertTurnRunning',
      'chat.useChat.revertNoCheckpoint',
      'chat.useChat.revertRestoreFailed',
      'chat.useChat.revertMessageNotFound',
      'chat.useChat.revertSessionNotFound',
      'chat.useChat.revertFailed',
      'chat.useChat.forkFailed',
      'chat.chatPage.revertSuccess',
      'chat.chatPage.forkSuccess',
      'chat.chatPage.forkSuccessWithCount',
    ]) {
      expect(tx(key)).not.toBe(key);
      expect(tx(key)).not.toContain('undefined');
    }
    expect(zh).toBeTruthy();
  });
});

describe('成功文案', () => {
  it('回滚成功用的是项目契约那句（不是通用"操作成功"）', () => {
    expect(revertSuccessText()).toBe(tx('chat.chatPage.revertSuccess'));
  });

  it('★ 分叉提示分两支：0 条继承时不能说"继承了 0 条消息"', () => {
    expect(forkSuccessText(0)).toBe(tx('chat.chatPage.forkSuccess'));
    expect(forkSuccessText(3)).toBe(tx('chat.chatPage.forkSuccessWithCount', { count: 3 }));
    expect(forkSuccessText(3)).not.toBe(forkSuccessText(0));
    // 数字真的插进去了（防"{{count}} 原样显示"）
    expect(forkSuccessText(3)).toContain('3');
    expect(forkSuccessText(3)).not.toContain('{{count}}');
  });
});
