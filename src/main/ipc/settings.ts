/**
 * 设置 IPC。
 */
import { ipcMain } from 'electron';
import { IPC, type AppSettings } from '@shared/types';
import { getSettings, updateSettings } from '../store/config';
import { safeWrap, type IpcContext } from './index';

export function registerSettingsHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.SETTINGS_GET,
    safeWrap(() => getSettings(), '读取设置'),
  );

  ipcMain.handle(
    IPC.SETTINGS_SET,
    safeWrap((_e, patch: Partial<AppSettings>) => updateSettings(patch), '保存设置'),
  );
}
