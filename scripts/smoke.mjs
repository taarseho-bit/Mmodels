/**
 * 无头冒烟测试：加载**真实构建产物**，验证界面不白屏、控制台无错误。
 *
 * 关键设计：
 *  1. 注册假 IPC —— 通道名必须与 preload 的 IPC 常量一致，
 *     业务逻辑尽量走真实模块；这里主要替代「弹对话框 / 建库」这类副作用
 *  2. 加载 out/renderer/index.html（真实产物）+ out/preload/index.js（真实 preload）
 *  3. 收集 console-message / preload-error / render-process-gone
 *  4. 用 executeJavaScript 断言关键 DOM 存在
 *
 * ⚠️ Electron 是 GUI 子系统程序，stdout 拿不到 → 全程写文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, BrowserWindow, ipcMain } from 'electron';

const PROJECT = 'D:\\mathmodel-desktop';
const OUT = process.env.VERIFY_OUT || path.join(os.tmpdir(), 'mm-verify');
fs.mkdirSync(OUT, { recursive: true });
const TRACE = path.join(OUT, 'trace.txt');
fs.writeFileSync(TRACE, '');
const trace = (m) => fs.appendFileSync(TRACE, m + '\n');

app.disableHardwareAcceleration();

// Electron 默认 window-all-closed 会退掉整个应用 —— 必须接管，否则中途腰斩
app.on('window-all-closed', () => trace('[w] window-all-closed（已接管，不退出）'));

// ─────────────────────────────────────────────────────────────
// 假 IPC：只替代副作用（对话框 / 本地服务），业务逻辑尽量真实
// ─────────────────────────────────────────────────────────────

/**
 * 每次运行用**独立的临时项目目录**。
 *
 * ⚠️ 之前用固定目录 + 强删，遇到「上一次运行的 electron 进程还没退干净」时
 *    会报 EPERM，整个验证脚本挂在启动阶段 ——
 *    表现为 `App threw an error during load`，看起来像应用崩了。
 */
const RUN_ID = Date.now().toString(36);
const PROJECT_DIR = path.join(os.tmpdir(), `mm-verify-project-${RUN_ID}`);

// 尽力清理历史遗留目录（失败不影响本次运行）
try {
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith('mm-verify-project')) {
      try {
        fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
      } catch {
        /* 被占用就跳过 */
      }
    }
  }
} catch {
  /* 忽略 */
}

const fakeProject = {
  id: 'proj-verify-1',
  name: '验证项目',
  root: PROJECT_DIR,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  lastOpenedAt: Date.now(),
};

const fakeProvider = {
  id: 'prov-verify-1',
  name: '验证供应商',
  apiFormat: 'openai',
  baseUrl: 'https://example.invalid/v1',
  apiKey: 'sk-verify',
  models: ['verify-model'],
  enabled: true,
};

const fakeSettings = {
  activeProviderId: fakeProvider.id,
  defaultModel: 'verify-model',
  builtinMcpEnabled: true,
  effort: null,
  disableThinking: true,
  locale: 'zh-CN',
  recentProjectId: null,
  // 故意设成 false：先验「首次运行向导会自动弹出」，走完再置 true
  onboardingDone: false,
  tourDone: false,
};

const fakeSkills = [
  {
    dirName: 'paper-writing',
    name: '论文写作',
    description: '按竞赛格式生成 LaTeX 论文，含摘要、模型假设、灵敏度分析等章节。',
    source: 'builtin',
    path: path.join(PROJECT, 'resources', 'builtin-skills', 'paper-writing'),
    disabledByDefault: false,
    enabled: true,
    fileCount: 12,
    byteSize: 380000,
    hasScripts: true,
  },
  {
    dirName: 'data-analysis',
    name: '数据分析',
    description: '描述性统计、相关性分析、可视化图表生成。',
    source: 'builtin',
    path: path.join(PROJECT, 'resources', 'builtin-skills', 'data-analysis'),
    disabledByDefault: false,
    enabled: false,
    fileCount: 5,
    byteSize: 64000,
    hasScripts: false,
  },
];

/** 已注册的通道 —— 防止重复注册（Electron 会直接抛错并中断整个脚本） */
const registeredChannels = new Set();

function stub(channel, fn) {
  if (registeredChannels.has(channel)) {
    throw new Error(
      `重复注册 IPC 通道 '${channel}'。Electron 对同一通道只允许一个 handler，` +
        '重复注册会让整个验证脚本在加载阶段就挂掉。请检查是否在多处 stub 了同一个通道。',
    );
  }
  registeredChannels.add(channel);
  ipcMain.handle(channel, async (...args) => {
    trace(`[ipc] ${channel}`);
    return fn(...args);
  });
}

// app:*
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

