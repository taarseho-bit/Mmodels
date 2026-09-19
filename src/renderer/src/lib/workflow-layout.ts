import type { WorkflowNode, WorkflowRun } from '@shared/workflow';

export const FLOW_ROOT = '__workflow_run__';
export interface FlowPosition { id: string; x: number; y: number; width: number; height: number; color: string; node?: WorkflowNode }
export interface FlowEdge { id: string; source: string; target: string; kind: 'execution' | 'delegation' | 'participation'; path: string; color: string; active: boolean; label: string; labelX: number; labelY: number }
export function layoutWorkflow(run: WorkflowRun, compact: boolean): { nodes: FlowPosition[]; edges: FlowEdge[]; width: number; height: number } {
  const byId = new Map(run.nodes.map(n => [n.id, n]));
  // 环/悬空父关系视为未确认归属；不能画出不存在的调用关系。
  const parents = new Map<string, string>();
  for (const node of run.nodes) {
    if (!node.parentId || !byId.has(node.parentId) || node.id === 'main') continue;
    let cursor: string | undefined = node.parentId;
    const seen = new Set([node.id]);
    while (cursor && byId.has(cursor) && !seen.has(cursor)) { seen.add(cursor); cursor = byId.get(cursor)?.parentId; }
    if (!cursor || !seen.has(cursor)) parents.set(node.id, node.parentId);
  }
  const depth = (id: string): number => parents.has(id) ? 1 + depth(parents.get(id)!) : 1;
  const rows = new Map<number, number>();
  const nextY = new Map<number, number>();
  const nodes: FlowPosition[] = [{ id: FLOW_ROOT, x: 28, y: 54, width: 138, height: 86, color: '#6a7d96' }];
  run.nodes.forEach((node, index) => {
    const column = depth(node.id), row = rows.get(column) ?? 0;
    const y = nextY.get(column) ?? 36;
    const height = compact && node.status !== 'running' ? 86 : 128;
    rows.set(column, row + 1);
    nextY.set(column, y + height + 32);
    nodes.push({ id: node.id, node, x: 232 + (column - 1) * 306, y,
      width: 232, height,
      color: `hsl(${Math.round((218 + index * 137.508) % 360)} 62% 52%)` });
  });
  // 同列只有一个协调者时居中到其子组，避免干扰同列其他成员的稳定位置。
  for (const position of [...nodes].reverse()) {
    if (!position.node || rows.get(depth(position.id)) !== 1) continue;
    const children = nodes.filter(n => parents.get(n.id) === position.id);
    if (children.length) position.y = (Math.min(...children.map(n => n.y)) + Math.max(...children.map(n => n.y + n.height))) / 2 - position.height / 2;
  }
  const roots = nodes.filter(n => n.node && !parents.has(n.id));
  if (roots.length) nodes[0].y = (Math.min(...roots.map(n => n.y)) + Math.max(...roots.map(n => n.y + n.height))) / 2 - nodes[0].height / 2;
  const positions = new Map(nodes.map(n => [n.id, n]));
  const edges: FlowEdge[] = run.nodes.map(node => {
    const sourceId = parents.get(node.id) ?? FLOW_ROOT;
    const source = positions.get(sourceId)!, target = positions.get(node.id)!;
    const sx = source.x + source.width, sy = source.y + source.height / 2;
    const tx = target.x, ty = target.y + target.height / 2, bend = Math.max(32, (tx - sx) / 2);
    const kind = node.id === 'main' ? 'execution' : sourceId === FLOW_ROOT ? 'participation' : 'delegation';
    const active = run.status === 'running' && node.status === 'running';
    return { id: `${sourceId}:${node.id}`, source: sourceId, target: node.id, kind, color: target.color, active,
      path: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}`,
      label: kind === 'participation' ? '参与本轮' : kind === 'execution' ? '执行' : '派发',
      labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 - 9 };
  });
  return { nodes, edges, width: Math.max(...nodes.map(n => n.x + n.width)) + 32, height: Math.max(...nodes.map(n => n.y + n.height)) + 40 };
}
