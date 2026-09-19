import type { WorkflowRun } from '@shared/workflow';

/** 订阅先于读取历史；按轮次及版本合并，迟到的历史快照不能覆盖实时状态。 */
export function mergeWorkflowRuns(current: WorkflowRun[], incoming: WorkflowRun[], sessionId: string): WorkflowRun[] {
  const runs = new Map<string, WorkflowRun>();
  for (const run of [...current, ...incoming]) {
    if (run.sessionId !== sessionId) continue;
    const previous = runs.get(run.id);
    if (!previous || run.revision > previous.revision) runs.set(run.id, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id)).slice(0, 20);
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
