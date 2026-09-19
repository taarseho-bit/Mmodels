/** 工作流只记录运行事件，不保存提示词、思考正文或工具原始输入输出。 */
export type WorkflowStatus = 'running' | 'completed' | 'stopped' | 'interrupted';
export interface WorkflowTool {
  id: string;
  name: string;
  label: string;
  skill?: string;
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
  status: 'running' | 'returned' | 'stopped' | 'unknown';
  tools: WorkflowTool[];
  startedAt: number;
  endedAt?: number;
}
export interface WorkflowRun {
  id: string;
  sessionId: string;
  startedAt: number;
  updatedAt: number;
  revision: number;
  status: WorkflowStatus;
  collaborationEnabled: boolean;
  nodes: WorkflowNode[];
  truncated: boolean;
}
export const WORKFLOW_IPC = { list: 'workflow:list', changed: 'workflow:changed' } as const;
export interface WorkflowApi {
  list(sessionId: string): Promise<WorkflowRun[]>;
  onChanged(cb: (run: WorkflowRun) => void): () => void;
}
export const AGENT_NAMES: Record<string, string> = {
  main: '建模主助手', 'problem-analyst': '题意分析员', 'data-analyst': '数据分析员',
  'model-solver': '建模求解员', 'paper-reviewer': '论文核验员',
  'general-purpose': '综合研究员', Explore: '资料探索员', Plan: '方案规划员',
};
export function chineseAgentName(type: string, description = ''): string {
  const named = description.match(/角色名[：:]\s*([\u3400-\u9fff]{2,12})/);
  return named?.[1] ?? AGENT_NAMES[type] ?? (/^[\u3400-\u9fff]{2,12}$/.test(type) ? type : '专项研究员');
}
const SKILLS: Record<string, string> = {
  'mma-paper': '论文写作', 'mma-review': '论文审阅', 'mma-model': '建模求解',
  'paper-search': '文献检索', 'paper-diagram': '论文绘图', 'paper-page-fit': '正文页数优化',
  'paper-polish': '论文润色', 'nature-figure': '科研绘图', 'competition-delivery-check': '比赛交付核对',
  'competition-audit': '比赛交付核对', 'data-search': '数据检索', doctor: '环境检查',
  'mathmodel-figure-templates': '建模图表模板', 'metaheuristic-optimization': '启发式优化',
  'mma-figure': '建模绘图', 'paper-sharing': '论文整理', 'skill-creator': '技能创建',
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
