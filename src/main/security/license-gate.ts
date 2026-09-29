/**
 * 商业版授权闸门。
 *
 * 默认策略是 optional，不改变当前开发版和本地 API 用户的行为；发布商业版时由
 * after-pack 写入 required=true，所有模型回合在启动前都要向授权服务确认。授权
 * 结果只在内存中短暂缓存，不写入一个可以永久离线复制的“解锁文件”。
 *
 * 断网宽限（2026-09-28 用户拍板，宽限 10 分钟）：
 * - 每次在线校验成功后，把「最后成功时刻」签名落盘到 userData/license-grace.json；
 * - 网络类失败（超时/连接失败/5xx/429）时，若距最后成功不足 10 分钟则放行；
 * - 服务端明确拒绝（401/403 或 allowed=false）时立即拒绝并清除宽限记录，
 *   不给被停用的令牌留任何宽限窗口；
 * - 宽限记录绑定令牌与设备指纹，并用设备指纹派生的 HMAC 签名，防止直接改
 *   JSON 字段延长窗口（与整体反逆向定位一致：防顺手篡改，不防决心攻击者）。
 */
import { app, safeStorage } from 'electron';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 断网宽限窗口：10 分钟（用户钦定，勿改长）。 */
export const GRACE_MS = 10 * 60 * 1000;

interface LicensePolicy {
  schema: 1;
  required: boolean;
  endpoint: string;
  cacheTtlMs: number;
}

interface LicenseCache {
  token: string;
  validUntil: number;
  feature: string;
}

interface GraceRecord {
  schema: 1;
  tokenHash: string;
  device: string;
  lastOkAt: number;
  sig: string;
}

/** 服务端明确拒绝：不给宽限。 */
class LicenseRejectionError extends Error {}

/** 服务端返回了无法信任的协议内容：不进入离线宽限。 */
class LicenseProtocolError extends Error {}

/** 网络类失败（可走宽限路径）。 */
class LicenseTransientError extends Error {}

let cache: LicenseCache | null = null;

function policyPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'license-policy.json')
    : join(process.cwd(), 'resources', 'license-policy.json');
}

function readPolicy(): LicensePolicy {
  const fallback: LicensePolicy = { schema: 1, required: false, endpoint: '', cacheTtlMs: 300_000 };
  try {
    const file = policyPath();
    if (!existsSync(file)) {
      if (app.isPackaged) throw new Error('商业授权策略文件缺失');
      return fallback;
    }
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LicensePolicy>;
    if (raw.schema !== 1 || typeof raw.required !== 'boolean' || typeof raw.endpoint !== 'string') {
      if (app.isPackaged) throw new Error('商业授权策略文件无效');
      return fallback;
    }
    const endpoint = raw.endpoint.trim();
    if (raw.required && (!endpoint || !/^https:\/\//i.test(endpoint) || (app.isPackaged && !/\/api\/license\/check\/?$/i.test(endpoint)))) {
      if (app.isPackaged) throw new Error('商业授权地址无效，必须使用 HTTPS 授权校验端点');
      return fallback;
    }
    return {
      schema: 1,
      required: raw.required,
      endpoint,
      cacheTtlMs: Math.min(Math.max(Number(raw.cacheTtlMs) || 300_000, 60_000), 900_000),
    };
  } catch (error) {
    // 开发态允许没有商业策略；打包态必须 fail-closed，不能把资源损坏当成免费版。
    if (app.isPackaged) throw error instanceof Error ? error : new Error('商业授权策略读取失败');
    return fallback;
  }
}

function readLicenseToken(): string {
  const fromEnv = process.env.MMODELS_LICENSE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = join(app.getPath('userData'), 'license.token');
    if (!existsSync(file)) return '';
    const raw = readFileSync(file, 'utf8').trim();
    // 新版密文带有明确前缀，避免把普通令牌误当作 base64 密文。
    // 没有前缀的内容按历史明文格式兼容读取；这样测试环境和已有安装都不会被
    // Electron 的 safeStorage 可用性误判卡住。
    if (!raw.startsWith('enc1:')) return raw;
    const secureStorage = safeStorage as unknown as {
      isEncryptionAvailable?: () => boolean;
      decryptString?: (value: Buffer) => string;
    } | undefined;
    if (secureStorage && typeof secureStorage.isEncryptionAvailable === 'function' &&
        secureStorage.isEncryptionAvailable() && typeof secureStorage.decryptString === 'function') {
      try {
        return secureStorage.decryptString(Buffer.from(raw.slice(5), 'base64')).trim();
      } catch {
        return '';
      }
    }
    return '';
  } catch {
    return '';
  }
}

