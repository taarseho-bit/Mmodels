import type { WorkflowNode, WorkflowRun } from '@shared/workflow';

/** 订阅先于读取历史；按轮次及版本合并，迟到的历史快照不能覆盖实时状态。 */
export function mergeWorkflowRuns(current: WorkflowRun[], incoming: WorkflowRun[], sessionId: string): WorkflowRun[] {
  const runs = new Map<string, WorkflowRun>();
  for (const original of [...current, ...incoming]) {
    // 旧版本已经明确记录的入口加载可展示，不能把它冒充 Skill 工具调用。
    const run = { ...original, nodes: original.nodes.map(n => ({ ...n, tools: n.tools.map(t =>
      !t.skill && t.label.startsWith('载入入口指令 · ') ? { ...t, skill: t.name, skillSource: 'entry' as const } : t) })) };
    if (run.sessionId !== sessionId) continue;
    const previous = runs.get(run.id);
    if (!previous || run.revision > previous.revision) runs.set(run.id, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id)).slice(0, 20);
}

/** 按项目合并所有会话的工作流快照；对话只是项目工作流中的一轮任务。 */
export function mergeProjectWorkflowRuns(current: WorkflowRun[], incoming: WorkflowRun[], projectId: string): WorkflowRun[] {
  const runs = new Map<string, WorkflowRun>();
  for (const original of [...current, ...incoming]) {
    if (original.projectId && original.projectId !== projectId) continue;
    const run = { ...original, projectId, nodes: original.nodes.map(n => ({ ...n, tools: n.tools.map(t =>
      !t.skill && t.label.startsWith('载入入口指令 · ') ? { ...t, skill: t.name, skillSource: 'entry' as const } : t) })) };
    const previous = runs.get(run.id);
    if (!previous || run.revision > previous.revision) runs.set(run.id, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id)).slice(0, 100);
}

/** 把项目内多轮对话组织成一棵树：项目主助手 → 任务轮次 → 本轮子成员。 */
export function buildProjectWorkflow(projectId: string, runs: WorkflowRun[]): WorkflowRun | null {
  if (!runs.length) return null;
  const ordered = [...runs].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
  const status = ordered.some(run => run.status === 'running') ? 'running'
    : ordered.some(run => run.status === 'interrupted') ? 'interrupted'
      : ordered.some(run => run.status === 'stopped') ? 'stopped' : 'completed';
  const mainTools = ordered.flatMap(run => run.nodes.filter(node => node.id === 'main').flatMap(node => node.tools.map(tool => ({ ...tool, id: `${run.id}:${tool.id}` }))));
  const nodes: WorkflowNode[] = [{ id: 'main', agentType: 'main', name: '项目主助手', status: status === 'running' ? 'running' : status === 'stopped' ? 'stopped' : 'returned',
    tools: mainTools, startedAt: ordered[0].startedAt, endedAt: status === 'running' ? undefined : ordered.at(-1)?.updatedAt }];
  const exchanges: { id: string; source: string; target: string }[] = [];
  for (const run of ordered) {
    const taskId = `task:${run.id}`;
    const taskStatus: WorkflowNode['status'] = run.status === 'running' ? 'running' : run.status === 'stopped' ? 'stopped' : run.status === 'completed' ? 'returned' : 'unknown';
    nodes.push({ id: taskId, parentId: 'main', agentType: 'project-task', name: `任务：${run.sessionTitle || '本轮建模工作'}`, assignment: `来自对话“${run.sessionTitle || '本轮建模工作'}”`, status: taskStatus,
      tools: [], startedAt: run.startedAt, endedAt: run.updatedAt });
    const byOriginalId = new Map(run.nodes.map(node => [node.id, node]));
    for (const node of run.nodes) {
      if (node.id === 'main') continue;
      const id = `${run.id}:${node.id}`;
      const parent = node.parentId && node.parentId !== 'main' && byOriginalId.has(node.parentId) ? `${run.id}:${node.parentId}` : taskId;
      nodes.push({ ...node, id, parentId: parent, tools: node.tools.map(tool => ({ ...tool, id: `${run.id}:${tool.id}` })) });
    }
    for (const link of run.exchanges ?? []) {
      const source = link.source === 'main' ? taskId : `${run.id}:${link.source}`;
      const target = link.target === 'main' ? taskId : `${run.id}:${link.target}`;
      if (nodes.some(node => node.id === source) && nodes.some(node => node.id === target)) exchanges.push({ ...link, id: `${run.id}:${link.id}`, source, target });
    }
  }
  const latest = [...ordered].reverse().find(item => item.status === 'running') ?? ordered.at(-1);
  return { id: `project:${projectId}`, sessionId: `project:${projectId}`, projectId, startedAt: ordered[0].startedAt,
    updatedAt: Math.max(...ordered.map(run => run.updatedAt)), revision: Math.max(...ordered.map(run => run.revision)), status: status as WorkflowRun['status'],
    collaborationEnabled: ordered.some(run => run.collaborationEnabled), nodes, truncated: ordered.some(run => run.truncated), exchanges,
    workflowStages: latest?.workflowStages, currentStage: latest?.currentStage, stageStatus: latest?.stageStatus };
}

/** 仅允许已有项目预览器打开项目内部文件；外部路径不转成可点击成果。 */
export function workflowArtifactPath(file: string, root: string): string | null {
  const clean = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '');
  let value = clean(file), base = clean(root);
  if (!base || value.includes('\0')) return null;
  if (value.toLowerCase().startsWith(`${base.toLowerCase()}/`)) value = value.slice(base.length + 1);
  else if (/^(?:[a-z]:|\/)/i.test(value)) return null;
  if (value.split('/').some(part => part === '..') || value.includes(':')) return null;
  return value.replace(/^\.\//, '') || null;
}
