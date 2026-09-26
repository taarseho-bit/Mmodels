/** 工作流只记录运行事件，不保存提示词、思考正文或工具原始输入输出。 */
export type WorkflowStatus = 'running' | 'completed' | 'stopped' | 'interrupted';
export interface WorkflowTool {
  id: string;
  name: string;
  label: string;
  skill?: string;
  skillSource?: 'call' | 'entry' | 'read';
  status: 'running' | 'completed' | 'unsuccessful' | 'stopped' | 'unknown';
  startedAt: number;
  endedAt?: number;
  artifact?: string;
  action?: string;
}
export interface WorkflowNode {
  id: string;
  /** 只有真实派发工具标识能关联到父成员时才填写，缺失不猜。 */
  parentId?: string;
  agentType: string;
  name: string;
  /** 只保存派发时的简短任务说明，不保存完整提示词或思考内容。 */
  assignment?: string;
  status: 'running' | 'returned' | 'stopped' | 'unknown';
  tools: WorkflowTool[];
  startedAt: number;
  endedAt?: number;
}
export interface WorkflowRun {
  id: string;
  sessionId: string;
  /** 项目级工作流字段；旧记录没有时仍按 sessionId 兼容读取。 */
  projectId?: string;
  sessionTitle?: string;
  startedAt: number;
  updatedAt: number;
  revision: number;
  status: WorkflowStatus;
  collaborationEnabled: boolean;
  nodes: WorkflowNode[];
  truncated: boolean;
  /** 本轮由编排策略提供的短阶段名；不保存提示词或模型思考正文。 */
  workflowStages?: string[];
  /** 最近一次真实工具活动所在阶段，按 0 开始。 */
  currentStage?: number;
  stageStatus?: 'waiting' | 'running' | 'completed';
  exchanges?: { id: string; source: string; target: string }[];
}
export const WORKFLOW_IPC = { list: 'workflow:list', listProject: 'workflow:list-project', changed: 'workflow:changed' } as const;
export interface WorkflowApi {
  list(sessionId: string): Promise<WorkflowRun[]>;
  listProject(projectId: string): Promise<WorkflowRun[]>;
  onChanged(cb: (run: WorkflowRun) => void): () => void;
}
export const AGENT_NAMES: Record<string, string> = {
  main: '建模主助手', 'problem-analyst': '题意分析员', 'data-analyst': '数据分析员',
  'literature-researcher': '文献调研员',
  'model-solver': '建模求解员', 'paper-reviewer': '论文核验员',
  'general-purpose': '综合研究员', Explore: '资料探索员', Plan: '方案规划员',
};

const TASK_AGENT_NAMES: Array<[RegExp, string]> = [
  [/附件|工作表|表格字段|文件结构|读取文件|读取资料/, '附件结构核验员'],
  [/缺失值|异常值|数据清洗|预处理|标准化|归一化/, '数据清洗研究员'],
  [/题意|题目条件|约束条件|边界条件|问题理解/, '题意约束分析员'],
  [/时间序列|趋势预测|需求预测|销量预测|预测模型/, '预测模型研究员'],
  [/优化|规划|调度|分配方案|路径方案|决策方案/, '优化方案研究员'],
  [/灵敏度|稳健性|敏感性|鲁棒性/, '稳健性核验员'],
  [/复算|复核|验证结果|结果核验|交叉验证|误差检验/, '结果复算员'],
  [/可视化|绘图|图表|流程图|示意图/, '图表表达研究员'],
  [/文献|论文检索|资料检索|搜索资料/, '文献检索员'],
  [/摘要|论文结构|论文写作|撰写论文|润色|排版/, '论文结构研究员'],
  [/统计特征|描述统计|相关性|数据分析|特征工程/, '数据特征分析员'],
  [/算法|建模|求解模型|模型求解|模型设计/, '模型求解研究员'],
];

