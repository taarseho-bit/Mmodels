/**
 * 导出/分享的默认文件名 —— 逐字复刻原版 `uw()`（decoded main @852731）。
 *
 * ⚠️ 这是**渲染层**的函数，位置也和原版一致：原版里 `uw()` 就在渲染层 bundle 中
 *    （导出/打包/分享三处菜单项都调它）。所以它不放在 `main/`，也不需要 IPC 绕一圈。
 *
 * 原版函数 `uw()` 的**逐字原文**已搬到
 * `.workbuddy/ui-audit/verify/original-code-dumps.md §6`
 * （搬出去的理由见 `WRITE-RULES.md §8`：注释里逐字引用的原文会被 `grep -c`
 * 一起数上，给出看起来像样的错数字）。要点：清洗非法字符 → 截断 48 → 取 UTC
 * 日期（`yyyymmdd`）→ 拼成 `mathmodel-chat-<标题>-<日期>.<扩展名>`。
 *
 * 产出形如：`mathmodel-chat-2026年A题-20260917.json`
 *
 * ⚠️ 两处**刻意保留**的原版行为，别"顺手修"：
 *   1. 清洗只去掉 Windows 非法字符 `[/\:*?"<>|]`，**保留中文、空格、连字符** ——
 *      用户看到的是可读标题（原版如此）。
 *   2. 日期取 `toISOString()`，即 **UTC 日期** —— 在 UTC+8 的凌晨（0–8 点）会显示前一天。
 *      照抄原版；改成本地日期会让同一份文件在原版与复刻里的名字对不上。
 */
export function exportFileName(title: string, ext: string): string {
  const clean = (title ?? '').replace(/[/\\:*?"<>|]/g, '').trim().slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  return `mathmodel-chat-${clean || 'untitled'}-${stamp}.${ext}`;
}
