/**
 * 反篡改运行时 —— 发布包防护的核心检测逻辑。
 *
 * ⚠️ 本模块会被 `scripts/harden.cjs` 单独用 esbuild 打成 CJS，
 *    再用 bytenode 编译为 V8 字节码（`out/main/_security.jsc`）。
 *    源码文本不随包分发 —— 这是「AI 辅助逆向」最难啃的形态：
 *    V8 字节码没有源码结构、无稳定训练语料，还原成本远高于混淆 JS。
 *
 * 设计原则（诚实定位）：
 *   - 客户端防护全部是「提高门槛」，不是绝对防御；
 *   - 绝对防线在服务端（AI 调用中转 + license 校验，见 plans/商业化方案）；
 *   - 这里做的是：让自动化的、低成本的篡改/调试尝试当场失败并留痕。
 *
 * 检测项：
 *   1. ELECTRON_RUN_AS_NODE / NODE_OPTIONS 注入（fuse 双保险之外的代码层兜底）
 *   2. 命令行调试参数（--inspect / --remote-debugging-port 等）
 *   3. app.asar 完整性（scripts/after-pack.cjs 写入的 integrity.meta）
 *   4. devtools 强制关闭（hardenWindow，由主窗口创建时调用）
 *
 * E2E 约定：MATHMODEL_E2E=1 只允许测试脚本带远程调试端口，
 *   不跳过环境注入、完整性校验或窗口加固；不存在关闭全部防护的环境变量。
 *
 * 约定：任何拦截都「先落盘 startup-error.log 再弹框」——
 *   dialog.showErrorBox 是模态的，会阻塞事件循环（与 main/index.ts 同一套纪律）。
 */

/** BrowserWindow 仅作类型使用（import type 不产生运行时代码，字节码里无 electron 顶层依赖） */
import type { BrowserWindow } from 'electron';
import { digestMatches, parseIntegrityMeta, type IntegrityMeta } from './integrity';
// 授权逻辑与反篡改逻辑一起进入 _security.jsc；业务 bundle 不携带可直接
// 搜索的授权闸门实现。开发态由调用方跳过，发布态由 session IPC 调用。
import { assertAiEntitlement } from './license-gate';

export { assertAiEntitlement };

/** 本模块最终输出为 CJS，require 是真实全局（esbuild 不改写标识符） */
declare const require: NodeRequire;

/** 惰性加载 electron —— 让本模块在纯 Node 单测环境下可安全导入 */
function loadElectron(): typeof import('electron') | null {
  try {
    const electron = require('electron');
    // 纯 Node 下 require('electron') 返回 exe 路径字符串而非 API
    if (!electron || typeof electron !== 'object' || typeof electron.app !== 'object') return null;
    return electron;
  } catch {
    return null;
  }
}

export interface AntiTamperOptions {
  /** app.isPackaged —— dev 下全部防护关闭 */
  isPackaged: boolean;
  /** app.getPath('userData') —— 拦截日志落盘位置 */
  userDataPath: string;
}

function isE2E(): boolean {
  return process.env.MATHMODEL_E2E === '1';
}

