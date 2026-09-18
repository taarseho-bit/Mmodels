/**
 * 设置 IPC。
 */
import { ipcMain } from 'electron';
import { IPC, type AppSettings } from '@shared/types';
import { getSettings, updateSettings } from '../store/config';
import { syncDesktopPetWindow } from '../windows/desktop-pet';
import { pushToRenderer, safeWrap, type IpcContext } from './index';

export function registerSettingsHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.SETTINGS_GET,
    safeWrap(() => getSettings(), '读取设置'),
  );

  ipcMain.handle(
    IPC.SETTINGS_SET,
    safeWrap((_e, patch: Partial<AppSettings>) => {
      const next = updateSettings(patch);
      if ('modelingPetEnabled' in patch) {
        syncDesktopPetWindow(next.modelingPetEnabled !== false);
      }
      pushToRenderer(IPC.SETTINGS_CHANGED, next);
      return next;
    }, '保存设置'),
  );
}
