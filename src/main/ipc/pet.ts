import { ipcMain } from 'electron';
import { IPC } from '@shared/types';
import {
  endDesktopPetDrag,
  moveDesktopPetDrag,
  setDesktopPetInteractive,
  showMainFromDesktopPet,
  startDesktopPetDrag,
} from '../windows/desktop-pet';
import { safeWrap, type IpcContext } from './index';

export function registerPetHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.PET_SHOW_MAIN,
    safeWrap(() => showMainFromDesktopPet(), '打开 MModels'),
  );
  ipcMain.on(IPC.PET_SET_INTERACTIVE, (event, interactive: boolean) => {
    setDesktopPetInteractive(event.sender, interactive === true);
  });
  ipcMain.on(IPC.PET_DRAG_START, (event, point: { x?: unknown; y?: unknown }) => {
    startDesktopPetDrag(event.sender, point);
  });
  ipcMain.on(IPC.PET_DRAG_MOVE, (event, point: { x?: unknown; y?: unknown }) => {
    moveDesktopPetDrag(event.sender, point);
  });
  ipcMain.on(IPC.PET_DRAG_END, (event) => endDesktopPetDrag(event.sender));
}