function writeStartupError(userDataPath: string, lines: string[]): void {
  try {
    // 延迟加载 fs/path —— 保持模块顶部无 Node 静态依赖之外的杂音
    const { appendFileSync, mkdirSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    mkdirSync(userDataPath, { recursive: true });
    appendFileSync(
      join(userDataPath, 'startup-error.log'),
      `[${new Date().toISOString()}] [anti-tamper] ${lines.join(' | ')}\n`,
      'utf8',
    );
  } catch {
    /* 日志写不出来也不能挡住拒绝逻辑 */
  }
}

/**
 * 拒绝启动：静默落盘取证后立即退出。
 * ⚠️ 不用 dialog.showErrorBox —— 它是模态的，会阻塞事件循环：
 *    process.exit 永远轮不到执行，进程表现为「卡住活着」（2026-09-27
 *    攻击面验证 T3 实测：弹窗挂着 10s 不退，防线形同虚设）。
 *    反篡改场景静默退出最专业：不给攻击者确认框，也不阻塞退出。
 */
function rejectStartup(userDataPath: string, lines: string[]): never {
  writeStartupError(userDataPath, lines);
  // eslint-disable-next-line n/no-process-exit -- 反篡改场景必须立即终止，跳过一切清理钩子
  process.exit(1);
}

/** 调试/注入参数特征 —— 命中即视为调试尝试 */
const DEBUG_ARG_RE = /^--(inspect|inspect-brk|inspect-port|remote-debugging-port|remote-debugging-pipe)(=?|$)/i;

/** 环境注入特征 */
function detectInjectedEnv(): string[] {
  const hits: string[] = [];
  if (process.env.ELECTRON_RUN_AS_NODE) hits.push(`ELECTRON_RUN_AS_NODE=${process.env.ELECTRON_RUN_AS_NODE}`);
  if (process.env.NODE_OPTIONS) hits.push(`NODE_OPTIONS=${process.env.NODE_OPTIONS}`);
  return hits;
}

function detectDebugArgv(): string | null {
  const hit = process.argv.find((a) => DEBUG_ARG_RE.test(a));
  return hit ?? null;
}

/**
 * Chromium switch 检测 —— ⚠️ 关键：--remote-debugging-port 等 Chromium 开关
 * 会被 Electron 从 process.argv 中剥离（Chromium command line 处理），
 * argv 检测抓不到它们，必须走 app.commandLine.hasSwitch()。
 * （2026-09-27 攻击面验证 T3 踩到：argv 检测形同虚设，CDP 参数照样活着。）
 */
function detectDebugSwitch(electron: typeof import('electron')): string | null {
  const switches = [
    'remote-debugging-port',
    'remote-debugging-pipe',
    'inspect',
    'inspect-brk',
    'inspect-port',
  ];
  try {
    for (const sw of switches) {
      if (electron.app.commandLine.hasSwitch(sw)) return `--${sw}`;
    }
  } catch {
    /* commandLine 不可用时退回 argv 检测结果 */
  }
  return null;
}

/**
 * asar 完整性校验：
 *   after-pack.cjs 在打包末期计算 app.asar 和关键外部资源的 sha256，
 *   写入 resources/integrity.meta。发布态缺少清单、清单格式错误、归档
 *   或关键资源不匹配，均立即拒绝启动；开发态不会调用本模块。
 */
function checkAsarIntegrity(userDataPath: string): void {
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const { readFileSync, existsSync, statSync } = require('node:fs') as typeof import('node:fs');
  const { join, resolve, sep } = require('node:path') as typeof import('node:path');
  const resourcesPath = process.resourcesPath;
  const metaPath = join(resourcesPath, 'integrity.meta');
  try {
    if (!existsSync(metaPath)) throw new Error('integrity.meta 缺失');
    const meta = parseIntegrityMeta(readFileSync(metaPath, 'utf8')) as IntegrityMeta;
    const asarPath = join(resourcesPath, 'app.asar');
    if (!existsSync(asarPath)) throw new Error('app.asar 缺失');
    // Electron 的 ASAR 补丁会把 app.asar 根路径当成虚拟目录；在
    // OnlyLoadAppFromAsar 开启时直接 readFileSync 可能得到 ENOENT。
    // 临时关闭虚拟路径映射，只读取物理归档文件，完成后立即恢复。
    const electronProcess = process as typeof process & { noAsar?: boolean };
    const previousNoAsar = electronProcess.noAsar;
    electronProcess.noAsar = true;
    let asarBytes: Buffer;
    try {
      asarBytes = readFileSync(asarPath);
    } finally {
      electronProcess.noAsar = previousNoAsar;
    }
    const actual = createHash('sha256').update(asarBytes).digest('hex');
    if (!digestMatches(meta.hash, actual)) {
      rejectStartup(userDataPath, ['asar integrity mismatch', `expected=${meta.hash}`, `actual=${actual}`]);
    }
    for (const file of meta.files) {
      const absolute = resolve(resourcesPath, file.path);
      const root = resolve(resourcesPath) + sep;
      if (!absolute.startsWith(root)) throw new Error(`资源路径越界：${file.path}`);
      if (!existsSync(absolute)) throw new Error(`关键资源缺失：${file.path}`);
      const stat = statSync(absolute);
      if (!stat.isFile() || stat.size !== file.size) throw new Error(`关键资源大小异常：${file.path}`);
      const actualFile = createHash('sha256').update(readFileSync(absolute)).digest('hex');
      if (!digestMatches(file.hash, actualFile)) throw new Error(`关键资源指纹不匹配：${file.path}`);
    }
  } catch (error) {
    rejectStartup(userDataPath, ['integrity verification failed', String(error)]);
  }
}

/**
 * 安装反篡改检测。必须在主进程最早期调用（单例锁之前），
 * 此时 dialog/app 可用（main 进程模块加载阶段 electron 已就绪）。
 */
export function installAntiTamper(opts: AntiTamperOptions): void {
  if (!opts.isPackaged) return; // dev：全部关闭

  const electron = loadElectron();
  if (!electron) return; // 非 Electron 环境（异常情况），不误伤

  // 1. 环境注入检测
  const injected = detectInjectedEnv();
  if (injected.length > 0) {
    rejectStartup(opts.userDataPath, ['injected env detected', ...injected]);
  }

  // 2. 命令行调试参数（argv + Chromium switch 双通道）
  const dbgArg = detectDebugArgv() ?? detectDebugSwitch(electron);
  const allowedForE2E = isE2E() && dbgArg?.startsWith('--remote-debugging-');
  if (dbgArg && !allowedForE2E) {
    rejectStartup(opts.userDataPath, ['debug argv detected', dbgArg]);
  }

  // 3. asar 完整性
  checkAsarIntegrity(opts.userDataPath);
}

/**
 * 窗口加固：主窗口创建后调用。
 * 打包态强制关闭 devtools（阻断 F12 / 手动打开的调试通道）。
 */
export function hardenWindow(win: BrowserWindow): void {
  if (!appIsPackaged()) return;
  try {
    win.webContents.on('devtools-opened', () => {
      win.webContents.closeDevTools();
    });
  } catch {
    /* 窗口已销毁等竞态，忽略 */
  }
}

function appIsPackaged(): boolean {
  const electron = loadElectron();
  if (!electron) return false;
  try {
    return electron.app.isPackaged === true;
  } catch {
    return false;
  }
}
