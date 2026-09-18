import { BrowserWindow, screen, type WebContents } from 'electron';
import { join } from 'node:path';
import { getSettings, updateSettings } from '../store/config';

const PET_WIDTH = 340;
const PET_HEIGHT = 260;
const EDGE_GAP = 18;

let desktopPetWindow: BrowserWindow | null = null;
let showMainWindow: (() => BrowserWindow) | null = null;
let savePositionTimer: NodeJS.Timeout | null = null;
let petDrag: { sender: WebContents; offsetX: number; offsetY: number } | null = null;

interface PetScreenPoint {
  x?: unknown;
  y?: unknown;
}

function validScreenPoint(point: PetScreenPoint): { x: number; y: number } | null {
  if (typeof point?.x !== 'number' || typeof point?.y !== 'number') return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return { x: point.x, y: point.y };
}

export function configureDesktopPetWindow(showMain: () => BrowserWindow): void {
  showMainWindow = showMain;
}

function initialPosition(): { x: number; y: number } {
  const saved = getSettings().modelingPetPosition;
  const area = saved
    ? screen.getDisplayNearestPoint(saved).workArea
    : screen.getPrimaryDisplay().workArea;
  const fallback = {
    x: area.x + area.width - PET_WIDTH - EDGE_GAP,
    y: area.y + area.height - PET_HEIGHT - EDGE_GAP,
  };
  const point = saved ?? fallback;
  return {
    x: Math.min(Math.max(area.x, Math.round(point.x)), area.x + area.width - PET_WIDTH),
    y: Math.min(Math.max(area.y, Math.round(point.y)), area.y + area.height - PET_HEIGHT),
  };
}

function rememberPosition(win: BrowserWindow): void {
  if (savePositionTimer) clearTimeout(savePositionTimer);
  savePositionTimer = setTimeout(() => {
    if (win.isDestroyed()) return;
    const { x, y } = win.getBounds();
    updateSettings({ modelingPetPosition: { x, y } });
  }, 180);
}

function createDesktopPetWindow(): BrowserWindow {
  const point = initialPosition();
  const win = new BrowserWindow({
    title: '小模',
    width: PET_WIDTH,
    height: PET_HEIGHT,
    minWidth: PET_WIDTH,
    maxWidth: PET_WIDTH,
    minHeight: PET_HEIGHT,
    maxHeight: PET_HEIGHT,
    x: point.x,
    y: point.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  // 透明区域默认让点击穿过去；渲染层在指针进入可见内容时临时接管。
  win.setIgnoreMouseEvents(true, { forward: true });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  win.on('moved', () => rememberPosition(win));
  win.on('closed', () => {
    if (savePositionTimer) clearTimeout(savePositionTimer);
    savePositionTimer = null;
    petDrag = null;
    if (desktopPetWindow === win) desktopPetWindow = null;
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    const url = new URL(devUrl);
    url.searchParams.set('window', 'desktop-pet');
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { window: 'desktop-pet' },
    });
  }

  return win;
}

export function syncDesktopPetWindow(enabled: boolean): BrowserWindow | null {
  if (!enabled) {
    if (desktopPetWindow && !desktopPetWindow.isDestroyed()) desktopPetWindow.close();
    desktopPetWindow = null;
    return null;
  }
  if (!desktopPetWindow || desktopPetWindow.isDestroyed()) {
    desktopPetWindow = createDesktopPetWindow();
  }
  return desktopPetWindow;
}

export function showMainFromDesktopPet(): boolean {
  const win = showMainWindow?.();
  if (!win) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

export function setDesktopPetInteractive(sender: WebContents, interactive: boolean): void {
  const win = desktopPetWindow;
  if (!win || win.isDestroyed() || win.webContents !== sender) return;
  if (petDrag) {
    win.setIgnoreMouseEvents(false);
    return;
  }
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

function windowForSender(sender: WebContents): BrowserWindow | null {
  const win = desktopPetWindow;
  if (!win || win.isDestroyed() || win.webContents !== sender) return null;
  return win;
}

export function startDesktopPetDrag(sender: WebContents, input: PetScreenPoint): void {
  const win = windowForSender(sender);
  const cursor = validScreenPoint(input);
  if (!win || !cursor) return;
  const bounds = win.getBounds();
  petDrag = {
    sender,
    offsetX: cursor.x - bounds.x,
    offsetY: cursor.y - bounds.y,
  };
  // 拖动期间必须由窗口接住连续的 move/up，不能再让鼠标穿透。
  win.setIgnoreMouseEvents(false);
}

export function moveDesktopPetDrag(sender: WebContents, input: PetScreenPoint): void {
  const win = windowForSender(sender);
  const current = petDrag;
  const cursor = validScreenPoint(input);
  if (!win || !current || current.sender !== sender || !cursor) return;
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const x = Math.min(
    Math.max(area.x, cursor.x - current.offsetX),
    area.x + area.width - PET_WIDTH,
  );
  const y = Math.min(
    Math.max(area.y, cursor.y - current.offsetY),
    area.y + area.height - PET_HEIGHT,
  );
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: PET_WIDTH, height: PET_HEIGHT }, false);
}

export function endDesktopPetDrag(sender: WebContents): void {
  const win = windowForSender(sender);
  if (!win || !petDrag || petDrag.sender !== sender) return;
  petDrag = null;
  rememberPosition(win);
}
