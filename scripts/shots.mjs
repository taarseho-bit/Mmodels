/**
 * 多页截图：把每个路由 + 侧栏面板 + 明暗两套主题各截一张。
 * 用途：给出「界面确实渲染正确」的可视证据。
 *
 * 复用主冒烟脚本的假 IPC 设计，但只做截图，不做断言。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, BrowserWindow, ipcMain } from 'electron';

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
  const win = new BrowserWindow({
    width: 1440, height: 940, show: false,
    webPreferences: {
      preload: path.join(PROJECT, 'out', 'preload', 'index.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: false, webSecurity: true,
      // 与 src/main/index.ts 一致：浏览器面板需要 webview
      webviewTag: true,
      // ⚠️ 隐藏窗口默认被 Chromium 节流：capturePage 会拿到**上一帧**（陈旧画面），
      //    表现为「截图内容和 DOM 断言对不上」。offscreen 渲染会持续出帧，最可靠。
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

  // offscreen 模式下必须开帧率，否则不出帧
  try {
    win.webContents.setFrameRate(30);
  } catch {
    /* 非 offscreen 时无此方法 */
  }

  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 3) errors.push(msg); });
  win.webContents.on('preload-error', (_e, p, err) => errors.push('[preload] ' + (err && err.message)));

  await win.loadURL('file:///' + path.join(PROJECT, 'out', 'renderer', 'index.html').replace(/\\/g, '/'));
  await new Promise((r) => setTimeout(r, 1200));

  // 打桩模态框
  await win.webContents.executeJavaScript(`window.prompt=()=>'板凳龙建模';window.confirm=()=>true;window.alert=()=>{};true;`);

  // 欢迎页
  await shoot(win, '01-welcome');

  // 进主界面
  await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes('新建项目'));if(b)b.click();return !!b;})()`);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await win.webContents.executeJavaScript(`!!document.querySelector('.app-shell')`)) break;
  }
  // ── 首次运行向导（onboardingDone=false → 自动弹出）──
  await settle(600);
  const wizShot = await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 30; i++) { if (document.querySelector('.ob-card')) break; await wait(200); }
      const has = !!document.querySelector('.ob-card');
      const t = (document.querySelector('.ob-title')||{}).textContent || '';
      // 填 Key 并连接
      const keyInput = [...document.querySelectorAll('.ob-body input')].find(i => i.type === 'password');
      if (keyInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(keyInput, 'sk-demo-xxxxxxxxxxxxxxxx');
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(200);
      }
      return { has, title: t.trim() };
    })()`,
  );
  trace('[shots] 向导 = ' + JSON.stringify(wizShot));
  await shoot(win, '02a-wizard-model-dark');

  // 点连接 → 已连接 → 进第二步
  await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = (txt) => [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.trim() === txt);
      const c = btn('连接'); if (c && !c.disabled) c.click();
      await wait(1500);
      const n = btn('继续'); if (n) n.click();
      await wait(1600);
      return true;
    })()`,
  );
  await shoot(win, '02b-wizard-environment-dark');

  // 第三步 → 起巡览
  await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const btn = (txt) => [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.trim() === txt);
      const n = btn('继续'); if (n) n.click();
      await wait(600);
      const t = [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.includes('界面引导'));
      if (t) t.click();
      await wait(1800);
      return true;
    })()`,
  );
  await shoot(win, '02c-tour-dark');

  // 巡览再走两步（换个 spotlight 目标）后退出
  await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const next = () => [...document.querySelectorAll('.tour-foot button')].find(b => b.textContent.trim() === '下一步');
      for (let i = 0; i < 2; i++) { const b = next(); if (b) b.click(); await wait(800); }
      return true;
    })()`,
  );
  await shoot(win, '02d-tour-step3-dark');
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true;`);
  await settle(500);
  // 向导已走完 → 放开供应商，后续截图才有模型可选
  providerList = [fakeProvider];
  // 向导已走完 → 放开供应商，后续截图才有模型可选
  providerList = [fakeProvider];

  await shoot(win, '02-chat-dark');

  // 写论文模式：展示「任务模式 + 比赛模板」两个选择器（原版截图里的形态）
  const composerProbe = await win.webContents.executeJavaScript(
    `(async () => {
      try {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const btns = () => [...document.querySelectorAll('.cz-bar .cz-btn')].map(e => e.textContent.trim());
      const before = btns();

      // 打开任务模式下拉 → 选「写论文」
      const modeBtn = [...document.querySelectorAll('.cz-bar .cz-btn')][1];
      if (modeBtn) modeBtn.click();
      await wait(350);
      const items = [...document.querySelectorAll('.cz-pop-item')].map(e => e.textContent.trim());
      const paper = [...document.querySelectorAll('.cz-pop-item')].find(e => e.textContent.includes('写论文'));
      if (paper) paper.click();
      await wait(600);
      const afterMode = btns();

      // 打开模板下拉 → 选「国赛 CUMCM」
      const tplBtn = [...document.querySelectorAll('.cz-bar .cz-btn')].find(e => e.textContent.includes('模板') || e.querySelector('[data-icon="templates"]'));
      if (tplBtn) tplBtn.click();
      await wait(350);
      const tplItems = [...document.querySelectorAll('.cz-pop-item')].map(e => e.textContent.trim());
      const cumcm = [...document.querySelectorAll('.cz-pop-item')].find(e => e.textContent.includes('国赛 CUMCM'));
      if (cumcm) cumcm.click();
      await wait(500);

      return {
        before,
        modeBtnFound: !!modeBtn,
        popItems: items,
        paperFound: !!paper,
        afterMode,
        tplBtnFound: !!tplBtn,
        tplItems,
        cumcmFound: !!cumcm,
        after: btns(),
        // ⚠️ 刻意不用正则：反斜杠在多层模板字面量里极易被吃掉，
        //    之前就踩过一次（/Electron\/[\d.]+/ 变成了 /Electron/[d.]+/，直接语法错误）。
        electron: (navigator.userAgent.split('Electron/')[1] || '').split(' ')[0],
      };
      } catch (e) { return { ERROR: String(e && e.message || e), stack: String(e && e.stack || '').slice(0,400) }; }
    })()`,
  );
  trace('[composer] ' + JSON.stringify(composerProbe, null, 2));
  await shoot(win, '02e-composer-paper-mode');

  // 明主题
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';true;`);
  await shoot(win, '03-chat-light');

  // ⚠️ 右栏默认隐藏，先点顶栏「打开面板」
  await win.webContents.executeJavaScript(
    `(()=>{const b=[...document.querySelectorAll('.topbar-action')].find(x=>x.textContent.trim()==='打开面板');if(b)b.click();return !!b;})()`,
  );
  await settle(700);

  // ⚠️ 右栏默认隐藏，先点顶栏「打开面板」
  await win.webContents.executeJavaScript(
    `(()=>{const b=[...document.querySelectorAll('.topbar-action')].find(x=>x.textContent.trim()==='打开面板');if(b)b.click();return !!b;})()`,
  );
  await settle(700);

  // 侧栏面板（浅色）
  for (const [label, name] of [
    ['文件', '04-panel-files-light'],
    ['更改', '04b-panel-changes-light'],
    ['项目版本', '04c-panel-versions-light'],
    ['流程图', '04f-panel-diagrams-light'],
    ['浏览器', '04g-panel-browser-light'],
    // 原版右栏没有「技能」标签（已从标签条移除），改拍新增的「科研绘图」标签
    ['科研绘图', '05-panel-skills-light'],
  ]) {
    await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(t)t.click();return !!t;})()`);
    await settle();
    await shoot(win, name);
  }

  // 流程图面板：进入详情（点待导出的那个）
  await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()==='流程图');if(t)t.click();return !!t;})()`);
  await settle();
  await win.webContents.executeJavaScript(`(()=>{const r=[...document.querySelectorAll('.dg-main')].find(e=>e.textContent.includes('framework'));if(r)r.click();return !!r;})()`);
  await settle(420);
  await shoot(win, '04h-diagram-detail-light');

  // 浏览器面板：用本地服务加载一个页面，截「真实渲染」的样子
  {
    const http = await import('node:http');
    const srv = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>城市路网通行效率 · 数据说明</title>' +
          '<style>body{font-family:system-ui,"PingFang SC",sans-serif;margin:0;padding:28px 32px;color:#17191c;background:#fff}' +
          'h1{font-size:19px;margin:0 0 6px}p{font-size:13px;line-height:1.9;color:#52565e;max-width:640px}' +
          '.k{display:inline-block;padding:2px 8px;border-radius:999px;background:#e8effd;color:#2563eb;font-size:11px;margin-right:6px}' +
          'table{border-collapse:collapse;margin-top:18px;font-size:12px}td,th{border:1px solid #e8eaed;padding:5px 12px;text-align:left}</style>' +
          '</head><body><h1>城市路网通行效率 · 数据说明</h1>' +
          '<p><span class="k">8 个站点</span><span class="k">24 小时刷卡记录</span>' +
          '本数据集覆盖人民广场、陆家嘴、徐家汇等 8 个站点的高峰时段客流与通行延误，用于建立以总延误最小为目标的优化模型。</p>' +
          '<table><tr><th>字段</th><th>含义</th><th>单位</th></tr>' +
          '<tr><td>日均客流</td><td>站点日均进出站人次</td><td>人次</td></tr>' +
          '<tr><td>峰值小时</td><td>最繁忙一小时的客流</td><td>人次</td></tr>' +
          '<tr><td>通行延误</td><td>高峰时段平均延误</td><td>秒</td></tr></table>' +
          '</body></html>',
      );
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()==='浏览器');if(t)t.click();return !!t;})()`);
    await settle();
    await win.webContents.executeJavaScript(
      `(async () => {
        const input = document.querySelector('.br-bar input');
        if (!input) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(`http://127.0.0.1:${port}/`)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 120));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`,
    );
    // 等页面真正加载出来
    for (let i = 0; i < 30; i++) {
      await settle(200);
      const ok = await win.webContents.executeJavaScript(
        `(()=>{const w=document.querySelector('.br-view webview');try{return !!(w&&w.getTitle());}catch(e){return false;}})()`,
      );
      if (ok) break;
    }
    await shoot(win, '04i-panel-browser-loaded-light');
    srv.close();
  }

  // 文件面板：展开 data 目录后点开 CSV，截「表格预览」
  await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()==='文件');if(t)t.click();return !!t;})()`);
  await settle();
  const treeProbe = await win.webContents.executeJavaScript(
    `(async () => {
      // data 目录默认折叠，先展开（点目录行会 toggle）
      const dir = [...document.querySelectorAll('.file-row')].find(e => e.textContent.includes('data') && e.textContent.includes('▸'));
      if (dir) { dir.click(); await new Promise(r => setTimeout(r, 420)); }
      const rows = [...document.querySelectorAll('.file-row')].map(e => e.textContent.trim());
      const csv = [...document.querySelectorAll('.file-row')].find(e => e.textContent.includes('.csv'));
      if (csv) { csv.click(); await new Promise(r => setTimeout(r, 620)); }
      const table = document.querySelector('.dt-table');
      return {
        expanded: !!dir,
        rows,
        clickedCsv: !!csv,
        hasTable: !!table,
        headers: table ? [...table.querySelectorAll('thead th')].map(e => e.textContent.trim()) : [],
        bodyRows: table ? table.querySelectorAll('tbody tr').length : 0,
        dimensions: ((document.querySelector('.pv-head .muted')||{}).textContent || '').trim(),
      };
    })()`,
  );
  trace('[panel] 表格预览探测 = ' + JSON.stringify(treeProbe));
  if (!treeProbe.hasTable) errors.push('表格预览未渲染：' + JSON.stringify(treeProbe));
  await shoot(win, '04d-panel-table-preview-light');

  // 项目版本：打开「保存版本」弹层
  await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()==='项目版本');if(t)t.click();return !!t;})()`);
  await settle();
  await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('保存当前状态'));if(b)b.click();return !!b;})()`);
  await settle(360);
  await shoot(win, '04e-versions-save-dialog-light');
  await win.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='取消');if(b)b.click();return !!b;})()`);
  await settle();
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';true;`);
  // 右栏已无「技能」标签，改拍「科研绘图」（保留原文件名，便于审计目录对号入座）
  await win.webContents.executeJavaScript(`(()=>{const t=[...document.querySelectorAll('.sidepanel-tab')].find(e=>e.textContent.trim()==='科研绘图');if(t)t.click();return !!t;})()`);
  await shoot(win, '06-panel-skills-dark');

  // 各页（浅色）
  await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='light';true;`);
  for (const [label, name] of [
    ['竞赛日历', '07-competitions-light'],
    ['科研绘图', '08-gallery-light'],
    ['数据集', '08b-datasets-light'],
    ['数模广场', '09-papers-light'],
    ['自动化', '10-automation-light'],
    ['扩展', '11-extensions-light'],
    ['设置', '12-settings-light'],
  ]) {
    await goto(win, label);
    await shoot(win, name);
  }

  // 竞赛日历：切到列表视图
  if (await goto(win, '竞赛日历')) {
    const ok = await win.webContents.executeJavaScript(
      `(()=>{const b=[...document.querySelectorAll('.cal-seg button')].find(x=>x.textContent.trim()==='列表');if(b)b.click();return !!b;})()`,
    );
    trace(`[competitions] 切列表视图 = ${ok}`);
    await settle();
    await shoot(win, '13-competitions-list-light');
  }

  // 科研绘图：打开大图预览
  if (await goto(win, '科研绘图')) {
    const ok = await win.webContents.executeJavaScript(
      `(()=>{const b=document.querySelector('.gal-card button');if(b)b.click();return !!b;})()`,
    );
    trace(`[gallery] 打开预览 = ${ok}`);
    await settle();
    await shoot(win, '14-gallery-preview-light');
    await win.webContents.executeJavaScript(
      `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('关闭预览'));if(b)b.click();return !!b;})()`,
    );
    await settle();
  }

  // 自动化运行历史展开（深色）
  if (await goto(win, '自动化')) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme='dark';true;`);
    await settle();
    const ok = await win.webContents.executeJavaScript(
      `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('运行历史'));if(b)b.click();return !!b;})()`,
    );
    trace(`[automation] 展开运行历史 = ${ok}`);
    await settle();
    await shoot(win, '15-automation-runs-dark');
  }

  trace('[done] 错误 ' + errors.length + ' 条');
  errors.slice(0, 20).forEach((e) => trace('  [E] ' + e));
  fs.writeFileSync(path.join(OUT, 'shots-errors.json'), JSON.stringify(errors, null, 2));

  app.quit();
}).catch((err) => {
  trace('[E] ' + (err && err.stack ? err.stack : String(err)));
  app.quit();
});
