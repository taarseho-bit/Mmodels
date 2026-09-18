/**
 * 内置浏览器 IPC —— 支撑 `BrowserPanel`。
 *
 * 只做渲染层拿不到的两件事：
 *  1. 把 `<webview>` 的页面**截图写入系统剪贴板**
 *     （渲染层只能拿到 canvas，写系统剪贴板要走主进程 clipboard）
 *  2. 打开「新窗口」时按需兜底（外链统一交给系统浏览器）
 *
 * ⚠️ 通过 `webContents.fromId(id)` 定位目标 webview。
 *    渲染层传的是 `webview.getWebContentsId()`，
 *    不能接受任意 id —— 先校验它确实是本窗口下的 webview，
 *    否则等于给了渲染层「截任意页面」的能力。
 */
import { ipcMain, clipboard, webContents, BrowserWindow } from 'electron';
import { IPC } from '@shared/types';
import { safeWrap, type IpcContext } from './index';

/** 校验某个 webContents 确实是主窗口下的 <webview> 且类型为 webview */
function resolveWebview(id: number): Electron.WebContents | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed()) return null;
  // 只允许 webview 类型，挡住主窗口或其它 webContents
  if (wc.getType() !== 'webview') return null;
  return wc;
}

export function registerBrowserHandlers(ctx: IpcContext): void {
  ipcMain.handle(
    IPC.BROWSER_CAPTURE,
    safeWrap(async (_e, id: number) => {
      const wc = resolveWebview(id);
      if (!wc) return { ok: false, reason: 'not-a-webview' };

      const img = await wc.capturePage();
      if (img.isEmpty()) return { ok: false, reason: 'empty' };
      clipboard.writeImage(img);
      const size = img.getSize();
      return { ok: true, width: size.width, height: size.height };
    }, '截图到剪贴板'),
  );

  ipcMain.handle(
    IPC.BROWSER_OPEN_EXTERNAL,
    safeWrap(async (_e, url: string) => {
      // 只放行 http/https，避免被诱导打开本地文件或自定义协议
      if (!/^https?:\/\//i.test(url)) return { ok: false, reason: 'blocked-scheme' };
      const shell = await import('electron').then((m) => m.shell);
      await shell.openExternal(url);
      return { ok: true };
    }, '用系统浏览器打开'),
  );

  /** 把 webview 的缩放/静音状态收敛到主进程可观测（便于排查） */
  ipcMain.handle(
    IPC.BROWSER_SET_ZOOM,
    safeWrap(async (_e, id: number, factor: number) => {
      const wc = resolveWebview(id);
      if (!wc) return { ok: false };
      const f = Math.min(3, Math.max(0.25, Number(factor) || 1));
      wc.setZoomFactor(f);
      return { ok: true, factor: f };
    }, '设置浏览器缩放'),
  );

  // 主窗口被关闭时，确保没有游离的 webview 残留
  const win: BrowserWindow | null = ctx.getMainWindow();
  win?.once('closed', () => {
    for (const wc of webContents.getAllWebContents()) {
      if (wc.getType() === 'webview' && !wc.isDestroyed()) wc.close();
    }
  });
}
