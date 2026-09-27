/**
 * 商业版授权闸门。
 *
 * 默认策略是 optional，不改变当前开发版和本地 API 用户的行为；发布商业版时由
 * after-pack 写入 required=true，所有模型回合在启动前都要向授权服务确认。授权
 * 结果只在内存中短暂缓存，不写入一个可以永久离线复制的“解锁文件”。
 */
import { app } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface LicensePolicy {
  schema: 1;
  required: boolean;
  endpoint: string;
  cacheTtlMs: number;
}

interface LicenseCache {
  token: string;
  validUntil: number;
}

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
    if (!existsSync(file)) return fallback;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<LicensePolicy>;
    if (raw.schema !== 1 || typeof raw.required !== 'boolean' || typeof raw.endpoint !== 'string') return fallback;
    return {
      schema: 1,
      required: raw.required,
      endpoint: raw.endpoint.trim(),
      cacheTtlMs: Math.min(Math.max(Number(raw.cacheTtlMs) || 300_000, 60_000), 900_000),
    };
  } catch {
    // 加固模块会先校验资源指纹；这里仅负责在开发态给出安全的默认值。
    return fallback;
  }
}

function readLicenseToken(): string {
  const fromEnv = process.env.MMODELS_LICENSE_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  try {
    const file = join(app.getPath('userData'), 'license.token');
    return existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

function deviceId(): string {
  return createHash('sha256').update(`${app.getPath('userData')}|${process.platform}|${process.arch}`).digest('hex');
}

/** 商业版模型调用前的在线授权确认；本地开发版直接放行。 */
export async function assertAiEntitlement(): Promise<void> {
  const policy = readPolicy();
  if (!policy.required) return;
  if (!policy.endpoint) throw new Error('当前版本需要在线验证授权，请在设置中完成授权后重试。');

  const token = readLicenseToken();
  if (!token) throw new Error('当前版本需要授权令牌，请先完成授权后再调用模型。');
  if (cache && cache.token === token && cache.validUntil > Date.now()) return;

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
        'x-mmodels-device': deviceId(),
      },
      body: JSON.stringify({ app: 'mmodels-desktop', version: app.getVersion(), deviceId: deviceId() }),
    });
    if (!response.ok) throw new Error(`授权服务返回 ${response.status}`);
    const body = await response.json() as { allowed?: boolean; expiresAt?: number | string };
    if (body.allowed !== true) throw new Error('授权已失效或当前设备未被允许');
    const expiresAt = typeof body.expiresAt === 'number' ? body.expiresAt : Date.parse(String(body.expiresAt ?? ''));
    const validUntil = Math.min(
      Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : Date.now() + policy.cacheTtlMs,
      Date.now() + policy.cacheTtlMs,
    );
    cache = { token, validUntil };
  } catch (error) {
    cache = null;
    throw new Error('授权验证暂时不可用，请检查网络后重试。');
  } finally {
    clearTimeout(timer);
  }
}
