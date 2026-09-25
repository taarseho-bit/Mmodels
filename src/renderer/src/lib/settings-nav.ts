/**
 * 页面跳转总线 —— 让任意位置（扩展页的「跳到运行环境」、教程卡的「开始教程」等）
 * 能精确打开设置页的**指定分区**，或者跳到别的页面，
 * 而不必把状态塞进 store（store 正被多个改动并行编辑，用事件总线避免写入冲突）。
 *
 * 用法：
 *   import { openSettings, openRoute } from '../lib/settings-nav';
 *   openSettings('env');        // 打开设置页并切到「运行环境」
 *   openSettings();             // 打开设置页（默认分区）
 *   openRoute('gallery');       // 切到「科研绘图」页
 *   openRoute('extensions', undefined, 'algorithms'); // 切到扩展页并停在「算法」分区
 *
 * 监听方：App.tsx（切路由 / 记下分区）、SettingsPage.tsx（切分区）、
 *        ExtensionsPage.tsx（切 tab）。
 */
export const OPEN_SETTINGS_EVENT = 'mm:open-settings';

/** 页面跳转事件（不与 openSettings 共用：一个只改设置分区，一个改整页路由） */
export const OPEN_ROUTE_EVENT = 'mm:open-route';

export interface OpenSettingsDetail {
  /** 目标分区 id（见 SettingsPage 的 SectionId），省略则保持/默认「论文默认规则」 */
  section?: string;
}

/** 可跳转的页面 —— 与 App.tsx 的 Route 联合保持一致（这里不带运行时依赖，故手写） */
export type AppRoute =
  | 'workbench'
  | 'chat'
  | 'gallery'
  | 'papers'
  | 'competitions'
  | 'datasets'
  | 'automation'
  | 'extensions'
  | 'settings';

export interface OpenRouteDetail {
  route: AppRoute;
  /**
   * 需要一并打开的右栏面板（对应原版「带我走到该功能」时顺便展开的面板）。
   * 见 store/app.ts 的 SidePanelTab。
   */
  panel?: string;
  /**
   * 目标页面内部的**分区**（目前只有扩展页用得上）。
   * 原版跳转带的是 `u({to:"/extensions", search:{section:"skills"}})` ——
   * 「＋」菜单的「管理技能/算法/连接器/插件」四行都落在扩展页的不同 tab 上，
   * 不带这一项就只会停在默认的「技能」tab（算法/连接器/插件三行会指错地方）。
   */
  section?: string;
}

export function openSettings(section?: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenSettingsDetail>(OPEN_SETTINGS_EVENT, { detail: { section } }),
  );
}

/** 订阅设置页跳转事件（返回退订函数） */
export function onOpenSettings(fn: (detail: OpenSettingsDetail) => void): () => void {
  const handler = (e: Event): void => fn((e as CustomEvent<OpenSettingsDetail>).detail ?? {});
  window.addEventListener(OPEN_SETTINGS_EVENT, handler);
  return () => window.removeEventListener(OPEN_SETTINGS_EVENT, handler);
}

/** 跳到某个页面（可顺带展开右栏面板、切到页面内某个分区） */
export function openRoute(
  route: AppRoute,
  panel?: OpenRouteDetail['panel'],
  section?: OpenRouteDetail['section'],
): void {
  window.dispatchEvent(
    new CustomEvent<OpenRouteDetail>(OPEN_ROUTE_EVENT, { detail: { route, panel, section } }),
  );
}

/** 订阅页面跳转事件（返回退订函数） */
export function onOpenRoute(fn: (detail: OpenRouteDetail) => void): () => void {
  const handler = (e: Event): void => fn((e as CustomEvent<OpenRouteDetail>).detail ?? { route: 'chat' });
  window.addEventListener(OPEN_ROUTE_EVENT, handler);
  return () => window.removeEventListener(OPEN_ROUTE_EVENT, handler);
}
