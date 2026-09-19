import type { WorkflowNode, WorkflowRun } from '@shared/workflow';

export const FLOW_ROOT = '__workflow_run__';
export interface FlowPosition { id: string; x: number; y: number; width: number; height: number; color: string; node?: WorkflowNode }
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  kind: 'execution' | 'delegation' | 'participation' | 'exchange';
  path: string;
  color: string;
  active: boolean;
  muted: boolean;
  label: string;
  labelX: number;
  labelY: number;
}

const ROOT_WIDTH = 174;
const ROOT_HEIGHT = 64;
const CARD_WIDTH = 262;
const CARD_HEIGHT = 146;
const FOLDED_WIDTH = 190;
const FOLDED_HEIGHT = 66;
const SIBLING_GAP = 34;
const LEVEL_GAP = 74;
const MARGIN_X = 30;
const MARGIN_Y = 18;

function stableColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return `hsl(${(218 + Math.abs(hash) * 137) % 360} 58% 50%)`;
}

/**
 * 只按真实 parentId 生成树。父关系缺失或成环时，将成员挂在主助手下方，
 * 同时用虚线标明“参与但归属未确认”，避免画出一条并不存在的派发链。
 */
export function layoutWorkflow(run: WorkflowRun, compact: boolean): { nodes: FlowPosition[]; edges: FlowEdge[]; width: number; height: number } {
  const byId = new Map(run.nodes.map(node => [node.id, node]));
  const confirmedParents = new Map<string, string>();
  for (const node of run.nodes) {
    if (node.id === 'main' || !node.parentId || !byId.has(node.parentId)) continue;
    const seen = new Set<string>([node.id]);
    let cursor: string | undefined = node.parentId;
    let valid = true;
    while (cursor && byId.has(cursor)) {
      if (seen.has(cursor)) { valid = false; break; }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId;
    }
    if (valid) confirmedParents.set(node.id, node.parentId);
  }

  const mainId = byId.has('main') ? 'main' : undefined;
  const visualParents = new Map<string, string>();
  const inferred = new Set<string>();
  for (const node of run.nodes) {
    if (node.id === mainId) {
      visualParents.set(node.id, FLOW_ROOT);
      continue;
    }
    const confirmed = confirmedParents.get(node.id);
    if (confirmed) visualParents.set(node.id, confirmed);
    else {
      visualParents.set(node.id, mainId ?? FLOW_ROOT);
      inferred.add(node.id);
    }
  }

  const children = new Map<string, string[]>();
  for (const [id, parent] of visualParents) {
    const branch = children.get(parent) ?? [];
    branch.push(id);
    children.set(parent, branch);
  }
  for (const branch of children.values()) branch.sort((a, b) => {
    const left = byId.get(a), right = byId.get(b);
    const active = Number(right?.status === 'running') - Number(left?.status === 'running');
    return active || (left?.startedAt ?? 0) - (right?.startedAt ?? 0) || a.localeCompare(b);
  });

  const folded = (id: string): boolean => compact && id !== FLOW_ROOT && byId.get(id)?.status !== 'running';
  const nodeWidth = (id: string): number => id === FLOW_ROOT ? ROOT_WIDTH : folded(id) ? FOLDED_WIDTH : CARD_WIDTH;
  const nodeHeight = (id: string): number => id === FLOW_ROOT ? ROOT_HEIGHT : folded(id) ? FOLDED_HEIGHT : CARD_HEIGHT;
  const subtreeWidths = new Map<string, number>();
  const subtreeWidth = (id: string): number => {
    const branch = children.get(id) ?? [];
    const branchWidth = branch.reduce((sum, child) => sum + subtreeWidth(child), 0) + Math.max(0, branch.length - 1) * SIBLING_GAP;
    const width = Math.max(nodeWidth(id), branchWidth);
    subtreeWidths.set(id, width);
    return width;
  };
  subtreeWidth(FLOW_ROOT);

  const levels = new Map<string, number>([[FLOW_ROOT, 0]]);
  const assignLevel = (id: string): void => {
    const level = levels.get(id) ?? 0;
    for (const child of children.get(id) ?? []) { levels.set(child, level + 1); assignLevel(child); }
  };
  assignLevel(FLOW_ROOT);
  const levelHeights = new Map<number, number>();
  for (const [id, level] of levels) levelHeights.set(level, Math.max(levelHeights.get(level) ?? 0, nodeHeight(id)));
  const levelY = new Map<number, number>();
  let nextY = MARGIN_Y;
  for (let level = 0; level <= Math.max(...levels.values()); level++) {
    levelY.set(level, nextY);
    nextY += (levelHeights.get(level) ?? CARD_HEIGHT) + LEVEL_GAP;
  }

  const positions: FlowPosition[] = [];
  const place = (id: string, left: number): void => {
    const width = subtreeWidths.get(id) ?? nodeWidth(id);
    const ownWidth = nodeWidth(id);
    const node = byId.get(id);
    positions.push({ id, node, x: left + (width - ownWidth) / 2, y: levelY.get(levels.get(id) ?? 0) ?? MARGIN_Y,
      width: ownWidth, height: nodeHeight(id), color: id === FLOW_ROOT ? '#6a7d96' : stableColor(id) });
    const branch = children.get(id) ?? [];
    const branchWidth = branch.reduce((sum, child) => sum + (subtreeWidths.get(child) ?? nodeWidth(child)), 0)
      + Math.max(0, branch.length - 1) * SIBLING_GAP;
    let childLeft = left + (width - branchWidth) / 2;
    for (const child of branch) {
      place(child, childLeft);
      childLeft += (subtreeWidths.get(child) ?? nodeWidth(child)) + SIBLING_GAP;
    }
  };
  place(FLOW_ROOT, MARGIN_X);

  const positionById = new Map(positions.map(position => [position.id, position]));
  const edges: FlowEdge[] = run.nodes.flatMap(node => {
    const sourceId = visualParents.get(node.id);
    const source = sourceId ? positionById.get(sourceId) : undefined;
    const target = positionById.get(node.id);
    if (!sourceId || !source || !target) return [];
    const sx = source.x + source.width / 2;
    const sy = source.y + source.height;
    const tx = target.x + target.width / 2;
    const ty = target.y;
    const middleY = sy + (ty - sy) / 2;
    const kind = node.id === mainId ? 'execution' : inferred.has(node.id) ? 'participation' : 'delegation';
    return [{
      id: `${sourceId}:${node.id}`,
      source: sourceId,
      target: node.id,
      kind,
      color: target.color,
      active: run.status === 'running' && node.status === 'running',
      muted: node.status !== 'running',
      path: `M ${sx} ${sy} V ${middleY} H ${tx} V ${ty}`,
      label: kind === 'participation' ? '参与' : kind === 'execution' ? '统筹' : '派发',
      labelX: sx === tx ? sx + 22 : (sx + tx) / 2,
      labelY: middleY - 7,
    }];
  });

  // 成员之间的主动交流是辅助信息，不改变树的父子骨架。
  for (const link of run.exchanges ?? []) {
    const source = positionById.get(link.source), target = positionById.get(link.target);
    if (!source || !target || source === target) continue;
    const sx = source.x + source.width, sy = source.y + source.height / 2;
    const tx = target.x, ty = target.y + target.height / 2;
    const bend = Math.max(34, Math.abs(tx - sx) * .24);
    edges.push({ ...link, kind: 'exchange', color: '#8b78a8', active: false,
      muted: byId.get(link.source)?.status !== 'running' && byId.get(link.target)?.status !== 'running',
      label: '协作', labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 - 8,
      path: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}` });
  }

  const maxX = Math.max(...positions.map(position => position.x + position.width));
  const maxY = Math.max(...positions.map(position => position.y + position.height));
  return { nodes: positions, edges, width: maxX + MARGIN_X, height: maxY + 48 };
}
