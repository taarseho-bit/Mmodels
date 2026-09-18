/**
 * 主进程入口 —— 应用的起搏器。
 *
 * 启动顺序（顺序很重要，不要随意调整）：
 *   1. 单实例锁（避免两个进程抢同一个 SQLite 文件）
 *   2. app.whenReady()
 *   3. 初始化数据库（建表）
 *   4. 启动本地 HTTP 服务（随机端口 + token）
 *      —— 必须在窗口之前，因为 preload 要用这份信息注入渲染层
 *   5. 注册 IPC 处理器
 *   6. 创建主窗口
 *
 * ⚠️ 关于 `--mathmodel-server-port` / `--mathmodel-server-token`
 *    原版通过命令行参数把服务信息传给渲染层进程。
 *    我们这里改为：服务信息存在模块级变量里，preload 通过
 *    同步 IPC（`ipcRenderer.sendSync`）读取。原因：命令行参数在
 *    Windows 上容易被引号/编码问题坑到，且渲染层无法通过
 *    `process.argv` 拿到主进程的参数（Electron 只传自己的）。
 */
import { app, BrowserWindow, shell, nativeTheme, dialog, Menu } from 'electron';
import { join } from 'node:path';
import { LocalServer, type ServerInfo } from './server';
import { registerIpcHandlers } from './ipc';
import { mountRoutes } from './server/routes';
import { closeDb, initDb } from './db';
import { bootstrapDefaultProject } from './ipc/project';
import { warmupSkillsPlugin } from './agent/skills-plugin';
import { getSettings, syncProxyRuntime, updateSettings } from './store/config';
import { isRenderingScreenshots } from './runtime/guards';
import { registerMediaProtocol, registerMediaScheme } from './media/protocol';
import {
  configureDesktopPetWindow,
  syncDesktopPetWindow,
} from './windows/desktop-pet';

// ─────────────────────────────────────────────────────────────
// 全局单例
// ─────────────────────────────────────────────────────────────

const localServer = new LocalServer();
let mainWindow: BrowserWindow | null = null;

// 与原版并存：Windows 应用身份、通知和任务栏分组均使用独立品牌。
app.setName('MModels');
if (process.platform === 'win32') app.setAppUserModelId('com.mmodels.desktop');

/** 渲染层通过同步 IPC 读取，所以放在模块级 */
let serverInfo: ServerInfo | null = null;

const isDev = !app.isPackaged;
const DEBUG = process.env.MATHMODEL_DEBUG === '1' || isDev;

/**
 * ⚠️ 必须在这里（app ready 之前）声明 `mm-media` 协议特权，
 *    ready 之后再调 `registerSchemesAsPrivileged` 无效，音视频会静默播不出来。
 */
registerMediaScheme();

function log(...args: unknown[]): void {
  if (DEBUG) console.log('[main]', ...args);
}

// ─────────────────────────────────────────────────────────────
// 单实例锁
// ─────────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 第二个实例：把已有窗口拉到前台然后退出
  app.quit();
}

app.on('second-instance', () => {
  showMainApplicationWindow();
});

// ─────────────────────────────────────────────────────────────
// 窗口创建
// ─────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  // MModels 使用应用内顶栏，不显示 Electron 默认的 File/Edit/View/Window 菜单。
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    title: 'MModels',
    /**
     * ⚠️ 尺寸与原版实机**逐像素对齐**：原版网页视口实测 1266×804 CSS px
     *    （DPR 1.25，CDP `Runtime.evaluate innerWidth/innerHeight` 取证）。
     *    用 useContentSize 让内容区精确等于这个值，否则截图对比会因视口不同
     *    产生大量假差异（换行位置、列数、间距全部对不上）。
     */
    width: 1266,
    height: 804,
    useContentSize: true,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1a1a1a' : '#ffffff',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      /**
       * ⚠️ 必须是 .cjs，不能是 .js。
       * 本项目 package.json 有 `"type": "module"`，所有 .js 都会被当成 ES Module，
       * 而 Electron 的 preload 加载器走 require() → 抛 ERR_REQUIRE_ESM →
       * preload 静默不执行 → window.mathmodel undefined → 界面卡在启动画面。
       * 详见 electron.vite.config.ts 里 preload.output.entryFileNames 的注释。
       */
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      // 数学建模页面要嵌入 PDF 预览、本地图片，contextIsolation 必须开
      contextIsolation: true,
      nodeIntegration: false,
      // 渲染层要显示本地产物文件（图片/PDF），需要在 file:// 下访问
      webSecurity: true,
      /**
       * 内置浏览器面板（BrowserPanel）用 <webview> 承载外部网页。
       * ⚠️ 开启后必须配 `will-attach-webview` 加固（见下方），
       *    否则被嵌入的页面可能拿到 preload 或 node 能力。
       */
      webviewTag: true,
    },
  });
  win.setMenuBarVisibility(false);

  // ── <webview> 安全加固 ──────────────────────────────────────
  // 官方建议：无条件剥掉 preload、禁掉 node，并强制 http/https。
  // 我们的画布页面不需要向被嵌入的网页暴露任何本地能力。
  win.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    delete (webPreferences as { preload?: string }).preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    // 只允许 http/https，挡掉 file:// 与自定义协议
    if (!/^https?:\/\//i.test(params.src || '')) {
      log('blocked webview src: ' + params.src);
      params.src = 'about:blank';
    }
  });

  // 先渲染完再显示，避免白屏闪烁
  win.once('ready-to-show', () => {
    win.show();
    log('window shown');
  });

  // 外链一律走系统浏览器，不在应用内开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 阻止渲染层被导航到外部地址
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
    if (url.startsWith('http')) void shell.openExternal(url);
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

function showMainApplicationWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return mainWindow;
}

// ─────────────────────────────────────────────────────────────
// 启动流程
// ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  log('bootstrapping...');

  // ── 1. 数据库 ──
  try {
    const dbPath = initDb();
    log('db ready at', dbPath);
  } catch (err) {
    // 数据库起不来是致命问题，但要给用户看得懂的提示
    const message = err instanceof Error ? err.message : String(err);
    // 同样先落盘：模态框会阻塞事件循环（见下面本地服务那段的说明）
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(app.getPath('userData'), 'startup-error.log'),
        `[${new Date().toISOString()}] 数据库初始化失败\n${message}\n${err instanceof Error ? (err.stack ?? '') : ''}\n`,
        'utf8',
      );
    } catch {
      /* 日志写不出来也不能挡住后面的提示 */
    }
    dialog.showErrorBox(
      '数据库初始化失败',
      `无法初始化本地数据库：\n${message}\n\n` +
        `常见原因：磁盘空间不足、文件被占用或原生模块未正确编译。`,
    );
    app.quit();
    return;
  }

  // ── 1.5 默认项目 ──
  // 原版在启动时必定保证「有且有一个可用的默认项目」，否则
  // env:check / git:info / file:* 这些依赖项目根目录的通道全部不可用，
  // 界面首屏就是一堆「尚未打开任何项目」。
  // 失败**不阻断启动**：最多是首屏没有项目，用户可以自己建。
  try {
    const defaultId = bootstrapDefaultProject();
    if (defaultId && !getSettings().recentProjectId) {
      // 只在没有「最近项目」时兜底认领，避免覆盖用户上次的选择
      updateSettings({ recentProjectId: defaultId });
      log('默认项目已就绪：', defaultId);
    }
  } catch (err) {
    console.error('[projects] 默认项目初始化异常：', err);
  }

  // ── 2. 本地服务 ──
  try {
    serverInfo = await localServer.start({
      debug: DEBUG,
      registerRoutes: mountRoutes,
    });
    log('server ready on', serverInfo.baseUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // ⚠️ 先落盘再弹框。
    //    `dialog.showErrorBox` 是**模态**的 —— 在无人值守 / 自动化环境里
    //    它会把主进程的事件循环**永久阻塞**：应用看起来还活着（进程在），
    //    但窗口不出现、调试端口也不响应，排起来极其费劲。
    //    写一份日志文件，至少让错误能被看到。
    try {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(
        join(app.getPath('userData'), 'startup-error.log'),
        `[${new Date().toISOString()}] 本地服务启动失败\n${message}\n${err instanceof Error ? (err.stack ?? '') : ''}\n`,
        'utf8',
      );
      log('server start failed, wrote startup-error.log:', message);
    } catch {
      /* 日志写不出来也不能挡住后面的提示 */
    }
    dialog.showErrorBox(
      '本地服务启动失败',
      `无法启动本地 HTTP 服务：\n${message}\n\n` +
        `常见原因：端口被占用或防火墙拦截。`,
    );
    app.quit();
    return;
  }

  // ── 3. IPC ──
  registerIpcHandlers({
    getServerInfo: () => serverInfo,
    getMainWindow: () => mainWindow,
    debug: DEBUG,
  });
  log('ipc registered');

  configureDesktopPetWindow(showMainApplicationWindow);

  // ── 3.2 音视频流式协议（mm-media://file/<相对路径>）──
  registerMediaProtocol();
  log('media protocol registered');

  // ── 3.5 代理运行时同步 ──
  // 上一次运行留下的代理设置要在**第一个 Agent 会话之前**生效，
  // 否则用户重启后会发现「开关是开的但没走代理」。
  syncProxyRuntime();
  log('proxy runtime synced, enabled =', getSettings().proxy?.enabled ?? false);

  // ── 3.7 技能插件预热 ──
  // 物化 <userData>/skills-plugin 要先摘要再复制约 130MB 技能资源（首启约 1s），
  // 放在第一条消息里就是一次用户可感知的卡顿，所以启动时先异步做掉。
  // 故意不 await：不拖慢启动；预热失败也不影响会话（会话里会同步兜底重试一次）。
  void warmupSkillsPlugin().catch((err) => {
    log('skills plugin warmup failed:', err instanceof Error ? err.message : err);
  });

  // ── 4. 窗口 ──
  mainWindow = createMainWindow();
  syncDesktopPetWindow(getSettings().modelingPetEnabled !== false);
}

// ─────────────────────────────────────────────────────────────
// 生命周期
// ─────────────────────────────────────────────────────────────

app.whenReady().then(bootstrap).catch((err) => {
  dialog.showErrorBox('启动失败', String(err));
  app.quit();
});

app.on('activate', () => {
  // 桌面小模本身也是一个窗口，不能再用 getAllWindows() 判断主界面是否存在。
  showMainApplicationWindow();
});

app.on('window-all-closed', () => {
  // ⚠️ 截图渲染期间不能退 —— 截图用的是隐藏窗口，
  //    一旦退掉整个应用，正在跑的生成任务会被腰斩。
  if (isRenderingScreenshots()) {
    log('window-all-closed ignored (screenshot rendering in progress)');
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  log('shutting down...');
  try {
    await localServer.stop();
  } catch {
    /* ignore */
  }
  try {
    closeDb();
  } catch {
    /* ignore */
  }
});

// 未捕获异常不要让进程静默死掉
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
});

// ─────────────────────────────────────────────────────────────
// 导出给其他模块用
// ─────────────────────────────────────────────────────────────

export { localServer, serverInfo };
