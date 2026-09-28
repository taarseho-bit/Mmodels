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
