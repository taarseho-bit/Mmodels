import type { AgentActivity, ContentBlock } from '@shared/types';

export type ModelingPetState =
  | 'resting'
  | 'thinking'
  | 'reading'
  | 'researching'
  | 'solving'
  | 'plotting'
  | 'writing'
  | 'reviewing'
  | 'collaborating'
  | 'stopping';

export const AGENT_LABELS: Record<string, string> = {
  'problem-analyst': '题意分析',
  'data-analyst': '数据分析',
  'model-solver': '建模求解',
  'paper-reviewer': '结果核验',
};

export const PET_COPY: Record<ModelingPetState, string> = {
  resting: '小模在旁边待命',
  thinking: '正在把问题拆成可以一步步解决的小块…',
  reading: '正在把题目条件和已有文件一一对上…',
  researching: '正在核对资料来源和数据口径…',
  solving: '正在检查变量、约束和计算结果能不能对上…',
  plotting: '正在让图表准确说出数据里的规律…',
  writing: '正在把模型、结果和结论整理进论文…',
  reviewing: '正在从评委视角找遗漏和前后矛盾…',
  collaborating: '几位建模伙伴正在分头核对，稍后一起汇总…',
  stopping: '正在停下，已经完成的内容会保留下来…',
};

const shortName = (name: string | undefined): string => (name ?? '').split('__').pop()?.toLowerCase() ?? '';

export function petStateFor(input: {
  active: boolean;
  stopping: boolean;
  blocks: ContentBlock[];
  agents: AgentActivity[];
}): ModelingPetState {
  if (input.stopping) return 'stopping';
  if (!input.active) return 'resting';
  if (input.agents.some((agent) => agent.status === 'running' || agent.status === 'pending')) {
    return 'collaborating';
  }

  const lastTool = [...input.blocks]
    .reverse()
    .find((block) => block?.kind === 'tool_use' && block.toolName);
  const tool = shortName(lastTool?.toolName);
  if (!tool) return 'thinking';
  if (/read|glob|grep|pdf|file/.test(tool)) return 'reading';
  if (/web|search|browser|fetch/.test(tool)) return 'researching';
  if (/draw|diagram|plot|chart|image/.test(tool)) return 'plotting';
  if (/write|edit|notebook/.test(tool)) return 'writing';
  if (/review|lint|test/.test(tool)) return 'reviewing';
  if (/agent|task/.test(tool)) return 'collaborating';
  if (/bash|python|terminal|execute/.test(tool)) return 'solving';
  return 'thinking';
}

export function visibleAgentText(activity: AgentActivity): string {
  const summary = activity.summary?.trim() ?? '';
  // SDK 的摘要若没有遵守中文约束，不把英文原样泄到界面，退回稳定中文状态。
  if (summary && /[\u3400-\u9fff]/.test(summary)) return summary;
  if (activity.status === 'completed') return '这一部分已经核对完成';
  if (activity.status === 'failed' || activity.status === 'killed') return '这一路已停下，主智能体正在接手';
  if (activity.status === 'paused') return '暂时等待其他结果';
  return activity.description && /[\u3400-\u9fff]/.test(activity.description)
    ? activity.description
    : '正在独立核对这一部分';
}

/**
 * 演示用成员窗口：优先显示正在工作的成员，最多保留两张卡片。
 * 完整成员列表仍由工作流快照保存，避免为了界面清爽丢掉审计信息。
 */
export function visibleAgentActivities(activities: AgentActivity[], max = 2): AgentActivity[] {
  const limit = Math.max(1, Math.floor(max));
  return [
    ...activities.filter((activity) => activity.status === 'running' || activity.status === 'pending'),
    ...activities.filter((activity) => activity.status !== 'running' && activity.status !== 'pending'),
  ].slice(0, limit);
}
