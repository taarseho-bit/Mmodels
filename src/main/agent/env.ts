/**
 * 执行环境准备：把 Claude Agent SDK 需要的环境变量组装好。
 *
 * 这一层是**复刻原版行为的关键**：
 * 原版的 `claudeExecutablePath` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` 三件套
 * 就是在这里被注入子进程的。
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ProviderConfig, ProxySettings } from '@shared/types';

/**
 * ESM 里没有 `require`。项目是 `"type": "module"`，
 * 直接写 `require('electron')` 会 ReferenceError —— 必须走 createRequire。
 *
 * ⚠️ 但 `import.meta.url` 在**被打成 CJS 时会是 undefined**
 * （esbuild 会把它替换成 undefined，不抛错，所以 try/catch 抓不到）。
 * 本文件要被验证脚本直接 import，那些脚本习惯打 CJS，故这里做兜底。
 */
const nodeRequire: NodeRequire = (() => {
  const u = (import.meta as { url?: string }).url;
  if (typeof u === 'string' && u.length > 0) return createRequire(u);
  // 兜底：以 cwd 为基准。不追求精确解析，能拿到 electron 即可。
  return createRequire(join(process.cwd(), '__resolver__.js'));
})();

/** 平台包目录名（按当前平台） */
export function platformPkgName(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'win32') return `@anthropic-ai/claude-agent-sdk-win32-${arch}`;
  if (process.platform === 'darwin') return `@anthropic-ai/claude-agent-sdk-darwin-${arch}`;
  return `@anthropic-ai/claude-agent-sdk-linux-${arch}`;
}

/** SDK 平台包里的两个候选文件名 */
const CLI_NAMES = ['claude.exe', 'cli.js'];

/** 从 `@anthropic-ai/claude-agent-sdk` 的安装位置推出平台包目录 */
function sdkPlatformDirs(): string[] {
  const dirs: string[] = [];
  try {
    const entry = nodeRequire.resolve('@anthropic-ai/claude-agent-sdk');
    // entry 形如 <...>/node_modules/@anthropic-ai/claude-agent-sdk/dist/index.js
    let dir = dirname(entry);
    for (let i = 0; i < 6; i++) {
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
      // pnpm 的 .pnpm/<name>/node_modules 与普通 node_modules 都在这层
      if (dir.endsWith('node_modules')) {
        dirs.push(join(dir, platformPkgName()));
        break;
      }
    }
  } catch {
    /* SDK 未安装或解析失败，走别的兜底 */
  }
  return dirs;
}

/**
 * pnpm 布局把平台包藏在 `.pnpm/@anthropic-ai+claude-agent-sdk-win32-x64@<ver>/`
 * 下，按 `node_modules/<pkg>` 是找不到的。这里扫一遍 `.pnpm`。
 */
