import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';

/**
 * 角色专属技能清单（2026-09-20 技能大扩充配套）。
 *
 * 与 `src/main/ipc/session.ts`「数学建模协作组」的角色-技能映射保持同源口径：
 * 主智能体派发时把对应技能名写进任务说明，成员一醒来就知道该优先用哪些技能，
 * 而不是在几十个技能里盲选（用户实测反馈：成员几乎不用技能）。
 */
export const ROLE_SKILL_HINTS: Record<string, string> = {
  'problem-analyst':
    'problem-parser（题意解析）、problem-classifier（题型分类）、model-assumptions-builder（建模假设清单）、' +
    'symbol-table-builder（符号表统一）、related-paper-analyzer（相关工作分析）、deep-research（深度调研）',
  'data-analyst':
    'data-auditor-cleaner（数据审计与清洗）、data-provenance（数据溯源）、pdf（PDF 附件读取）、novelty-assessment（查新）',
  'literature-researcher':
    'literature-search（多库文献检索）、literature-review（综述整理）、citation-management（引用管理）、' +
    'reference-manager（参考文献管理）、paper-search（真实文献检索与核验）、related-paper-analyzer（相关工作分析）、' +
    'deep-research（深度调研）',
  'model-solver':
    'modeling-algorithms（算法资源库选型索引）、method-selector（模型选型与风险探针）、model-selection-audit（模型方案比较）、' +
    'baseline-comparison（基线对照）、python-model-code-generator（求解代码生成）、robustness-checker（灵敏度与稳健性检验）、result-reproducibility（结果复现）',
  'paper-writer':
    'paper-writing（写作纪律）、paper-section-writer（分章起草）、literature-positioning（文献定位）、' +
    'citation-management（引用管理）、reference-manager（参考文献管理）、paper-search（真实文献检索）、' +
    'paper-polisher（语言润色）',
  'figure-maker':
    'figure-table-planner（图表规划）、scipilot-figure-skill（数据图选型顾问）、scientific-figure-making（出版级数据图）、' +
    'paper-diagram（问题求解流程、模型结构、优化决策、验证闭环）、mathmodel-figure-templates（赛事图表模板）、' +
    'figure-quality-audit（图表质量检查）、table-layout-audit（表格宽度与分页检查）',
  'paper-reviewer':
    'paper-review（审稿评审）、proof-audit（推导审计）、claim-evidence-audit（论断-证据审计）、' +
    'verifying-bibliography（引用真实性核验）、quality-assurance-auditor（终审清单）、' +
    'paper-page-fit（页数核验）、paper-table-repair（表格修复）、figure-quality-audit（图表质量检查）、' +
    'result-reproducibility（结果复现）、submission-package-audit（提交包检查）、competition-audit（提交材料核对）',
};

const SKILL_GUIDANCE =
  '开工前先查可用技能：凡命中上面常用技能清单、或任务明显属于某个技能范围的，必须实际调用该技能并按其步骤执行，' +
  '不要凭通用知识绕过技能，也不要只调用一次就抛下（技能内的 references 按需读取）；' +
  '只有确实没有匹配技能时才直接动手。返回时说明实际用了哪个技能、走了哪些关键步骤、证据与产出在哪，' +
  '以及下一位成员需要什么输入。' +
  '统一按以下结构返回：结论、证据/文件、风险或未验证项、建议下一步；不要写长篇过程，不要向其他成员发起无关闲聊。';

/**
 * 数学建模协作组。分析/核验类成员只读，正式论文与数据文件由主智能体统一写入；
 * 写作、绘图与求解三类**执行型**成员可写文件，但各自只有明确的可写范围
 * （论文文件 / 图表产物 / scratch 验证脚本），互不交叉，避免并行覆盖。
 */
