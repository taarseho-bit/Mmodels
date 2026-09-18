/**
 * 放大侧栏头部区域，并 dump 该区域相关元素的 computed style，
 * 以确定那个「灰白方块」到底是什么。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

const PROJECT = 'D:\\mathmodel-desktop';
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'mm-probe');
fs.mkdirSync(OUT, { recursive: true });
const TRACE = path.join(OUT, 'probe-trace.txt');
fs.writeFileSync(TRACE, '');
const trace = (m) => fs.appendFileSync(TRACE, m + '\n');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => trace('[w] 已接管'));
nativeTheme.themeSource = 'light';

const fakeProject = { id: 'p', name: '板凳龙建模', root: 'C:\\proj', createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: Date.now() };
const fakeProvider = { id: 'v', name: 'DeepSeek', apiFormat: 'openai', baseUrl: 'https://x/v1', apiKey: 'k', models: ['deepseek-chat'], enabled: true };
const settings = { activeProviderId: 'v', defaultModel: 'deepseek-chat', builtinMcpEnabled: true, effort: null, disableThinking: true, locale: 'zh-CN', recentProjectId: null };

const stub = (c, f) => ipcMain.handle(c, async (...a) => f(...a));
stub('app:version', () => ({ app: '0.1.0', electron: '33', chrome: '130', node: '20', platform: 'win32', arch: 'x64', packaged: false }));
stub('app:open-path', () => true); stub('app:show-item-in-folder', () => true); stub('app:set-native-theme', () => true);
stub('project:list', () => [fakeProject]); stub('project:create', () => fakeProject);
stub('project:open', () => fakeProject); stub('project:remove', () => []); stub('project:current', () => fakeProject);
stub('session:list', () => [{ id: 's1', title: '板凳龙运动建模', projectId: 'p', providerId: 'v', model: 'deepseek-chat', status: 'idle', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 3 }]);
stub('session:create', () => ({ id: 's1', title: 'x', projectId: 'p', providerId: 'v', model: 'm', status: 'idle', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 0 }));
stub('session:get', () => ({ meta: {}, messages: [] }));
stub('session:rename', () => null); stub('session:delete', () => true);
stub('session:abort', () => true); stub('session:send', () => ({ messageId: 'm' }));
stub('settings:get', () => settings); stub('settings:set', (_e, p) => ({ ...settings, ...p }));
stub('llm:list-providers', () => [fakeProvider]); stub('llm:upsert-provider', () => [fakeProvider]);
stub('llm:delete-provider', () => []); stub('llm:test-provider', () => ({ ok: true, detail: 'ok' }));
stub('llm:presets', () => []); stub('llm:list-models', () => []);
stub('skill:list', () => []); stub('skill:toggle', () => []); stub('skill:read', () => ''); stub('skill:import', () => []);
stub('file:tree', () => []); stub('file:read-preview', () => ({ kind: 'text', relPath: 'x', size: 0, text: '' }));
stub('file:select-directory', () => null); stub('file:select-files', () => null);
stub('file:save-text', () => null); stub('file:save-binary', () => null);
stub('file:write', () => true); stub('file:rename', () => true); stub('file:delete', () => true);
stub('term:create', () => ({ termId: 't', pid: 1 })); stub('term:write', () => true);
stub('term:resize', () => true); stub('term:kill', () => true);
stub('automation:list', () => []); stub('automation:upsert', () => []); stub('automation:delete', () => []);
stub('automation:toggle', () => []); stub('automation:run-now', () => true); stub('automation:runs', () => []);
ipcMain.on('app:server-info', (e) => { e.returnValue = { port: 1, token: 't', baseUrl: 'http://127.0.0.1:1' }; });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 940, show: false,
    webPreferences: { preload: path.join(PROJECT, 'out', 'preload', 'index.cjs'), contextIsolation: true, sandbox: false },
  });
  await win.loadURL('file:///' + path.join(PROJECT, 'out', 'renderer', 'index.html').replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 1600));

  // dump 侧栏头部的元素树 + computed style
  const info = await win.webContents.executeJavaScript(`(() => {
    const head = document.querySelector('.sidebar-head');
    if (!head) return { err: 'no .sidebar-head' };
    const walk = (el, depth) => {
      const cs = getComputedStyle(el);
      return {
        d: depth,
        tag: el.tagName,
        cls: el.className || '',
        text: (el.textContent||'').trim().slice(0, 24),
        bg: cs.backgroundColor,
        color: cs.color,
        border: cs.border,
        padding: cs.padding,
        rect: (() => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
        children: depth < 3 ? [...el.children].map(c => walk(c, depth + 1)) : [],
      };
    };
    return walk(head, 0);
  })()`);
  fs.writeFileSync(path.join(OUT, 'dom-probe.json'), JSON.stringify(info, null, 2), 'utf8');

  // 裁剪侧栏头部区域并放大
  const rect = await win.webContents.executeJavaScript(`(() => {
    const h = document.querySelector('.sidebar-head').getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return { x: Math.floor(h.x*dpr), y: Math.floor(h.y*dpr), width: Math.ceil(h.width*dpr)+10, height: Math.ceil(h.height*dpr)+10 };
  })()`);
  trace('[crop rect] ' + JSON.stringify(rect));
  const img = await win.webContents.capturePage(rect);
  const big = img.resize({ width: rect.width * 3, height: rect.height * 3 });
  fs.writeFileSync(path.join(OUT, 'sidebar-head-zoom.png'), big.toPNG());
  trace('[shot] sidebar-head-zoom.png ' + JSON.stringify(big.getSize()));

  app.quit();
}).catch((err) => { trace('[E] ' + (err && err.stack ? err.stack : String(err))); app.quit(); });