// project / session / settings / llm / skill
stub('project:list', () => [fakeProject]);
stub('project:create', () => fakeProject);
stub('project:open', () => fakeProject);
stub('project:remove', () => []);
stub('project:current', () => fakeProject);

stub('session:list', () => [
  {
    id: 'sess-verify-1',
    title: '验证会话',
    projectId: fakeProject.id,
    providerId: fakeProvider.id,
    model: 'verify-model',
    status: 'idle',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messageCount: 1,
  },
]);
stub('session:create', () => ({
  id: 'sess-verify-1',
  title: '验证会话',
  projectId: fakeProject.id,
  providerId: fakeProvider.id,
  model: 'verify-model',
  status: 'idle',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  messageCount: 0,
}));
stub('session:get', () => ({
  meta: {},
  messages: [
    {
      id: 'm-md-probe',
      role: 'assistant',
      createdAt: Date.now(),
      // ⚠️ 必须用真实形状 { blocks: ContentBlock[] }，不是 { content: string }。
      //    写错会让 ChatPage 在 m.blocks.filter(...) 处直接崩，
      //    表现为「整个对话页白屏」—— 看着像产品坏了，其实是桩给错了数据。
      blocks: [
        {
          kind: 'text',
          // ⚠️ LaTeX 的反斜杠在 JS 字符串里必须写双份，
          //    否则 \i \f 会被当成转义字符（\f 还是换页符），公式就废了
          text: [
            '目标函数为 $E = mc^2$，写成块级：',
            '',
            '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$',
            '',
            '```mermaid',
            'flowchart LR',
            '  A[读题] --> B[建模]',
            '  B --> C[求解]',
            '```',
          ].join('\n'),
        },
      ],
    },
  ],
}));
stub('session:rename', () => null);
stub('session:delete', () => true);
stub('session:abort', () => true);
stub('session:send', () => ({ messageId: 'msg-verify-1' }));

// ⚠️ 必须是**可累积**的：写死成 { ...fakeSettings, ...patch } 的话，
//    连续两次 patch 会互相覆盖（第二次把第一次的字段丢掉），
//    表现为「刚设好的模式自己变回去了」—— 是桩的 bug，不是产品 bug。
let currentSettings = { ...fakeSettings };
stub('settings:get', () => currentSettings);
stub('settings:set', (_e, p) => {
  currentSettings = { ...currentSettings, ...(p || {}) };
  return currentSettings;
});

// 可变：首次运行向导要验「没有供应商时停在第一步填 Key」
let providerList = [];
stub('llm:list-providers', () => providerList);
stub('llm:upsert-provider', (_e, p) => {
  providerList = [p];
  return providerList;
});
stub('llm:delete-provider', () => []);
stub('llm:test-provider', () => ({ ok: true, detail: '连接成功（冒烟测试桩）' }));
stub('llm:presets', () => [
  {
    key: 'deepseek',
    name: 'DeepSeek',
    apiFormat: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    note: 'V4 系列需关思考',
  },
]);
stub('llm:list-models', () => []);

stub('skill:list', () => fakeSkills);
stub('skill:toggle', () => fakeSkills);
stub('skill:read', () => '# 论文写作技能\n\n用于生成竞赛论文。\n');
stub('skill:import', () => fakeSkills);

// file / terminal / automation（页面里有调用，不打桩会刷控制台噪声）
// 文件树与预览也读**真实文件** —— 这样文件面板和数据表格预览渲染的是真数据
stub('file:tree', () => {
  const root = fakeProject.root;
  const walk = (rel) => {
    const abs = path.join(root, rel);
    let entries = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.name !== '.git')
      .map((e) => {
        const r = rel ? `${rel}/${e.name}` : e.name;
        const st = fs.statSync(path.join(root, r));
        return e.isDirectory()
          ? {
              name: e.name,
              relPath: r,
              isDirectory: true,
              size: 0,
              mtimeMs: st.mtimeMs,
              children: walk(r),
            }
          : {
              name: e.name,
              relPath: r,
              isDirectory: false,
              size: st.size,
              mtimeMs: st.mtimeMs,
            };
      });
  };
  return walk('');
});
stub('file:read-preview', (_e, relPath) => {
  const abs = path.join(fakeProject.root, relPath);
  const st = fs.statSync(abs);
  const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
  if (['csv', 'tsv'].includes(ext)) {
    return {
      kind: 'text',
      relPath,
      size: st.size,
      text: fs.readFileSync(abs, 'utf8'),
    };
  }
  return {
    kind: 'text',
    relPath,
    size: st.size,
    text: fs.readFileSync(abs, 'utf8').slice(0, 4000),
    truncated: st.size > 4000,
  };
});
stub('file:select-directory', () => null);
stub('file:select-files', () => null);
stub('file:save-text', () => null);
stub('file:save-binary', () => null);
stub('file:write', () => true);
stub('file:rename', () => true);
stub('file:delete', () => true);

