import type { WorkflowNode, WorkflowRun } from '@shared/workflow';

export const FLOW_ROOT = '__workflow_run__';
export interface FlowPosition { id: string; x: number; y: number; width: number; height: number; color: string; node?: WorkflowNode }
export interface FlowEdge { id: string; source: string; target: string; kind: 'execution' | 'delegation' | 'participation' | 'exchange'; path: string; color: string; active: boolean; label: string; labelX: number; labelY: number }
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
  // 用接近黄金比例的网格承载拓扑次序；图形位置不冒充执行顺序。
  const count = Math.max(1, run.nodes.length), cardWidth = 270, gap = 48, rowHeight = 186;
  let columns = 1, best = Infinity;
  for (let c = 1; c <= Math.min(count, 8); c++) {
    const w = c * (cardWidth + gap) + 8, h = 150 + Math.ceil(count / c) * rowHeight;
    const score = Math.abs(Math.log(w / h / 1.618)) + (Math.ceil(count / c) * c - count) * .025;
    if (score < best) { best = score; columns = c; }
  }
  const ordered = [...run.nodes].sort((a, b) => depth(a.id) - depth(b.id));
  const width = columns * (cardWidth + gap) + 8;
  const nodes: FlowPosition[] = [{ id: FLOW_ROOT, x: width / 2 - 90, y: 16, width: 180, height: 76, color: '#6a7d96' }];
  run.nodes.forEach((node, index) => {
    const slot = ordered.findIndex(n => n.id === node.id);
    const height = compact && node.status !== 'running' ? 88 : 146;
    nodes.push({ id: node.id, node, x: 28 + slot % columns * (cardWidth + gap), y: 140 + Math.floor(slot / columns) * rowHeight,
      width: cardWidth, height,
      color: `hsl(${Math.round((218 + index * 137.508) % 360)} 62% 52%)` });
  });
  const positions = new Map(nodes.map(n => [n.id, n]));
  const edges: FlowEdge[] = run.nodes.map(node => {
    const sourceId = parents.get(node.id) ?? FLOW_ROOT;
    const source = positions.get(sourceId)!, target = positions.get(node.id)!;
    const sameRow = source.y === target.y;
    const sx = sameRow ? source.x + source.width : source.x + source.width / 2;
    const sy = sameRow ? source.y + source.height / 2 : source.y + source.height;
    const tx = sameRow ? target.x : target.x + target.width / 2;
    const ty = sameRow ? target.y + target.height / 2 : target.y;
    let path = sameRow ? `M ${sx} ${sy} C ${sx + 24} ${sy}, ${tx - 24} ${ty}, ${tx} ${ty}`
      : `M ${sx} ${sy} C ${sx} ${sy + 24}, ${tx} ${ty - 24}, ${tx} ${ty}`;
    let labelX = (sx + tx) / 2, labelY = (sy + ty) / 2 - 9;
    // Non-adjacent siblings must not draw through another agent and look like a false handoff.
    if (sameRow && target.x - source.x > cardWidth + gap + 1) {
      const y = source.y - 22, start = source.x + source.width / 2, end = target.x + target.width / 2;
      path = `M ${start} ${source.y} L ${start} ${y} L ${end} ${y} L ${end} ${target.y}`;
      labelX = (start + end) / 2; labelY = y - 6;
    } else if (!sameRow && target.y - source.y > rowHeight + 1) {
      const lane = source.x - 16;
      path = `M ${sx} ${sy} L ${sx} ${sy + 18} L ${lane} ${sy + 18} L ${lane} ${ty - 22} L ${tx} ${ty - 22} L ${tx} ${ty}`;
      labelX = (lane + tx) / 2; labelY = ty - 28;
    }
    const kind = node.id === 'main' ? 'execution' : sourceId === FLOW_ROOT ? 'participation' : 'delegation';
    const active = run.status === 'running' && node.status === 'running';
    return { id: `${sourceId}:${node.id}`, source: sourceId, target: node.id, kind, color: target.color, active,
      path,
      label: kind === 'participation' ? '参与' : kind === 'execution' ? '统筹' : '分工',
      labelX, labelY };
  });
  for (const link of run.exchanges ?? []) {
    const a = positions.get(link.source), b = positions.get(link.target);
    if (!a || !b || a === b) continue;
    const sx = a.x + a.width / 2, sy = a.y + a.height, tx = b.x + b.width / 2, ty = b.y + b.height;
    edges.push({ ...link, kind: 'exchange', color: '#9470b5', active: false, label: '交流', labelX: (sx + tx) / 2,
      labelY: Math.max(sy, ty) + 15, path: `M ${sx} ${sy} C ${sx} ${Math.max(sy, ty) + 38}, ${tx} ${Math.max(sy, ty) + 38}, ${tx} ${ty}` });
  }
  return { nodes, edges, width: Math.max(...nodes.map(n => n.x + n.width)) + 32, height: Math.max(...nodes.map(n => n.y + n.height)) + 50 };
}
