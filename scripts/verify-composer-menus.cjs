/**
 * 多页截图：把每个路由 + 侧栏面板 + 明暗两套主题各截一张。
 * 用途：给出「界面确实渲染正确」的可视证据。
 *
 * 复用主冒烟脚本的假 IPC 设计，但只做截图，不做断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire as __cr } from 'node:module';
const __req = __cr(import.meta.url);
const { app, BrowserWindow, ipcMain } = __req('electron');

const PROJECT = 'D:\\mathmodel-desktop';
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'mm-shots');
fs.mkdirSync(OUT, { recursive: true });
const TRACE = path.join(OUT, 'shots-trace.txt');
fs.writeFileSync(TRACE, '');
const trace = (m) => fs.appendFileSync(TRACE, m + '\n');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => trace('[w] window-all-closed 已接管'));

/** 每次运行独立目录（理由见 smoke.mjs） */
const RUN_ID = Date.now().toString(36);

const fakeProject = {
  id: 'proj-1',
  name: '板凳龙建模',
  // ⚠️ 必须与 smoke.mjs 用**不同的目录**。
  // 两者共用同一个临时目录时，截图会继承冒烟测试留下的 git 版本，
  // 导致「项目版本」面板出现重复条目（曾误以为是产品 bug）。
  root: path.join(os.tmpdir(), `mm-shots-project-${RUN_ID}`),
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastOpenedAt: Date.now(),
};

const fakeProvider = {
  id: 'prov-1',
  name: 'DeepSeek',
  apiFormat: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-xxxx',
  models: ['deepseek-chat'],
  enabled: true,
};

const skills = [
  ['paper-writing', '论文写作', '按竞赛格式生成 LaTeX 论文，含摘要、模型假设、符号说明、灵敏度分析与参考文献。', true, 371000, 12, true],
  ['data-analysis', '数据分析', '描述性统计、相关性矩阵、分布检验与可视化图表生成。', true, 63000, 5, false],
  ['optimization', '优化求解', '线性/整数/非线性规划的建模与求解，含灵敏度分析。', false, 128000, 8, true],
  ['plotting', '科学绘图', '按学术规范出图：折线、散点、热力图、三维曲面。', true, 94000, 6, false],
  ['latex-build', 'LaTeX 编译', '本地 xelatex 编译与错误定位，支持中文字体配置。', true, 41000, 3, true],
].map(([dirName, name, description, enabled, byteSize, fileCount, hasScripts]) => ({
  dirName, name, description, enabled, byteSize, fileCount, hasScripts,
  source: 'builtin',
  path: path.join(PROJECT, 'resources', 'builtin-skills', dirName),
  disabledByDefault: false,
}));

const fakeSettings = {
  activeProviderId: fakeProvider.id,
  defaultModel: 'deepseek-chat',
  builtinMcpEnabled: true,
  effort: 'high',
  disableThinking: true,
  locale: 'zh-CN',
  recentProjectId: null,
  // 让首次运行向导先弹出来，截完再置 true
  onboardingDone: false,
  tourDone: false,
};

const sessions = [
  { id: 's1', title: '板凳龙运动建模', projectId: 'proj-1', providerId: 'prov-1', model: 'deepseek-chat', status: 'idle', createdAt: Date.now() - 7200000, updatedAt: Date.now() - 600000, messageCount: 14 },
  { id: 's2', title: '数据预处理与探索', projectId: 'proj-1', providerId: 'prov-1', model: 'deepseek-chat', status: 'idle', createdAt: Date.now() - 86400000, updatedAt: Date.now() - 80000000, messageCount: 6 },
  { id: 's3', title: '[自动] 每日数据复盘', projectId: 'proj-1', providerId: 'prov-1', model: 'deepseek-chat', status: 'running', createdAt: Date.now() - 3600000, updatedAt: Date.now() - 60000, messageCount: 2 },
];

