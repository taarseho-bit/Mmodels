import { app, Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';

export interface AppTrayActions {
  showMain: () => void;
  hideMain: () => void;
  isMainVisible: () => boolean;
  togglePet: (enabled: boolean) => void;
  isPetEnabled: () => boolean;
  quitCompletely: () => void;
}

let appTray: Tray | null = null;

function trayIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'tray-icon.png')
    : join(app.getAppPath(), 'build', 'icon.png');
}

function trayMenu(actions: AppTrayActions): Electron.Menu {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '打开 MModels',
      click: actions.showMain,
    },
    {
      label: actions.isMainVisible() ? '隐藏主窗口' : '显示主窗口',
      click: actions.isMainVisible() ? actions.hideMain : actions.showMain,
    },
    { type: 'separator' },
    {
      label: '显示桌面小模',
      type: 'checkbox',
      checked: actions.isPetEnabled(),
      click: (item) => actions.togglePet(item.checked),
    },
    { type: 'separator' },
    {
      label: '完全退出 MModels',
      click: actions.quitCompletely,
    },
  ];
  return Menu.buildFromTemplate(template);
}

export function createAppTray(actions: AppTrayActions): Tray {
  appTray?.destroy();
  const icon = nativeImage.createFromPath(trayIconPath());
  appTray = new Tray(icon.resize({ width: 20, height: 20 }));
  appTray.setToolTip('MModels · 数学建模工作台');
  appTray.on('click', actions.showMain);
  appTray.on('right-click', () => {
    if (!appTray || appTray.isDestroyed()) return;
    appTray.popUpContextMenu(trayMenu(actions));
  });
  return appTray;
}

export function destroyAppTray(): void {
  if (appTray && !appTray.isDestroyed()) appTray.destroy();
  appTray = null;
}
