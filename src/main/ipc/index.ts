/**
 * IPC 处理器注册中心。
 *
 * 设计原则：
 *  1. **单一注册入口** —— 所有 handler 在这里汇总，方便审计有哪些通道
 *  2. **通道名从 shared/types 的 IPC 常量表来** —— 不允许散落字符串字面量
 *  3. **每个 handler 自己包 try/catch** —— 未捕获的异常会让渲染层拿到
 *     一个没头没尾的 Error，用户看不懂。统一转成可读信息。
 *
 * 2026-09-28 商业化：账号/授权通道（account.ts）已接入，仍在此单一入口注册。
 */
import { ipcMain, BrowserWindow, app } from 'electron';
import { randomUUID } from 'node:crypto';
import { appendFileSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '@shared/types';
import type { ServerInfo } from '../server';
import { registerAppHandlers } from './app';
import { registerFileHandlers } from './file';
import { registerProjectHandlers } from './project';
import { registerSessionHandlers, sessionRegistry } from './session';
import { registerLlmHandlers } from './llm';
import { registerSettingsHandlers } from './settings';
import { registerSkillHandlers } from './skill';
import { killAllTerms, registerTerminalHandlers } from './terminal';
import { registerAutomationHandlers } from './automation';
import { registerGitHandlers } from './git';
import { registerDiagramHandlers } from './diagram';
import { registerBrowserHandlers } from './browser';
import { registerDatasetHandlers } from './dataset';
import { registerEnvironmentHandlers } from './environment';
import { registerPaperHandlers } from './paper';
import { registerStatsHandlers } from './stats';
import { registerAlgorithmHandlers } from './algorithms';
import { registerCollabHandlers } from './collab';
import { registerNetworkHandlers } from './network';
import { registerPetHandlers } from './pet';
import { registerCompetitionLibraryHandlers } from './competition-library';
import { registerWorkflowHandlers } from './workflow';
import { registerConnectorHandlers } from './connectors';
import { registerAccountHandlers } from './account';
import { closeAgentBrowsers } from '../agent/browser-tools';
import { bridgeRegistry } from '../agent/bridge-registry';

export interface IpcContext {
  getServerInfo: () => ServerInfo | null;
  getMainWindow: () => BrowserWindow | null;
  debug: boolean;
}

/**
 * 把底层错误转换成面向用户的中文提示。
 *
 * 原始错误只写主进程日志，不能把上游 HTTP 文本、绝对路径、命令行参数
 * 或英文堆栈直接塞进渲染层。保留诊断编号，用户需要排查时可以把编号交给开发者。
 */
export function friendlyIpcError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '');
  const details = raw as Error & { code?: string; retryAfter?: number };
  if (details?.code === 'LOGIN_RATE_LIMITED' || /登录尝试过于频繁/.test(message)) {
    const seconds = Number(details?.retryAfter);
    const wait = Number.isFinite(seconds) && seconds > 0
      ? (seconds >= 60 ? `约 ${Math.ceil(seconds / 60)} 分钟` : `${Math.ceil(seconds)} 秒`)
      : '稍后';
    return `登录尝试较多，请${wait}后重试。`;
  }
  if (/当前接口不支持|不支持 document|document 内容|unsupported document/i.test(message)) return '当前接口暂时不支持直接读取这类文档，正在改用本地解析方式。';
  if (/401|403|unauthori[sz]ed|forbidden|api.?key|token/i.test(message)) return '连接凭据或访问权限需要检查，请打开连接器设置后重试。';
  if (/429|too many requests|rate.?limit/i.test(message)) return '服务当前比较忙，稍后会自动重试；也可以换一个模型或连接器。';
  if (/insufficient_points|points_insufficient|积分不足/i.test(message)) return '当前积分不足，可以完成基础任务获取积分，或兑换卡密继续使用。';
  if (/TRIAL_MULTI_AGENT_FORBIDDEN|PAID_VIP_REQUIRED|多智能体.*试用|付费 VIP/i.test(message)) return '多智能体协作需要卡密兑换的 VIP，24 小时体验不包含这项能力。';
  if (/invite_not_verified|邀请关系/i.test(message)) return '邀请关系还在核验中，确认注册完成后再领取奖励。';
  if (/timed? ?out|timeout|ETIMEDOUT|网络异常|fetch failed|ENETUNREACH|ECONNRESET/i.test(message)) return '网络暂时没有连通，正在重试；如果持续失败，请检查网络或代理设置。';
  // ⚠️ 必须在文件「找不到」规则之前：ENOTFOUND（DNS 解析失败）、ECONNREFUSED、
  //    以及服务端 404 的「接口不存在」都会命中 not found/不存在 字样，
  //    曾经被误报成「文件或目录没有找到」误导排障方向（2026-09-28 签到事故）。
  if (/ENOTFOUND|getaddrinfo|ECONNREFUSED|EAI_AGAIN|接口不存在|服务返回 404/i.test(message)) return '暂时连不上会员服务；如果持续失败，可能是服务端正在维护或本机网络/代理受限。';
  if (/ENOENT|not found|不存在|找不到|no such file/i.test(message)) return '需要的文件或目录没有找到，请检查项目文件后重试。';
  if (/EACCES|permission denied|权限不足|拒绝访问/i.test(message)) return '当前操作没有足够权限，请检查项目目录权限或在设置中调整访问范围。';
  if (/spawn|命令|executable|进程/i.test(message) && /failed|error|失败|找不到/i.test(message)) return '本机环境还没有准备好这个工具，正在保留当前结果；请到运行环境中检查后重试。';
  // 已经是通俗中文的业务提示可以保留；含绝对路径或控制字符的内容统一收敛。
  if (/[A-Za-z]:\\|\\Users\\|\/Users\/|\r|\n|stack|at \w+\s*\(/i.test(message)) return '这次操作没有完成，当前内容已经保留，可以重试或换一种方式。';
  return message.length > 240 ? `${message.slice(0, 237)}…` : message || '这次操作没有完成，当前内容已经保留，可以重试。';
}

