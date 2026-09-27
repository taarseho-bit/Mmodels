/**
 * 配置存储层。
 *
 * 分两层：
 *   1. AppSettings / ProviderConfig → `conf`（JSON，存 userData）
 *      —— 这些是**机器级**配置，不应该跟着项目目录走
 *   2. 项目与会话 → SQLite（drizzle）
 *      —— 这些会增长、需要查询，用数据库
 *
 * ⚠️ 密钥处理：
 *   项目契约用 Electron `safeStorage` 加密。
 *   我们这里先做**明文存储 + 明确告知**，因为：
 *     - safeStorage 在 Linux 上可能退化为明文（取决于 keyring）
 *     - 加密后密钥无法被用户手动迁移/备份，反而更痛
 *   `safeStorage.isEncryptionAvailable()` 为真时才加密，并打标记录。
 */
import { app, safeStorage } from 'electron';
import Conf from 'conf';
import type {
  AppSettings,
  BotSecretStatus,
  BotSettings,
  ProviderConfig,
  ProxySettings,
} from '@shared/types';
import { setProxyRuntime } from '../agent/env';

/** 设置 → 网络：默认与界面样例一致（开关开、来源=系统代理） */
export const DEFAULT_PROXY: ProxySettings = { enabled: true, mode: 'system', manualUrl: '' };

/** 设置 → 机器人：默认全关、无凭据 */
export const DEFAULT_BOTS: BotSettings = {
  feishu: { enabled: false, appId: '' },
  wechat: { enabled: false },
};

const DEFAULT_SETTINGS: AppSettings = {
  activeProviderId: null,
  defaultModel: null,
  builtinMcpEnabled: true,
  effort: null,
  disableThinking: false,
  fastMode: false,
  locale: 'zh-CN',
  recentProjectId: null,
  onboardingDone: false,
  permissionMode: 'full',
  planMode: false,
  multiAgentEnabled: true,
  modelingQualityMode: 'balanced',
  skillAutoSelect: true,
  maxParallelAgents: 2,
  maxTotalAgents: 4,
  modelingPetEnabled: true,
  // ⚠️ 必须是 'paper'，与项目契约一致。
  //    项目契约的 zod schema 与运行时兜底都是 "paper"。
  //    只有 paper 模式才显示「比赛模板 + 比赛信息」、并把占位文字换成
  //    「粘贴题目，或拖入题目 PDF / 附件…」。写成 'chat' 会让首屏
  //    看不到任何比赛相关内容 —— 用户会以为整个功能没做。
  composerMode: 'paper',
  // 决策模式默认「精细人工」：关键决策弹窗征求用户（与旧行为最接近的初始值）
  decisionMode: 'manual',
  paperTemplateId: null,
  paperProfiles: [],
  paperDefaultProfileId: null,
  // 项目契约：新论文默认**不**自动带入队伍档案，需要显式打开
  paperProfileEnabled: false,
  // 项目契约：初始化论文项目配置默认开启
  paperInitProjectConfig: true,
  tourDone: false,
  // 项目契约：任务完成通知默认**开启**。依据是当前渲染层的判据
  //   `function YI(t){return t.getQueryData(["settings"])?.notifications??!0}`
  //   —— `??!0` 即"未设置 = 开"。消费方在 src/main/notify.ts（唯一门禁）。
  notifyEnabled: true,
  proxy: DEFAULT_PROXY,
  bots: DEFAULT_BOTS,
};

interface StoreShape {
  settings: AppSettings;
  providers: ProviderConfig[];
  /** 被用户禁用的技能目录名 */
  disabledSkills: string[];
  /** 被用户显式启用的技能目录名（用于压过技能自带的 .disabled-by-default） */
  enabledSkills: string[];
  /**
   * 机器人密钥（飞书 App Secret）。
   * 单独一层、**不进 AppSettings** —— AppSettings 会整份回传渲染层，
   * 密钥不该跟着走。这里只经 `network:bot-secret-status` 暴露「配没配」。
   */
  botSecrets: Record<string, string>;
  /** MCP 连接器密钥单独保存，键为连接器名，值为环境变量映射。 */
  mcpSecrets: Record<string, Record<string, string>>;
}

const store = new Conf<StoreShape>({
  projectName: 'mmodels-desktop',
  cwd: app.getPath('userData'),
  defaults: {
    settings: DEFAULT_SETTINGS,
    providers: [],
    disabledSkills: [],
    enabledSkills: [],
    botSecrets: {},
    mcpSecrets: {},
  },
});

