/**
 * IPC 处理器注册中心。
 *
 * 设计原则：
 *  1. **单一注册入口** —— 所有 handler 在这里汇总，方便审计有哪些通道
 *  2. **通道名从 shared/types 的 IPC 常量表来** —— 不允许散落字符串字面量
 *  3. **每个 handler 自己包 try/catch** —— 未捕获的异常会让渲染层拿到
 *     一个没头没尾的 Error，用户看不懂。统一转成可读信息。
 *
 * ⚠️ 注意：本文件**不注册**账号/计费相关通道（按需求排除）。
 */
import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '@shared/types';
import type { ServerInfo } from '../server';
import { registerAppHandlers } from './app';
import { registerFileHandlers } from './file';
import { registerProjectHandlers } from './project';
import { registerSessionHandlers } from './session';
import { registerLlmHandlers } from './llm';
import { registerSettingsHandlers } from './settings';
import { registerSkillHandlers } from './skill';
import { registerTerminalHandlers } from './terminal';
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

export interface IpcContext {
  getServerInfo: () => ServerInfo | null;
  getMainWindow: () => BrowserWindow | null;
  debug: boolean;
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
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[ipc] ${label} failed:`, err);
          throw new Error(`${label} 执行失败：${msg}`);
        });
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ipc] ${label} failed:`, err);
      throw new Error(`${label} 执行失败：${msg}`);
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
