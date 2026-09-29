/**
 * 首次运行向导的轻量事件总线 —— 设置页「新手教程」里的"重新运行首次引导"
 * 用它把 App.tsx 顶层的 showWizard 状态重新拉起来（跨组件直接开弹窗，
 * 与 membership-nav.ts 同一套模式）。
 */
export const SHOW_ONBOARDING_EVENT = 'mm:show-onboarding';

export function showOnboarding(): void {
  window.dispatchEvent(new CustomEvent(SHOW_ONBOARDING_EVENT));
}

export function onShowOnboarding(fn: () => void): () => void {
  const handler = (): void => fn();
  window.addEventListener(SHOW_ONBOARDING_EVENT, handler);
  return () => window.removeEventListener(SHOW_ONBOARDING_EVENT, handler);
}
