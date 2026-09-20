/**
 * Composer 决策模式 / 协作开关的静态渲染冒烟（2026-09-20）。
 *
 * 用户需求的两处 UI 落点：
 *   ① 决策模式 chip —— 与任务模式正交的「怎么做决定」选择器（先规划/精细/AI 自动），
 *      落在任务模式 chip 旁边（cz-bar）；
 *   ② 多智能体协作 —— 从「选项」菜单拎出来，变成底部栏常驻显眼开关。
 *
 * node 环境（无 DOM）：zustand 只能读到初始 state（settings 未设 ⇒ decisionMode
 * 显示默认「精细」），Popover 关闭态不渲染菜单内容 —— 所以只断言 chip/按钮本身，
 * 菜单内部留给实机验证。
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from './Composer';

const noop = (): void => {};

function renderComposer(): string {
  return renderToStaticMarkup(
    <Composer value="" onChange={noop} onSend={noop} onAbort={noop} isRunning={false} />,
  );
}

describe('Composer 决策模式与协作开关（静态冒烟）', () => {
  it('决策模式 chip 常驻渲染，默认决策方式是「精细」', () => {
    const html = renderComposer();
    // title 是 tx() 的译文（不是键名），断言译文片段
    expect(html).toContain('决策方式');
    expect(html).toContain('精细');
  });

  it('多智能体协作是底部栏常驻按钮（不再藏在「选项」菜单里）', () => {
    const html = renderComposer();
    expect(html).toContain('多智能体协作');
    expect(html).toContain('协作');
    // 旧的「选项」按钮已移除
    expect(html).not.toContain('任务选项');
  });

  it('先规划生效时横幅替换（planMode 派生自 decisionMode）—— 默认态不出现横幅', () => {
    const html = renderComposer();
    // 默认 decisionMode='manual'，不该出现先规划的运行横幅
    expect(html).not.toContain('先给出方案，不会改文件');
  });
});
