/**
 * 数学建模技能的积分目录。
 *
 * 这是“展示 + 预判”的共享目录；服务端仍会用自己的白名单重新计算成本。
 * 成本按一次技能回合计算，不与普通对话成本叠加。没有选择模式时由主进程
 * 使用 basic（10 分）兜底。把目录集中在这里，避免会员中心、# 面板和主进程
 * 各写一套互相漂移的数字。
 */

export type SkillPointGroup = '题目与建模' | '数据与研究' | '图表与交付' | '论文与评阅' | '协作与工具';

export interface SkillPointEntry {
  /** 内置 skill 目录名，也是服务端计费白名单 key。 */
  id: string;
  label: string;
  description: string;
  group: SkillPointGroup;
  /** 一次技能回合的积分成本。付费 VIP / 24 小时体验不扣。 */
  cost: number;
}

type SkillSeed = readonly [id: string, label: string, cost: number, description: string];

const SEEDS: Readonly<Record<SkillPointGroup, readonly SkillSeed[]>> = {
  '题目与建模': [
    ['problem-parser', '题目解析', 15, '提取目标、约束、变量和数据需求'],
    ['problem-classifier', '题型识别', 15, '判断问题结构与可行建模方向'],
    ['model-assumptions-builder', '模型假设', 20, '建立可解释、可验证的假设清单'],
    ['symbol-table-builder', '符号表', 15, '统一变量、参数、单位与下标'],
    ['method-selector', '方法选型', 20, '比较候选方法并说明选择理由'],
    ['model-selection-audit', '模型选型审计', 25, '检查模型与题意、数据的匹配性'],
    ['modeling-algorithms', '建模算法', 25, '组织算法步骤、输入输出和限制'],
    ['python-model-code-generator', '模型代码生成', 30, '生成可运行、可复现的求解脚本'],
    ['baseline-comparison', '基线方案对比', 20, '建立基线并量化改进幅度'],
    ['metaheuristic-optimization', '启发式优化', 30, '设计遗传、粒子群等优化求解流程'],
    ['robustness-checker', '稳健性分析', 25, '做灵敏度、扰动和稳定性检验'],
    ['result-reproducibility', '结果复现', 20, '核对脚本、随机种子和结果来源'],
    ['experiment-audit', '实验审计', 25, '检查实验设计、对照与统计依据'],
    ['proof-audit', '推导与公式审计', 20, '逐条核对推导、公式和符号一致性'],
    ['quality-assurance-auditor', '质量审计', 25, '对模型、结果和交付物做综合检查'],
    ['novelty-assessment', '创新性评估', 20, '梳理方法、结论与应用上的新意'],
    ['modeler-decision-logger', '决策记录', 10, '记录关键建模决策和变更理由'],
    ['decision-prompt-builder', '决策提示构建', 15, '把复杂选择整理成可回答的问题'],
    ['time-planner', '竞赛时间规划', 15, '按剩余时间安排建模与交付步骤'],
    ['competition-rules', '竞赛规则核对', 15, '读取赛制、格式和提交限制'],
    ['competition-audit', '竞赛交付审计', 25, '逐项检查论文、代码和材料'],
    ['competition-sprint', '竞赛冲刺', 40, '按比赛倒计时推进完整建模流程'],
  ],
  '数据与研究': [
    ['data-search', '公开数据检索', 20, '寻找可追溯的数据源并记录许可'],
    ['data-auditor-cleaner', '数据体检与清洗', 20, '检查缺失、异常、重复和字段漂移'],
    ['data-provenance', '数据溯源', 15, '记录数据来源、版本、许可和处理链'],
    ['deep-research', '深度研究', 30, '围绕问题组织多来源研究证据'],
    ['literature-search', '文献检索', 20, '检索真实文献并核验可得性'],
    ['paper-search', '论文搜索', 20, '按主题、方法和年份查找论文'],
    ['related-paper-analyzer', '相关论文分析', 25, '比较相关工作与当前方案差异'],
    ['literature-positioning', '文献定位', 20, '把研究放入已有方法谱系'],
    ['doctor', '研究诊断', 20, '发现研究流程中的缺口和风险'],
  ],
  '图表与交付': [
    ['draw-figures', '建模绘图', 20, '生成求解流程、模型结构和结果图'],
    ['academic-figures', '科研图表', 25, '按论文规范生成出版级图表'],
    ['scientific-figure-making', '科学绘图', 25, '统一配色、字体、图例和标注'],
    ['scipilot-figure-skill', '科研可视化', 25, '把数据分析结果组织成科研图'],
    ['nature-figure', '高水平图表', 30, '按高水平期刊风格检查图表表达'],
    ['figure-quality-audit', '图表质量审计', 20, '检查遮挡、分辨率、图例和可读性'],
    ['figure-table-planner', '图表规划', 20, '为论文各节匹配合适图表'],
    ['mathmodel-figure-templates', '建模图表模板', 20, '选择问题求解、验证和比较模板'],
    ['paper-diagram', '模型流程图', 20, '绘制整体求解流程和模型结构图'],
    ['table-layout-audit', '表格排版审计', 20, '检查宽度、分页、对齐和中文字体'],
    ['paper-table-repair', '表格修复', 20, '修复论文表格溢出和断页问题'],
    ['pdf', 'PDF 排版检查', 15, '检查 PDF 页面、字体和图表嵌入'],
    ['submission-package-audit', '提交材料检查', 25, '核对最终论文、代码和附件清单'],
    ['paper-sharing', '成果分享', 15, '整理可分享的论文与结果摘要'],
  ],
  '论文与评阅': [
    ['write-paper', '全流程论文写作', 30, '从题意、模型到论文结构逐步成稿'],
    ['paper-writing', '论文写作', 30, '将建模结果写成完整论文段落'],
    ['paper-section-writer', '论文分节写作', 25, '针对指定章节生成可审阅文本'],
    ['abstract-writer', '摘要撰写', 20, '提炼问题、方法、结果和结论'],
    ['paper-polisher', '论文润色', 20, '改善中文表达、逻辑衔接和术语一致性'],
    ['review-paper', '论文评阅', 30, '按评阅维度检查论文并给出修改项'],
    ['paper-review', '论文核验', 30, '检查模型、结果、证据和结论闭环'],
    ['literature-review', '文献综述', 25, '归纳研究脉络并形成综述结构'],
    ['citation-management', '引用管理', 15, '整理文中引用与参考文献格式'],
    ['reference-manager', '参考文献整理', 15, '统一条目、格式和去重结果'],
    ['verifying-bibliography', '参考文献核真', 20, '逐条核验文献真实性和字段完整性'],
    ['claim-evidence-audit', '论断证据审计', 20, '检查结论是否有数据或文献支撑'],
    ['latex-paper-audit', 'LaTeX 论文审计', 20, '检查编译、引用、浮动体和版式'],
    ['paper-page-fit', '页数压缩', 20, '在比赛页数上限内调整排版'],
    ['defense-ppt', '答辩提纲与幻灯片', 30, '把论文转成答辩结构和演示要点'],
    ['defense-question-simulator', '答辩问题模拟', 25, '模拟评委追问并准备回答依据'],
  ],
  '协作与工具': [
    ['skill-creator', '技能创建', 20, '生成可复用的数学建模技能说明'],
  ],
} as const;

