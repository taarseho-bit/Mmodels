/**
 * B1 流式渲染优化：稳定前缀切点（2026-09-19 卡顿优化）。
 *
 * 问题：流式输出时每个 token 到达都对**全文**重新 `marked.parse` ——
 *       一篇几千行的论文答案每 token O(n)，整轮 O(n²)，这是「流式时界面卡」的主嫌。
 *
 * 方案：把文本切成 `stable = source[0, split)`（已成终态，memo 命中、DOM 子树不重建）
 *       和 `tail = source[split..]`（每 token 增长，只解析这一小段）。
 *
 * 正确性依据：marked 的块级解析按空行分隔的 chunk 独立进行 —— 只要切点落在真正的
 * 块级边界（且不在未闭合围栏 / 未配对 $$ 内），「拆开解析」≡「整体解析」。
 * 单测在 `markdown-split.test.ts` 里盯行为；渲染侧在 `components/Markdown.tsx`。
 */

/**
 * 在流式文本里找「稳定前缀」切点，返回下标（`source.slice(0, split)` 为稳定段）。
 *
 * 切点必须满足两条：
 *   1. 落在块级边界（空行行尾）或围栏闭合行行尾；
 *   2. 切点之前的 ``` / ~~~ 围栏全部闭合、$$ 数学块全部配对（围栏内的 $$ 不计数）。
 *
 * 取**最后一个**安全切点：stable 越大单轮解析越少。
 * 找不到返回 -1 —— 此时全文走活跃尾部，行为与拆分前完全一致
 * （比如整篇只有一段、或围栏从头开到尾）。
 */
export function findStableSplit(text: string): number {
  const lines = text.split('\n');
  let fenceOpen = false;
  let dollarCount = 0;
  let lastSafe = -1;
  let offset = 0; // 当前行首在原文中的下标
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenceOpen = !fenceOpen;
      // 围栏刚闭合：围栏整体已成终态，行尾也是安全点
      if (!fenceOpen) lastSafe = offset + line.length;
    } else if (!fenceOpen) {
      dollarCount += (line.match(/\$\$/g) ?? []).length;
    }
    // 空行且围栏闭合、$$ 配对 → 块级边界，安全（最后一行之后不算，切了 tail 为空没意义）
    if (!fenceOpen && dollarCount % 2 === 0 && line.trim() === '' && i < lines.length - 1) {
      lastSafe = offset;
    }
    offset += line.length + 1;
  }
  return lastSafe;
}
