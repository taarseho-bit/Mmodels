/**
 * 环境检查 IPC —— 支撑首次运行向导与「运行环境」设置。
 * 检测逻辑在 `src/main/scan/environment.ts`（纯 Node，可被验证脚本直接 import）。
 */
import { ipcMain, app } from 'electron';
import { join } from 'node:path';
import { IPC } from '@shared/types';
import { safeWrap, type IpcContext } from './index';
import { currentProjectRoot } from './file';
import { checkEnvironment } from '../scan/environment';

export function registerEnvironmentHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.ENV_CHECK,
    safeWrap(async () => {
      // 项目可能还没建（首次运行向导就是这个场景），root 允许为空
      const root = currentProjectRoot();
      // 随包二进制目录：开发期指向项目 resources/，打包后是 process.resourcesPath
      const resources = app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), 'resources');
      return checkEnvironment(root || undefined, resources);
    }, '检查运行环境'),
  );
}
