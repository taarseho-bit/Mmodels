import { describe, expect, it } from 'vitest';
import { collaborationPolicyFor, collaborationPolicyPrompt, DEFAULT_MAX_PARALLEL_AGENTS, skillRouteHints } from './orchestration-policy';

describe('数模协作编排策略', () => {
  it('默认限制为两位并行成员', () => {
    expect(DEFAULT_MAX_PARALLEL_AGENTS).toBe(2);
    expect(collaborationPolicyFor('paper')).toMatchObject({ maxParallelAgents: 2, maxTotalAgents: 4 });
  });

  it('不同任务采用不同阶段和预算', () => {
    expect(collaborationPolicyFor('audit')).toMatchObject({ maxParallelAgents: 1, maxTotalAgents: 2 });
    expect(collaborationPolicyFor('review')?.stages).toEqual(['结构检查', '结果复核', '修改清单']);
  });

  it('未触发协作时不注入工作流指令', () => {
    expect(collaborationPolicyPrompt(null)).toEqual([]);
    expect(collaborationPolicyPrompt('complex').join('\n')).toContain('质量门');
  });

  it('按任务给出有限且不重复的技能方向', () => {
    const hints = skillRouteHints('请读取 Excel 数据，完成清洗、建模、绘图并写成论文，最后检查页数');
    expect(hints.length).toBeGreaterThan(4);
    expect(new Set(hints.map(h => h.id)).size).toBe(hints.length);
    expect(hints.map(h => h.id)).toContain('data-auditor-cleaner');
    expect(hints.map(h => h.id)).toContain('paper-page-fit');
  });
});
