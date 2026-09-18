/**
 * 运行时状态守卫。
 *
 * 为什么需要这个：Electron 默认的 `window-all-closed` 行为是**退出整个应用**。
 * 但我们在若干场景下会临时创建隐藏窗口（界面截图渲染），
 * 这时主窗口可能还没建、或者已经被关掉 —— 一旦被判定为「所有窗口关闭」，
 * 应用会当场退出，正在跑的生成任务全部腰斩。
 *
 * 所以用一个显式的标志位拦住退出逻辑。
 * （这是软著通项目里踩过的坑，原样搬过来。）
 */

let screenshotRendering = 0;

/** 进入截图渲染状态，返回一个 release 函数 */
export function enterScreenshotRendering(): () => void {
  screenshotRendering += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    screenshotRendering = Math.max(0, screenshotRendering - 1);
  };
}

export function isRenderingScreenshots(): boolean {
  return screenshotRendering > 0;
}

/** 应用是否正在退出（供长任务判断要不要提前收尾） */
let quitting = false;
export function markQuitting(): void {
  quitting = true;
}
export function isQuitting(): boolean {
  return quitting;
}
