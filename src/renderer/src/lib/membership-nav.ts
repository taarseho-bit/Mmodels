/** 账号与会员中心的轻量事件总线，避免把弹窗状态塞进项目 store。 */
export type MembershipCenterView = 'account' | 'plans' | 'redeem' | 'points';

export const OPEN_MEMBERSHIP_EVENT = 'mm:open-membership';

export function openMembership(view: MembershipCenterView = 'plans'): void {
  window.dispatchEvent(new CustomEvent<MembershipCenterView>(OPEN_MEMBERSHIP_EVENT, { detail: view }));
}

export function onOpenMembership(fn: (view: MembershipCenterView) => void): () => void {
  const handler = (event: Event): void => {
    const value = (event as CustomEvent<MembershipCenterView>).detail;
    fn(value === 'account' || value === 'redeem' || value === 'points' ? value : 'plans');
  };
  window.addEventListener(OPEN_MEMBERSHIP_EVENT, handler);
  return () => window.removeEventListener(OPEN_MEMBERSHIP_EVENT, handler);
}

/**
 * 账号状态广播：会员弹窗里签到/兑换/登录之后，左下角账号芯片等常驻 UI
 * 要立即跟上。类型用结构化的 unknown 传递（这里不 import shared 类型，
 * 保持本模块零依赖 —— 订阅方自己收窄）。
 */
export const ACCOUNT_STATUS_EVENT = 'mm:account-status';

export function notifyAccountStatus(status: unknown): void {
  window.dispatchEvent(new CustomEvent(ACCOUNT_STATUS_EVENT, { detail: status }));
}

export function onAccountStatus(fn: (status: unknown) => void): () => void {
  const handler = (event: Event): void => {
    fn((event as CustomEvent).detail);
  };
  window.addEventListener(ACCOUNT_STATUS_EVENT, handler);
  return () => window.removeEventListener(ACCOUNT_STATUS_EVENT, handler);
}
