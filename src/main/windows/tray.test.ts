import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const tray = readFileSync(fileURLToPath(new URL('./tray.ts', import.meta.url)), 'utf8');
const main = readFileSync(fileURLToPath(new URL('../index.ts', import.meta.url)), 'utf8');
const ipc = readFileSync(fileURLToPath(new URL('../ipc/index.ts', import.meta.url)), 'utf8');
const builder = readFileSync(fileURLToPath(new URL('../../../electron-builder.yml', import.meta.url)), 'utf8');

describe('关闭到托盘与完全退出', () => {
  it('主窗口的 close 事件会阻止销毁并隐藏窗口', () => {
    const start = main.indexOf("win.on('close'");
    const end = main.indexOf('\n  });', start);
    const handler = main.slice(start, end);
    expect(handler).toContain('event.preventDefault()');
    expect(handler).toContain('win.hide()');
    expect(handler).toContain('quittingCompletely');
  });

  it('托盘菜单提供主窗口、小模和完全退出操作', () => {
    expect(tray).toContain("label: '打开 MModels'");
    expect(tray).toContain("label: '显示桌面小模'");
    expect(tray).toContain("label: '完全退出 MModels'");
    expect(tray).toContain("appTray.on('right-click'");
  });

  it('完全退出会结束会话和终端，并携带托盘图标资源', () => {
    expect(ipc).toContain('sessionRegistry.disposeAll()');
    expect(ipc).toContain('killAllTerms()');
    expect(main).toContain('shutdownIpcRuntimes()');
    expect(main).toContain('destroyAppTray()');
    expect(builder).toContain('to: tray-icon.png');
  });
});