export const MODELING_AGENTS = {
  'problem-analyst': {
    description: '梳理题意、变量、目标、约束和容易误读的条件，适合复杂题目的第一轮独立分析。',
    prompt:
      '你是题意分析子智能体。用简体中文工作。独立核对题目条件、符号、目标、约束、数据口径和潜在歧义。' +
      '只向主智能体返回结构化结论、证据和风险，不修改任何项目文件，也不要把未经验证的猜测写成事实。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['problem-analyst']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'],
    maxTurns: 12,
    background: true,
  },
  'data-analyst': {
    description: '检查数据质量、字段口径、缺失异常、统计规律和可复现的数据处理方案。',
    prompt:
      '你是数据分析子智能体。用简体中文工作。检查数据来源、字段、单位、缺失值、异常值、分布和可用性，' +
      '必要时运行只读分析命令。只返回结论、关键数值、复现步骤和风险；不直接改论文与正式代码文件。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['data-analyst']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', 'Skill'],
    disallowedTools: ['Write', 'Edit', 'NotebookEdit'],
    maxTurns: 16,
    background: true,
  },
  'model-solver': {
    description: '独立提出模型、推导求解方法，并检查可行性、目标值和最优性证据。',
    prompt:
      '你是建模求解子智能体。用简体中文工作。独立建立变量、假设、目标和约束，给出求解路线，' +
      '并核对单位、边界、残差、目标值和最优性证据。' +
      // 受控写权限（2026-09-19）：只允许写 scratch 验证脚本，正式求解脚本与论文仍归主智能体。
      '复杂的多行验证 Python 写成项目内 scratch-*.py 临时脚本再运行，不覆盖正式求解脚本、数据和论文文件；' +
      '向主智能体返回可复核的推导、数值证据、失败尝试和推荐方案。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['model-solver']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Skill'],
    disallowedTools: ['Edit', 'NotebookEdit'],
    maxTurns: 28,
    background: true,
  },
  'literature-researcher': {
    description: '检索赛题背景与政策统计资料、梳理方法文献依据、整理真实可核验的引用条目，适合联网检索密集的环节。',
    prompt:
      '你是文献调研子智能体。用简体中文工作。负责比赛工作流的文献环节：检索赛题背景、政策与统计资料，' +
      '为方法选型提供文献依据与对比，把整理好的真实文献条目按引用格式给出（题名/作者/期刊/年卷期/DOI/URL），' +
      '并逐条核对真实可查，专抓编造引用。只读工作：不写任何项目文件，文献条目以结构化清单返回，' +
      '由写作成员落盘 .bib；返回时给出每条文献的来源链接与核对状态。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['literature-researcher']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'],
    maxTurns: 18,
    background: true,
  },
  'paper-writer': {
    description: '按比赛模板分章撰写或修改论文正文、公式与参考文献，适合大体量写作执行。',
    prompt:
      '你是论文写作子智能体。用简体中文工作。按项目 `.mathmodel/paper/config.json` 指定的比赛模板，' +
      '撰写或修改指定章节的 LaTeX 正文、公式、图表引用与参考文献条目。' +
      '只写论文相关文件（.tex/.md/.bib 与模板要求的文件），不改数据、求解脚本和其他成员负责的文件；' +
      '每完成一部分汇报文件路径与内容摘要，编译报错先自行修复再继续。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['paper-writer']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'Skill'],
    disallowedTools: ['NotebookEdit'],
    maxTurns: 24,
    background: true,
  },
  'figure-maker': {
    description: '批量生成或修改图表脚本与图片产物（figures/、draw.io），适合成批绘图执行。',
    prompt:
      '你是图表制作子智能体。用简体中文工作。按主智能体给定的统一风格要求，生成或修改绘图脚本并运行验证，' +
      '图片输出到项目 figures/ 目录（draw.io 图保存 .drawio 源文件与导出的 PNG）。' +
      '只写图表脚本与图片产物，不改论文正文、数据和其他成员负责的文件；' +
      '汇报每张图的路径与它支撑的正文结论。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['figure-maker']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'Skill'],
    disallowedTools: ['NotebookEdit'],
    maxTurns: 22,
    background: true,
  },
  'paper-reviewer': {
    description: '从比赛评审角度交叉检查模型、结果、图表和论文表述是否互相一致。',
    prompt:
      '你是结果与论文核验子智能体。用简体中文工作。站在数学建模比赛评审视角，核对题目要求、' +
      '模型假设、计算结果、图表、结论和页数约束是否一致。只返回按严重程度排列的具体问题、证据和修改建议，' +
      '不直接修改项目文件。' +
      `你的常用技能（优先从中匹配）：${ROLE_SKILL_HINTS['paper-reviewer']}。` + SKILL_GUIDANCE,
    tools: ['Read', 'Glob', 'Grep', 'Skill'],
    maxTurns: 14,
    background: true,
  },
} satisfies Record<string, AgentDefinition>;

/**
 * 供会话编排层使用的角色类型和最小注册表。
 *
 * 这里故意把「全部角色」和「本轮选中的角色」分开：直接调用
 * `AgentSession.run({ multiAgentEnabled: true })` 的旧入口仍然可以拿到完整
 * 协作组；来自 IPC 的正常对话则可以只注册与当前任务相关的成员，避免模型
 * 面对一长串不相关角色后随意派人。
 */
export type ModelingAgentId = keyof typeof MODELING_AGENTS;
export type ModelingAgentRoster = Record<string, AgentDefinition>;

export interface ModelingAgentRoute {
  /** 触发这次路由的任务类型；没有显式类型时为 null。 */
  trigger: string | null;
  /** 本轮实际允许主智能体调用的角色，顺序也是推荐的派发顺序。 */
  agentIds: ModelingAgentId[];
  /** 给用户和工作流看的简短解释。 */
  reason: string;
  /** 命中的通俗关键词，便于排查为什么启用了某个角色。 */
  matchedSignals: string[];
}