export const SKILL_POINT_CATALOG: readonly SkillPointEntry[] = Object.freeze(
  (Object.entries(SEEDS) as Array<[SkillPointGroup, readonly SkillSeed[]]>).flatMap(([group, seeds]) =>
    seeds.map(([id, label, cost, description]) => ({ id, label, cost, description, group })),
  ),
);

export const SKILL_POINT_BY_ID: Readonly<Record<string, SkillPointEntry>> = Object.freeze(
  Object.fromEntries(SKILL_POINT_CATALOG.map((entry) => [entry.id, entry])),
);

/** 从带斜杠命令或“使用 xxx 技能”的 # 插入文本中提取稳定计费 key。 */
export function skillIdFromPrompt(prompt: string): string | undefined {
  const text = String(prompt || '').trim();
  const command = /^\/([a-z0-9][a-z0-9-]*)\b/i.exec(text)?.[1]?.toLowerCase();
  if (command && SKILL_POINT_BY_ID[command]) return command;
  // 用户也可能直接输入 `#skill-id` 后回车，而不是用面板完成替换；
  // 这种写法仍然属于明确技能选择，不能退回普通 10 分档。
  const hash = /(?:^|\s)#([a-z0-9][a-z0-9-]*)\b/i.exec(text)?.[1]?.toLowerCase();
  if (hash && SKILL_POINT_BY_ID[hash]) return hash;
  const mentioned = /(?:使用|调用)\s+([a-z0-9][a-z0-9-]*)\s*技能/i.exec(text)?.[1]?.toLowerCase();
  if (mentioned && SKILL_POINT_BY_ID[mentioned]) return mentioned;
  return undefined;
}

export function skillPointCost(skillId: string | undefined): number | undefined {
  if (!skillId) return undefined;
  return SKILL_POINT_BY_ID[skillId]?.cost;
}
