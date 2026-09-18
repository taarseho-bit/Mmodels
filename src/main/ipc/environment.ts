/**
 * 环境检查 IPC —— 支撑首次运行向导与「运行环境」设置。
 * 检测逻辑在 `src/main/scan/environment.ts`（纯 Node，可被验证脚本直接 import）。
 */
import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { safeWrap, type IpcContext } from './index';
import { currentProjectRoot } from './file';
import { checkEnvironment } from '../scan/environment';
import { resolveResourcesRoot } from '../resources';

export function registerEnvironmentHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.ENV_CHECK,
    safeWrap(async () => {
      // 项目可能还没建（首次运行向导就是这个场景），root 允许为空
      const root = currentProjectRoot();
      const resources = resolveResourcesRoot(['bin'], '运行环境资源');
      return checkEnvironment(root || undefined, resources);
    }, '检查运行环境'),
  );
}
