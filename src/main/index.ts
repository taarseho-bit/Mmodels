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
 *    应用约定通过命令行参数把服务信息传给渲染层进程。
 *    我们这里改为：服务信息存在模块级变量里，preload 通过
 *    同步 IPC（`ipcRenderer.sendSync`）读取。原因：命令行参数在
 *    Windows 上容易被引号/编码问题坑到，且渲染层无法通过
 *    `process.argv` 拿到主进程的参数（Electron 只传自己的）。
 */
import { app, BrowserWindow, shell, nativeTheme, dialog, Menu } from 'electron';
import { join } from 'node:path';
import { appendFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// ⚠️ bytenode 副作用 import：注册 .jsc（V8 字节码）加载钩子。
//    必须先于安全模块 .jsc 的 require —— 加固产物（_security.jsc）依赖它。
//    preload 保持 CJS 加载器以兼容 Electron/DevTools，但代码已强混淆。
//    dev 模式下同样安全（纯注册无副作用）。
import 'bytenode';
import { LocalServer, type ServerInfo } from './server';
import { pushToRenderer, registerIpcHandlers, shutdownIpcRuntimes } from './ipc';
import { IPC } from '@shared/types';
import { mountRoutes } from './server/routes';
import { closeDb, initDb, isDbOpen } from './db';
import { bootstrapDefaultProject } from './ipc/project';
import { warmupSkillsPlugin } from './agent/skills-plugin';
import { getSettings, syncProxyRuntime, updateSettings } from './store/config';
import { isRenderingScreenshots, markQuitting } from './runtime/guards';
import { configureSharedEnvironment } from './runtime/shared-environment';
import { registerMediaProtocol, registerMediaScheme } from './media/protocol';
import {
  configureDesktopPetWindow,
  syncDesktopPetWindow,
} from './windows/desktop-pet';
import { createAppTray, destroyAppTray } from './windows/tray';

// ─────────────────────────────────────────────────────────────
// 全局单例
// ─────────────────────────────────────────────────────────────

const localServer = new LocalServer();
let mainWindow: BrowserWindow | null = null;
let quittingCompletely = false;

// 与应用约定并存：Windows 应用身份、通知和任务栏分组均使用独立品牌。
app.setName('MModels');
if (process.platform === 'win32') app.setAppUserModelId('com.mmodels.desktop');

/**
 * userData 覆盖开关（自动化测试 / 多实例隔离用）。
 *
 * ⚠️ 单实例锁按 userData 路径算：setName('MModels') 之后，dev 实例与
 *    安装版/便携版共享同一个 userData（%APPDATA%/MModels）—— 用户开着
 *    正式版时跑任何 dev/测试实例都会抢锁失败、静默退出（2026-09-27
 *    加固验证时踩到：electron.exe . 秒退且零输出，就是撞上便携版）。
 *    测试脚本设置 MATHMODEL_USERDATA 指向独立目录即可并存。
 *    普通用户不设此变量，行为不变。
 */
if (process.env.MATHMODEL_USERDATA) {
  app.setPath('userData', process.env.MATHMODEL_USERDATA);
}

/** 渲染层通过同步 IPC 读取，所以放在模块级 */
let serverInfo: ServerInfo | null = null;

const isDev = !app.isPackaged;
const DEBUG = process.env.MATHMODEL_DEBUG === '1' || isDev;

/**
 * 反篡改检测（最早期执行 —— 单例锁之前）。
 * _security.jsc 是 src/main/security/anti-tamper.ts 的 V8 字节码产物
 * （scripts/harden.cjs 生成）。源码文本不随包分发，防「删检测代码」式篡改。
 *
 * - dev（未打包）：跳过（字节码产物不存在属正常）。
 * - 打包态但字节码缺失：包体被破坏，拒绝启动并立即退出。
 */
if (!isDev) {
  type SecurityModule = {
    installAntiTamper(opts: { isPackaged: boolean; userDataPath: string }): void;
  };
  try {
    const nodeRequire = createRequire(import.meta.url);
    (nodeRequire('./_security.jsc') as SecurityModule).installAntiTamper({
      isPackaged: true,
      userDataPath: app.getPath('userData'),
    });
  } catch (err) {
    try {
      writeFileSync(
        join(app.getPath('userData'), 'startup-error.log'),
        `[${new Date().toISOString()}] _security.jsc 加载失败（包体可能被破坏）\n${String(err)}\n`,
        'utf8',
      );
    } catch {
      /* 日志写不出也必须拦住 */
    }
    // 反篡改失败不能继续跑后续 bootstrap；也不弹模态框，避免进程
    // 留在“看起来还活着”的状态。诊断信息已经写入 startup-error.log。
    process.exit(1);
  }
}

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

/**
 * 单实例锁 —— ⚠️ `app.quit()` 是「排队退出」而不是「当场退出」：
 * 事件循环还在转，`whenReady` 照样 resolve。所以**拿不到锁时必须把
 * 整条启动链（whenReady → bootstrap）拦在 else 里**，否则第二个实例会
 * 带伤跑完 bootstrap 的前半程：initDb 刚把数据库打开，quit 在某个
 * await 间隙生效 → before-quit 里 `closeDb()` 把模块级 db 置回 null →
 * bootstrap 后半段任何一次 `getDb()` 都抛「数据库尚未初始化」→
 * 用户看到莫名其妙的「启动失败」框。
 *
 * 运行测试触发（2026-09-20 便携版）：上一个实例还在托盘/后台活着时再启动
 * 一个（安装版与便携版共用同一个 userData，锁是按 userData 算的），
 * 新实例就炸在这个窗口期。修复后：抢锁失败的实例安静退出，已有窗口
 * 由旧实例的 `second-instance` 监听拉到前台。
 */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // 第二个实例：退出（窗口前置由**已运行的**那个实例的 second-instance 处理）
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainApplicationWindow();
  });

  app.whenReady().then(bootstrap).catch((err) => {
    // ⚠️ 先落盘再弹框 —— `dialog.showErrorBox` 是**模态**的，会阻塞事件循环
    //    （与 bootstrap 里数据库/本地服务两处专属 catch 同一套约定）。
    //    「启动失败」这条路径此前**不落盘**，排障只能靠用户截图。
    try {
      appendFileSync(
        join(app.getPath('userData'), 'startup-error.log'),
        `[${new Date().toISOString()}] bootstrap 失败\n${String(err)}\n${err instanceof Error && err.stack ? err.stack : ''}\n`,
        'utf8',
      );
    } catch {
      /* 日志写不出来也不能挡住后面的提示 */
    }
    dialog.showErrorBox('启动失败', String(err));
    app.quit();
  });
}

