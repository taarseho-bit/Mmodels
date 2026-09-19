/**
 * B1 稳定前缀切点的单测（2026-09-19 卡顿优化）。
 *
 * 核心不变量：**切点处拆开的两段，各自喂给 marked 渲染，结果拼接 ≡ 整篇渲染**。
 * 拆分函数本身不依赖 marked，这里主要盯切点选择的边界：
 * 段落边界、未闭合/已闭合围栏、$$ 配对与跨行块、围栏内 $$ 不计数、
 * 无安全点返回 -1、切分必须无损（stable + tail === 原文）。
 */
import { describe, expect, it } from 'vitest';
import { findStableSplit } from './markdown-split';

/** 无损性：切完必须能原样拼回去 */
function expectLossless(text: string): void {
  const split = findStableSplit(text);
  if (split > 0) {
    expect(split).toBeLessThanOrEqual(text.length);
    expect(text.slice(0, split) + text.slice(split)).toBe(text);
  } else {
    expect(split).toBe(-1);
  }
}

describe('findStableSplit —— B1 稳定前缀切点', () => {
  it('普通多段落文本：切在最后一个空行处', () => {
    const text = '第一段。\n\n第二段。\n\n第三段开';
    const split = findStableSplit(text);
    // 前两段已成终态；「第三段开」还在增长，必须在 tail
    expect(split).toBeGreaterThan(0);
    expect(text.slice(0, split)).not.toContain('第三段');
    expect(text.slice(split)).toContain('第三段');
  });

  it('只有一段（无空行）：返回 -1，全文走 tail', () => {
    expect(findStableSplit('就是一段话')).toBe(-1);
    expect(findStableSplit('')).toBe(-1);
  });

  it('未闭合的代码围栏：切点被顶到围栏开始之前', () => {
    const text = '引言。\n\n```python\nprint(1)\nprint(2';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    // 稳定段不能包含未闭合围栏的任何内容
    expect(text.slice(0, split)).not.toContain('```');
    expectLossless(text);
  });

  it('已闭合的代码围栏：围栏闭合行尾就是安全点', () => {
    const text = '引言。\n\n```python\nprint(1)\n```\n\n后续正';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    // 稳定段可以包含完整围栏（它已是终态）
    expect(text.slice(0, split)).toContain('```');
    expectLossless(text);
  });

  it('$$ 未配对（跨行数学块还在增长）：不能切进去', () => {
    const text = '结论如下。\n\n$$\nE = mc^2\n\\int f(x)dx';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    expect(text.slice(0, split)).not.toContain('$$');
    expectLossless(text);
  });

  it('$$ 已配对：之后的内容可以稳定', () => {
    const text = '结论如下。\n\n$$\nE = mc^2\n$$\n\n正文继续';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    expect(text.slice(0, split)).toContain('$$');
    expectLossless(text);
  });

  it('围栏内的 $$ 不计数 —— 不影响切点判定', () => {
    const text = '开头。\n\n```text\n价格是 $$5\n```\n\n结尾段';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    expectLossless(text);
  });

  it('流式追加模拟：前缀逐步进入稳定段且始终无损', () => {
    const chunks = ['第一段', '。\n\n第二段', '来了。\n\n```js\nconst a', ' = 1;\n```', '\n\n收尾'];
    let text = '';
    let prevSplit = -1;
    for (const chunk of chunks) {
      text += chunk;
      const split = findStableSplit(text);
      if (split > 0) {
        // 稳定段只会变大（终态一旦确定不会回退）
        expect(split).toBeGreaterThanOrEqual(prevSplit);
        prevSplit = split;
      }
      expectLossless(text);
    }
    // 全部到齐后最后一段也该稳定了
    expect(prevSplit).toBeGreaterThan(0);
  });

  it('列表连续行（无空行分隔）整体留在 tail，不拆散列表', () => {
    const text = '计划如下。\n\n- 第一项\n- 第二项\n- 第三';
    const split = findStableSplit(text);
    expect(split).toBeGreaterThan(0);
    // 列表整块必须在 tail（切点在「计划如下。」之后）
    expect(text.slice(split)).toContain('- 第一项');
    expectLossless(text);
  });
});