// ─────────────────────────────────────────────────────────────
// 密钥加解密（能力可用时才启用）
// ─────────────────────────────────────────────────────────────

function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

const ENC_PREFIX = 'enc:v1:';

function encryptSecret(plain: string): string {
  if (!plain) return '';
  if (!canEncrypt()) return plain;
  try {
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

function decryptSecret(stored: string): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    const buf = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    return safeStorage.decryptString(buf);
  } catch {
    // 解密失败（换了机器/用户）→ 返回空串，让用户重填，而不是抛错
    return '';
  }
}

// ─────────────────────────────────────────────────────────────
// 设置
// ─────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const settings = { ...DEFAULT_SETTINGS, ...store.get('settings') };
  // 渲染层只需要知道哪些字段已经配置，不应收到真实令牌。
  if (settings.mcpServers) {
    const secretStore = { ...(store.get('mcpSecrets') ?? {}) };
    let migrated = false;
    const clean = settings.mcpServers.map(server => {
      const existing = { ...(secretStore[server.name] ?? {}) };
      for (const [key, value] of Object.entries(server.env ?? {})) {
        if (value) { existing[key] = encryptSecret(value); migrated = true; }
      }
      if (Object.keys(existing).length) secretStore[server.name] = existing;
      return { ...server, env: Object.fromEntries(Object.keys(server.env ?? {}).map(key => [key, ''])) };
    });
    if (migrated) {
      store.set('mcpSecrets', secretStore);
      store.set('settings', { ...settings, mcpServers: clean });
    }
    settings.mcpServers = clean;
  }
  return settings;
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  const stored = { ...DEFAULT_SETTINGS, ...store.get('settings') };
  // 历史版本把 MCP 密钥写在 settings.mcpServers.env 中：写入新配置时迁移到
  // safeStorage 层，并且不再把真实值写入普通设置 JSON。
  if (patch.mcpServers) {
    const secretStore = { ...(store.get('mcpSecrets') ?? {}) };
    const sanitized = patch.mcpServers.map(server => {
      const env = server.env ?? {};
      const existing = { ...(secretStore[server.name] ?? {}) };
      for (const [key, value] of Object.entries(env)) {
        if (value) existing[key] = encryptSecret(value);
      }
      if (Object.keys(existing).length) secretStore[server.name] = existing;
      return { ...server, env: Object.fromEntries(Object.keys(env).map(key => [key, ''])) };
    });
    for (const key of Object.keys(secretStore)) {
      if (!sanitized.some(server => server.name === key)) delete secretStore[key];
    }
    store.set('mcpSecrets', secretStore);
    patch = { ...patch, mcpServers: sanitized };
  }
  const next = { ...stored, ...patch };
  store.set('settings', next);
  // 代理变更要立刻同步给 Agent 子进程环境（env.ts 的运行时缓存）
  if (patch.proxy) setProxyRuntime(next.proxy ?? DEFAULT_PROXY, detectedSystemProxy());
  return next;
}

/** 主进程运行 Agent 时读取带解密凭据的连接器配置。绝不通过 preload 暴露。 */
export function getRuntimeMcpServers(): NonNullable<AppSettings['mcpServers']> {
  const stored = { ...DEFAULT_SETTINGS, ...store.get('settings') };
  const secretStore = store.get('mcpSecrets') ?? {};
  return (stored.mcpServers ?? []).map(server => {
    const secrets = secretStore[server.name] ?? {};
    const env = { ...(server.env ?? {}) };
    for (const [key, value] of Object.entries(secrets)) {
      const plain = decryptSecret(value);
      if (plain) env[key] = plain;
    }
    return { ...server, env };
  });
}

// ─────────────────────────────────────────────────────────────
// 网络代理
// ─────────────────────────────────────────────────────────────

/**
 * 系统代理检测结果的进程内缓存。
 * 由 IPC `network:detect-proxy` 通过 `rememberSystemProxy()` 写入；
 * 这里不直接调 Electron —— config.ts 被多个模块 import，保持无副作用依赖。
 */
let systemProxyCache: string | null = null;

export function rememberSystemProxy(url: string | null): void {
  systemProxyCache = url;
  // 检测结果变了，「当前生效」也要跟着变 → 重推给 env.ts
  setProxyRuntime(getSettings().proxy ?? DEFAULT_PROXY, url);
}

export function detectedSystemProxy(): string | null {
  return systemProxyCache;
}

export function getProxy(): ProxySettings {
  return getSettings().proxy ?? DEFAULT_PROXY;
}

export function setProxy(cfg: ProxySettings): ProxySettings {
  const next = { ...DEFAULT_PROXY, ...cfg };
  updateSettings({ proxy: next });
  return next;
}