function pnpmPlatformDirs(root: string): string[] {
  const out: string[] = [];
  const pnpmDir = join(root, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return out;
  const prefix = platformPkgName().replace('/', '+') + '@';
  try {
    for (const d of readdirSync(pnpmDir)) {
      if (!d.startsWith(prefix)) continue;
      out.push(join(pnpmDir, d, 'node_modules', platformPkgName()));
    }
  } catch {
    /* 读不到就跳过 */
  }
  return out;
}

/** 可能的项目根（开发期用） */
function candidateRoots(override?: string): string[] {
  const roots: string[] = [];
  if (override) roots.push(override);
  roots.push(process.cwd());
  try {
    // 不顶层 import electron：本模块要保持「纯 node 可加载」（验证脚本会直接跑）
    const electron = nodeRequire('electron') as { app?: { getAppPath?: () => string } };
    const p = electron?.app?.getAppPath?.();
    if (p) roots.push(p);
  } catch {
    /* 非 electron 环境 */
  }
  return [...new Set(roots)];
}

/**
 * 定位 claude 可执行文件。
 *
 * ⚠️ **打包后不能再用 `process.cwd()`** —— 运行时 cwd 是启动目录
 * （快捷方式可能指向任意位置），不是 app 根。
 * 优先取随包分发的 `resources/claude-code/claude.exe`（**与原版布局一致**），
 * 再退回 SDK 平台包。
 *
 * @param projectRootOverride 开发期可显式传入项目根（验证脚本用）
 */
export function resolveClaudeExecutable(projectRootOverride?: string): string | null {
  const cands: string[] = [];
  const roots = candidateRoots(projectRootOverride);

  // ── 1. 随包分发（打包后优先，也是原版的布局）──
  //    electron-builder 的 extraResources 配成 `to: .`，
  //    所以内容直接落在 process.resourcesPath 下。
  const rp = process.resourcesPath;
  if (rp) {
    for (const n of CLI_NAMES) cands.push(join(rp, 'claude-code', n));
  }

  // ── 2. 开发期：<项目根>/resources/claude-code/ ──
  for (const r of roots) {
    for (const n of CLI_NAMES) cands.push(join(r, 'resources', 'claude-code', n));
  }

  // ── 3. 兜底：SDK 平台包（npm 扁平 + pnpm 两种布局）──
  const dirs = [...sdkPlatformDirs()];
  for (const r of roots) dirs.push(...pnpmPlatformDirs(r));
  for (const r of roots) dirs.push(join(r, 'node_modules', platformPkgName()));
  for (const d of dirs) {
    for (const n of CLI_NAMES) cands.push(join(d, n));
  }

  for (const c of cands) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

/**
 * 归一化 baseUrl。
 *
 * ⚠️ 不要写「不是 v1 就补 v1」这种逻辑 —— 各家端点形态不同：
 *   智谱   → /api/paas/v4
 *   Gemini → /v1beta/openai
 *   本地   → /v1
 * 只做去尾部斜杠。
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}

export interface EnvOverrides {
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  ANTHROPIC_MODEL?: string;
  HTTP_PROXY?: string;
  HTTPS_PROXY?: string;
  http_proxy?: string;
  https_proxy?: string;
  NO_PROXY?: string;
  no_proxy?: string;
}

/**
 * 把 ProviderConfig 翻译成子进程环境变量。
 *
 * - Anthropic 协议：设 baseUrl + 密钥。authMode='authToken' 用 AUTH_TOKEN 头，
 *   否则用 API_KEY。官方直连不设 baseUrl（用 SDK 默认）。
 * - OpenAI 协议：不能直接给 claude 用，必须经协议转换桥。
 *   本函数只负责给出桥的地址，转换由 bridge 模块完成。
 */
export function buildProviderEnv(
  provider: ProviderConfig,
  model: string,
  bridgeBaseUrl?: string,
): EnvOverrides {
  const env: EnvOverrides = {};

  if (provider.apiFormat === 'anthropic') {
    const base = normalizeBaseUrl(provider.baseUrl);
    // 官方端点交给 SDK 默认处理，避免把 api.anthropic.com 硬写进去
    if (base && !base.includes('api.anthropic.com')) {
      env.ANTHROPIC_BASE_URL = base;
    }
    if (provider.anthropicAuthMode === 'authToken') {
      env.ANTHROPIC_AUTH_TOKEN = provider.apiKey;
    } else {
      env.ANTHROPIC_API_KEY = provider.apiKey;
    }
  } else {
    // OpenAI 协议 → 指向本地协议桥
    if (bridgeBaseUrl) env.ANTHROPIC_BASE_URL = bridgeBaseUrl;
    // Claude Code 用 API_KEY 是否存在来判断“已登录”。AUTH_TOKEN 在新版 CLI
    // 会被当作 OAuth 登录态，任意 bridge token 会触发 /login 提示。
    // 本地桥不校验上游密钥；真实密钥只保存在桥服务配置里。
    env.ANTHROPIC_API_KEY = 'mathmodel-local-bridge';
  }

  if (model) env.ANTHROPIC_MODEL = model;
  return env;
}

/**
 * 构造子进程完整环境。
 *
 * 三个必须做的清理：
 *  1. 删掉 ELECTRON_RUN_AS_NODE —— 否则 electron 退化成普通 node，子进程行为异常
 *  2. 删掉可能继承来的 ANTHROPIC_* —— 避免宿主的配置污染我们的会话
 *  3. 删掉继承来的 *_proxy —— 代理完全由「设置 → 网络」决定（见 buildProxyEnv），
 *     否则宿主的代理会绕过界面上那个开关
 */
export function buildChildEnv(overrides: EnvOverrides): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  for (const k of [
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
  ]) {
    delete env[k];
  }

  // 宿主继承来的代理一律清掉，由下面的 runtime 缓存重新决定
  for (const k of PROXY_ENV_KEYS) delete env[k];

  return { ...env, ...buildProxyEnv(), ...overrides };
}

// ─────────────────────────────────────────────────────────────
// 网络代理（设置 → 网络）
//
// 为什么放在这个文件：**这里是子进程环境的唯一出口**。
// Agent 会话本身（claude 子进程）和它在 Bash 里跑的 git/curl 都继承这份 env，
// 所以把 HTTP_PROXY/HTTPS_PROXY/NO_PROXY 写在这里，就等于按原版承诺
// 「Agent 会话以及 Agent 在 Bash 中运行的命令都会通过此代理访问网络」。
//
// 数据流：
//   renderer「设置 → 网络」→ IPC network:set-proxy → store/config.ts 落 conf
//     → setProxyRuntime()（本文件）→ buildChildEnv() 注入
//   系统代理地址由 IPC network:detect-proxy 调 Electron session.resolveProxy 得到，
//   同样经 setProxyRuntime() 缓存（渲染层只把它显示在「当前生效」那一行）。
// ─────────────────────────────────────────────────────────────

/** 会被我们接管的代理环境变量（大小写两套：git/curl 读大写，部分库读小写） */
const PROXY_ENV_KEYS = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
];

