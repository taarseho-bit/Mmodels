/**
 * 账号与授权 IPC（商业化）。
 *
 * 对接授权服务（register/login/redeem/check）。凭证落盘在本机 userData：
 *  - account.json   账号名 + 加密密码 + 已知到期时间（redeem 续费需要密码；只存本机）
 *  - license.token  服务端签发的授权令牌（license-gate 每次模型回合前校验）
 *
 * ⚠️ deviceId 计算公式必须与 security/license-gate.ts 的 deviceId() 保持一致
 *    （sha256(userData|platform|arch)），否则服务端 device mismatch 会拒答。
 */
import { app, ipcMain, safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IPC,
  type AccountAiQuota,
  type AccountFeedbackResult,
  type AccountPlan,
  type AccountPointRewardKind,
  type AccountPointsEarnResult,
  type AccountStatusInfo,
  type AccountEntitlementInfo,
  type AccountEntitlementRequest,
  type AccountPointWallet,
  type EntitlementReason,
  type MembershipFeature,
} from '@shared/types';
import { isPaidVip, isTrialActive, localFeatureAccess, pointsBalanceOf } from '@shared/membership';
import { CHAT_POINT_COSTS } from '@shared/types';
import { safeWrap } from './index';
import { isLicenseRequired } from '../security/license-gate';

interface LocalAccount {
  username: string;
  password: string;
  expiresAt: number;
  plan?: AccountPlan;
  trialDaysLeft?: number;
  trialHoursLeft?: number;
  trialExpiresAt?: number;
  trialStartedAt?: number;
  trialActive?: boolean;
  points?: number;
  pointsBalance?: number;
  pointsPerChat?: number;
  pointWallet?: AccountPointWallet;
  inviteCode?: string;
  checkedIn?: boolean;
  aiQuota?: AccountAiQuota;
  checkedAt?: number;
}

interface StoredAccount {
  username: string;
  passwordEnc?: string;
  /** 历史明文字段，仅用于一次迁移，成功读取后立即删除。 */
  password?: string;
  expiresAt?: number;
  plan?: AccountPlan;
  trialDaysLeft?: number;
  trialHoursLeft?: number;
  trialExpiresAt?: number;
  trialStartedAt?: number;
  trialActive?: boolean;
  points?: number;
  pointsBalance?: number;
  pointsPerChat?: number;
  pointWallet?: AccountPointWallet;
  inviteCode?: string;
  checkedIn?: boolean;
  aiQuota?: AccountAiQuota;
  checkedAt?: number;
}

function finiteNonNegative(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function finitePositive(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeQuota(value: unknown): AccountAiQuota | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const q = value as Record<string, unknown>;
  const used = finiteNonNegative(q.used);
  const base = finiteNonNegative(q.base);
  const bonus = finiteNonNegative(q.bonus);
  const total = finiteNonNegative(q.total);
  const remaining = finiteNonNegative(q.remaining);
  if ([used, base, bonus, total, remaining].some((v) => v === undefined)) return undefined;
  return {
    used: used!,
    base: base!,
    bonus: bonus!,
    total: total!,
    remaining: remaining!,
    vip: q.vip === true,
    ...(typeof q.date === 'string' ? { date: q.date.slice(0, 32) } : {}),
    ...(finitePositive(q.checkedAt) ? { checkedAt: finitePositive(q.checkedAt) } : {}),
  };
}

function normalizePointWallet(value: unknown): AccountPointWallet | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const w = value as Record<string, unknown>;
  const balance = finiteNonNegative(w.balance);
  if (balance === undefined) return undefined;
  const lastCost = finiteNonNegative(w.lastCost);
  const checkedAt = finitePositive(w.checkedAt);
  return {
    balance,
    ...(lastCost !== undefined ? { lastCost } : {}),
    ...(typeof w.transactionId === 'string' && w.transactionId.trim()
      ? { transactionId: w.transactionId.trim().slice(0, 128) }
      : {}),
    ...(checkedAt !== undefined ? { checkedAt } : {}),
  };
}

function normalizedPoints(data: Record<string, unknown>): number | undefined {
  const wallet = normalizePointWallet(data.pointWallet ?? data.pointsWallet ?? data.aiPoints);
  if (wallet) return wallet.balance;
  return finiteNonNegative(data.pointsBalance)
    ?? finiteNonNegative(data.balancePoints)
    ?? finiteNonNegative(data.aiPoints)
    ?? finiteNonNegative(data.points)
    ?? finiteNonNegative(data.credits);
}