/**
 * 把当前设置推给 Agent 子进程环境。主进程启动时调一次 —— 否则重启后
 * 代理设置要等用户再动一次开关才生效。
 */
export function syncProxyRuntime(): void {
  setProxyRuntime(getProxy(), systemProxyCache);
}

// ─────────────────────────────────────────────────────────────
// 机器人密钥（safeStorage 加密，不进 AppSettings）
// ─────────────────────────────────────────────────────────────

/** 密钥种类 → conf 里的键 */
export type BotSecretKind = 'feishuAppSecret';

function botSecretStatus(kind: BotSecretKind): BotSecretStatus {
  const stored = store.get('botSecrets')[kind] ?? '';
  return {
    configured: stored !== '',
    // 明文回退时 storage 里没有 enc:v1: 前缀
    encrypted: stored.startsWith(ENC_PREFIX),
    available: canEncrypt(),
  };
}

export function getBotSecretStatus(): BotSecretStatus {
  return botSecretStatus('feishuAppSecret');
}

export function setBotSecret(kind: BotSecretKind, plain: string): BotSecretStatus {
  const all = { ...store.get('botSecrets') };
  // 空串 = 用户没改（项目契约占位「已配置，留空则保留当前密钥」）
  if (plain === '') return botSecretStatus(kind);
  all[kind] = encryptSecret(plain);
  store.set('botSecrets', all);
  return botSecretStatus(kind);
}

export function clearBotSecret(kind: BotSecretKind): BotSecretStatus {
  const all = { ...store.get('botSecrets') };
  delete all[kind];
  store.set('botSecrets', all);
  return botSecretStatus(kind);
}

// ─────────────────────────────────────────────────────────────
// 供应商
// ─────────────────────────────────────────────────────────────

/** 对外的形态：密钥已解密 */
export function listProviders(): ProviderConfig[] {
  return store.get('providers').map((p) => ({ ...p, apiKey: decryptSecret(p.apiKey) }));
}

/** 落库前加密 */
export function upsertProvider(input: ProviderConfig): ProviderConfig[] {
  if (input.contextWindows && Object.values(input.contextWindows).some(n => !Number.isInteger(n) || n < 128_000 || n > 1_000_000)) {
    throw new Error('模型上下文容量请设置在 128K 到 1M 之间，或选择自动识别');
  }
  const all = store.get('providers');
  const stored: ProviderConfig = { ...input, apiKey: encryptSecret(input.apiKey) };
  const idx = all.findIndex((p) => p.id === input.id);
  if (idx >= 0) all[idx] = stored;
  else all.push(stored);
  store.set('providers', all);
  return listProviders();
}

export function deleteProvider(id: string): ProviderConfig[] {
  store.set(
    'providers',
    store.get('providers').filter((p) => p.id !== id),
  );
  // 如果删的是当前激活的，清空激活项
  if (getSettings().activeProviderId === id) {
    updateSettings({ activeProviderId: null, defaultModel: null });
  }
  return listProviders();
}

export function findProvider(id: string): ProviderConfig | null {
  const p = listProviders().find((x) => x.id === id);
  return p ?? null;
}

export function activeProvider(): ProviderConfig | null {
  const id = getSettings().activeProviderId;
  return id ? findProvider(id) : null;
}

// ─────────────────────────────────────────────────────────────
// 技能开关
// ─────────────────────────────────────────────────────────────

export function disabledSkillDirs(): Set<string> {
  return new Set(store.get('disabledSkills'));
}

/**
 * 被用户**显式打开**的技能目录名。
 *
 * 为什么需要这张名单：内置技能里有 `.disabled-by-default` 的（如 data-search），
 * 它们的「默认关」来自技能目录本身，不是用户的选择。只记「禁用名单」的话，
 * 用户把开关点开会毫无效果（不在禁用名单里 ≠ 启用，标记者依然算关）。
 * 所以显式打开要单独记一笔，由它压过 `.disabled-by-default`。
 */
export function enabledSkillDirs(): Set<string> {
  return new Set(store.get('enabledSkills'));
}

export function setSkillDisabled(dirName: string, disabled: boolean): Set<string> {
  const cur = disabledSkillDirs();
  const forced = enabledSkillDirs();
  if (disabled) {
    cur.add(dirName);
    forced.delete(dirName);
  } else {
    cur.delete(dirName);
    forced.add(dirName);
  }
  store.set('disabledSkills', [...cur]);
  store.set('enabledSkills', [...forced]);
  return cur;
}

export const configStorePath = store.path;
