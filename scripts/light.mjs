/**
 * 单独验证明主题：窗口创建时就强制 prefers-color-scheme=light，
 * 让应用自己走 bootstrap 的 prefersDark 分支 —— 而不是事后改 DOM。
 * 这样才是「用户真的在浅色系统下打开应用」的等价场景。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';

const PROJECT = 'D:\\mathmodel-desktop';
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'mm-light');
fs.mkdirSync(OUT, { recursive: true });
const TRACE = path.join(OUT, 'light-trace.txt');
fs.writeFileSync(TRACE, '');
const trace = (m) => fs.appendFileSync(TRACE, m + '\n');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => trace('[w] 已接管'));

// ⭐ 关键：在 app ready 前强制浅色，nativeTheme 会跟着变，
//    渲染层的 matchMedia('(prefers-color-scheme: dark)') 也就返回 false
nativeTheme.themeSource = 'light';

const fakeProject = {
  id: 'proj-1', name: '板凳龙建模',
  root: path.join(os.tmpdir(), 'mm-verify-project'),
  createdAt: Date.now(), updatedAt: Date.now(), lastOpenedAt: Date.now(),
};
const fakeProvider = {
  id: 'prov-1', name: 'DeepSeek', apiFormat: 'openai',
  baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-xxxx',
  models: ['deepseek-chat'], enabled: true,
};
const skills = [
  ['paper-writing', '论文写作', '按竞赛格式生成 LaTeX 论文，含摘要、模型假设、符号说明、灵敏度分析与参考文献。', true, 371000, 12, true],
  ['data-analysis', '数据分析', '描述性统计、相关性矩阵、分布检验与可视化图表生成。', true, 63000, 5, false],
  ['optimization', '优化求解', '线性/整数/非线性规划的建模与求解，含灵敏度分析。', false, 128000, 8, true],
  ['plotting', '科学绘图', '按学术规范出图：折线、散点、热力图、三维曲面。', true, 94000, 6, false],
].map(([dirName, name, description, enabled, byteSize, fileCount, hasScripts]) => ({
  dirName, name, description, enabled, byteSize, fileCount, hasScripts,
  source: 'builtin', path: 'x', disabledByDefault: false,
}));
const fakeSettings = {
  activeProviderId: 'prov-1', defaultModel: 'deepseek-chat', builtinMcpEnabled: true,
  effort: 'high', disableThinking: true, locale: 'zh-CN', recentProjectId: null,
};
const sessions = [
  { id: 's1', title: '板凳龙运动建模', projectId: 'proj-1', providerId: 'prov-1', model: 'deepseek-chat', status: 'idle', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 14 },
  { id: 's2', title: '数据预处理与探索', projectId: 'proj-1', providerId: 'prov-1', model: 'deepseek-chat', status: 'idle', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 6 },
];

const stub = (c, f) => ipcMain.handle(c, async (...a) => f(...a));
stub('app:version', () => ({ app: '0.1.0', electron: '33.4.11', chrome: '130.0', node: '20.18.0', platform: 'win32', arch: 'x64', packaged: false }));
stub('app:open-path', () => true);
stub('app:show-item-in-folder', () => true);
stub('app:set-native-theme', () => true);
stub('project:list', () => [fakeProject]);
stub('project:create', () => fakeProject);
stub('project:open', () => fakeProject);
stub('project:remove', () => []);
stub('project:current', () => fakeProject);
stub('session:list', () => sessions);
stub('session:create', () => sessions[0]);
stub('session:get', () => ({ meta: sessions[0], messages: [] }));
stub('session:rename', () => null);
stub('session:delete', () => true);
stub('session:abort', () => true);
stub('session:send', () => ({ messageId: 'm1' }));
stub('settings:get', () => fakeSettings);
stub('settings:set', (_e, p) => ({ ...fakeSettings, ...p }));
stub('llm:list-providers', () => [fakeProvider]);
stub('llm:upsert-provider', () => [fakeProvider]);
stub('llm:delete-provider', () => []);
stub('llm:test-provider', () => ({ ok: true, detail: '连接成功，可用模型 12 个' }));
stub('llm:presets', () => [
  { key: 'deepseek', name: 'DeepSeek', apiFormat: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', note: 'V4 系列默认开思考会烧光输出预算' },
  { key: 'minimax', name: 'MiniMax', apiFormat: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', defaultModel: 'MiniMax-M2', note: '国内可直连' },
  { key: 'zhipu', name: '智谱 GLM', apiFormat: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6', note: '端点不是 /v1 结尾' },
  { key: 'ollama', name: 'Ollama（本地）', apiFormat: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5:14b', note: '本地推理' },
]);
stub('llm:list-models', () => []);
stub('skill:list', () => skills);
stub('skill:toggle', () => skills);
stub('skill:read', () => '---\nname: 论文写作\n---\n\n# 论文写作\n');
stub('skill:import', () => skills);
stub('file:tree', () => [
  { name: 'data', relPath: 'data', isDirectory: true, size: 0, mtimeMs: Date.now(), children: [
    { name: 'bench.csv', relPath: 'data/bench.csv', isDirectory: false, size: 24576, mtimeMs: Date.now() },
  ]},
  { name: 'model.py', relPath: 'model.py', isDirectory: false, size: 8192, mtimeMs: Date.now() },
  { name: 'paper.tex', relPath: 'paper.tex', isDirectory: false, size: 51200, mtimeMs: Date.now() },
]);
stub('file:read-preview', () => ({ kind: 'text', relPath: 'x', size: 0, text: '' }));
stub('file:select-directory', () => null);
stub('file:select-files', () => null);
stub('file:save-text', () => null);
stub('file:save-binary', () => null);
stub('file:write', () => true);
stub('file:rename', () => true);
stub('file:delete', () => true);
stub('term:create', () => ({ termId: 't1', pid: 1 }));
stub('term:write', () => true);
stub('term:resize', () => true);
stub('term:kill', () => true);
stub('automation:list', () => [
  { id: 'a1', projectId: 'proj-1', name: '每日数据复盘', prompt: '读取 data/ 下最新数据，重新拟合预测模型，把图表写入 figures/，并在 report.md 里追加一段结论。', cron: '0 8 * * *', enabled: true, createdAt: Date.now(), updatedAt: Date.now(), lastRunAt: Date.now() - 86400000, nextRunAt: Date.now() + 57600000 },
]);
stub('automation:upsert', () => []);
stub('automation:delete', () => []);
stub('automation:toggle', () => []);
stub('automation:run-now', () => true);
stub('automation:runs', () => []);
ipcMain.on('app:server-info', (e) => { e.returnValue = { port: 51234, token: 'tok', baseUrl: 'http://127.0.0.1:51234' }; });

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440, height: 940, show: false,
    webPreferences: {
      preload: path.join(PROJECT, 'out', 'preload', 'index.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: false,
    },
  });
  const errors = [];
  win.webContents.on('console-message', (_e, lvl, msg) => { if (lvl >= 3) errors.push(msg); });

  await win.loadURL('file:///' + path.join(PROJECT, 'out', 'renderer', 'index.html').replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 1400));
  await win.webContents.executeJavaScript(`window.prompt=()=>'板凳龙建模';window.confirm=()=>true;window.alert=()=>{};true;`);

  // 报告应用自己认定的主题
  const themeInfo = await win.webContents.executeJavaScript(`({
    dataTheme: document.documentElement.dataset.theme || '(未设置)',
    prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  })`);
  trace('[theme] ' + JSON.stringify(themeInfo));

  const shoot = async (name) => {
    await new Promise((r) => setTimeout(r, 800));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG());
    trace('[shot] ' + name + '.png ' + JSON.stringify(img.getSize()));
  };

  await shoot('L1-welcome');
  await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建项目'));if(b)b.click();return !!b;})()`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await win.webContents.executeJavaScript(`!!document.querySelector('.app-shell')`)) break;
  }
  await shoot('L2-chat');
  for (const [label, name] of [['文件', 'L3-files'], ['技能', 'L4-skills'], ['终端', 'L5-terminal']]) {
    await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(t)t.click();return !!t;})()`);
    await shoot(name);
  }
  for (const [label, name] of [['自动化', 'L6-automation'], ['扩展', 'L7-extensions'], ['设置', 'L8-settings']]) {
    await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.rail-item')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(t)t.click();return !!t;})()`);
    await shoot(name);
  }

  trace('[done] 错误 ' + errors.length + ' 条');
  errors.slice(0, 20).forEach((e) => trace('  [E] ' + e));
  app.quit();
}).catch((err) => {
  trace('[E] ' + (err && err.stack ? err.stack : String(err)));
  app.quit();
});
