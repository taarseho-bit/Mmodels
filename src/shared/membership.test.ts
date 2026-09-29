import { describe, expect, it } from 'vitest';
import { CHAT_POINT_COSTS, type AccountStatusInfo } from './types';
import { featureRequiresPaidVip, isPaidVip, isTrialActive, localFeatureAccess, pointCostForTurn, pointsBalanceOf } from './membership';

const now = 1_700_000_000_000;
const account = (patch: Partial<AccountStatusInfo> = {}): AccountStatusInfo => ({
  loggedIn: true,
  username: 'demo',
  expiresAt: 0,
  points: 10,
  ...patch,
});
describe('会员统一权益口径', () => {
  it('试用按 24 小时窗口判断，不能被当成付费 VIP', () => {
    expect(isTrialActive({ trialExpiresAt: now + 60 * 60 * 1000 }, now)).toBe(true);
    expect(isTrialActive({ trialExpiresAt: now - 1 }, now)).toBe(false);
    expect(isPaidVip(account({ plan: 'vip', expiresAt: now + 1000 }), now)).toBe(true);
    expect(isPaidVip(account({ plan: 'vip', expiresAt: now - 1 }), now)).toBe(false);
  });

  it('多智能体在试用期明确锁定，基础论文仍可用', () => {
    const trial = account({ trialActive: true, trialExpiresAt: now + 86_400_000, points: 0 });
    expect(featureRequiresPaidVip('multi-agent')).toBe(true);
    expect(localFeatureAccess('multi-agent', trial, 8, now)).toMatchObject({
      allowed: false,
      reason: 'paid-vip-required',
    });
    expect(localFeatureAccess('full-paper', trial, 3, now)).toMatchObject({ allowed: true, costPoints: 0 });
  });

  it('免费用户按积分余额预检查，积分不足时不启动任务', () => {
    const free = account({ pointsBalance: 2, points: undefined });
    expect(localFeatureAccess('ai-chat', free, 1, now)).toMatchObject({ allowed: true, balancePoints: 2, costPoints: 1 });
    expect(localFeatureAccess('full-paper', free, 3, now)).toMatchObject({ allowed: false, reason: 'points-insufficient' });
    expect(pointsBalanceOf(free)).toBe(2);
  });

  it('积分成本档位稳定且可供输入框显示', () => {
    expect(pointCostForTurn({}).cost).toBe(CHAT_POINT_COSTS.basic);
    expect(pointCostForTurn({ paper: true }).cost).toBe(CHAT_POINT_COSTS.paper);
    expect(pointCostForTurn({ collaboration: true, paper: true }).cost).toBe(CHAT_POINT_COSTS.collaboration);
  });
});