function wrapIpcError(label: string, err: unknown): Error {
  const diagnosticId = `MM-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 6).toUpperCase()}`;
  console.error(`[ipc] ${label} failed (${diagnosticId}):`, err);
  // ⚠️ 打包版主进程 stdout 不可见——原始堆栈必须落盘，用户报诊断编号时才能
  //    反查真实错误（2026-09-29 登录失败排障时只有编号没有现场，走了一段弯路）。
  try {
    const logPath = join(app.getPath('userData'), 'ipc-errors.log');
    try {
      if (statSync(logPath).size > 256 * 1024) unlinkSync(logPath); // 超限即清，滚动重启
    } catch { /* 文件不存在属正常 */ }
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
    appendFileSync(
      logPath,
      `[${diagnosticId}] ${new Date().toISOString()} ${label}\n${stack}\n\n`,
      'utf8',
    );
  } catch { /* 日志写不出来也不能挡住用户提示 */ }
  const wrapped = new Error(`${label}：${friendlyIpcError(err)}（诊断编号 ${diagnosticId}）`);
  (wrapped as Error & { code?: string; diagnosticId?: string }).code = 'MM_IPC_OPERATION_FAILED';
  (wrapped as Error & { code?: string; diagnosticId?: string }).diagnosticId = diagnosticId;
  return wrapped;
}

/** 把 handler 的错误包成可读信息 */
export function safeWrap<T extends unknown[]>(
  fn: (...args: T) => unknown,
  label: string,
): (...args: T) => unknown {
  return (...args: T) => {
    try {
      const result = fn(...args);
      // 支持 async handler
      if (result instanceof Promise) {
        return result.catch((err: unknown) => {
          throw wrapIpcError(`${label}执行失败`, err);
        });
      }
      return result;
    } catch (err) {
      throw wrapIpcError(`${label}执行失败`, err);
    }
  };
}

export function registerIpcHandlers(ctx: IpcContext): void {
  // ── 同步通道：渲染层启动时立刻要拿服务信息，必须同步 ──
  ipcMain.on(IPC.APP_SERVER_INFO, (event) => {
    event.returnValue = ctx.getServerInfo();
  });

  registerAppHandlers(ctx);
  registerFileHandlers(ctx);
  registerProjectHandlers(ctx);
  registerSessionHandlers(ctx);
  registerLlmHandlers(ctx);
  registerSettingsHandlers(ctx);
  registerSkillHandlers(ctx);
  registerTerminalHandlers(ctx);
  registerAutomationHandlers(ctx);
  registerGitHandlers(ctx);
  registerDiagramHandlers(ctx);
  registerBrowserHandlers(ctx);
  registerDatasetHandlers(ctx);
  registerEnvironmentHandlers(ctx);
  registerPaperHandlers(ctx);
  registerStatsHandlers();
  registerAlgorithmHandlers(ctx);
  registerCollabHandlers();
  registerNetworkHandlers(ctx);
  registerPetHandlers(ctx);
  registerCompetitionLibraryHandlers(ctx);
  registerWorkflowHandlers();
  registerConnectorHandlers(ctx);
  registerAccountHandlers();
}

/** 彻底退出应用前，先结束由 MModels 自己启动的长驻任务与终端子进程。 */
export function shutdownIpcRuntimes(): void {
  sessionRegistry.disposeAll();
  killAllTerms();
  closeAgentBrowsers();
  void bridgeRegistry.stop();
}

/** 向渲染层推送事件（主窗口） */
export function pushToRenderer(channel: string, payload: unknown): void {
  const wins = BrowserWindow.getAllWindows();
  for (const w of wins) {
    if (!w.isDestroyed()) {
      w.webContents.send(channel, payload);
    }
  }
}