const automations = [
  { id: 'a1', projectId: 'proj-1', name: '每日数据复盘', prompt: '读取 data/ 下最新数据，重新拟合预测模型，把图表写入 figures/，并在 report.md 里追加一段结论。', cron: '0 8 * * *', enabled: true, createdAt: Date.now(), updatedAt: Date.now(), lastRunAt: Date.now() - 86400000, nextRunAt: Date.now() + 57600000 },
  { id: 'a2', projectId: 'proj-1', name: '每周论文进度检查', prompt: '检查论文各章节完成度，列出缺失的图表与参考文献，输出到 progress.md。', cron: '0 9 * * 1', enabled: false, createdAt: Date.now(), updatedAt: Date.now(), lastRunAt: null, nextRunAt: null },
];

/** 已注册的通道 —— 防止重复注册（Electron 会直接抛错并中断整个脚本） */
const registeredChannels = new Set();

function stub(channel, fn) {
  if (registeredChannels.has(channel)) {
    throw new Error(
      `重复注册 IPC 通道 '${channel}'。\n` +
        'Electron 对同一通道只允许一个 handler，重复注册会让整个截图脚本在加载阶段就挂掉。\n' +
        '请检查是否在多个地方 stub 了同一个通道。',
    );
  }
  registeredChannels.add(channel);
  ipcMain.handle(channel, async (...a) => fn(...a));
}

// ⚠️ 不要硬编码版本号 —— 升级 Electron 后状态栏会显示陈旧信息，
  //    看起来像「升级没生效」。直接用运行时真实值。
stub('app:version', () => ({
  app: '0.1.0',
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  platform: process.platform,
  arch: process.arch,
  packaged: false,
}));
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

// ⚠️ 必须是**可累积**的：写死成 { ...fakeSettings, ...patch } 的话，
//    连续两次 patch 会互相覆盖（第二次把第一次的字段丢掉），
//    表现为「刚设好的模式自己变回去了」—— 是桩的 bug，不是产品 bug。
let currentSettings = { ...fakeSettings };
stub('settings:get', () => currentSettings);
stub('settings:set', (_e, p) => {
  currentSettings = { ...currentSettings, ...(p || {}) };
  return currentSettings;
});