stub('term:create', () => ({ termId: 't1', pid: 1234 }));
stub('term:write', () => true);
stub('term:resize', () => true);
stub('term:kill', () => true);

stub('automation:list', () => [
  {
    id: 'auto-1',
    projectId: fakeProject.id,
    name: '每日复盘',
    prompt: '读取最新数据，重新拟合模型并输出报告。',
    cron: '0 8 * * *',
    enabled: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastRunAt: null,
    nextRunAt: Date.now() + 3600_000,
  },
]);
stub('automation:upsert', () => []);
stub('automation:delete', () => []);
stub('automation:toggle', () => []);
stub('automation:run-now', () => true);
stub('automation:runs', () => []);

// ─────────────────────────────────────────────────────────────
// git：**走真实模块**，不用造假结果（造假的验证没有意义）
//   把临时项目真的 init 成仓库、真的写文件、真的存版本，
//   这样「更改」「项目版本」两个面板渲染的就是真实数据。
// ─────────────────────────────────────────────────────────────
const git = await import('../src/main/git/index.ts');

{
  const root = fakeProject.root;
  // ⚠️ 先清空：临时项目目录会在多次运行间复用，
  //    不清的话 git 版本会累积（上次跑 1 个、这次变 3 个），
  //    断言与截图都失去可比性。
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 被占用就跳过，反正目录是新建的 */ }
  fs.mkdirSync(root, { recursive: true });
  // 造一点真实内容，让 diff / 版本面板有东西可渲染
  fs.writeFileSync(
    path.join(root, 'main.py'),
    ['import numpy as np', '', 'def solve():', '    return 42', ''].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(root, 'data.csv'),
    ['x,y', '1,2.5', '2,3.1', '3,4.8', '4,5.2', '5,6.0'].join('\n'),
    'utf8',
  );
  await git.ensureRepo(root);
  await git.saveVersion(root, '完成数据清洗', 'manual');
  // 制造一处未提交改动 → diff 面板会渲染出 add/del 行
  fs.writeFileSync(
    path.join(root, 'main.py'),
    ['import numpy as np', '', 'def solve():', '    return 42', '', 'def extra():', '    return 7', ''].join('\n'),
    'utf8',
  );
  trace('[git] 测试仓库已就绪');
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
// 流程图 / 数据集：走**真实模块**
// ⚠️ 只能 import `src/main/scan/*`（纯 Node，无 electron / 数据库依赖）。
//    若改成 import `src/main/ipc/diagram.ts`，会顺着
//    `./file → ../db → better-sqlite3` 把原生模块拖进 ESM bundle，
//    运行时报 `Dynamic require of "fs" is not supported`，整个验证跑不起来。
// ─────────────────────────────────────────────────────────────
const diagramScan = await import('../src/main/scan/diagram.ts');
const datasetScan = await import('../src/main/scan/dataset.ts');
{
  // 造两个 .drawio：一个已导出（新鲜）、一个未导出（待导出）
  const root = fakeProject.root;
  fs.writeFileSync(
    path.join(root, 'roadmap.drawio'),
    '<mxfile><diagram name="roadmap"><mxGraphModel/></diagram></mxfile>',
    'utf8',
  );
  fs.writeFileSync(path.join(root, 'roadmap.png'), 'fakepng', 'utf8');
  // 让导出图比源文件新 → 不算待导出
  const future = Date.now() + 60_000;
  fs.utimesSync(path.join(root, 'roadmap.png'), future / 1000, future / 1000);

  // framework 没有导出图 → 待导出
  fs.writeFileSync(
    path.join(root, 'framework.drawio'),
    '<mxfile><diagram name="framework"><mxGraphModel/></diagram></mxfile>',
    'utf8',
  );
}
stub('diagram:list', () => {
  const r = diagramScan.collectDiagrams(fakeProject.root);
  return { ...r, truncated: r.total > r.diagrams.length };
});

// 数据集：真实扫描（上面已写入 data.csv）
stub('dataset:list', () => datasetScan.collectDataFiles(fakeProject.root));
stub('dataset:import', () => ({ imported: [], canceled: true }));

// 浏览器面板
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


// ─────────────────────────────────────────────────────────────
// 运行环境检查：走**真实模块**（纯 Node，可直接 import）
// 真检测要跑 ~4 秒，启动时跑一次并缓存，避免拖慢向导步骤的断言。
// ─────────────────────────────────────────────────────────────
const envScan = await import('../src/main/scan/environment.ts');
let envCache = null;
{
  const t = Date.now();
  envCache = await envScan.checkEnvironment(fakeProject.root, path.join(PROJECT, 'resources'));
  trace(`[env] 真实检测完成 ${Date.now() - t}ms，必需缺失 ${envCache.missingRequired}，建议缺失 ${envCache.missingRecommended}`);
}
stub('env:check', () => envCache);