function deviceId(): string {
  return createHash('sha256').update(`${app.getPath('userData')}|${process.platform}|${process.arch}`).digest('hex');
}

function gracePath(): string {
  return join(app.getPath('userData'), 'license-grace.json');
}

function graceKeyPath(): string {
  return join(app.getPath('userData'), 'license-grace.key');
}

/** 宽限签名使用随机本地密钥，而不是把 token/device 直接当作“签名”。 */
function graceKey(): Buffer {
  try {
    const file = graceKeyPath();
    if (existsSync(file)) {
      const key = readFileSync(file);
      if (key.length >= 32) return key;
    }
    const key = randomBytes(32);
    writeFileSync(file, key, { mode: 0o600 });
    return key;
  } catch {
    // 只读 userData 时退回设备绑定的进程内密钥；无法持久化就不提供跨进程宽限。
    return createHash('sha256').update(`${deviceId()}|${app.getVersion()}`).digest();
  }
}

function graceSig(token: string, device: string, lastOkAt: number): string {
  return createHmac('sha256', graceKey()).update(`${token}|${device}|${lastOkAt}`).digest('hex');
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 校验成功后记录最后成功时刻（写失败静默——本次已放行，只是丢宽限）。 */
function writeGrace(token: string, device: string, lastOkAt: number): void {
  try {
    const record: GraceRecord = {
      schema: 1,
      tokenHash: tokenHash(token),
      device,
      lastOkAt,
      sig: graceSig(token, device, lastOkAt),
    };
    writeFileSync(gracePath(), JSON.stringify(record), 'utf8');
  } catch {
    // 忽略：宽限文件写失败只影响后续断网宽限，不影响本次放行。
  }
}

/** 网络类失败时判断是否仍在宽限窗口内。 */
function readGrace(token: string, device: string, now: number): boolean {
  try {
    const file = gracePath();
    if (!existsSync(file)) return false;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<GraceRecord>;
    if (
      raw.schema !== 1 ||
      typeof raw.tokenHash !== 'string' ||
      typeof raw.device !== 'string' ||
      typeof raw.lastOkAt !== 'number' ||
      typeof raw.sig !== 'string'
    ) {
      return false;
    }
    if (raw.tokenHash !== tokenHash(token) || raw.device !== device) return false;
    if (graceSig(token, raw.device, raw.lastOkAt) !== raw.sig) return false;
    const age = now - raw.lastOkAt;
    return age >= 0 && age < GRACE_MS;
  } catch {
    return false;
  }
}

function clearGrace(): void {
  try {
    rmSync(gracePath(), { force: true });
  } catch {
    // 忽略：清不掉也不影响拒绝结果。
  }
}

/** 商业版模型调用前的在线授权确认；本地开发版直接放行。 */
export function isLicenseRequired(): boolean {
  return readPolicy().required;
}

/** 在线检查一项能力。ai-chat 带 requestId 时每轮都会走服务端，服务端据此幂等扣减次数。 */
/**
 * 在模型回合开始前做一次服务端权益确认。
 * pointsCost 是新版统一积分口径；旧授权服务忽略该字段仍可正常工作。
 */
export async function assertAiEntitlement(feature = 'ai-chat', requestId?: string, pointsCost?: number, chatMode?: string): Promise<void> {
  const policy = readPolicy();
  if (!policy.required) return;
  if (!policy.endpoint) throw new Error('当前版本需要在线验证授权，请在设置中完成授权后重试。');

  const token = readLicenseToken();
  if (!token) throw new Error('当前版本需要授权令牌，请先完成授权后再调用模型。');
  const consumeBasic = feature === 'ai-chat' && Boolean(requestId);
  if (cache && cache.token === token && cache.feature === feature && cache.validUntil > Date.now() && !consumeBasic) return;

  const device = deviceId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(policy.endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'x-mmodels-version': app.getVersion(),
        'x-mmodels-device': device,
        'x-mmodels-feature': feature,
        ...(Number.isFinite(pointsCost) && Number(pointsCost) > 0
          ? { 'x-mmodels-points-cost': String(Math.max(0, Math.round(Number(pointsCost)))) }
          : {}),
        ...(requestId ? { 'x-mmodels-request-id': requestId } : {}),
      },
      body: JSON.stringify({
        app: 'mmodels-desktop',
        version: app.getVersion(),
        deviceId: device,
        feature,
        requestId,
        consume: feature === 'ai-chat',
        ...(chatMode ? { chatMode } : {}),
        ...(Number.isFinite(pointsCost) && Number(pointsCost) > 0
          ? { pointsCost: Math.max(0, Math.round(Number(pointsCost))) }
          : {}),
      }),
    });

    // 5xx / 429 等服务端故障按网络类失败处理（走宽限）；401/403 仍需读取
    // 响应体，以便把“积分用完”和“需要 VIP”显示成用户看得懂的提示。
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      throw new LicenseTransientError(`授权服务返回 ${response.status}`);
    }

    let body: { allowed?: boolean; expiresAt?: number | string; code?: string; reason?: string };
    try {
      body = (await response.json()) as { allowed?: boolean; expiresAt?: number | string };
    } catch {
      throw new LicenseProtocolError('授权服务响应格式无效');
    }
    if (response.status === 401 || response.status === 403) {
      clearGrace();
      cache = null;
      if (body.code === 'AI_QUOTA_EXCEEDED') throw new LicenseRejectionError('今日可用积分已用完，请签到或兑换 VIP 卡密后继续。');
      if (body.code === 'POINTS_INSUFFICIENT') throw new LicenseRejectionError('当前积分不足，完成建模或兑换卡密后继续。');
      if (body.code === 'PAID_VIP_REQUIRED' || body.code === 'TRIAL_MULTI_AGENT_FORBIDDEN') {
        throw new LicenseRejectionError('多智能体协作需要卡密兑换的 VIP，24 小时体验不包含这项能力。');
      }
      if (body.code === 'FEATURE_VIP_REQUIRED') throw new LicenseRejectionError('当前功能需要 VIP 会员，请打开会员中心升级。');
      throw new LicenseRejectionError('授权已失效，请重新登录或续费。');
    }
    if (typeof body.allowed !== 'boolean') {
      throw new LicenseProtocolError('授权服务响应缺少校验结果');
    }
    if (body.allowed !== true) {
      clearGrace();
      cache = null;
      if (body.code === 'AI_QUOTA_EXCEEDED') throw new LicenseRejectionError('今日可用积分已用完，请签到或兑换 VIP 卡密后继续。');
      if (body.code === 'POINTS_INSUFFICIENT') throw new LicenseRejectionError('当前积分不足，完成建模或兑换卡密后继续。');
      if (body.code === 'PAID_VIP_REQUIRED' || body.code === 'TRIAL_MULTI_AGENT_FORBIDDEN') {
        throw new LicenseRejectionError('多智能体协作需要卡密兑换的 VIP，24 小时体验不包含这项能力。');
      }
      if (body.code === 'FEATURE_VIP_REQUIRED') throw new LicenseRejectionError('当前功能需要 VIP 会员，请打开会员中心升级。');
      throw new LicenseRejectionError('授权已失效或当前设备未被允许');
    }

    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : Date.parse(String(body.expiresAt ?? ''));
    const validUntil = Math.min(
      Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + policy.cacheTtlMs,
      Date.now() + policy.cacheTtlMs,
    );
    cache = { token, feature, validUntil };
    writeGrace(token, device, Date.now());
    return;
  } catch (error) {
    if (error instanceof LicenseRejectionError) throw error;
    if (error instanceof LicenseProtocolError) throw new Error('授权服务返回格式无效，请稍后重试。');

    // 网络类失败：10 分钟宽限窗口内放行。
    cache = null;
    if (readGrace(token, device, Date.now())) {
      // 宽限放行只缓存 60 秒，网络恢复后尽快回到真实校验。
      cache = { token, feature, validUntil: Date.now() + 60_000 };
      return;
    }
    const detail = error instanceof LicenseTransientError ? error.message : '网络异常';
    throw new Error(`授权验证暂时不可用（${detail}），请检查网络后重试。`);
  } finally {
    clearTimeout(timer);
  }
}

/** 仅供单元测试构造/清理宽限记录；生产代码勿用。 */
export const __licenseTestHooks = {
  GRACE_MS,
  writeGrace,
  clearGrace,
  gracePath,
  deviceId,
};