function statusFromLocal(local: LocalAccount | null): AccountStatusInfo {
  if (!local) {
    return { loggedIn: false, username: '', expiresAt: 0, authRequired: isLicenseRequired() };
  }
  return {
    loggedIn: true,
    username: local.username,
    expiresAt: local.expiresAt,
    authRequired: isLicenseRequired(),
    ...(local.plan ? { plan: local.plan } : {}),
    ...(local.trialDaysLeft !== undefined ? { trialDaysLeft: local.trialDaysLeft } : {}),
    ...(local.trialHoursLeft !== undefined ? { trialHoursLeft: local.trialHoursLeft } : {}),
    ...(local.trialExpiresAt !== undefined ? { trialExpiresAt: local.trialExpiresAt } : {}),
    ...(local.trialStartedAt !== undefined ? { trialStartedAt: local.trialStartedAt } : {}),
    trialActive: isTrialActive(local),
    ...(local.points !== undefined ? { points: local.points } : {}),
    ...(local.pointsBalance !== undefined ? { pointsBalance: local.pointsBalance } : {}),
    ...(local.pointsPerChat !== undefined ? { pointsPerChat: local.pointsPerChat } : {}),
    ...(local.pointWallet ? { pointWallet: local.pointWallet } : {}),
    ...(local.inviteCode ? { inviteCode: local.inviteCode } : {}),
    ...(local.checkedIn !== undefined ? { checkedIn: local.checkedIn } : {}),
    ...(local.aiQuota ? { aiQuota: local.aiQuota } : {}),
    ...(local.checkedAt !== undefined ? { checkedAt: local.checkedAt } : {}),
  };
}

function accountFile(): string {
  return join(app.getPath('userData'), 'account.json');
}
function tokenFile(): string {
  return join(app.getPath('userData'), 'license.token');
}

function readLocal(): LocalAccount | null {
  try {
    const raw = JSON.parse(readFileSync(accountFile(), 'utf8')) as StoredAccount;
    if (typeof raw.username !== 'string') return null;
    let password = '';
    if (typeof raw.passwordEnc === 'string' && safeStorage.isEncryptionAvailable()) {
      password = safeStorage.decryptString(Buffer.from(raw.passwordEnc, 'base64'));
    } else if (typeof raw.password === 'string') {
      // 迁移历史明文账号文件；安全存储暂不可用时只在内存使用。
      password = raw.password;
      if (safeStorage.isEncryptionAvailable()) {
        writeLocal({
          username: raw.username,
          password,
          expiresAt: Number(raw.expiresAt) || 0,
          plan: raw.plan,
          trialDaysLeft: raw.trialDaysLeft,
          trialHoursLeft: raw.trialHoursLeft,
          trialExpiresAt: raw.trialExpiresAt,
          trialStartedAt: raw.trialStartedAt,
          trialActive: raw.trialActive,
          points: raw.points,
          pointsBalance: raw.pointsBalance,
          pointsPerChat: raw.pointsPerChat,
          pointWallet: raw.pointWallet,
          inviteCode: raw.inviteCode,
          checkedIn: raw.checkedIn,
          aiQuota: raw.aiQuota,
          checkedAt: raw.checkedAt,
        });
      }
    }
    if (!password) return null;
    return {
      username: raw.username,
      password,
      expiresAt: Number(raw.expiresAt) || 0,
      plan: raw.plan === 'vip' ? 'vip' : raw.plan === 'free' ? 'free' : undefined,
      trialDaysLeft: finiteNonNegative(raw.trialDaysLeft),
      trialHoursLeft: finiteNonNegative(raw.trialHoursLeft),
      trialExpiresAt: finitePositive(raw.trialExpiresAt),
      trialStartedAt: finitePositive(raw.trialStartedAt),
      trialActive: raw.trialActive === true,
      points: finiteNonNegative(raw.points),
      pointsBalance: finiteNonNegative(raw.pointsBalance),
      pointsPerChat: finiteNonNegative(raw.pointsPerChat),
      pointWallet: normalizePointWallet(raw.pointWallet),
      inviteCode: typeof raw.inviteCode === 'string' ? raw.inviteCode : undefined,
      checkedIn: raw.checkedIn === true,
      aiQuota: normalizeQuota(raw.aiQuota),
      checkedAt: finitePositive(raw.checkedAt),
    };
  } catch {
    return null;
  }
}

