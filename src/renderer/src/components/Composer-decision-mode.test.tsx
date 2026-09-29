/**
 * Composer 决策模式 / 协作开关的静态渲染冒烟（2026-09-20；2026-09-26 随布局改版更新）。
 *
 * 2026-09-26 布局改版（用户钦定）：
 *   ① 决策模式 chip 从顶部上下文栏（cz-bar）**移到底部栏（cz-foot）**，
 *      放在「多智能体协作」旁边；命名改为 人工精细建模 / AI 全流程自动 / 先规划；
 *   ② 多智能体协作 —— 底部栏常驻显眼开关（2026-09-20 原需求不变）；
 *   ③ 任务深度（快速/标准/深度）chip 从左侧移到右侧模型选择旁（另一测试不覆盖，运行测试验证）。
 *
 * node 环境（无 DOM）：zustand 只能读到初始 state（settings 未设 ⇒ decisionMode
 * 显示默认「人工精细」），Popover 关闭态不渲染菜单内容 —— 所以只断言 chip/按钮本身，
 * 菜单内部留给运行测试验证。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { Composer } from './Composer';

const noop = (): void => {};

function renderComposer(): string {
  return renderToStaticMarkup(
    <Composer value="" onChange={noop} onSend={noop} onAbort={noop} isRunning={false} />,
  );
}

describe('Composer 决策模式与协作开关（静态冒烟）', () => {
  it('决策模式 chip 常驻渲染（现居底部栏），默认决策方式是「人工精细」', () => {
    const html = renderComposer();
    // title 是 tx() 的译文（不是键名），断言译文片段
    expect(html).toContain('决策方式');
    expect(html).toContain('人工精细');
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

  it('# 技能面板的价格列不再挤压说明，卡密 VIP 显示 VIP无限', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/components/Composer.tsx'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/pages.css'), 'utf8');
    expect(source).toContain("className={`hash-pop-cost${hashPricingIsPaidVip ? ' is-vip' : ''}`}");
    expect(source).toContain("hashPricingIsPaidVip ? 'VIP无限' : hashTaskCost(it)");
    expect(source).not.toContain('hashTaskCost(it)} 积分 / 回合');
    expect(css).toContain('.hash-pop .grow {');
    expect(css).toContain('.hash-pop .hash-pop-cost.is-vip');
  });
});
