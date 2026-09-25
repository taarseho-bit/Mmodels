import type { MultiAgentTrigger } from '../ipc/session';

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
