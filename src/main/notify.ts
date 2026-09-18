/**
 * 系统通知的**唯一出口** —— 设置里「允许系统通知」(`settings.notifyEnabled`) 在这里生效。
 *
 * 为什么必须集中到一处：
 *   `new Notification(...)` 全仓有 2 个创建点 —— `ipc/app.ts` 的 `notify:show`
 *   与 `ipc/automation.ts` 的「自动化跑完提醒」。门禁如果写在各自调用点上，
 *   以后新增第三个创建点的人**大概率会忘**；只要漏一处，用户把开关关掉照样被弹窗
 *   打扰，而且这种漏在界面上看不出来（开关拨到哪边都"能用"）。
 *   所以门禁只写这一份，`src/main/notify.test.ts` 里还有一条结构级断言盯着
 *   「主进程里不许绕过本文件直接 new Notification」。
 *
 * 默认值对齐原版 —— **结论**：原版渲染层"**开关未设置 = 开启**"（空值合并到 true），
 *   只有显式关掉才拦；并且发送前还要「窗口可见且有焦点就不弹」。
 *   本项目沿用「未设置 = 开启」（判的是"不等于 `false`"），
 *   后半条由各调用点自己判（`automation.ts` 已经只在窗口失焦时才弹）。
 *   原版这个开关的界面文案是「任务完成通知」+「聊天完成或在后台等待工具审批时发送系统通知」。
 *
 * 除了开关，本文件还承担**未读徽标**（原版那段也在主进程的通知创建路径里，
 * 和开关一样"只写一份"）：见下方 `bumpUnreadBadge` / `clearUnreadBadge`。
 *
 * ⚠️ 原版那两行判据的**逐字原文**已搬到
 *   `.workbuddy/ui-audit/verify/original-code-dumps.md §2`。
 *   搬出去的理由见 `WRITE-RULES.md §8`：**注释里逐字引用的原文会被 `grep -c` 一起数上**，
 *   给出一个看起来像样的错数字（真实事故：期望 10、实跑 15）。
 */
import { BrowserWindow, Notification, app } from 'electron';
import { getSettings } from './store/config';
import type { AppSettings } from '@shared/types';

/** 通知构造入参（只取本项目用到的三个字段） */
export interface SystemNotificationInit {
  title: string;
  body?: string;
  silent?: boolean;
}

/** 通知句柄 —— 只暴露本项目用到的那两个方法，便于单测塞假构造器 */
export interface SystemNotificationHandle {
  on(event: 'click', listener: () => void): void;
  show(): void;
}

/** 造一个通知对象。抽成参数是为了单测能注入假构造器并断言**调用次数**。 */
export type NotificationFactory = (init: SystemNotificationInit) => SystemNotificationHandle;

/**
 * 开关是否允许弹系统通知。
 *
 * **未设置视为开启**（原版默认值），只有显式 `false` 才拦 ——
 * 老用户设置里没有这个字段时不能因为"读不到"就把通知全掐了。
 */
export function notificationsEnabled(
  settings: Pick<AppSettings, 'notifyEnabled'> | null | undefined = getSettings(),
): boolean {
  return settings?.notifyEnabled !== false;
}

const electronFactory: NotificationFactory = (init) => new Notification(init);

// ─────────────────────────────────────────────────────────────
// 未读徽标（对应原版主进程里的 `setBadgeCount` / 计数归零那一段）
// ─────────────────────────────────────────────────────────────
/**
 * 原版主进程的形态（`out/main/index.js`，**已混淆**，变量名按语义重命名）：
 *
 *   let unread = 0;
 *   const apply = () => app.setBadgeCount(unread);
 *   const clear = () => { unread !== 0 && (unread = 0, apply()); };   // 清零时 0 不重复刷
 *   // 创建通知前：
 *   //   (win.visible && !win.minimized && win.focused) || (unread = Math.min(unread + 1, 99), apply())
 *   // 点击通知时：clear()
 *
 * 搬进来的理由和开关一样 —— **只写一份**：以后新增第三个通知创建点，
 * 不会有人记得补"未读 +1"和"点击清零"。
 */

