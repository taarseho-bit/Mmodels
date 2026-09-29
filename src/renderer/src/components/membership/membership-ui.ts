import type { AccountStatusInfo } from '@shared/types';

/**
 * 会员中心统一口径：新账号的免费体验按 24 小时展示。
 * 服务端兼容接口仍可能只返回 trialDaysLeft，因此界面优先使用 expiresAt
 * 计算小时，缺失时再回退到天数，避免历史账号出现空白状态。
 */
export const TRIAL_WINDOW_HOURS = 24;
export const POINTS_PER_BASIC_CHAT = 10;

type ExtendedAccountStatus = AccountStatusInfo & {
  conversationPoints?: number;
  aiPoints?: number | { balance?: number; remaining?: number };
  chatPoints?: number;
  pointWallet?: { balance?: number };
};

export function isPaidVip(status: AccountStatusInfo | null | undefined): boolean {
  return status?.loggedIn === true && status.plan === 'vip' && Number(status.expiresAt) > Date.now();
}

export function isActiveTrial(status: AccountStatusInfo | null | undefined): boolean {
  if (status?.loggedIn !== true || isPaidVip(status)) return false;
  // trialActive 只是历史缓存里的展示字段；没有明确的服务端截止时间时
  // 不在界面上放行体验权益，避免旧缓存把账号永久显示成试用状态。
  return Number.isFinite(Number(status.trialExpiresAt)) && Number(status.trialExpiresAt) > Date.now();
}

export function trialHoursLeft(status: AccountStatusInfo | null | undefined): number {
  if (!isActiveTrial(status)) return 0;
  const expiry = Number(status?.trialExpiresAt) || Number(status?.expiresAt) || 0;
  if (expiry > 0) return Math.max(0, Math.ceil((expiry - Date.now()) / 3_600_000));
  return Math.max(0, Math.ceil(Number(status?.trialDaysLeft ?? 0) * 24));
}

/**
 * 兼容积分统一改造前后的状态：新服务端可返回 conversationPoints / aiPoints，
 * 旧服务端只有 aiQuota.remaining，此时按每次基础对话 10 分换算显示。
 * 这只负责展示，真正扣减仍由主进程和服务端决定。
 */
export function conversationPointsLeft(status: AccountStatusInfo | null | undefined): number | null {
  if (!status?.loggedIn) return null;
  const extended = status as ExtendedAccountStatus;
  for (const value of [
    extended.conversationPoints,
    typeof extended.aiPoints === 'number' ? extended.aiPoints : extended.aiPoints?.balance,
    extended.chatPoints,
    extended.pointWallet?.balance,
    status.pointsBalance,
  ]) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  }
  const remaining = status.aiQuota?.remaining;
  return typeof remaining === 'number' ? Math.max(0, Math.floor(remaining * POINTS_PER_BASIC_CHAT)) : null;
}

export function pointsBalance(status: AccountStatusInfo | null | undefined): number {
  const extended = status as ExtendedAccountStatus | null | undefined;
  const candidate = status?.pointWallet?.balance
    ?? status?.pointsBalance
    ?? status?.points
    ?? (typeof extended?.aiPoints === 'object' ? extended.aiPoints?.balance : extended?.aiPoints);
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(0, Math.floor(candidate));
  // 历史本地账号可能只有旧的 aiQuota.remaining；沿用统一的积分口径，
  // 避免 VIP 登录后账号芯片误显示为 0。
  return conversationPointsLeft(status) ?? 0;
}