// ─────────────────────────────────────────────────────────────
// 同步 IPC：APP_SERVER_INFO
// ─────────────────────────────────────────────────────────────
ipcMain.on('app:server-info', (e) => {
  trace('[ipc] app:server-info (sync)');
  e.returnValue = { port: 0, token: '', baseUrl: '' };
});

// ─────────────────────────────────────────────────────────────
// 冒烟
// ─────────────────────────────────────────────────────────────

const errors = [];

app.whenReady().then(async () => {
  trace('[1] app ready');

  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    show: false,
    webPreferences: {
      preload: path.join(PROJECT, 'out', 'preload', 'index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true,
      // ⚠️ 必须与 src/main/index.ts 保持一致，否则浏览器面板的 <webview> 建不出来
      webviewTag: true,
    },
  });

  // 与真实主进程同样的 webview 加固（测试窗口也要有，否则测的不是真实配置）
  win.webContents.on('will-attach-webview', (_e, wprefs, params) => {
    delete wprefs.preload;
    wprefs.nodeIntegration = false;
    wprefs.contextIsolation = true;
    wprefs.sandbox = true;
    if (!/^https?:\/\//i.test(params.src || '')) params.src = 'about:blank';
  });

  win.webContents.on('console-message', (_e, level, msg) => {
    // level: 0=verbose 1=info 2=warning 3=error
    if (level >= 2) errors.push(`[console ${level}] ${msg}`);
  });
  win.webContents.on('preload-error', (_e, p, err) => {
    errors.push(`[preload-error] ${p}: ${err && err.message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    errors.push(`[render-process-gone] ${JSON.stringify(details)}`);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    errors.push(`[did-fail-load] ${code} ${desc} ${url}`);
  });

  const htmlPath = path.join(PROJECT, 'out', 'renderer', 'index.html');
  trace('[2] loading ' + htmlPath);
  await win.loadURL('file:///' + htmlPath.replace(/\\/g, '/'));

  // 轮询等待 React 渲染完成（不要 sleep 固定时长）
  let booted = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const has = await win.webContents.executeJavaScript(
      `(document.querySelector('#root') ? document.querySelector('#root').innerHTML.length : 0) > 200`,
    );
    if (has) {
      booted = true;
      trace(`[3] UI 出现（第 ${i + 1} 次轮询）`);
      break;
    }
  }
  if (!booted) trace('[3] ⚠️ 60 次轮询后 #root 仍为空');

  // 多等一会让 bootstrap 的 Promise 全部落地
  await new Promise((r) => setTimeout(r, 1500));

  const report = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    return {
      title: document.title,
      bodyTextLength: (document.body.innerText || '').length,
      hasBootSplash: !!q('.boot-splash'),
      hasAppShell: !!q('.app-shell'),
      hasWelcome: !!q('.starters'),
      topbarTabs: qa('.rail-item').map(e => e.textContent.trim()),
      sidePanelTabs: qa('.sidepanel-tab').map(e => e.textContent.trim()),
      statusbarItems: qa('.statusbar-item').map(e => e.textContent.trim()).slice(0, 8),
      rootHTMLLength: (q('#root') ? q('#root').innerHTML.length : -1),
      firstHeading: (q('h1') && q('h1').textContent) || '',
      hasMathmodelApi: typeof window.mathmodel === 'object' && window.mathmodel !== null,
      apiKeys: window.mathmodel ? Object.keys(window.mathmodel).sort() : [],
    };
  })()`);

  trace('[4] report = ' + JSON.stringify(report, null, 2));

  // ── 逐页驱动 ──
  const pageResults = [];
  const welcomeVisible = report.hasWelcome;
  trace('[5] 欢迎页可见=' + welcomeVisible);

  if (welcomeVisible) {
    // 无头环境里 window.prompt 会挂住整个渲染进程 —— 先打桩再点真实按钮。
    // 这样走的是**真实的 React 事件路径**（store.createProject → refresh 链），
    // 只把不可避免的模态框换成返回值。
    await win.webContents.executeJavaScript(`
      window.prompt = () => '冒烟验证项目';
      window.confirm = () => true;
      window.alert = () => {};
      true;
    `);

    const clicked = await win.webContents.executeJavaScript(`(() => {
      const btn = [...document.querySelectorAll('button')].find(b => (b.textContent||'').includes('新建项目'));
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    trace('[5.1] 点击「新建项目」=' + clicked);

    // 等界面切到主壳
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const ok = await win.webContents.executeJavaScript(`!!document.querySelector('.app-shell')`);
      if (ok) {
        trace(`[5.2] 主壳出现（第 ${i + 1} 次轮询）`);
        break;
      }
    }
  }

  const shellState = await win.webContents.executeJavaScript(`({
    hasShell: !!document.querySelector('.app-shell'),
    hasWelcome: !!document.querySelector('.starters'),
    topbarTabs: [...document.querySelectorAll('.rail-item')].map(e => e.textContent.trim()),
    sidePanelTabs: [...document.querySelectorAll('.sidepanel-tab')].map(e => e.textContent.trim()),
  })`);
  trace('[6] 主壳状态 = ' + JSON.stringify(shellState, null, 2));

  // 侧栏导航与右栏标签是分两步渲染的，稍等一下再读，否则拿到空数组
  await new Promise((r) => setTimeout(r, 800));
  const railState = await win.webContents.executeJavaScript(`({
    navItems: [...document.querySelectorAll('.rail-item[data-route]')].map(e => e.textContent.trim()),
    navLabels: [...document.querySelectorAll('.rail-nav .rail-item')].map(e => e.textContent.trim()),
    hasNewThread: !!document.querySelector('#tour-new-thread'),
    projectsSection: !![...document.querySelectorAll('.rail-sec-head span')].find(e => e.textContent.trim() === '项目'),
    chatsSection: !![...document.querySelectorAll('.rail-sec-head span')].find(e => e.textContent.trim() === '会话'),
    topbarActions: [...document.querySelectorAll('.topbar-action')].map(e => e.textContent.trim()),
    brand: (document.querySelector('.topbar-name')||{}).textContent || '',
  })`);
  trace('[6.1] 左侧导航 = ' + JSON.stringify(railState));


  // ── [6.5] 首次运行向导：应自动弹出，走完三步 ──
  // 此时 providerList 为空 → 应停在第一步「连接模型」，并要求填 API Key
  const wizardProbe = await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      let card = null;
      for (let i = 0; i < 30; i++) {
        card = document.querySelector('.ob-card');
        if (card) break;
        await wait(200);
      }
      if (!card) return { appeared: false };

      const stepLabel = () => (document.querySelector('.ob-head .muted') || {}).textContent.trim();
      const title = () => (document.querySelector('.ob-title') || {}).textContent.trim();
      const btn = (txt) => [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.trim() === txt);

      // ── 第 1 步：连接模型 ──
      const step1Label = stepLabel();
      const step1Title = title();
      const presets = document.querySelectorAll('.ob-preset').length;
      const recBadge = !!document.querySelector('.ob-rec');
      const activePreset = (document.querySelector('.ob-preset.active .ob-preset-name') || {}).textContent || '';

      // 连接按钮在没填 Key 时应禁用
      const connectBtnBefore = btn('连接');
      const disabledBeforeKey = connectBtnBefore ? connectBtnBefore.disabled : null;

      // 填入 API Key（受控输入走原生 setter）
      const keyInput = [...document.querySelectorAll('.ob-body input')].find(i => i.type === 'password');
      let connectClicked = false;
      if (keyInput) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(keyInput, 'sk-smoke-test-key');
        keyInput.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(200);
        const connectBtn = btn('连接');
        if (connectBtn && !connectBtn.disabled) { connectBtn.click(); connectClicked = true; }
      }
      await wait(1600);
      const afterConnect = {
        okShown: !!document.querySelector('.ob-ok'),
        okText: ((document.querySelector('.ob-ok') || {}).textContent || '').trim().slice(0, 60),
      };

      // ── 第 2 步：检查运行环境 ──
      const next1 = btn('继续');
      if (next1) next1.click();
      await wait(1800);   // env 结果已在启动时缓存，这里等渲染即可
      const step2Label = stepLabel();
      const step2Title = title();
      const envRows = document.querySelectorAll('.ob-envrow').length;
      const envHasRequired = [...document.querySelectorAll('.ob-envlevel')].some(e => e.textContent.trim() === '必需');

      // ── 第 3 步：开始使用 ──
      const next2 = btn('继续');
      if (next2) next2.click();
      await wait(500);
      const step3Label = stepLabel();
      const step3Title = title();
      const tourBtn = [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.includes('界面引导'));

      return {
        appeared: true,
        step1: { label: step1Label, title: step1Title, presets, recBadge, activePreset, disabledBeforeKey },
        connectClicked, afterConnect,
        step2: { label: step2Label, title: step2Title, envRows, envHasRequired },
        step3: { label: step3Label, title: step3Title },
        hasTourBtn: !!tourBtn,
      };
    })()`,
  );
  trace('[6.5] 首次运行向导 = ' + JSON.stringify(wizardProbe, null, 2));

  // ── [6.6] 引导巡览：从向导第三步点「看一遍界面引导」进入 ──
  const tourProbe = await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      const tourBtn = [...document.querySelectorAll('.ob-foot button')].find(b => b.textContent.includes('界面引导'));
      if (!tourBtn) return { entered: false, reason: 'no-button' };
      tourBtn.click();
      await wait(1600);

      const read = () => ({
        title: (document.querySelector('.tour-title') || {}).textContent.trim(),
        step: (document.querySelector('.tour-step') || {}).textContent.trim(),
        hasHole: !!document.querySelector('.tour-hole'),
        descLen: ((document.querySelector('.tour-desc') || {}).textContent || '').length,
      });

      const first = read();
      const nextBtn = () => [...document.querySelectorAll('.tour-foot button')].find(b => b.textContent.trim() === '下一步');
      const seen = [first];

      // 连点几步，确认标题在变（说明步骤在推进、且找不到目标的步骤被正确跳过）
      for (let i = 0; i < 5; i++) {
        const b = nextBtn();
        if (!b) break;
        b.click();
        await wait(700);
        seen.push(read());
      }

      const titles = seen.map(s => s.title);
      const distinct = new Set(titles.filter(Boolean)).size;

      // Esc 退出
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(500);
      const closed = !document.querySelector('.tour-root');

      return { entered: true, first, titles, distinct, closed, holeCount: seen.filter(s => s.hasHole).length };
    })()`,
  );
  trace('[6.6] 引导巡览 = ' + JSON.stringify(tourProbe));

  // 向导走完后放开供应商列表（后续设置/面板测试需要）
  providerList = [fakeProvider];
  await win.webContents.executeJavaScript(
    `(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='刷新'); return !!b; })()`,
  );

  // ── 逐个切换顶栏 tab（只对存在的 tab 点）──
  // ⚠️ 「对话」不是导航项（原版通过「新建会话」或点会话进入），
  //    所以给每个标签配一个选择器，而不是一律按文字找导航项。
  const ROUTE_SELECTORS = {
    对话: '#tour-new-thread',
    竞赛日历: '[data-route="competitions"]',
    科研绘图: '[data-route="gallery"]',
    数据集: '[data-route="datasets"]',
    数模广场: '[data-route="papers"]',
    自动化: '[data-route="automation"]',
    扩展: '[data-route="extensions"]',
    设置: '[data-route="settings"]',
  };

  for (const label of [
    '对话',
    '竞赛日历',
    '科研绘图',
    '数据集',
    '数模广场',
    '自动化',
    '扩展',
    '设置',
  ]) {
    const clicked = await win.webContents.executeJavaScript(
      `(() => {
        const sel = ${JSON.stringify(ROUTE_SELECTORS[label])};
        const t = document.querySelector(sel);
        if (t) { t.click(); return true; }
        return false;
      })()`,
    );
    await new Promise((r) => setTimeout(r, 900));
    const st = await win.webContents.executeJavaScript(`({
      route: ${JSON.stringify(label)},
      pageTitle: ((document.querySelector('.page-title')||{}).textContent || '').trim(),
      panelCount: document.querySelectorAll('.panel').length,
      skillCards: document.querySelectorAll('.skill-card').length,
      starters: document.querySelectorAll('.starter').length,
      switches: document.querySelectorAll('.switch').length,
      badges: document.querySelectorAll('.badge').length,
      mainHtmlLen: (document.querySelector('.app-main')||{innerHTML:''}).innerHTML.length,
    })`);
    pageResults.push({ clicked, ...st });
    trace(`[7] tab ${label} = ` + JSON.stringify(st));
  }

  // ── [7.8] Markdown 渲染：公式（KaTeX）与图表（Mermaid）──
  // KaTeX / Mermaid 是「装了但没接上」的高风险点：装了依赖、编译也过，
  // 但渲染不出来只有真的看一眼才知道。这里用一条塞了公式和流程图的
  // 历史消息做端到端断言。
  const mdProbe = await win.webContents.executeJavaScript(
    `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms));
      // 回对话页
      const nt = document.querySelector('#tour-new-thread');
      if (nt) nt.click();
      await wait(700);
      // 点第一条会话，触发历史加载
      const row = [...document.querySelectorAll('.rail-item')].find(e => e.textContent.includes('验证会话'));
      if (row) row.click();
      // Mermaid 是动态 import + 异步渲染，给足时间
      for (let i = 0; i < 48; i++) {
        await wait(250);
        if (document.querySelector('.md .katex') && document.querySelector('.md-mermaid svg')) break;
      }
      return {
        clickedSession: !!row,
        katex: document.querySelectorAll('.md .katex').length,
        katexDisplay: document.querySelectorAll('.md .katex-display').length,
        mermaidBox: document.querySelectorAll('.md-mermaid').length,
        mermaidSvg: document.querySelectorAll('.md-mermaid svg').length,
        mermaidError: document.querySelectorAll('code.language-mermaid[data-mm-error]').length,
        mdLen: (document.querySelector('.md') || { innerHTML: '' }).innerHTML.length,
      };
    })()`,
  );
  trace('[7.8] Markdown 渲染 = ' + JSON.stringify(mdProbe));

  // ── 侧栏面板切换（必须在「对话」路由下，SidePanel 只在 chat 显示）──
  const panelResults = [];

  // 先切回对话页
  await win.webContents.executeJavaScript(
    `(() => {
      const t = document.querySelector('#tour-new-thread');
      if (t) { t.click(); return true; }
      return false;
    })()`,
  );
  await new Promise((r) => setTimeout(r, 900));

  // ⚠️ 右栏默认隐藏（对齐原版），先点顶栏「打开面板」把它打开
  await win.webContents.executeJavaScript(
    `(() => {
      const b = [...document.querySelectorAll('.topbar-action')].find(x => x.textContent.trim() === '打开面板');
      if (b) { b.click(); return true; }
      // 兜底：直接点「编辑器视图」
      const e = [...document.querySelectorAll('.topbar-action')].find(x => x.textContent.trim() === '编辑器视图');
      if (e) { e.click(); return true; }
      return false;
    })()`,
  );
  await new Promise((r) => setTimeout(r, 600));

  // ⚠️ 右栏默认隐藏（对齐原版），先点顶栏「打开面板」把它打开
  await win.webContents.executeJavaScript(
    `(() => {
      const b = [...document.querySelectorAll('.topbar-action')].find(x => x.textContent.trim() === '打开面板');
      if (b) { b.click(); return true; }
      // 兜底：直接点「编辑器视图」
      const e = [...document.querySelectorAll('.topbar-action')].find(x => x.textContent.trim() === '编辑器视图');
      if (e) { e.click(); return true; }
      return false;
    })()`,
  );
  await new Promise((r) => setTimeout(r, 600));

  const sideTabs = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.sidepanel-tab')].map(e => e.textContent.trim())`,
  );
  trace('[7.5] 侧栏 tab = ' + JSON.stringify(sideTabs));

  for (const label of sideTabs.length ? sideTabs : ['文件', '终端', '科研绘图']) {
    const ok = await win.webContents.executeJavaScript(
      `(() => {
        const t = [...document.querySelectorAll('.sidepanel-tab')].find(e => e.textContent.trim() === ${JSON.stringify(label)});
        if (t) { t.click(); return true; }
        return false;
      })()`,
    );
    await new Promise((r) => setTimeout(r, 900));
    const st = await win.webContents.executeJavaScript(`({
      panel: ${JSON.stringify(label)},
      skillCards: document.querySelectorAll('.skill-card').length,
      switches: document.querySelectorAll('.switch').length,
      fileRows: document.querySelectorAll('.file-row').length,
      skillNames: [...document.querySelectorAll('.skill-name')].map(e => e.textContent.trim()),
      // 更改面板：diff 行数与新增/删除行数
      diffLines: document.querySelectorAll('.diff-line').length,
      diffAdds: document.querySelectorAll('.diff-add').length,
      diffDels: document.querySelectorAll('.diff-del').length,
      // 版本面板：版本条目数
      verRows: document.querySelectorAll('.ver-row').length,
      // 流程图面板：条目数与「待导出」徽标数
      dgRows: document.querySelectorAll('.dg-row').length,
      dgStale: document.querySelectorAll('.dg-badge').length,
      // 浏览器面板：标签与地址栏
      brTabs: document.querySelectorAll('.br-tab').length,
      brBar: document.querySelectorAll('.br-bar input').length,
      // ⚠️ 浏览器面板是保活挂载（display:none 也在 DOM 里），
      //    直接取 textContent 会把它的文案混进每个面板 —— 先剥离再取。
      sideText: (() => {
        const body = document.querySelector('.sidepanel-body');
        if (!body) return '';
        const c = body.cloneNode(true);
        c.querySelectorAll('.panel-keepalive').forEach(e => e.remove());
        return (c.textContent || '').slice(0, 160);
      })(),
    })`);
    panelResults.push({ ok, ...st });
    trace(`[8] 侧栏 ${label} = ` + JSON.stringify(st));
  }

  // ── 文件面板：点开 CSV，验证**表格预览**真的渲染出表格 ──
  const previewProbe = await win.webContents.executeJavaScript(
    `(async () => {
      // 切到文件面板
      const tab = [...document.querySelectorAll('.sidepanel-tab')].find(e => e.textContent.trim() === '文件');
      if (tab) tab.click();
      await new Promise(r => setTimeout(r, 700));
      // 找到 data.csv 那一行并点开
      const row = [...document.querySelectorAll('.file-row')].find(e => e.textContent.includes('data.csv'));
      if (!row) return { found: false };
      row.click();
      await new Promise(r => setTimeout(r, 900));
      const table = document.querySelector('.dt-table');
      return {
        found: true,
        hasTable: !!table,
        headers: table ? [...table.querySelectorAll('thead th')].map(e => e.textContent.trim()) : [],
        bodyRows: table ? table.querySelectorAll('tbody tr').length : 0,
        // 第一行数据（验证数值解析与单元格内容）
        firstRow: table ? [...(table.querySelector('tbody tr')?.querySelectorAll('td') || [])].map(e => e.textContent.trim()) : [],
        dimensions: (document.querySelector('.pv-head .muted')||{textContent:''}).textContent.trim(),
      };
    })()`,
  );
  trace('[8.5] 表格预览 = ' + JSON.stringify(previewProbe));

  // ── 版本面板：保存一个版本（走真实 git），验证条目出现 ──
  const versionProbe = await win.webContents.executeJavaScript(
    `(async () => {
      const tab = [...document.querySelectorAll('.sidepanel-tab')].find(e => e.textContent.trim() === '项目版本');
      if (!tab) return { found: false };
      tab.click();
      await new Promise(r => setTimeout(r, 900));
      const rows = document.querySelectorAll('.ver-row').length;
      const names = [...document.querySelectorAll('.ver-name')].map(e => e.textContent.trim());
      const badge = (document.querySelector('.ver-meta .badge')||{textContent:''}).textContent.trim();
      return { found: true, rows, names, firstKind: badge };
    })()`,
  );
  trace('[8.6] 版本面板 = ' + JSON.stringify(versionProbe));

  // ── 浏览器面板：用本地 HTTP 服务验证 <webview> **真的能加载页面** ──
  // 这是本轮风险最高的一段：webviewTag、安全加固、地址栏导航缺一不可。
  // 起一个 127.0.0.1 的临时服务，让 webview 指向它。
  const http = await import('node:http');
  const probeServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>探针页面 OK</title></head><body><h1 id="probe">webview 已加载</h1></body></html>');
  });
  await new Promise((r) => probeServer.listen(0, '127.0.0.1', r));
  const probePort = probeServer.address().port;
  trace('[8.7] 探针服务端口 = ' + probePort);

  const browserProbe = await win.webContents.executeJavaScript(
    `(async () => {
      const tab = [...document.querySelectorAll('.sidepanel-tab')].find(e => e.textContent.trim() === '浏览器');
      if (!tab) return { found: false };
      tab.click();
      await new Promise(r => setTimeout(r, 700));

      const input = document.querySelector('.br-bar input');
      if (!input) return { found: true, hasInput: false };

      // React 受控输入必须走原生 setter，直接改 .value 不会触发状态更新
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, ${JSON.stringify(`http://127.0.0.1:${probePort}/`)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 120));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // 轮询等 webview 加载完成
      let wvTitle = '';
      let wvUrl = '';
      let lastErr = '';
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        const wv = document.querySelector('.br-view webview');
        if (!wv) continue;
        try {
          wvUrl = wv.getURL();
          wvTitle = wv.getTitle();
        } catch (e) {
          lastErr = String(e && e.message || e).slice(0, 80);
        }
        if (wvTitle) break;
      }
      const tabTitle = (document.querySelector('.br-tab') || { textContent: '' }).textContent.replace('✕', '').trim();
      return {
        found: true, hasInput: true, wvUrl, wvTitle, tabTitle, lastErr,
        blankGone: !document.querySelector('.br-blank'),
        hasWv: !!document.querySelector('.br-view webview'),
      };
    })()`,
  );
  trace('[8.7] 浏览器面板 = ' + JSON.stringify(browserProbe));
  probeServer.close();

  // ── 截图 ──
  try {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, 'smoke.png'), img.toPNG());
    trace('[9] 截图已保存 smoke.png size=' + JSON.stringify(img.getSize()));
  } catch (e) {
    trace('[9] 截图失败: ' + (e && e.message));
  }

  const summary = {
    booted,
    report,
    pageResults,
    panelResults,
    previewProbe,
    versionProbe,
    browserProbe,
    railState,
    mdProbe,
    wizardProbe,
    tourProbe,
    errorCount: errors.length,
    errors: errors.slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(summary, null, 2), 'utf8');
  trace('[done] 控制台错误 ' + errors.length + ' 条');

  app.quit();
}).catch((err) => {
  trace('[E] ' + (err && err.stack ? err.stack : String(err)));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ fatal: String(err) }, null, 2));
  app.quit();
});
