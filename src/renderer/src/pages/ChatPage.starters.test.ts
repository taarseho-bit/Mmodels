import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STARTERS } from './ChatPage';
import { skillIdFromPrompt, skillPointCost } from '@shared/skill-pricing';

describe('空会话快捷卡片计费', () => {
  it('八张建模快捷卡都绑定共享技能并在提示词中保留可识别命令', () => {
    expect(STARTERS).toHaveLength(8);
    const expected: Record<string, string> = {
      '找公开数据': 'data-search',
      '数据体检': 'data-auditor-cleaner',
      '方法选型': 'method-selector',
      '求解与复现': 'result-reproducibility',
      '灵敏度分析': 'robustness-checker',
      '论文成稿': 'write-paper',
      '投稿级图表': 'draw-figures',
      '评审与打分': 'review-paper',
    };
    for (const starter of STARTERS) {
      expect(starter.skillId, starter.title).toBe(expected[starter.title]);
      expect(starter.skillId, starter.title).toBeTruthy();
      expect(skillPointCost(starter.skillId), starter.title).toBeGreaterThan(0);
      expect(skillIdFromPrompt(starter.prompt), starter.title).toBe(starter.skillId);
    }
  });

  it('快捷卡不会把论文导出误当成独立扣分项', () => {
    expect(STARTERS.some((starter) => /导出/.test(starter.prompt))).toBe(false);
  });

  it('普通首页显示快捷卡，只有编辑器栏隐藏快捷卡', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/renderer/src/styles/resizable-panels.css'), 'utf8');
    expect(css).toContain('.editorview-chatcol:not(.is-main) .newchat-examples { display: none; }');
    expect(css).not.toContain('.editorview-chatcol .newchat-examples { display: none; }');
  });

  it('卡片只显示积分数字，完整说明放在提示信息中', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/src/pages/ChatPage.tsx'), 'utf8');
    expect(source).toContain('className="starter-cost"');
    expect(source).toContain('aria-label={`${skillPointCost(s.skillId) ?? 10} 积分`}');
    expect(source).not.toContain('积分/回合');
  });
});
