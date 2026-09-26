import type { MultiAgentTrigger } from '../ipc/session';

export interface SkillRouteHint {
  id: string;
  label: string;
  reason: string;
}

const SKILL_ROUTES: Array<{ pattern: RegExp; hints: SkillRouteHint[] }> = [
  { pattern: /论文|写作|成稿|排版|摘要|正文/, hints: [
    { id: 'problem-parser', label: '题目拆解', reason: '先把题目条件、问题和约束整理清楚' },
    { id: 'model-selection-audit', label: '模型选择核验', reason: '比较模型假设与题目条件是否匹配' },
    { id: 'paper-section-writer', label: '论文分段写作', reason: '按建模论文结构组织正文' },
    { id: 'paper-page-fit', label: '正文页数优化', reason: '提交前核验页数、图表和排版' },
    { id: 'latex-paper-audit', label: '论文编译检查', reason: '确认公式、目录和版面能正常生成' },
    { id: 'paper-table-repair', label: '表格排版修复', reason: '处理宽表、跨页和列宽不一致' },
  ] },
  { pattern: /评审|评阅|审阅|打分|诊断|修改意见/, hints: [
    { id: 'paper-review', label: '论文结构检查', reason: '从评审角度检查论文是否完整' },
    { id: 'claim-evidence-audit', label: '结论证据核验', reason: '确认结论能回到数据或复算结果' },
    { id: 'table-layout-audit', label: '表格排版检查', reason: '避免表格裁切、溢出或跨页混乱' },
  ] },
  { pattern: /数据|表格|excel|xlsx|csv|清洗|缺失|异常|预处理/, hints: [
    { id: 'data-auditor-cleaner', label: '数据审计清洗', reason: '检查字段、缺失值、异常值和单位' },
    { id: 'data-provenance', label: '数据来源记录', reason: '保留数据来源、版本和处理过程' },
    { id: 'result-reproducibility', label: '结果复现检查', reason: '确保计算可以重新运行得到相同结果' },
  ] },
  { pattern: /绘图|图表|可视化|流程图|示意图|热力图|散点图/, hints: [
    { id: 'scientific-figure-making', label: '科研图表制作', reason: '选择清晰、适合论文的图表表达方式' },
    { id: 'mathmodel-figure-templates', label: '建模图表模板', reason: '使用数学建模常用的图表版式' },
    { id: 'figure-quality-audit', label: '图表质量检查', reason: '检查字体、图例、分辨率和重叠' },
  ] },
  { pattern: /优化|规划|调度|分配|路径|算法|求解|仿真|预测/, hints: [
    { id: 'method-selector', label: '方法选择', reason: '根据问题类型筛选候选模型和算法' },
    { id: 'modeling-algorithms', label: '建模算法实现', reason: '选择可运行、可解释的求解方法' },
    { id: 'robustness-checker', label: '稳健性分析', reason: '检查参数变化对结论的影响' },
  ] },
  { pattern: /文献|引用|参考文献|资料检索|真实来源/, hints: [
    { id: 'literature-search', label: '真实文献检索', reason: '查找可核验的公开来源' },
    { id: 'verifying-bibliography', label: '参考文献核验', reason: '逐条检查作者、标题、年份和链接' },
    { id: 'citation-management', label: '引用整理', reason: '统一正文引用和参考文献格式' },
  ] },
  { pattern: /提交|交付|最终版|打包|比赛规则|匿名|页数限制/, hints: [
    { id: 'submission-package-audit', label: '提交材料核对', reason: '检查文件、命名、匿名和最终目录' },
    { id: 'competition-audit', label: '比赛要求核对', reason: '对照当前比赛信息检查硬性要求' },
    { id: 'paper-page-fit', label: '正文页数优化', reason: '确认正文没有超过比赛上限' },
    { id: 'quality-assurance-auditor', label: '交付质量复核', reason: '把内容、文件和可复算性一起过一遍' },
  ] },
];

/** 根据用户当前任务给出有限、可解释的技能建议；只用于路由提示，不强行调用。 */
export function skillRouteHints(prompt: string): SkillRouteHint[] {
  const text = prompt.replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out: SkillRouteHint[] = [];
  const seen = new Set<string>();
  for (const route of SKILL_ROUTES) {
    if (!route.pattern.test(text)) continue;
    for (const hint of route.hints) {
      if (seen.has(hint.id)) continue;
      seen.add(hint.id);
      out.push(hint);
      if (out.length >= 8) return out;
    }
  }
  return out;
}

/** 数模任务的协作编排策略：少量成员、清晰阶段、主助手统一收口。 */
export interface CollaborationPolicy {
  trigger: Exclude<MultiAgentTrigger, null>;
  maxParallelAgents: number;
  maxTotalAgents: number;
  stages: string[];
  qualityGate: string;
}

export const DEFAULT_MAX_PARALLEL_AGENTS = 2;

const POLICIES: Record<Exclude<MultiAgentTrigger, null>, CollaborationPolicy> = {
  paper: {
    trigger: 'paper', maxParallelAgents: 2, maxTotalAgents: 4,
    stages: ['题意与数据', '模型与计算', '图表与论文', '终审交付'],
    qualityGate: '结论必须能回到题目条件、数据或可复算结果，才能进入论文。',
  },
  review: {
    trigger: 'review', maxParallelAgents: 2, maxTotalAgents: 3,
    stages: ['结构检查', '结果复核', '修改清单'],
    qualityGate: '每条意见都要标出位置、证据和修改建议，不凭印象打分。',
  },
  audit: {
    trigger: 'audit', maxParallelAgents: 1, maxTotalAgents: 2,
    stages: ['材料核对', '提交前确认'],
    qualityGate: '只报告实际发现的缺项或不一致，不把未检查说成通过。',
  },
  'multi-file': {
    trigger: 'multi-file', maxParallelAgents: 2, maxTotalAgents: 3,
    stages: ['附件结构', '关键计算', '结果汇总'],
    qualityGate: '每个文件的结论都要说明来源和处理范围，避免把不同口径混在一起。',
  },
  complex: {
    trigger: 'complex', maxParallelAgents: 2, maxTotalAgents: 4,
    stages: ['问题拆解', '候选方案', '独立复核', '主助手收口'],
    qualityGate: '先确认边界和输入，再做计算；没有独立证据的结论不得直接交付。',
  },
};

export function collaborationPolicyFor(trigger: MultiAgentTrigger): CollaborationPolicy | null {
  return trigger ? POLICIES[trigger] : null;
}

export function collaborationPolicyPrompt(trigger: MultiAgentTrigger): string[] {
  const policy = collaborationPolicyFor(trigger);
  if (!policy) return [];
  return [
    `- 本轮按“${policy.stages.join(' → ')}”推进；每完成一个阶段先过质量门，再决定是否进入下一阶段。`,
    `- 并行上限为 ${policy.maxParallelAgents} 位，整轮最多新建 ${policy.maxTotalAgents} 位；优先复用已经完成同一专项的成员。`,
    `- 质量门：${policy.qualityGate}`,
    '- 如果没有清晰的输入、交付物和验收标准，就不创建新成员，由主助手直接处理。',
  ];
}
