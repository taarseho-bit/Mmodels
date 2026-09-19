/**
 * 应用级 IPC。
 */
import { app, shell, nativeTheme, ipcMain, Notification } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IPC } from '@shared/types';
import { getSettings } from '../store/config';
import { createSystemNotification } from '../notify';
import { pushToRenderer, safeWrap, type IpcContext } from './index';

export function registerAppHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.APP_VERSION,
    safeWrap(() => ({
      app: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
    }), '获取版本信息'),
  );

  ipcMain.handle(
    IPC.APP_QUIT_COMPLETELY,
    safeWrap(() => {
      // 先把 IPC 结果送回渲染层，再进入 before-quit 的统一清理流程。
      setImmediate(() => app.quit());
      return true;
    }, '完全退出应用'),
  );

  ipcMain.handle(
    IPC.APP_OPEN_PATH,
    safeWrap(async (_e, targetPath: string) => {
      await shell.openPath(targetPath);
      return true;
    }, '打开路径'),
  );

  ipcMain.handle(
    IPC.APP_SHOW_IN_FOLDER,
    safeWrap((_e, targetPath: string) => {
      shell.showItemInFolder(targetPath);
      return true;
    }, '在文件夹中显示'),
  );

  ipcMain.handle(
    IPC.APP_SET_THEME,
    safeWrap((_e, theme: 'light' | 'dark' | 'system') => {
      nativeTheme.themeSource = theme;
      return nativeTheme.shouldUseDarkColors;
    }, '设置主题'),
  );

  /**
   * keybindings.json 的落盘路径。
   *
   * 原版让用户直接手改这份文件（设置页显示路径 + 「编辑」用系统默认应用打开）。
   * 本项目的快捷键存在 conf 里，这里把它镜像成一个真实文件：
   *   - 文件不存在 → 用当前设置生成一份骨架
   *   - 传了 rules → 顺手覆盖写（设置页改完键位同步过去）
   */
  ipcMain.handle(
    IPC.APP_KEYBINDINGS_FILE,
    safeWrap((_e, rules?: Record<string, string>) => {
      const file = join(app.getPath('userData'), 'keybindings.json');
      const dir = dirname(file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (rules || !existsSync(file)) {
        const body = rules ?? getSettings().keybindings ?? {};
        writeFileSync(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      }
      return file;
    }, '获取键位文件'),
  );

  // ── 系统通知（对应原版 notifications.isSupported / show / onNotificationOpenSession）──
  ipcMain.handle(
    IPC.NOTIFY_IS_SUPPORTED,
    safeWrap(() => Notification.isSupported(), '检查通知支持'),
  );

  /**
   * 弹系统通知。payload.sessionId 可选：
   * 带了它，用户点击通知时会聚焦主窗口并向渲染层推 `NOTIFY_OPEN_SESSION`，
   * 由渲染层负责跳到那个会话（对应原版 onNotificationOpenSession）。
   *
   * ⚠️ 「允许系统通知」关掉（或系统不支持）时 `createSystemNotification` 返回 null，
   *    这里直接返回 false —— **不创建通知对象**（不是弹一个空的、也不是假装成功）。
   *    返回 false 让渲染层诚实地显示"没发出去"。
   */
  ipcMain.handle(
    IPC.NOTIFY_SHOW,
    safeWrap(
      (
        _e,
        payload: { title: string; body?: string; sessionId?: string; silent?: boolean },
      ) => {
        const n = createSystemNotification({
          title: payload.title,
          body: payload.body ?? '',
          silent: payload.silent ?? false,
        });
        if (!n) return false;
        n.on('click', () => {
          const win = _ctx.getMainWindow();
          if (win) {
            if (win.isMinimized()) win.restore();
            win.show();
            win.focus();
          }
          if (payload.sessionId) {
            pushToRenderer(IPC.NOTIFY_OPEN_SESSION, { sessionId: payload.sessionId });
          }
        });
        n.show();
        return true;
      },
      '显示系统通知',
    ),
  );
}
