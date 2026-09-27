/**
 * 网络代理与机器人 IPC（设置 → 网络 / 机器人）。
 *
 * 分工：
 *  - **代理设置**：真值在 `settings.proxy`（conf）。本文件额外负责
 *    「系统代理检测」——那必须调 Electron 的 `session.resolveProxy()`，
 *    渲染层拿不到。检测结果经 `rememberSystemProxy()` 缓存到 store/config，
 *    最终由 `main/agent/env.ts` 的 `buildChildEnv()` 注入子进程环境。
 *  - **机器人密钥**：只有状态可以出主进程；密钥本体永不回传渲染层。
 */
import { ipcMain, session } from 'electron';
import { IPC, type BotSecretStatus, type ProxyDetection, type ProxySettings } from '@shared/types';
import {
  clearBotSecret,
  getBotSecretStatus,
  getProxy,
  rememberSystemProxy,
  setBotSecret,
  setProxy,
} from '../store/config';
import { resolveEffectiveProxy } from '../agent/env';
import { safeWrap, type IpcContext } from './index';

/** 探测系统代理时用哪个 URL —— 应用约定描述里点名了 Anthropic 官方端点 */
const PROBE_URL = 'https://api.anthropic.com';

/**
 * 解析 Electron `resolveProxy()` 的返回串。
 *
 * 形态：`DIRECT` / `PROXY 127.0.0.1:7890` / `SOCKS5 127.0.0.1:1080`，
 * 多个候选用 `;` 分隔（形如 `PROXY a:1;DIRECT`，取第一个可用的）。
 * 返回的还是**没有协议前缀**的地址，交由 `resolveEffectiveProxy` 统一判定
 * （它会按应用约定语义把 socks 判为不支持）。
 */
function parseResolveProxy(raw: string): string | null {
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (!p || /^DIRECT$/i.test(p)) continue;
    const sp = p.indexOf(' ');
    const kind = (sp === -1 ? p : p.slice(0, sp)).toUpperCase();
    const addr = sp === -1 ? '' : p.slice(sp + 1).trim();
    if (!addr) continue;
    if (kind === 'PROXY' || kind === 'HTTP' || kind === 'HTTPS') return addr;
    if (kind.startsWith('SOCKS')) return `socks://${addr}`;
  }
  return null;
}

/**
 * 真实检测一次「当前生效」代理。
 *
 * 系统模式才会去问 Electron；手动模式直接用配置里的地址 ——
 * 但两种模式都走同一个 `resolveEffectiveProxy()`，保证界面上显示的就是
 * 子进程真正会用的那个地址（不会出现「显示有代理、实际直连」）。
 */
async function detectProxy(): Promise<ProxyDetection> {
  const cfg = getProxy();
  let raw: string | undefined;
  let systemUrl: string | null = null;
  let systemUnsupported = false;

  if (cfg.enabled && cfg.mode === 'system') {
    try {
      raw = await session.defaultSession.resolveProxy(PROBE_URL);
      const parsed = parseResolveProxy(raw);
      if (parsed && /^socks/i.test(parsed)) {
        systemUnsupported = true;
        systemUrl = null; // socks 不能注入子进程，缓存里也不留
      } else {
        systemUrl = parsed;
      }
    } catch {
      // 拿不到就按「未检测到系统代理」处理，不抛错
      raw = undefined;
      systemUrl = null;
    }
    rememberSystemProxy(systemUrl);
  }

  const eff = resolveEffectiveProxy(cfg, systemUrl);
  return {
    url: eff.url,
    source: eff.source,
    unsupported: eff.unsupported || systemUnsupported,
    raw,
  };
}

function botSecretsPayload(): { feishu: BotSecretStatus } {
  return { feishu: getBotSecretStatus() };
}

export function registerNetworkHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.NETWORK_GET_PROXY,
    safeWrap(() => getProxy(), '读取代理设置'),
  );

  ipcMain.handle(
    IPC.NETWORK_SET_PROXY,
    safeWrap((_e, cfg: ProxySettings) => {
      const next = setProxy(cfg);
      // 设置一变，「当前生效」可能马上不同（例如切到手动模式）→ 立刻重推给 env
      rememberSystemProxy(null);
      return next;
    }, '保存代理设置'),
  );

  ipcMain.handle(
    IPC.NETWORK_DETECT_PROXY,
    safeWrap(() => detectProxy(), '检测代理'),
  );

  ipcMain.handle(
    IPC.NETWORK_BOT_SECRET_STATUS,
    safeWrap(() => botSecretsPayload(), '读取机器人密钥状态'),
  );

  ipcMain.handle(
    IPC.NETWORK_SET_BOT_SECRET,
    safeWrap(
      (_e, kind: 'feishuAppSecret', secret: string) => ({
        feishu: setBotSecret(kind, secret),
      }),
      '保存机器人密钥',
    ),
  );

  ipcMain.handle(
    IPC.NETWORK_CLEAR_BOT_SECRET,
    safeWrap(
      (_e, kind: 'feishuAppSecret') => ({ feishu: clearBotSecret(kind) }),
      '清除机器人密钥',
    ),
  );
}
