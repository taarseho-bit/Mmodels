/**
 * 版本历史 IPC。
 *
 * 为什么要单独一层：渲染层不能直接跑 git（contextIsolation + 无 node），
 * 而 git 的输出格式与错误语义都很「脏」（退出码、本地化消息、编码），
 * 统一在主进程收口成结构化数据，界面才好渲染。
 */
import { ipcMain } from 'electron';
import { IPC, type GitInfo, type VersionKind } from '@shared/types';
import {
  isRepo,
  gitAvailable,
  status,
  diffFile,
  listVersions,
  saveVersion,
  restoreVersion,
  ensureRepo,
} from '../git';
import { safeWrap, pushToRenderer, type IpcContext } from './index';
import { currentProjectRoot } from './file';

export function registerGitHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.GIT_INFO,
    safeWrap(async (): Promise<GitInfo> => {
      const cwd = currentProjectRoot();
      const [available, repo] = await Promise.all([gitAvailable(), isRepo(cwd)]);
      return { available, isRepo: repo };
    }, '读取 Git 状态'),
  );

  ipcMain.handle(
    IPC.GIT_STATUS,
    safeWrap(async () => {
      const cwd = currentProjectRoot();
      if (!(await isRepo(cwd))) return { isRepo: false, files: [] };
      return { isRepo: true, files: await status(cwd) };
    }, '读取变更'),
  );

  ipcMain.handle(
    IPC.GIT_DIFF,
    safeWrap(async (_e, path: string) => {
      const cwd = currentProjectRoot();
      if (!(await isRepo(cwd))) throw new Error('会话工作目录不是 Git 仓库，无法展示代码变更。');
      return diffFile(cwd, path);
    }, '读取文件差异'),
  );

  ipcMain.handle(
    IPC.GIT_VERSIONS,
    safeWrap(async () => {
      const cwd = currentProjectRoot();
      if (!(await gitAvailable())) return { available: false, isRepo: false, versions: [] };
      const repo = await isRepo(cwd);
      if (!repo) return { available: true, isRepo: false, versions: [] };
      return { available: true, isRepo: true, versions: await listVersions(cwd) };
    }, '读取版本列表'),
  );

  ipcMain.handle(
    IPC.GIT_SAVE_VERSION,
    safeWrap(async (_e, name: string, kind?: VersionKind) => {
      const cwd = currentProjectRoot();
      await ensureRepo(cwd);
      const r = await saveVersion(cwd, name, kind ?? 'manual');
      pushToRenderer(IPC.GIT_CHANGED, { reason: 'save' });
      return r;
    }, '保存版本'),
  );

  ipcMain.handle(
    IPC.GIT_RESTORE,
    safeWrap(async (_e, sha: string) => {
      const cwd = currentProjectRoot();
      const r = await restoreVersion(cwd, sha);
      pushToRenderer(IPC.GIT_CHANGED, { reason: 'restore' });
      return r;
    }, '恢复版本'),
  );
}
