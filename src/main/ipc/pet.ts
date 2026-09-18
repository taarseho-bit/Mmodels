import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import { setDesktopPetInteractive, showMainFromDesktopPet } from '../windows/desktop-pet';
import { safeWrap, type IpcContext } from './index';

export function registerPetHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.PET_SHOW_MAIN,
    safeWrap(() => showMainFromDesktopPet(), '打开 MModels'),
  );
  ipcMain.on(IPC.PET_SET_INTERACTIVE, (event, interactive: boolean) => {
    setDesktopPetInteractive(event.sender, interactive === true);
  });
}