/** 代理一律绕过的本机地址 —— 本地协议桥/本地服务绝不能被代理掉 */
const LOCAL_NO_PROXY = 'localhost,127.0.0.1,::1,0.0.0.0';

let proxyRuntime: ProxySettings | null = null;
let systemProxyUrl: string | null = null;

/**
 * 更新代理运行时缓存。主进程在**启动时**和**每次设置/检测变更后**调用。
 * 不 import electron、不 import store —— 本模块要保持「纯 node 可加载」
 * （验证脚本会直接 import 它），所以配置由调用方推进来。
 */
export function setProxyRuntime(cfg: ProxySettings | null, detectedSystemUrl: string | null = null): void {
  proxyRuntime = cfg ?? null;
  systemProxyUrl = detectedSystemUrl;
}

/** 当前缓存的代理设置（IPC 层读它来做检测口径统一） */
export function getProxyRuntime(): ProxySettings | null {
  return proxyRuntime;
}

function withHttpScheme(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `http://${u}`;
}

/**
 * 把「代理设置 + 系统检测结果」翻译成**当前生效**的代理地址。
 *
 * 原版语义：子进程只支持 HTTP 代理，SOCKS 地址会被忽略
 * （`settings.proxySection.socksUnsupported`），所以 socks 一律判为 unsupported。
 */
export function resolveEffectiveProxy(
  cfg: ProxySettings | null | undefined,
  detectedSystemUrl: string | null,
): { url: string | null; source: 'manual' | 'system' | 'none'; unsupported: boolean } {
  if (!cfg || !cfg.enabled) return { url: null, source: 'none', unsupported: false };

  if (cfg.mode === 'manual') {
    const raw = cfg.manualUrl.trim();
    if (!raw) return { url: null, source: 'none', unsupported: false };
    if (/^socks/i.test(raw)) return { url: null, source: 'manual', unsupported: true };
    return { url: withHttpScheme(raw), source: 'manual', unsupported: false };
  }

  if (!detectedSystemUrl) return { url: null, source: 'none', unsupported: false };
  if (/^socks/i.test(detectedSystemUrl)) {
    return { url: null, source: 'system', unsupported: true };
  }
  return { url: withHttpScheme(detectedSystemUrl), source: 'system', unsupported: false };
}

/**
 * 由运行时缓存算出要注入的环境变量。
 * 没有可用代理时返回 `NO_PROXY='*'` 之外的**空对象**（即直连），
 * 而不是留下半套变量 —— 半套变量会让 curl 走一个不存在的代理。
 */
export function buildProxyEnv(): EnvOverrides {
  const eff = resolveEffectiveProxy(proxyRuntime, systemProxyUrl);
  if (!eff.url) return {};

  const env: EnvOverrides = {
    HTTP_PROXY: eff.url,
    HTTPS_PROXY: eff.url,
    http_proxy: eff.url,
    https_proxy: eff.url,
    NO_PROXY: LOCAL_NO_PROXY,
    no_proxy: LOCAL_NO_PROXY,
  };
  return env;
}