function writeLocal(account: LocalAccount): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('系统安全存储不可用，无法安全保存账号凭证');
  }
  const payload: StoredAccount = {
    username: account.username,
    passwordEnc: safeStorage.encryptString(account.password).toString('base64'),
    expiresAt: account.expiresAt,
    ...(account.plan ? { plan: account.plan } : {}),
    ...(account.trialDaysLeft !== undefined ? { trialDaysLeft: account.trialDaysLeft } : {}),
    ...(account.trialHoursLeft !== undefined ? { trialHoursLeft: account.trialHoursLeft } : {}),
    ...(account.trialExpiresAt !== undefined ? { trialExpiresAt: account.trialExpiresAt } : {}),
    ...(account.trialStartedAt !== undefined ? { trialStartedAt: account.trialStartedAt } : {}),
    ...(account.trialActive !== undefined ? { trialActive: account.trialActive } : {}),
    ...(account.points !== undefined ? { points: account.points } : {}),
    ...(account.pointsBalance !== undefined ? { pointsBalance: account.pointsBalance } : {}),
    ...(account.pointsPerChat !== undefined ? { pointsPerChat: account.pointsPerChat } : {}),
    ...(account.pointWallet ? { pointWallet: account.pointWallet } : {}),
    ...(account.inviteCode ? { inviteCode: account.inviteCode } : {}),
    ...(account.checkedIn !== undefined ? { checkedIn: account.checkedIn } : {}),
    ...(account.aiQuota ? { aiQuota: account.aiQuota } : {}),
    ...(account.checkedAt !== undefined ? { checkedAt: account.checkedAt } : {}),
  };
  const target = accountFile();
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, target);
}

function assertSecureStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，请重启应用后重试');
}

/** 与 security/license-gate.ts 的 deviceId() 同公式，勿单独改动 */
function deviceId(): string {
  return createHash('sha256').update(`${app.getPath('userData')}|${process.platform}|${process.arch}`).digest('hex');
}

/** 授权服务 API 基址：优先 license-policy.json 的 endpoint 前缀，其次环境变量，最后当前生产地址 */
function apiBase(): string {
  try {
    const file = app.isPackaged
      ? join(process.resourcesPath, 'license-policy.json')
      : join(process.cwd(), 'resources', 'license-policy.json');
    if (existsSync(file)) {
      const policy = JSON.parse(readFileSync(file, 'utf8')) as { endpoint?: string; required?: boolean };
      const endpoint = String(policy.endpoint || '').trim();
      if (!endpoint && policy.required === false) {
        // 打包版即使策略标记为 optional，也不能接受环境变量注入的明文 HTTP
        // 地址；只有开发态允许通过 MM_LICENSE_API 指向本地测试服务。
        if (app.isPackaged) return 'https://api.mmodel.top';
        return process.env.MM_LICENSE_API?.trim() || 'https://api.mmodel.top';
      }
      const parsed = new URL(endpoint);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !/\/api\/license\/check\/?$/i.test(parsed.pathname)) {
        throw new Error('授权策略地址无效');
      }
      return parsed.origin;
    }
  } catch {
    if (app.isPackaged) throw new Error('商业授权策略缺失或无效，请重新安装当前版本');
  }
  const env = process.env.MM_LICENSE_API?.trim();
  if (!env) throw new Error('开发环境未配置 MM_LICENSE_API，未发送账号请求');
  const parsed = new URL(env);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('授权服务必须使用不含凭据和查询参数的 HTTPS 地址');
  }
  return parsed.toString().replace(/\/$/, '');
}

