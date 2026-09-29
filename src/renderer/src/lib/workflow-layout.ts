import type { WorkflowNode, WorkflowRun } from '@shared/workflow';

export const FLOW_ROOT = '__workflow_run__';
export interface FlowPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  node?: WorkflowNode;
  aggregateCount?: number;
}
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
const GROUP_WIDTH = 196;
const GROUP_HEIGHT = 58;
const COLUMN_GAP = 28;
const ROW_GAP = 22;
const LEVEL_GAP = 52;
const MARGIN_X = 30;
const MARGIN_Y = 18;
// 三列优先让层级图保持接近舒适的纵横比例；同一层超过三位时向下分行，
// 避免中屏演示被横向拉长，导致“适应画布”后节点文字缩得太小。
const MAX_COLUMNS = 3;
// 极宽的一层如果只有最后一两个节点单独成行，会让图显得过高；
// 七位以上才允许第四列，兼顾大屏的纵横比例和中屏的可读性。
const WIDE_LEVEL_THRESHOLD = 7;

interface LayoutItem {
  id: string;
  node?: WorkflowNode;
  aggregateCount?: number;
}

function stableColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return `hsl(${(218 + Math.abs(hash) * 137) % 360} 58% 50%)`;
}

const genericName = (name: string): boolean => /^(?:专项研究员|协作研究员|综合研究员)(?:\s*[·#]?\s*\d+)?$/.test(name);

/**
 * 真实父子关系决定层级；同一层超过四位时在本层内部换行，避免无限横向延伸。
 * 没有工具、没有分工且已经结束的短时成员，在默认收起状态按父级合并成一个摘要节点。
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
    if (node.id === mainId) visualParents.set(node.id, FLOW_ROOT);
    else if (confirmedParents.has(node.id)) visualParents.set(node.id, confirmedParents.get(node.id)!);
    else {
      visualParents.set(node.id, mainId ?? FLOW_ROOT);
      inferred.add(node.id);
    }
  }

  const rawChildren = new Map<string, string[]>();
  for (const [id, parent] of visualParents) rawChildren.set(parent, [...(rawChildren.get(parent) ?? []), id]);
  const grouped = new Map<string, string[]>();
  if (compact) {
    for (const node of run.nodes) {
      const parent = visualParents.get(node.id);
      const isEmptyLeaf = node.id !== mainId && node.status !== 'running' && node.tools.length === 0 && !node.assignment
        && genericName(node.name) && !(rawChildren.get(node.id)?.length);
      if (parent && isEmptyLeaf) grouped.set(parent, [...(grouped.get(parent) ?? []), node.id]);
    }
    for (const [parent, ids] of [...grouped]) if (ids.length < 2) grouped.delete(parent);
  }
  const hidden = new Set([...grouped.values()].flat());

  const items = new Map<string, LayoutItem>([[FLOW_ROOT, { id: FLOW_ROOT }]]);
  for (const node of run.nodes) if (!hidden.has(node.id)) items.set(node.id, { id: node.id, node });
  const groupIds = new Map<string, string>();
  for (const [parent, ids] of grouped) {
    const id = `__workflow_group__:${parent}`;
    groupIds.set(parent, id);
    items.set(id, { id, aggregateCount: ids.length });
  }

  const children = new Map<string, string[]>();
  const addChild = (parent: string, id: string): void => { children.set(parent, [...(children.get(parent) ?? []), id]); };
  for (const node of run.nodes) if (!hidden.has(node.id)) addChild(visualParents.get(node.id) ?? FLOW_ROOT, node.id);
  for (const [parent, id] of groupIds) addChild(parent, id);
  for (const branch of children.values()) branch.sort((leftId, rightId) => {
    const left = items.get(leftId), right = items.get(rightId);
    if (Boolean(left?.aggregateCount) !== Boolean(right?.aggregateCount)) return left?.aggregateCount ? 1 : -1;
    const active = Number(right?.node?.status === 'running') - Number(left?.node?.status === 'running');
    return active || (left?.node?.startedAt ?? 0) - (right?.node?.startedAt ?? 0) || leftId.localeCompare(rightId);
  });

  const levels = new Map<number, LayoutItem[]>();
  const depthById = new Map<string, number>();
  const walk = (id: string, depth: number): void => {
    depthById.set(id, depth);
    levels.set(depth, [...(levels.get(depth) ?? []), items.get(id)!]);
    for (const child of children.get(id) ?? []) walk(child, depth + 1);
  };
  walk(FLOW_ROOT, 0);

  const dimensions = (item: LayoutItem): [number, number] => {
    if (item.id === FLOW_ROOT) return [ROOT_WIDTH, ROOT_HEIGHT];
    if (item.aggregateCount) return [GROUP_WIDTH, GROUP_HEIGHT];
    if (compact && item.node?.status !== 'running') return [FOLDED_WIDTH, FOLDED_HEIGHT];
    return [CARD_WIDTH, CARD_HEIGHT];
  };
  interface RowPlan { items: LayoutItem[]; width: number; height: number; y: number }
  const rows: RowPlan[] = [];
  let y = MARGIN_Y;
  let contentWidth = ROOT_WIDTH;
  for (let depth = 0; depth <= Math.max(...levels.keys()); depth++) {
    const level = levels.get(depth) ?? [];
    const columns = level.length >= WIDE_LEVEL_THRESHOLD ? MAX_COLUMNS + 1 : MAX_COLUMNS;
    for (let start = 0; start < level.length; start += columns) {
      const rowItems = level.slice(start, start + columns);
      const width = rowItems.reduce((sum, item) => sum + dimensions(item)[0], 0) + Math.max(0, rowItems.length - 1) * COLUMN_GAP;
      const height = Math.max(...rowItems.map(item => dimensions(item)[1]));
      rows.push({ items: rowItems, width, height, y });
      contentWidth = Math.max(contentWidth, width);
      y += height + ROW_GAP;
    }
    y += LEVEL_GAP - ROW_GAP;
  }
  const canvasWidth = contentWidth + MARGIN_X * 2;
  const positions: FlowPosition[] = [];
  for (const row of rows) {
    let x = (canvasWidth - row.width) / 2;
    for (const item of row.items) {
      const [width, height] = dimensions(item);
      positions.push({ id: item.id, node: item.node, aggregateCount: item.aggregateCount,
        x, y: row.y + (row.height - height) / 2, width, height,
        color: item.id === FLOW_ROOT ? '#6a7d96' : item.aggregateCount ? '#8b95a3' : stableColor(item.id) });
      x += width + COLUMN_GAP;
    }
  }

  const positionById = new Map(positions.map(position => [position.id, position]));
  const curve = (sourceId: string, targetId: string): { path: string; labelX: number; labelY: number } | undefined => {
    const source = positionById.get(sourceId), target = positionById.get(targetId);
    if (!source || !target) return undefined;
    const sx = source.x + source.width / 2, sy = source.y + source.height;
    const tx = target.x + target.width / 2, ty = target.y;
    const bend = Math.max(30, (ty - sy) * .46);
    return { path: `M ${sx} ${sy} C ${sx} ${sy + bend}, ${tx} ${ty - bend}, ${tx} ${ty}`,
      labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 - 7 };
  };
  const edges: FlowEdge[] = [];
  for (const node of run.nodes) {
    if (hidden.has(node.id)) continue;
    const sourceId = visualParents.get(node.id) ?? FLOW_ROOT;
    const shape = curve(sourceId, node.id);
    const target = positionById.get(node.id);
    if (!shape || !target) continue;
    const kind = node.id === mainId ? 'execution' : inferred.has(node.id) ? 'participation' : 'delegation';
    edges.push({ id: `${sourceId}:${node.id}`, source: sourceId, target: node.id, kind, color: target.color,
      active: run.status === 'running' && node.status === 'running', muted: node.status !== 'running',
      label: kind === 'participation' ? '参与' : kind === 'execution' ? '统筹' : '派发', ...shape });
  }
  for (const [parent, id] of groupIds) {
    const shape = curve(parent, id);
    if (!shape) continue;
    edges.push({ id: `${parent}:${id}`, source: parent, target: id, kind: 'participation', color: '#8b95a3',
      active: false, muted: true, label: '已收起', ...shape });
  }

  // 交流线只作为淡色补充，不改变树的层级。
  for (const link of run.exchanges ?? []) {
    if (hidden.has(link.source) || hidden.has(link.target)) continue;
    const source = positionById.get(link.source), target = positionById.get(link.target);
    if (!source || !target || source === target) continue;
    const sx = source.x + source.width, sy = source.y + source.height / 2;
    const tx = target.x, ty = target.y + target.height / 2;
    const bend = Math.max(36, Math.abs(tx - sx) * .22);
    edges.push({ ...link, kind: 'exchange', color: '#8b78a8', active: false,
      muted: byId.get(link.source)?.status !== 'running' && byId.get(link.target)?.status !== 'running',
      label: '协作', labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 - 8,
      path: `M ${sx} ${sy} C ${sx + bend} ${sy}, ${tx - bend} ${ty}, ${tx} ${ty}` });
  }

  const maxY = Math.max(...positions.map(position => position.y + position.height));
  return { nodes: positions, edges, width: canvasWidth, height: maxY + 48 };
}