// ─────────────────────────────────────────────────────────────
// 窗口创建
// ─────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  // MModels 使用应用内顶栏，不显示 Electron 默认的 File/Edit/View/Window 菜单。
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    title: 'MModels',
    /**
     * ⚠️ 尺寸与界面检查**逐像素对齐**：应用约定网页视口实测 1266×804 CSS px
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

  // ── 反篡改：打包态强制关闭 devtools（详见 src/main/security/anti-tamper.ts）──
  if (!isDev) {
    type SecurityModule = { hardenWindow(win: BrowserWindow): void };
    try {
      const nodeRequire = createRequire(import.meta.url);
      (nodeRequire('./_security.jsc') as SecurityModule).hardenWindow(win);
    } catch {
      /* security 模块缺失已在上方 installAntiTamper 拦截，此处不再重复退出 */
    }
  }

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
  const allowRendererNavigation = (url: string): boolean => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl && url.startsWith(devUrl)) return true;
    return url.startsWith('file://') || url.startsWith('mm-media://');
  };
  const blockExternalNavigation = (event: Electron.Event, url: string): void => {
    if (allowRendererNavigation(url)) return;
    event.preventDefault();
    if (url.startsWith('http')) void shell.openExternal(url);
  };
  win.webContents.on('will-navigate', (event, url) => blockExternalNavigation(event, url));
  // 重定向不会总是触发 will-navigate；补上这一层，避免外部页面通过 30x 绕过边界。
  win.webContents.on('will-redirect', (event, url) => blockExternalNavigation(event, url));

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    mainWindow = null;
  });

  // 右上角 X 只收进系统托盘；真正退出统一走托盘里的“完全退出”。
  win.on('close', (event) => {
    if (quittingCompletely) return;
    event.preventDefault();
    win.hide();
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

function hideMainApplicationWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
}

function setDesktopPetEnabled(enabled: boolean): void {
  const next = updateSettings({ modelingPetEnabled: enabled });
  syncDesktopPetWindow(enabled);
  pushToRenderer(IPC.SETTINGS_CHANGED, next);
}

function quitApplicationCompletely(): void {
  if (quittingCompletely) return;
  quittingCompletely = true;
  markQuitting();
  shutdownIpcRuntimes();
  syncDesktopPetWindow(false);
  destroyAppTray();
  app.quit();
}

// ─────────────────────────────────────────────────────────────
// 启动流程
// ─────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  configureSharedEnvironment(app.getPath('userData'));
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
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
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
  // 应用约定在启动时必定保证「有且有一个可用的默认项目」，否则
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
      const { appendFileSync } = await import('node:fs');
      appendFileSync(
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

  // localServer.start() 是启动流程唯一的 await 间隙。若系统退出、第二实例
  // 或其他生命周期事件在这里触发 before-quit，closeDb() 会把句柄置空；
  // 继续注册 workflow IPC 就会把“退出中的应用”误报为数据库启动失败。
  if (quittingCompletely || !isDbOpen()) {
    log('bootstrap cancelled while the application was closing');
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
  createAppTray({
    showMain: () => { showMainApplicationWindow(); },
    hideMain: hideMainApplicationWindow,
    isMainVisible: () => !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    togglePet: setDesktopPetEnabled,
    isPetEnabled: () => getSettings().modelingPetEnabled !== false,
    quitCompletely: quitApplicationCompletely,
  });
}

// ─────────────────────────────────────────────────────────────
// 生命周期
// ─────────────────────────────────────────────────────────────

// whenReady → bootstrap 已移入上方单实例锁的 else 分支：
// 抢锁失败的实例不得继续初始化（详见该处的长注释）。

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
  // 首个主窗口创建前不应因系统生命周期事件结束 bootstrap；否则
  // before-quit 会关闭数据库，随后 registerWorkflowHandlers() 触发误报。
  if (!mainWindow && !quittingCompletely) {
    log('window-all-closed ignored during startup');
    return;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  quittingCompletely = true;
  markQuitting();
  shutdownIpcRuntimes();
  destroyAppTray();
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