async function callApi(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; reason?: string; code?: string; allowed?: boolean };
    if (!res.ok || data.ok === false) {
      throw new Error(String(data.error || data.reason || data.code || `服务返回 ${res.status}`));
    }
    return data;
  } catch (e) {
    if (e instanceof Error && e.message.includes('abort')) {
      throw new Error('授权服务连接超时，请检查网络后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function statusOf(): AccountStatusInfo {
  const local = readLocal();
  return statusFromLocal(local);
}

function membershipErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (/timeout|timed out|abort|网络|fetch|socket|dns|连接/i.test(raw)) return '会员服务暂时不可用，请检查网络后重试。';
  if (/POINTS_INSUFFICIENT|积分不足/i.test(raw)) return '当前积分不足，请先完成基础任务或兑换卡密后继续。';
  if (/TRIAL_MULTI_AGENT_FORBIDDEN|PAID_VIP_REQUIRED|多智能体.*试用|付费 VIP/i.test(raw)) return '多智能体协作需要卡密兑换的 VIP，24 小时体验不包含这项能力。';
  if (/401|403|登录|令牌|授权/i.test(raw)) return '登录状态已失效，请重新登录后重试。';
  if (/429|频繁|rate/i.test(raw)) return '操作过于频繁，请稍后重试。';
  return raw && !/[A-Za-z]:\\|\n|stack|at \w+\s*\(/i.test(raw) ? raw : '这次会员操作没有完成，请稍后重试。';
}

const MEMBERSHIP_FEATURES: readonly MembershipFeature[] = [
  'ai-chat', 'multi-agent', 'full-paper', 'deep-modeling', 'advanced-figures',
  'large-context', 'export', 'cloud-collaboration', 'automation',
];

function localEntitlement(feature: MembershipFeature, account: AccountStatusInfo): AccountEntitlementInfo {
  const cost = feature === 'ai-chat' ? account.pointsPerChat ?? CHAT_POINT_COSTS.basic : 0;
  const access = localFeatureAccess(feature, account, cost);
  // 旧服务端/旧账号没有积分余额时，继续以旧 aiQuota 做展示和兼容预检。
  if (feature === 'ai-chat' && !isPaidVip(account) && !isTrialActive(account)) {
    const remaining = account.aiQuota?.remaining;
    if (typeof remaining === 'number' && remaining <= 0 && access.allowed) {
      return { feature, allowed: false, reason: 'ai-quota-exceeded', account, remaining: 0, costPoints: cost };
    }
    return {
      feature,
      allowed: access.allowed,
      reason: access.allowed ? 'allowed' : access.reason,
      account,
      ...(typeof remaining === 'number' ? { remaining } : {}),
      ...(access.costPoints !== undefined ? { costPoints: access.costPoints } : {}),
      ...(access.balancePoints !== undefined ? { balancePoints: access.balancePoints } : {}),
    };
  }
  return {
    feature,
    allowed: access.allowed,
    reason: access.reason,
    account,
    ...(access.costPoints !== undefined ? { costPoints: access.costPoints } : {}),
    ...(access.balancePoints !== undefined ? { balancePoints: access.balancePoints } : {}),
  };
}

function entitlementReason(code: unknown, body: Record<string, unknown>): EntitlementReason {
  if (body.allowed === true) return 'allowed';
  switch (String(code || body.code || '')) {
    case 'LOGIN_REQUIRED': return 'login-required';
    case 'AI_QUOTA_EXCEEDED': return 'ai-quota-exceeded';
    case 'POINTS_INSUFFICIENT': return 'points-insufficient';
    case 'PAID_VIP_REQUIRED':
    case 'TRIAL_MULTI_AGENT_FORBIDDEN': return 'paid-vip-required';
    case 'FEATURE_VIP_REQUIRED': return 'vip-required';
    default: return 'service-unavailable';
  }
}

async function remoteEntitlement(feature: MembershipFeature, local: LocalAccount, pointsCost = 0): Promise<AccountEntitlementInfo> {
  const token = tokenFromDisk();
  if (!token) return { feature, allowed: false, reason: 'login-required', account: statusFromLocal(local) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${apiBase()}/api/license/check`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-mmodels-device': deviceId(),
        'x-mmodels-feature': feature,
      },
        body: JSON.stringify({
          app: 'mmodels-desktop',
          version: app.getVersion(),
          deviceId: deviceId(),
          feature,
          consume: false,
          ...(pointsCost > 0 ? { pointsCost } : {}),
        }),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const account = statusFromRemote(local, body);
    if (account.loggedIn) {
      try {
        writeLocal({
          ...local,
          expiresAt: account.expiresAt,
          plan: account.plan,
          trialDaysLeft: account.trialDaysLeft,
          trialHoursLeft: account.trialHoursLeft,
          trialExpiresAt: account.trialExpiresAt,
          trialStartedAt: account.trialStartedAt,
          trialActive: account.trialActive,
          points: account.points,
          pointsBalance: account.pointsBalance,
          pointsPerChat: account.pointsPerChat,
          pointWallet: account.pointWallet,
          aiQuota: account.aiQuota,
          checkedAt: account.checkedAt,
        });
      } catch { /* UI 预检查不能因本地缓存写入失败而中断 */ }
    }
    const allowed = response.ok && body.allowed === true;
    const remaining = account.aiQuota?.remaining;
    const balancePoints = pointsBalanceOf(account);
    const costPoints = finiteNonNegative(body.costPoints ?? body.pointsCost) ?? (pointsCost > 0 ? pointsCost : undefined);
    return {
      feature,
      allowed,
      reason: allowed ? 'allowed' : entitlementReason(body.code, body),
      account,
      ...(typeof remaining === 'number' ? { remaining } : {}),
      ...(costPoints !== undefined ? { costPoints } : {}),
      ...(balancePoints !== undefined ? { balancePoints } : {}),
    };
  } catch {
    return { feature, allowed: false, reason: 'service-unavailable', account: statusFromLocal(local) };
  } finally {
    clearTimeout(timer);
  }
}

async function entitlementOf(feature: MembershipFeature, pointsCost = 0): Promise<AccountEntitlementInfo> {
  const local = readLocal();
  if (!local) return { feature, allowed: false, reason: 'login-required', account: statusOf() };
  if (!isLicenseRequired() && !process.env.MM_LICENSE_API?.trim()) {
    const account = statusFromLocal(local);
    return { ...localEntitlement(feature, account), ...(pointsCost > 0 ? { costPoints: pointsCost } : {}) };
  }
  return remoteEntitlement(feature, local, pointsCost);
}

function tokenFromDisk(): string {
  try {
    const raw = readFileSync(tokenFile(), 'utf8').trim();
    if (!raw.startsWith('enc1:') || !safeStorage.isEncryptionAvailable()) return raw;
    return safeStorage.decryptString(Buffer.from(raw.slice(5), 'base64')).trim();
  } catch { return ''; }
}

function statusFromRemote(local: LocalAccount, data: Record<string, unknown>): AccountStatusInfo {
  const quota = normalizeQuota(data.aiQuota);
  const pointWallet = normalizePointWallet(data.pointWallet ?? data.pointsWallet ?? data.aiPoints);
  const balance = normalizedPoints(data);
  const plan = data.plan === 'vip' ? 'vip' : 'free';
  const expiresAt = Number(data.expiresAt) || local.expiresAt;
  const trialExpiresAt = finitePositive(data.trialExpiresAt);
  const trialActive = trialExpiresAt !== undefined && trialExpiresAt > Date.now() && plan !== 'vip';
  const trialHoursLeft = finiteNonNegative(data.trialHoursLeft) ?? (
    trialExpiresAt !== undefined ? Math.max(0, Math.ceil((trialExpiresAt - Date.now()) / 3_600_000)) : undefined
  );
  return {
    loggedIn: true,
    username: local.username,
    expiresAt,
    authRequired: isLicenseRequired(),
    plan,
    trialDaysLeft: finiteNonNegative(data.trialDaysLeft) ?? 0,
    ...(trialHoursLeft !== undefined ? { trialHoursLeft } : {}),
    ...(trialExpiresAt !== undefined ? { trialExpiresAt } : {}),
    ...(finitePositive(data.trialStartedAt) !== undefined ? { trialStartedAt: finitePositive(data.trialStartedAt) } : {}),
    trialActive,
    points: balance ?? 0,
    ...(balance !== undefined ? { pointsBalance: balance } : {}),
    ...(finiteNonNegative(data.pointsPerChat ?? data.defaultPointCost ?? data.pointCost ?? data.pointsCost) !== undefined
      ? { pointsPerChat: finiteNonNegative(data.pointsPerChat ?? data.defaultPointCost ?? data.pointCost ?? data.pointsCost) } : {}),
    ...(pointWallet ? { pointWallet } : {}),
    inviteCode: typeof data.inviteCode === 'string' ? data.inviteCode : local.inviteCode,
    checkedIn: data.checkedIn === true,
    ...(quota ? { aiQuota: quota } : {}),
    checkedAt: Date.now(),
  };
}

async function refreshRemoteStatus(local: LocalAccount): Promise<AccountStatusInfo> {
  // 普通本地开发没有配置测试授权服务时，不要因为一次打开设置把界面卡住十秒。
  // 发布版策略为 required=true，仍会强制走下面的在线快照。
  if (!isLicenseRequired() && !process.env.MM_LICENSE_API?.trim()) return statusFromLocal(local);
  const token = tokenFromDisk();
  if (!token) return statusFromLocal(local);
  const data = await callApi('/api/account/status', {}, {
    authorization: `Bearer ${token}`,
    'x-mmodels-device': deviceId(),
  });
  const next = statusFromRemote(local, data);
  writeLocal({
    ...local,
    expiresAt: next.expiresAt,
    plan: next.plan,
    trialDaysLeft: next.trialDaysLeft,
    trialHoursLeft: next.trialHoursLeft,
    trialExpiresAt: next.trialExpiresAt,
    trialStartedAt: next.trialStartedAt,
    trialActive: next.trialActive,
    points: next.points,
    pointsBalance: next.pointsBalance,
    pointsPerChat: next.pointsPerChat,
    pointWallet: next.pointWallet,
    inviteCode: next.inviteCode,
    checkedIn: next.checkedIn,
    aiQuota: next.aiQuota,
    checkedAt: next.checkedAt,
  });
  return next;
}

function persistAuth(username: string, password: string, data: Record<string, unknown>): AccountStatusInfo {
  const exp = Number(data.expiresAt) || 0;
  const tok = String(data.token || '').trim();
  if (!tok) throw new Error('服务端未返回授权令牌');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，无法保存授权令牌');
  // 先准备两份临时文件，再提交令牌和账号；账号提交失败时恢复旧令牌，
  // 避免出现“界面显示已登录但模型没有令牌”的半登录状态。
  const accountTarget = accountFile();
  const tokenTarget = tokenFile();
  const accountTmp = `${accountTarget}.tmp`;
  const tokenTmp = `${tokenTarget}.tmp`;
  let previousToken: Buffer | null = null;
  let hadToken = false;
  try {
    if (existsSync(tokenTarget)) {
      previousToken = readFileSync(tokenTarget);
      hadToken = true;
    }
    const accountPayload: StoredAccount = {
      username,
      passwordEnc: safeStorage.encryptString(password).toString('base64'),
      expiresAt: exp,
      plan: data.plan === 'vip' ? 'vip' : data.plan === 'free' ? 'free' : undefined,
      trialDaysLeft: finiteNonNegative(data.trialDaysLeft),
      trialHoursLeft: finiteNonNegative(data.trialHoursLeft),
      trialExpiresAt: finitePositive(data.trialExpiresAt),
      trialStartedAt: finitePositive(data.trialStartedAt),
      trialActive: data.trialActive === true,
      points: normalizedPoints(data),
      pointsBalance: normalizedPoints(data),
      pointsPerChat: finiteNonNegative(data.pointsPerChat ?? data.defaultPointCost ?? data.pointCost ?? data.pointsCost),
      pointWallet: normalizePointWallet(data.pointWallet ?? data.pointsWallet ?? data.aiPoints),
      inviteCode: typeof data.inviteCode === 'string' && data.inviteCode ? data.inviteCode : undefined,
      checkedIn: data.checkedIn === true ? true : data.checkedIn === false ? false : undefined,
      aiQuota: normalizeQuota(data.aiQuota),
      checkedAt: Date.now(),
    };
    writeFileSync(accountTmp, JSON.stringify(accountPayload, null, 2), { encoding: 'utf8', mode: 0o600 });
    writeFileSync(tokenTmp, `enc1:${safeStorage.encryptString(tok).toString('base64')}`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tokenTmp, tokenTarget);
    try {
      renameSync(accountTmp, accountTarget);
    } catch (error) {
      // token 已提交但账号未提交：尽量回到提交前的令牌状态。
      if (hadToken && previousToken) {
        writeFileSync(tokenTmp, previousToken, { mode: 0o600 });
        renameSync(tokenTmp, tokenTarget);
      } else {
        rmSync(tokenTarget, { force: true });
      }
      throw error;
    }
  } finally {
    try { rmSync(accountTmp, { force: true }); } catch { /* ignore */ }
    try { rmSync(tokenTmp, { force: true }); } catch { /* ignore */ }
  }
  const local: LocalAccount = {
    username,
    password,
    expiresAt: exp,
    plan: data.plan === 'vip' ? 'vip' : 'free',
    trialDaysLeft: finiteNonNegative(data.trialDaysLeft) ?? 0,
    trialHoursLeft: finiteNonNegative(data.trialHoursLeft),
    trialExpiresAt: finitePositive(data.trialExpiresAt),
    trialStartedAt: finitePositive(data.trialStartedAt),
    trialActive: data.trialActive === true,
    points: normalizedPoints(data) ?? 0,
    pointsBalance: normalizedPoints(data) ?? 0,
    pointsPerChat: finiteNonNegative(data.pointsPerChat ?? data.defaultPointCost ?? data.pointCost ?? data.pointsCost),
    pointWallet: normalizePointWallet(data.pointWallet ?? data.pointsWallet ?? data.aiPoints),
    inviteCode: typeof data.inviteCode === 'string' && data.inviteCode ? data.inviteCode : undefined,
    checkedIn: data.checkedIn === true,
    aiQuota: normalizeQuota(data.aiQuota),
    checkedAt: Date.now(),
  };
  return statusFromLocal(local);
}

export function registerAccountHandlers(): void {
  ipcMain.handle(IPC.ACCOUNT_STATUS, safeWrap(async (): Promise<AccountStatusInfo> => {
    const local = readLocal();
    if (!local) return statusOf();
    try { return await refreshRemoteStatus(local); }
    catch (error) {
      return { ...statusFromLocal(local), error: membershipErrorText(error) };
    }
  }, '读取账号状态'));

  ipcMain.handle(
    IPC.ACCOUNT_ENTITLEMENT,
    safeWrap(async (_e, request: MembershipFeature | AccountEntitlementRequest): Promise<AccountEntitlementInfo> => {
      const featureArg = typeof request === 'object' && request !== null ? request.feature : request;
      const pointsCost = typeof request === 'object' && request !== null
        ? finiteNonNegative(request.pointsCost) ?? 0
        : 0;
      const feature = String(featureArg || '').trim() as MembershipFeature;
      if (!MEMBERSHIP_FEATURES.includes(feature)) {
        throw new Error('功能标识不合法');
      }
      return entitlementOf(feature, pointsCost);
    }, '查询会员权益'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_REGISTER,
    safeWrap(async (_e, args: { username?: string; password?: string; email?: string; emailCode?: string; code?: string; inviteCode?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const username = String(args?.username || '').trim();
      const password = String(args?.password || '');
      const email = String(args?.email || '').trim().toLowerCase();
      const emailCode = String(args?.emailCode || '').trim();
      const code = String(args?.code || '').trim().toUpperCase();
      const inviteCode = String(args?.inviteCode || '').trim().toUpperCase();
      const data = await callApi('/api/auth/register', {
        username, password, email, emailCode, deviceId: deviceId(), code: code || undefined,
        inviteCode: /^MM-[A-Z2-9]{6}$/.test(inviteCode) ? inviteCode : undefined,
      });
      return persistAuth(username, password, data);
    }, '注册账号'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_SEND_CODE,
    safeWrap(async (_e, args: { email?: string; purpose?: 'register' | 'reset' }): Promise<void> => {
      const email = String(args?.email || '').trim().toLowerCase();
      const purpose = args?.purpose === 'reset' ? 'reset' : 'register';
      await callApi('/api/auth/send-code', { email, purpose });
    }, '发送邮箱验证码'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_RESET_PASSWORD,
    safeWrap(async (_e, args: { email?: string; emailCode?: string; newPassword?: string }): Promise<void> => {
      const email = String(args?.email || '').trim().toLowerCase();
      const emailCode = String(args?.emailCode || '').trim();
      const newPassword = String(args?.newPassword || '');
      await callApi('/api/auth/reset-pass', { email, emailCode, newPassword });
    }, '重置密码'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_LOGIN,
    safeWrap(async (_e, args: { username?: string; password?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const username = String(args?.username || '').trim();
      const password = String(args?.password || '');
      const data = await callApi('/api/auth/login', { username, password, deviceId: deviceId() });
      // 允许用绑定邮箱登录：服务端回传真实用户名，本地按真实用户名落盘，
      // 否则后续卡密兑换 / 签到等接口按邮箱查不到账号。
      const name = typeof data.username === 'string' && data.username.trim() ? data.username.trim() : username;
      return persistAuth(name, password, data);
    }, '登录账号'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_REDEEM,
    safeWrap(async (_e, args: { code?: string }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先登录账号后再兑换卡密');
      const code = String(args?.code || '').trim().toUpperCase();
      const data = await callApi('/api/redeem', {
        username: local.username, password: local.password, code, deviceId: deviceId(),
      });
      return persistAuth(local.username, local.password, data);
    }, '兑换卡密'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_CHECKIN,
    safeWrap(async (): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先注册或登录账号');
      const token = tokenFromDisk();
      if (!token) throw new Error('登录状态已失效，请重新登录');
      const data = await callApi('/api/account/checkin', {}, { authorization: `Bearer ${token}`, 'x-mmodels-device': deviceId() });
      return persistAuth(local.username, local.password, { ...data, token });
    }, '每日签到'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_POINTS_REDEEM,
    safeWrap(async (_e, args: { days?: number }): Promise<AccountStatusInfo> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先注册或登录账号');
      const token = tokenFromDisk();
      if (!token) throw new Error('登录状态已失效，请重新登录');
      const days = Number(args?.days);
      const data = await callApi('/api/account/points-redeem', { days }, { authorization: `Bearer ${token}`, 'x-mmodels-device': deviceId() });
      return persistAuth(local.username, local.password, { ...data, token });
    }, '积分兑换会员'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_POINTS_EARN,
    safeWrap(async (_e, args: { kind?: AccountPointRewardKind; eventId?: string }): Promise<AccountPointsEarnResult> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先注册或登录账号');
      const token = tokenFromDisk();
      if (!token) throw new Error('登录状态已失效，请重新登录');
      const kind = args?.kind;
      if (kind !== 'firstProject' && kind !== 'paperExport' && kind !== 'feedback' && kind !== 'invite') {
        throw new Error('积分奖励类型不合法');
      }
      const eventId = String(args?.eventId || '').trim();
      const data = await callApi('/api/account/points-earn', { kind, eventId }, {
        authorization: `Bearer ${token}`,
        'x-mmodels-device': deviceId(),
      });
      const status = persistAuth(local.username, local.password, { ...data, token });
      return {
        status,
        kind,
        awarded: finiteNonNegative(data.awarded) ?? 0,
        duplicate: data.duplicate === true,
      };
    }, '领取积分奖励'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_FEEDBACK,
    safeWrap(async (_e, args: { text?: string; contact?: string }): Promise<AccountFeedbackResult> => {
      assertSecureStorage();
      const local = readLocal();
      if (!local) throw new Error('请先注册或登录账号');
      const token = tokenFromDisk();
      if (!token) throw new Error('登录状态已失效，请重新登录');
      const text = String(args?.text || '').trim();
      if (text.length < 8) throw new Error('反馈内容太短，请至少写 8 个字');
      const data = await callApi('/api/account/feedback', {
        text: text.slice(0, 2000),
        contact: String(args?.contact || '').slice(0, 120),
        version: app.getVersion(),
        platform: `${process.platform} ${process.arch}`,
      }, {
        authorization: `Bearer ${token}`,
        'x-mmodels-device': deviceId(),
      });
      const status = persistAuth(local.username, local.password, { ...data, token });
      return { status, awarded: finiteNonNegative(data.awarded) ?? 0 };
    }, '提交反馈'),
  );

  ipcMain.handle(
    IPC.ACCOUNT_LOGOUT,
    safeWrap(async (): Promise<AccountStatusInfo> => {
      // 先请服务端吊销令牌（离线或服务不可用时忽略），再清本地凭证。
      // 只删本地文件的话，令牌一旦泄漏，服务端仍会认它。
      try {
        const token = tokenFromDisk();
        if (token) {
          await callApi('/api/account/logout', {}, {
            authorization: `Bearer ${token}`,
            'x-mmodels-device': deviceId(),
          });
        }
      } catch { /* 退出登录不能被网络问题挡住 */ }
      try { rmSync(accountFile(), { force: true }); } catch { /* 忽略 */ }
      try { rmSync(tokenFile(), { force: true }); } catch { /* 忽略 */ }
      return { loggedIn: false, username: '', expiresAt: 0 };
    }, '退出登录'),
  );
}
