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
import { ipcMain, BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
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
  if (/当前接口不支持|不支持 document|document 内容|unsupported document/i.test(message)) return '当前接口暂时不支持直接读取这类文档，正在改用本地解析方式。';
  if (/401|403|unauthori[sz]ed|forbidden|api.?key|token/i.test(message)) return '连接凭据或访问权限需要检查，请打开连接器设置后重试。';
  if (/429|too many requests|rate.?limit/i.test(message)) return '服务当前比较忙，稍后会自动重试；也可以换一个模型或连接器。';
  if (/insufficient_points|积分不足/i.test(message)) return '当前积分不足，完成建模或签到后再来兑换。';
  if (/invite_not_verified|邀请关系/i.test(message)) return '邀请关系还在核验中，确认注册完成后再领取奖励。';
  if (/timed? ?out|timeout|ETIMEDOUT|网络异常|fetch failed|ENETUNREACH|ECONNRESET/i.test(message)) return '网络暂时没有连通，正在重试；如果持续失败，请检查网络或代理设置。';
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