interface RoleRule {
  id: ModelingAgentId;
  label: string;
  patterns: RegExp[];
}

const ROLE_RULES: RoleRule[] = [
  {
    id: 'problem-analyst',
    label: '题意与约束',
    patterns: [/题目|题意|题干|拆解|变量|约束|目标|条件|问题描述|读题/],
  },
  {
    id: 'data-analyst',
    label: '数据整理',
    patterns: [/数据|附件|excel|xlsx|csv|表格|字段|缺失|异常|清洗|样本|统计|预处理/],
  },
  {
    id: 'model-solver',
    label: '模型与求解',
    patterns: [/建模|模型|算法|优化|规划|调度|分配|路径|预测|分类|回归|仿真|求解|灵敏度|参数/],
  },
  {
    id: 'literature-researcher',
    label: '文献与资料',
    patterns: [/文献|引用|参考文献|资料|检索|研究现状|背景|查新|来源/],
  },
  {
    id: 'paper-writer',
    label: '论文成稿',
    patterns: [/写论文|论文|成稿|正文|摘要|章节|latex|排版|润色|写作/],
  },
  {
    id: 'figure-maker',
    label: '图表表达',
    patterns: [/绘图|图表|可视化|流程图|示意图|热力图|散点图|柱状图|折线图|表格排版/],
  },
  {
    id: 'paper-reviewer',
    label: '审阅与交付',
    patterns: [/评审|评阅|审阅|检查|核验|质量|提交|最终版|页数|格式|复核|交付/],
  },
];

/** 任务类型对应的最小角色集合；它们不是强制全部派发，而是 SDK 的候选角色。 */
const DEFAULT_ROLE_IDS: Record<string, ModelingAgentId[]> = {
  paper: ['problem-analyst', 'model-solver', 'paper-writer'],
  review: ['paper-reviewer', 'problem-analyst'],
  audit: ['paper-reviewer'],
  'multi-file': ['data-analyst', 'problem-analyst', 'model-solver'],
  complex: ['problem-analyst', 'model-solver'],
};

function triggerLabel(trigger: string | null): string {
  switch (trigger) {
    case 'paper': return '论文写作与综合解题';
    case 'review': return '论文评阅与交叉核验';
    case 'audit': return '提交材料核对';
    case 'multi-file': return '多附件综合分析';
    case 'complex': return '复杂建模任务';
    default: return '当前建模任务';
  }
}

/**
 * 根据任务类型和本轮文字选择候选角色。
 *
 * 这一步只做轻量、可解释的路由，不调用模型，也不代表一定会创建成员；
 * 主智能体仍需根据依赖和质量门决定是否真正派发。最多保留 4 个角色，避免
 * 工作流出现大量没有实际工作的平行节点。
 */
export function modelingAgentRouteForPrompt(prompt: string, trigger: string | null = null): ModelingAgentRoute {
  const text = prompt.replace(/\s+/g, ' ').trim().toLowerCase();
  const ids: ModelingAgentId[] = [];
  const matchedSignals: string[] = [];

  const add = (id: ModelingAgentId) => {
    if (!ids.includes(id)) ids.push(id);
  };

  // 任务类型先给出最低限度的骨架，再用本轮关键词补充具体成员。
  for (const id of DEFAULT_ROLE_IDS[trigger ?? ''] ?? []) add(id);
  for (const rule of ROLE_RULES) {
    const matched = rule.patterns.some(pattern => pattern.test(text));
    if (!matched) continue;
    add(rule.id);
    if (!matchedSignals.includes(rule.label)) matchedSignals.push(rule.label);
  }

  // 未触发协作时也允许对明确的专业请求给出候选；普通闲聊则返回空，
  // 由调用方传入 null，避免为了“看起来有团队”而注册所有角色。
  const selected = ids.slice(0, 4);
  const names = selected.map(id => ROLE_RULES.find(rule => rule.id === id)?.label ?? id);
  const reason = selected.length
    ? `识别为“${triggerLabel(trigger)}”，${matchedSignals.length ? `命中${matchedSignals.join('、')}，` : ''}本轮候选成员为${names.join('、')}。`
    : '当前内容没有明显的复杂建模分工，先由主智能体直接处理。';
  return { trigger, agentIds: selected, reason, matchedSignals };
}

/** 将路由结果转换为 SDK 接受的精简角色注册表。 */
export function modelingAgentsForRoute(route: ModelingAgentRoute): ModelingAgentRoster {
  const roster: ModelingAgentRoster = {};
  for (const id of route.agentIds) roster[id] = MODELING_AGENTS[id];
  return roster;
}

export const MODELING_AGENT_IDS = Object.keys(MODELING_AGENTS) as ModelingAgentId[];
