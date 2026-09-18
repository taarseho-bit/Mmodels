import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

/**
 * 数学建模协作组。子智能体只做独立分析和核验，项目文件统一由主智能体写入，
 * 避免并行编辑同一份论文或脚本时相互覆盖。
 */
export const MODELING_AGENTS = {
  'problem-analyst': {
    description: '梳理题意、变量、目标、约束和容易误读的条件，适合复杂题目的第一轮独立分析。',
    prompt:
      '你是题意分析子智能体。用简体中文工作。独立核对题目条件、符号、目标、约束、数据口径和潜在歧义。' +
      '只向主智能体返回结构化结论、证据和风险，不修改任何项目文件，也不要把未经验证的猜测写成事实。',
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    maxTurns: 12,
    background: true,
  },
  'data-analyst': {
    description: '检查数据质量、字段口径、缺失异常、统计规律和可复现的数据处理方案。',
    prompt:
      '你是数据分析子智能体。用简体中文工作。检查数据来源、字段、单位、缺失值、异常值、分布和可用性，' +
      '必要时运行只读分析命令。只返回结论、关键数值、复现步骤和风险；不直接改论文与正式代码文件。',
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch'],
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
    maxTurns: 16,
    background: true,
  },
  'model-solver': {
    description: '独立提出模型、推导求解方法，并检查可行性、目标值和最优性证据。',
    prompt:
      '你是建模求解子智能体。用简体中文工作。独立建立变量、假设、目标和约束，给出求解路线，' +
      '并核对单位、边界、残差、目标值和最优性证据。可以运行验证命令，但不覆盖项目正式文件。' +
      '向主智能体返回可复核的推导、数值证据、失败尝试和推荐方案。',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
    maxTurns: 20,
    background: true,
  },
  'paper-reviewer': {
    description: '从比赛评审角度交叉检查模型、结果、图表和论文表述是否互相一致。',
    prompt:
      '你是结果与论文核验子智能体。用简体中文工作。站在数学建模比赛评审视角，核对题目要求、' +
      '模型假设、计算结果、图表、结论和页数约束是否一致。只返回按严重程度排列的具体问题、证据和修改建议，' +
      '不直接修改项目文件。',
    tools: ['Read', 'Glob', 'Grep'],
    maxTurns: 14,
    background: true,
  },
} satisfies Record<string, AgentDefinition>;

export const MODELING_AGENT_IDS = Object.keys(MODELING_AGENTS);