/** 从派发任务中生成可展示的短名称；只返回名称，不保留任务正文。 */
export function taskAgentName(description = ''): string | undefined {
  const named = description.match(/角色名[：:]\s*([\u3400-\u9fff]{2,12})/);
  if (named) return named[1];
  const compact = description.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  for (const [pattern, name] of TASK_AGENT_NAMES) if (pattern.test(compact)) return name;
  const problem = compact.match(/问题\s*([一二三四五六七八九十\d]{1,3})/);
  if (problem) return `问题${problem[1]}研究员`;
  const task = compact.match(/(?:任务|负责内容|研究内容)[：:]\s*([\u3400-\u9fff]{2,8})/);
  if (task) {
    const topic = task[1].replace(/^(?:请|负责|独立|深入|完成|开展|进行|研究|分析|核对|处理)+/, '').slice(0, 6);
    if (topic.length >= 2) return `${topic}研究员`.slice(0, 12);
  }
  return undefined;
}

/** 从公开的派发说明中提取适合老板演示的一句话分工，不保留完整提示词。 */
export function taskAgentAssignment(description = ''): string | undefined {
  let compact = description.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!compact || !/[\u3400-\u9fff]/.test(compact)) return undefined;
  compact = compact.replace(/^角色名[：:]\s*[\u3400-\u9fff]{2,12}\s*[；;，,]?\s*/, '');
  const explicit = compact.match(/(?:任务|负责内容|研究内容)[：:]\s*(.+)/)?.[1];
  const first = (explicit ?? compact).split(/[。；;]/)[0]
    .replace(/^(?:请|负责|独立|深入|完成|开展|进行|研究|分析|核对|处理|协助|重点)+/, '')
    .replace(/[，,]\s*(?:并|同时|最后).*/, '').trim();
  if (first.length < 2) return undefined;
  return first.length > 34 ? `${first.slice(0, 33)}…` : first;
}

export function chineseAgentName(type: string, description = ''): string {
  return taskAgentName(description) ?? AGENT_NAMES[type]
    ?? (/^[\u3400-\u9fff]{2,12}$/.test(type) ? type : '协作研究员');
}
const SKILLS: Record<string, string> = {
  'write-paper': '论文写作', 'review-paper': '论文审阅',
  'paper-search': '文献检索', 'paper-diagram': '论文绘图', 'paper-page-fit': '正文页数优化',
  'paper-polish': '论文润色', 'nature-figure': '科研绘图', 'competition-delivery-check': '比赛交付核对',
  'competition-audit': '比赛交付核对', 'data-search': '数据检索', doctor: '环境检查',
  'mathmodel-figure-templates': '建模图表模板', 'metaheuristic-optimization': '启发式优化',
  'draw-figures': '建模绘图', 'paper-library': '论文整理', 'skill-creator': '技能创建',
};
export function workflowToolLabel(name: string, skill?: string): string {
  if (skill) return SKILLS[skill.split(':').pop() ?? skill] ?? '专项技能';
  return ({ Read: '阅读资料', Glob: '查找文件', Grep: '检索内容', Bash: '运行计算或命令',
    Write: '生成文件', Edit: '修改文件', NotebookEdit: '修改计算笔记',
    Agent: '分配协作任务', Task: '分配协作任务', Skill: '调用技能',
    WebSearch: '检索资料', WebFetch: '读取网页', TaskCreate: '安排任务', TaskUpdate: '更新任务进度',
    TodoWrite: '整理任务清单', AskUserQuestion: '等待你的补充', TaskOutput: '接收任务结果',
  } as Record<string, string>)[name] ?? (name.startsWith('mcp__') ? '使用扩展工具' : '执行辅助操作');
}

/** 给旧工作流记录补一个有事实依据的展示名，不改动原始记录。 */
export function workflowAgentDisplayName(node: WorkflowNode): string {
  if (!/^(?:专项研究员|协作研究员|综合研究员)(?:\s*[·#]?\s*\d+)?$/.test(node.name)) return node.name;
  const skills = node.tools.map(tool => `${tool.skill ?? ''} ${tool.label}`).join(' ');
  const skillName = taskAgentName(skills);
  if (skillName) return skillName;
  const names = new Set(node.tools.map(tool => tool.name));
  if (names.has('Bash') || names.has('NotebookEdit')) return '计算实验员';
  if (names.has('Write') || names.has('Edit')) return '成果整理员';
  if (names.has('Read') || names.has('Glob') || names.has('Grep')) return '资料核验员';
  if (names.has('WebSearch') || names.has('WebFetch')) return '资料检索员';
  if (names.has('Agent') || names.has('Task')) return '协作统筹员';
  return node.status === 'running' ? '协作准备中' : '短时协作者';
}