// 可变：先给空，让首次运行向导停在第一步「连接模型」；截完再放开
let providerList = [];
stub('llm:list-providers', () => providerList);
stub('llm:upsert-provider', (_e, p) => { providerList = [p]; return providerList; });
stub('llm:delete-provider', () => []);
stub('llm:test-provider', () => ({ ok: true, detail: '连接成功，可用模型 12 个' }));
stub('llm:presets', () => [
  { key: 'anthropic', name: 'Anthropic 官方', apiFormat: 'anthropic', baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-5', note: '官方直连，需要海外网络环境' },
  { key: 'minimax', name: 'MiniMax', apiFormat: 'anthropic', baseUrl: 'https://api.minimaxi.com/anthropic', defaultModel: 'MiniMax-M2', note: '国内可直连' },
  { key: 'deepseek', name: 'DeepSeek', apiFormat: 'openai', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', note: 'V4 系列默认开思考会烧光输出预算' },
  { key: 'zhipu', name: '智谱 GLM', apiFormat: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6', note: '端点不是 /v1 结尾' },
  { key: 'dashscope', name: '通义千问', apiFormat: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3-max', note: '兼容模式端点' },
  { key: 'ollama', name: 'Ollama（本地）', apiFormat: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5:14b', note: '本地推理，apiKey 随便填' },
]);
stub('llm:list-models', () => []);

stub('skill:list', () => skills);
stub('skill:toggle', () => skills);
stub('skill:read', () => '---\nname: 论文写作\ndescription: 按竞赛格式生成论文\n---\n\n# 论文写作\n\n## 用途\n把模型与结果整理成符合竞赛格式的论文。\n');
stub('skill:import', () => skills);

stub('file:tree', () => [
  { name: 'data', relPath: 'data', isDirectory: true, size: 0, mtimeMs: Date.now(), children: [
    { name: 'bench.csv', relPath: 'data/bench.csv', isDirectory: false, size: 24576, mtimeMs: Date.now() },
    { name: 'raw.xlsx', relPath: 'data/raw.xlsx', isDirectory: false, size: 182000, mtimeMs: Date.now() },
  ]},
  { name: 'figures', relPath: 'figures', isDirectory: true, size: 0, mtimeMs: Date.now(), children: [
    { name: 'spiral.png', relPath: 'figures/spiral.png', isDirectory: false, size: 412000, mtimeMs: Date.now() },
  ]},
  { name: 'model.py', relPath: 'model.py', isDirectory: false, size: 8192, mtimeMs: Date.now() },
  { name: 'paper.tex', relPath: 'paper.tex', isDirectory: false, size: 51200, mtimeMs: Date.now() },
  { name: 'report.md', relPath: 'report.md', isDirectory: false, size: 3400, mtimeMs: Date.now() },
]);
stub('file:read-preview', (_e, relPath) => {
  // 表格预览截图：给一份真实的 CSV 内容，让 DataFilePreview 渲染出真表格
  if (String(relPath).endsWith('.csv')) {
    const rows = ['站点,日均客流,峰值小时,通行延误(秒)'];
    const names = ['人民广场', '陆家嘴', '徐家汇', '中山公园', '虹桥枢纽', '五角场', '世纪大道', '静安寺'];
    names.forEach((n, i) => {
      rows.push(`${n},${(18200 + i * 1430).toFixed(0)},${(2100 + i * 180).toFixed(0)},${(38 + i * 2.7).toFixed(1)}`);
    });
    return { kind: 'text', relPath, size: 512, text: rows.join('\n') };
  }
  return { kind: 'text', relPath, size: 0, text: '' };
});
stub('file:select-directory', () => null);
stub('file:select-files', () => null);
stub('file:save-text', () => null);
stub('file:save-binary', () => null);
stub('file:write', () => true);
stub('file:rename', () => true);
stub('file:delete', () => true);

stub('term:create', () => ({ termId: 't1', pid: 4321 }));
stub('term:write', () => true);
stub('term:resize', () => true);
stub('term:kill', () => true);

stub('automation:list', () => automations);
stub('automation:upsert', () => automations);
stub('automation:delete', () => automations);
stub('automation:toggle', () => automations);
stub('automation:run-now', () => true);
stub('automation:runs', () => [
  { id: 'r1', automation_id: 'a1', session_id: 's9', status: 'success', started_at: Date.now() - 86400000, finished_at: Date.now() - 86400000 + 45000, summary: '共 18420 输出 tokens', error: null },
  { id: 'r2', automation_id: 'a1', session_id: 's8', status: 'failed', started_at: Date.now() - 172800000, finished_at: Date.now() - 172800000 + 3000, summary: null, error: '未配置模型供应商，自动化任务无法执行' },
  { id: 'r3', automation_id: 'a1', session_id: 's7', status: 'success', started_at: Date.now() - 259200000, finished_at: Date.now() - 259200000 + 38000, summary: '共 15750 输出 tokens', error: null },
]);

// ─────────────────────────────────────────────────────────────
// git：走**真实模块**，让「更改」「项目版本」面板渲染真实数据
// ─────────────────────────────────────────────────────────────
const git = await import('../src/main/git/index.ts');
{
  const root = fakeProject.root;
  // 先清空，保证多次运行的可重复性（否则 git 版本会累积）
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 被占用就跳过，反正目录是新建的 */ }
  fs.mkdirSync(root, { recursive: true });
  const write = (name, lines) => fs.writeFileSync(path.join(root, name), lines.join('\n'), 'utf8');

  write('model.py', [
    'import numpy as np',
    'import pandas as pd',
    '',
    '',
    'def load(path):',
    '    df = pd.read_csv(path)',
    '    return df.dropna()',
    '',
    '',
    'def fit(df):',
    '    x = df["日均客流"].to_numpy()',
    '    y = df["通行延误(秒)"].to_numpy()',
    '    return np.polyfit(x, y, 1)',
    '',
  ]);
  write('paper.tex', ['\\documentclass{cumcmthesis}', '\\begin{document}', '正文', '\\end{document}', '']);
  await git.ensureRepo(root);
  await git.saveVersion(root, '完成数据清洗', 'manual');

  // 再改两处 → 「更改」面板有真实 diff 可渲染
  write('model.py', [
    'import numpy as np',
    'import pandas as pd',
    '',
    '',
    'def load(path):',
    '    df = pd.read_csv(path)',
    '    df = df[df["日均客流"] > 0]      # 剔除异常站点',
    '    return df.dropna()',
    '',
    '',
    'def fit(df):',
    '    x = df["日均客流"].to_numpy()',
    '    y = df["通行延误(秒)"].to_numpy()',
    '    return np.polyfit(x, y, 1)',
    '',
    '',
    'def report(coef):',
    '    return {"slope": float(coef[0]), "intercept": float(coef[1])}',
    '',
  ]);
  write('README.md', ['# 城市路网通行效率建模', '', '数据来自 8 个站点的 24 小时刷卡记录。', '']);
}
stub('git:info', async () => ({
  available: await git.gitAvailable(),
  isRepo: await git.isRepo(fakeProject.root),
}));
stub('git:status', async () => ({
  isRepo: await git.isRepo(fakeProject.root),
  files: await git.status(fakeProject.root),
}));
stub('git:diff', (_e, p) => git.diffFile(fakeProject.root, p));
stub('git:versions', async () => ({
  available: await git.gitAvailable(),
  isRepo: await git.isRepo(fakeProject.root),
  versions: await git.listVersions(fakeProject.root),
}));
stub('git:save-version', (_e, name, kind) => git.saveVersion(fakeProject.root, name, kind));
stub('git:restore', (_e, sha) => git.restoreVersion(fakeProject.root, sha));

// ─────────────────────────────────────────────────────────────
// 流程图 / 数据集：也走真实模块
// ⚠️ 只 import `src/main/scan/*`（纯 Node）。切勿改成 ipc/*，
//    那会把 better-sqlite3 拖进 ESM bundle 而整体跑不起来。
// ─────────────────────────────────────────────────────────────
const diagramScan = await import('../src/main/scan/diagram.ts');
const datasetScan = await import('../src/main/scan/dataset.ts');
{
  const root = fakeProject.root;
  // 一个已导出的（新鲜）+ 一个待导出的（无导出图）
  fs.writeFileSync(
    path.join(root, 'roadmap.drawio'),
    '<mxfile><diagram id="r1" name="roadmap"><mxGraphModel/></diagram></mxfile>',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'roadmap.png'), 'stub', 'utf8');
  const future = Date.now() + 120_000;
  fs.utimesSync(path.join(root, 'roadmap.png'), future / 1000, future / 1000);
  fs.writeFileSync(
    path.join(root, 'framework.drawio'),
    '<mxfile><diagram id="f1" name="framework"><mxGraphModel/></diagram></mxfile>',
    'utf8',
  );
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data', 'bench.csv'), 'x,y\n1,2\n', 'utf8');
}
stub('diagram:list', () => {
  const r = diagramScan.collectDiagrams(fakeProject.root);
  return { ...r, truncated: r.total > r.diagrams.length };
});
stub('dataset:list', () => datasetScan.collectDataFiles(fakeProject.root));
stub('dataset:import', () => ({ imported: [], canceled: true }));

// 运行环境：走真实模块，启动时跑一次并缓存
const envScan = await import('../src/main/scan/environment.ts');
let envCache = null;
{
  const t = Date.now();
  envCache = await envScan.checkEnvironment(fakeProject.root, path.join(PROJECT, 'resources'));
  trace(`[env] 真实检测完成 ${Date.now() - t}ms，必需缺失 ${envCache.missingRequired}`);
}
stub('env:check', () => envCache);
stub('browser:capture', () => ({ ok: true, width: 800, height: 600 }));
stub('browser:open-external', () => ({ ok: true }));
stub('browser:set-zoom', () => ({ ok: true }));

// 论文模板 / 比赛信息：走**真实模块**扫描 resources（纯 Node，可直接 import）
const paperScan = await import('../src/main/scan/paper-templates.ts');
{
  const r = paperScan.listPaperTemplates(path.join(PROJECT, 'resources'));
  trace('[paper] 扫到模板 ' + r.length + ' 个：' + r.map((t) => t.name).join(' / '));
}
stub('paper:templates', () => {
  const list = paperScan.listPaperTemplates(path.join(PROJECT, 'resources'));
  return { available: list.length > 0, dir: path.join(PROJECT, 'resources'), templates: list };
});
// 比赛信息用内存态（真实实现会写到 <项目>/.mathmodel/paper/config.json）
let paperConfig = { templateId: null, fields: {} };
stub('paper:get-config', () => ({ config: paperConfig, path: null }));
stub('paper:save-config', (_e, cfg) => {
  paperConfig = { templateId: cfg?.templateId ?? null, fields: cfg?.fields ?? {} };
  return { ok: true, path: null };
});


ipcMain.on('app:server-info', (e) => {
  e.returnValue = { port: 51234, token: 'verify-token', baseUrl: 'http://127.0.0.1:51234' };
});

// ─────────────────────────────────────────────────────────────

async function shoot(win, name) {
  await new Promise((r) => setTimeout(r, 700));
  // 逼出一次重绘：隐藏窗口合成器会缓存旧帧，不 invalidate 会截到上一页
  try {
    win.webContents.invalidate();
  } catch {
    /* 某些版本无此方法，忽略 */
  }
  await new Promise((r) => setTimeout(r, 180));
  const img = await win.webContents.capturePage();
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, img.toPNG());
  trace(`[shot] ${name}.png ${JSON.stringify(img.getSize())}`);
}

/** 等 React 完成一次渲染 + 过渡动画 */
const settle = (ms = 260) => new Promise((r) => setTimeout(r, ms));

/**
 * 切到指定导航页，并**确认切换成功**（读回激活 tab 与页壳标题）。
 * 不确认的话，截图可能落在上一页 —— 这是之前踩过的坑。
 */
const SHOT_ROUTE_SEL = {
  对话: '#tour-new-thread',
  竞赛日历: '[data-route="competitions"]',
  科研绘图: '[data-route="gallery"]',
  数据集: '[data-route="datasets"]',
  数模广场: '[data-route="papers"]',
  自动化: '[data-route="automation"]',
  扩展: '[data-route="extensions"]',
  设置: '[data-route="settings"]',
};

async function goto(win, label) {
  const sel = SHOT_ROUTE_SEL[label] || `[data-route="${label}"]`;
  const clicked = await win.webContents.executeJavaScript(
    `(()=>{const t=document.querySelector(${JSON.stringify(sel)});if(t)t.click();return !!t;})()`,
  );
  await settle();
  const state = await win.webContents.executeJavaScript(
    `(()=>{const a=document.querySelector('.rail-item.active');const h=document.querySelector('.shell-title');return {active:a?a.textContent.trim():null,shell:h?h.textContent.trim():null};})()`,
  );
  const ok = clicked && state.active === label;
  trace(`[goto] ${label} clicked=${clicked} active=${state.active} shell=${state.shell} ${ok ? 'OK' : '⚠️ 未切换'}`);
  if (!ok) errors.push(`切换「${label}」失败：active=${state.active} clicked=${clicked}`);
  return ok;
}

app.whenReady().then(async () => {
  // 直接进主界面：跳过首次运行向导，并给一个供应商，避免被向导挡住
  currentSettings = { ...currentSettings, onboardingDone: true, tourDone: true };
  providerList = [];

  const win = new BrowserWindow({
    width: 1440, height: 940, show: false,
    webPreferences: {
      preload: path.join(PROJECT, 'out', 'preload', 'index.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: true,
      webviewTag: true,
      offscreen: true,
      backgroundThrottling: false,
      paintWhenInitiallyHidden: true,
    },
  });
  win.webContents.on('will-attach-webview', (_e, wprefs, params) => {
    delete wprefs.preload;
    wprefs.nodeIntegration = false;
    wprefs.contextIsolation = true;
    wprefs.sandbox = true;
    if (!/^https?:\/\//i.test(params.src || '')) params.src = 'about:blank';
  });
  try { win.webContents.setFrameRate(30); } catch { /* 非 offscreen */ }

  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });
  win.webContents.on('preload-error', (_e, p, err) => errors.push('[preload] ' + (err && err.message)));

  await win.loadURL('file:///' + path.join(PROJECT, 'out', 'renderer', 'index.html').replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 1500));
  await win.webContents.executeJavaScript(`window.prompt=()=>'板凳龙建模';window.confirm=()=>true;window.alert=()=>{};true;`);

  // 欢迎页 → 新建项目 → 进主界面
  await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建项目'));if(b)b.click();return !!b;})()`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await win.webContents.executeJavaScript(`!!document.querySelector('.composer-box')`)) break;
  }
  await settle(800);

  // 兜底关掉可能弹出的向导/巡览
  await win.webContents.executeJavaScript(`(()=>{
    const x=document.querySelector('.ob-card .ob-close, .tour-close, [aria-label="关闭"]');
    if(x)x.click();
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    return true;
  })()`);
  await settle(500);

  const shotDir = 'D:/mathmodel-desktop/.mmodels-audit/_composer';
  fs.mkdirSync(shotDir, { recursive: true });
  const shoot2 = async (name) => {
    await new Promise((r) => setTimeout(r, 500));
    try { win.webContents.invalidate(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 200));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(shotDir, name + '.png'), img.toPNG());
    trace(`[shot] ${name}.png ${JSON.stringify(img.getSize())}`);
  };

  const js = (code) => win.webContents.executeJavaScript(code);
  const clickByText = (scope, text) => js(
    `(()=>{const s=document.querySelectorAll(${JSON.stringify(scope)});for(const e of s){if((e.textContent||'').includes(${JSON.stringify(text)})){e.click();return true;}}return false;})()`,
  );

  // ── 0. 首屏 ──
  const probe0 = await js(`(()=>{
    const inner=document.querySelector('.chat-inner');
    const scroll=document.querySelector('.chat-scroll');
    const hero=document.querySelector('.newchat-hero');
    const r=(e)=>{const b=e.getBoundingClientRect();return {top:Math.round(b.top),bottom:Math.round(b.bottom),h:Math.round(b.height)};};
    const chips=[...document.querySelectorAll('.cz-bar .cz-btn')].map(e=>e.textContent.trim());
    const footBtns=[...document.querySelectorAll('.cz-foot button')].map(e=>e.textContent.trim());
    return {
      innerH: inner?Math.round(inner.getBoundingClientRect().height):null,
      scrollH: scroll?Math.round(scroll.getBoundingClientRect().height):null,
      hero: hero?r(hero):null,
      winH: window.innerHeight,
      chips,
      modelChip:(document.querySelectorAll('.cz-foot .cz-btn')[1]||{}).textContent||null,
      dot: !!document.querySelector('.cz-dot'),
      plusTitle:(document.querySelector('#tour-plus')||{}).title||null,
      betaColor: getComputedStyle(document.querySelector('.newchat-beta-link')).color,
      tagStyle: (()=>{const t=document.querySelector('.starter-tag');if(!t)return null;const s=getComputedStyle(t);return {bg:s.backgroundColor,border:s.borderTopWidth+' '+s.borderTopColor,fs:s.fontSize,pad:s.padding};})(),
      sendBg: (()=>{const b=document.querySelector('.cz-send');if(!b)return null;const s=getComputedStyle(b);return {bg:s.backgroundColor,op:s.opacity,disabled:b.disabled};})(),
      chipBg: (()=>{const c=document.querySelector('.cz-bar .cz-btn');return c?getComputedStyle(c).backgroundColor:null;})(),
      brand: !!document.querySelector('[data-brand="mathmodel"]'),
      footBtns,
    };
  })()`);
  trace('[probe0] ' + JSON.stringify(probe0));
  await shoot2('c0-main');

  // ── 1. 模型菜单 ──
  await js(`(()=>{const b=[...document.querySelectorAll('.cz-foot .cz-btn')].find(x=>(x.textContent||'').includes('claude-')||(x.textContent||'').includes('模型'));if(b)b.click();return !!b;})()`);
  await settle(400);
  const probeModel = await js(`(()=>{
    const items=[...document.querySelectorAll('.cz-pop-item')].map(e=>e.textContent.trim());
    const checks=document.querySelectorAll('.cz-pop-check').length;
    const badges=[...document.querySelectorAll('.cz-pop-badge')].map(e=>e.textContent.trim());
    const sub=document.querySelector('.cz-sub-wrap .cz-pop-item');
    return {items, checks, badges, sub: sub?sub.textContent.trim():null, hasChevronRight: !!document.querySelector('.cz-sub-wrap svg[data-icon="chevron-right"]')};
  })()`);
  trace('[probeModel] ' + JSON.stringify(probeModel));
  await shoot2('c1-model');

  // ── 2. 悬停「思考强度」 → 二级子菜单 ──
  const hovered = await js(`(()=>{
    const row=document.querySelector('.cz-sub-wrap .cz-pop-item');
    if(!row) return false;
    row.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    row.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));
    row.parentElement.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));
    return true;
  })()`);
  await settle(450);
  const probeFly = await js(`(()=>{
    const f=document.querySelector('.cz-flyout');
    if(!f) return {open:false};
    const b=f.getBoundingClientRect();
    return {open:true, items:[...f.querySelectorAll('.cz-pop-item')].map(e=>e.textContent.trim()), rect:{left:Math.round(b.left),top:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
  })()`);
  trace('[probeFly] hovered=' + hovered + ' ' + JSON.stringify(probeFly));
  await shoot2('c2-effort');

  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`);
  await settle(400);

  // ── 3. 权限菜单 ──
  await clickByText('.cz-foot .cz-btn', '完全访问');
  await settle(400);
  const probePerm = await js(`(()=>{
    const pop=document.querySelector('.cz-pop');
    const items=pop?[...pop.querySelectorAll('.cz-pop-item')].map(e=>({t:e.textContent.trim(),lines:e.querySelectorAll('.col').length,icon:(e.querySelector('svg')||{}).getAttribute?e.querySelector('svg').getAttribute('data-icon'):null,sel:e.className.includes('selected')})):[];
    return {items};
  })()`);
  trace('[probePerm] ' + JSON.stringify(probePerm));
  await shoot2('c3-perm');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`);
  await settle(400);

  // ── 4. 项目菜单 ──
  await js(`(()=>{const b=document.querySelector('.cz-bar .cz-btn');if(b)b.click();return !!b;})()`);
  await settle(400);
  const probeProject = await js(`(()=>{
    const pop=document.querySelector('.cz-pop');
    return pop?{items:[...pop.querySelectorAll('.cz-pop-item')].map(e=>({t:e.textContent.trim(),icon:(e.querySelector('svg')||{getAttribute:()=>null}).getAttribute('data-icon'),sel:e.className.includes('selected')})),label:!!pop.querySelector('.cz-pop-label'),seps:pop.querySelectorAll('.cz-pop-sep').length}:null;
  })()`);
  trace('[probeProject] ' + JSON.stringify(probeProject));
  await shoot2('c4-project');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`);
  await settle(400);

  // ── 5. 模式菜单 ──
  await js(`(()=>{const bs=document.querySelectorAll('.cz-bar .cz-btn');const b=bs[1];if(b)b.click();return !!b;})()`);
  await settle(400);
  const probeMode = await js(`(()=>{
    const pop=document.querySelector('.cz-pop');
    return pop?{items:[...pop.querySelectorAll('.cz-pop-item')].map(e=>({t:e.textContent.trim().slice(0,12),icon:(e.querySelector('svg')||{getAttribute:()=>null}).getAttribute('data-icon'),sel:e.className.includes('selected')}))}:null;
  })()`);
  trace('[probeMode] ' + JSON.stringify(probeMode));
  await shoot2('c5-mode');
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`);
  await settle(400);

  // ── 6. 「+」 → 右侧文件面板 ──
  const beforePlus = await js(`(()=>({panel: !!document.querySelector('.side-panel, [class*="sp-"], [class*="panel"]') , tabText:(document.querySelector('.side-panel')||{}).textContent||null}))()`);
  await js(`(()=>{const b=document.querySelector('#tour-plus');if(b)b.click();return !!b;})()`);
  await settle(700);
  const probePlus = await js(`(()=>{
    const aside=document.querySelector('aside');
    const texts=[...document.querySelectorAll('aside button, aside [role="tab"], aside [class*="tab"]')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,12);
    return {before:${JSON.stringify(!!beforePlus.panel)}, asideTexts:texts, bodyTail: document.body.innerText.slice(-260)};
  })()`);
  trace('[probePlus] ' + JSON.stringify(probePlus));
  await shoot2('c6-plus');

  trace('[errors] ' + JSON.stringify(errors.slice(0, 12)));
  console.log('TRACE=' + TRACE);
  console.log(JSON.stringify({ probe0, probeModel, probeFly, probePerm, probeProject, probeMode, probePlus, errors: errors.slice(0, 12) }, null, 2));
  app.quit();
});
