import {
  CHAT_POINT_COSTS,
  type AccountPlan,
  type AccountStatusInfo,
  type ChatPointCostKind,
  type EntitlementReason,
  type MembershipFeature,
} from './types';

/** 会员状态判断全部集中在这里，主进程和渲染层可以共用同一套口径。 */
export function isPaidVip(account: Pick<AccountStatusInfo, 'plan' | 'expiresAt'> | null | undefined, now = Date.now()): boolean {
  return account?.plan === 'vip' && Number(account.expiresAt) > now;
}

/** 试用只看服务端下发的状态/截止时间；本地不能凭注册时间把它延长。 */
export function isTrialActive(
  account: Pick<AccountStatusInfo, 'trialActive' | 'trialExpiresAt'> | null | undefined,
  now = Date.now(),
): boolean {
  // 只有带有明确的服务端截止时间才算试用中。trialActive 只是兼容旧缓存的
  // 展示字段，缺少 trialExpiresAt 时不能把账号永久当成试用状态。
  return Number.isFinite(Number(account?.trialExpiresAt)) && Number(account?.trialExpiresAt) > now;
}

/** 试用窗口不能获得付费 VIP 专属能力。 */
export function featureRequiresPaidVip(feature: MembershipFeature): boolean {
  // 团队型能力是付费分界：多智能体、云协作和自动化都要求卡密 VIP；
  // 24 小时体验仍可试用单体建模、论文、深度建模和图表能力。
  return feature === 'multi-agent' || feature === 'cloud-collaboration' || feature === 'automation';
}

/**
 * 本地 UI 预检查。它只负责让按钮尽早呈现正确状态，真正执行前仍须走服务端。
 * 基础论文写作故意不放入 VIP 专属集合：免费用户也能用基础能力完成一篇论文。
 */
export function localFeatureAccess(
  feature: MembershipFeature,
  account: AccountStatusInfo | null | undefined,
  pointsCost = 0,
  now = Date.now(),
): { allowed: boolean; reason: EntitlementReason; balancePoints?: number; costPoints?: number } {
  if (!account?.loggedIn) return { allowed: false, reason: 'login-required', costPoints: pointsCost || undefined };

  const paidVip = isPaidVip(account, now);
  const trial = isTrialActive(account, now);
  const balance = typeof account.pointsBalance === 'number'
    ? account.pointsBalance
    : typeof account.points === 'number' ? account.points : undefined;

  if (featureRequiresPaidVip(feature) && !paidVip) {
    return {
      allowed: false,
      reason: trial ? 'paid-vip-required' : 'vip-required',
      ...(typeof balance === 'number' ? { balancePoints: balance } : {}),
      ...(pointsCost > 0 ? { costPoints: pointsCost } : {}),
    };
  }

  // 试用和付费 VIP 不扣统一积分；免费用户仅在服务端明确给出余额时预检查。
  const chargeable = !paidVip && !trial && pointsCost > 0;
  if (chargeable && typeof balance === 'number' && balance < pointsCost) {
    return { allowed: false, reason: 'points-insufficient', balancePoints: balance, costPoints: pointsCost };
  }

  return {
    allowed: true,
    reason: 'allowed',
    ...(typeof balance === 'number' ? { balancePoints: balance } : {}),
    ...(pointsCost > 0 ? { costPoints: paidVip || trial ? 0 : pointsCost } : {}),
  };
}

/** 将输入/模式映射为统一积分成本；服务端可以用更严格的最终值覆盖。 */
export function pointCostForTurn(input: {
  paper?: boolean;
  review?: boolean;
  figure?: boolean;
  strict?: boolean;
  collaboration?: boolean;
}): { kind: ChatPointCostKind; cost: number } {
  if (input.collaboration) return { kind: 'collaboration', cost: CHAT_POINT_COSTS.collaboration };
  if (input.strict) return { kind: 'strict', cost: CHAT_POINT_COSTS.strict };
  if (input.review) return { kind: 'review', cost: CHAT_POINT_COSTS.review };
  if (input.paper) return { kind: 'paper', cost: CHAT_POINT_COSTS.paper };
  if (input.figure) return { kind: 'figure', cost: CHAT_POINT_COSTS.figure };
  return { kind: 'basic', cost: CHAT_POINT_COSTS.basic };
}

/** 统一从新旧状态字段读取积分，兼容尚未迁移的账号。 */
export function pointsBalanceOf(account: Pick<AccountStatusInfo, 'points' | 'pointsBalance' | 'pointWallet'> | null | undefined): number | undefined {
  if (typeof account?.pointWallet?.balance === 'number') return Math.max(0, account.pointWallet.balance);
  if (typeof account?.pointsBalance === 'number') return Math.max(0, account.pointsBalance);
  if (typeof account?.points === 'number') return Math.max(0, account.points);
  return undefined;
}

/** 只为类型文档和迁移代码提供一个明确的旧档位别名。 */
export type LegacyAccountPlan = AccountPlan;