/** 未读徽标上限 —— 逐字取自原版 `Math.min(MA + 1, 0x63)`（`0x63` = 99） */
export const MAX_BADGE_COUNT = 99;

let unreadBadge = 0;

/** 当前未读数（供单测与诊断读取） */
export function unreadBadgeCount(): number {
  return unreadBadge;
}

/**
 * 主窗口此刻是不是"用户正看着"：`isVisible() && !isMinimized() && isFocused()` ——
 * 三项逐字对齐原版那段判据；取的是**单个主窗口**，所以用 `find` 而不是 `some`。
 *
 * ⚠️ 这是**主进程侧**的"注意力"判断，与渲染层的 `ZI()`（`document.visibilityState` +
 *    `hasFocus()`）是同一件事的两个视角：渲染层只看得到被遮挡，主进程还多知道"最小化"。
 */
export function isWindowAttentive(): boolean {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  return !!win && win.isVisible() && !win.isMinimized() && win.isFocused();
}

/** 把当前未读数刷到系统徽标 */
function applyBadge(): void {
  try {
    // ⚠️ `setBadgeCount` 在 **Windows 上是 no-op**：本仓 electron 43.3.0 的类型声明把它
    //    标成 `@platform linux,darwin`（`node_modules/electron/electron.d.ts:1695`）
    //    —— 本机（Windows）看不到效果是**预期**，不是没接上。
    //    `?.` + try/catch 是给"没有 Electron 运行时"的单测环境留的（那里 `app` 是 undefined）。
    app?.setBadgeCount?.(unreadBadge);
  } catch {
    /* 徽标是装饰性的：刷不上不影响通知本身，也不该让调用方去 try/catch */
  }
}

/** 未读 +1（封顶 99）并刷新徽标；返回新的未读数 */
export function bumpUnreadBadge(): number {
  unreadBadge = Math.min(unreadBadge + 1, MAX_BADGE_COUNT);
  applyBadge();
  return unreadBadge;
}

/** 清零并刷新徽标 —— 原版在**点击通知**时调；已经是 0 时不重复刷系统调用 */
export function clearUnreadBadge(): void {
  if (unreadBadge === 0) return;
  unreadBadge = 0;
  applyBadge();
}

/** 单测用：复位模块级计数（产品语义里没有"手动重置未读"这回事） */
export function resetUnreadBadgeForTest(): void {
  unreadBadge = 0;
}

/**
 * 创建系统通知；**不允许弹的时候返回 `null`**。
 *
 * ⚠️ 返回 `null` 的语义是"**不创建**"，不是"创建一个空通知再静默失败"：
 *   调用方拿到 `null` 就直接跳过，连 click 监听都不会挂上 —— 开关关掉后
 *   既不会留一个永远不触发的监听，也不会白建一个永远不会 show 的对象。
 *
 * 三道门禁/副作用依次是：
 *   1. 用户在设置里关掉了「允许系统通知」→ 不创建；
 *   2. 系统层面不支持通知（Windows 通知服务被关 / 部分 Linux 桌面环境）→ 不创建；
 *   3. 用户**没在看窗口** → 未读徽标 +1（这一步不影响创建与否）；
 *   4. 返回的句柄被**包了一层**：`click` 一律先清零徽标再交给调用方的监听器
 *      —— 挂在包装里而不是各调用点，理由同顶部那段"门禁只写一份"。
 *
 * 第 3 步的判据可以注入（`attentive`），这样单测不用起 Electron 也能测。
 */
export function createSystemNotification(
  init: SystemNotificationInit,
  factory: NotificationFactory = electronFactory,
  attentive: () => boolean = isWindowAttentive,
): SystemNotificationHandle | null {
  if (!notificationsEnabled()) return null;
  if (!Notification.isSupported()) return null;
  // 原版写法是 `(...三者皆真) || (未读+1)` —— 即"用户看着就不加，否则加"
  if (!attentive()) bumpUnreadBadge();
  const inner = factory(init);
  return {
    on: (event, listener) => {
      inner.on(event, () => {
        clearUnreadBadge();
        listener();
      });
    },
    show: () => inner.show(),
  };
}
