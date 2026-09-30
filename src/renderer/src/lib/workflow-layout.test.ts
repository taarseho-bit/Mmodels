import { describe, expect, it } from 'vitest';
import type { WorkflowNode, WorkflowRun } from '@shared/workflow';
import { FLOW_ROOT, layoutWorkflow } from './workflow-layout';
const n = (id: string, parentId?: string, status: WorkflowNode['status'] = 'running'): WorkflowNode => ({ id, parentId, name: id, agentType: id === 'main' ? 'main' : 'general-purpose', status, tools: [], startedAt: 1 });
const run = (nodes: WorkflowNode[], status: WorkflowRun['status'] = 'running'): WorkflowRun => ({ id: 'r', sessionId: 's', startedAt: 1, updatedAt: 1, revision: 1, status, nodes, truncated: false, collaborationEnabled: true });
describe('动态有向工作流布局', () => {
  it('真正的派发边使用父成员，未知归属挂在主助手的待确认分支', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b')]), false);
    expect(graph.edges.map(e => [e.source, e.target, e.kind])).toEqual([[FLOW_ROOT, 'main', 'execution'], ['main', 'a', 'delegation'], ['main', 'b', 'participation']]);
  });
  it('多层派发严格从上到下展开，并使用柔和曲线', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b', 'a')]), false);
    expect(graph.nodes[3].y).toBeGreaterThan(graph.nodes[2].y);
    expect(graph.edges[2].path).toMatch(/^M .* C /);
  });
  it('只有正在工作的目标有流动线，结束与停止立即移除', () => {
    const nodes = [n('main'), n('a', 'main', 'returned'), n('b', 'main', 'stopped')];
    expect(layoutWorkflow(run(nodes), false).edges.map(e => e.active)).toEqual([true, false, false]);
    expect(layoutWorkflow(run(nodes, 'stopped'), false).edges.every(e => !e.active)).toBe(true);
  });
  it('新增成员不会删除已交回成员，颜色彼此不同', () => {
    const old = layoutWorkflow(run([n('main'), n('a', 'main', 'returned')]), false);
    const next = layoutWorkflow(run([n('main'), n('a', 'main', 'returned'), n('b', 'main')]), false);
    expect(new Set(next.nodes.map(p => p.id))).toEqual(new Set([FLOW_ROOT, 'main', 'a', 'b']));
    expect(next.nodes.find(p => p.id === 'a')?.color).toBe(old.nodes.find(p => p.id === 'a')?.color);
    expect(new Set(next.nodes.map(p => p.color)).size).toBe(4);
  });
  it('收起已结束同时缩小宽高，不移除历史与关系', () => {
    const nodes = [n('main'), n('a', 'main', 'returned')];
    const full = layoutWorkflow(run(nodes), false), folded = layoutWorkflow(run(nodes), true);
    expect(folded.nodes[2].height).toBeLessThan(full.nodes[2].height);
    expect(folded.nodes[2].width).toBeLessThan(full.nodes[2].width);
    expect(folded.nodes[1].height).toBe(full.nodes[1].height);
    expect(folded.edges.length).toBe(full.edges.length);
  });
  it('环与悬空关系不会无限递归或编造派发链', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'b'), n('b', 'a'), n('c', 'missing')]), false);
    expect(graph.edges.slice(1).every(e => e.kind === 'participation')).toBe(true);
    expect(Number.isFinite(graph.height)).toBe(true);
  });
  it('自动协调者居中不会与同列其他成员重叠', () => {
    const graph = layoutWorkflow(run([n('main'), n('unknown'), n('a', 'main'), n('b', 'main')]), false);
    for (const a of graph.nodes) for (const b of graph.nodes) if (a !== b) {
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  });
  it('宽大的成员簇保持可读宽度并沿弧形展开', () => {
    const graph = layoutWorkflow(run([n('main'), ...Array.from({ length: 7 }, (_, i) => n(`a${i}`, 'main'))]), false);
    const at = (id: string) => graph.nodes.find(node => node.id === id)!;
    expect(at('a4').y).toBeGreaterThan(at('a0').y);
    expect(graph.width).toBeLessThan(1300);
    expect(graph.width / graph.height).toBeGreaterThan(1.25);
    expect(graph.width / graph.height).toBeLessThan(2.1);
  });
  it('20 位直接协作者的卡片和点击区域互不覆盖', () => {
    const graph = layoutWorkflow(run([n('main'), ...Array.from({length:20},(_,i)=>n(`member-${i}`,'main'))]), false);
    expect(graph.width).toBeLessThan(1600);
    for (const a of graph.nodes) for (const b of graph.nodes) if(a !== b) {
      expect(a.x+a.width <= b.x || b.x+b.width <= a.x || a.y+a.height <= b.y || b.y+b.height <= a.y).toBe(true);
    }
  });
  it('多个无操作的已结束通用成员默认合并，展开后仍全部存在', () => {
    const nodes = [n('main'), n('a', 'main', 'returned'), n('b', 'main', 'returned'), n('c', 'main')];
    for (const node of nodes.slice(1)) node.name = '协作研究员';
    const compact = layoutWorkflow(run(nodes), true), expanded = layoutWorkflow(run(nodes), false);
    expect(compact.nodes.find(node => node.aggregateCount === 2)?.id).toContain('__workflow_group__');
    expect(compact.nodes.some(node => node.id === 'a' || node.id === 'b')).toBe(false);
    expect(expanded.nodes.filter(node => ['a', 'b', 'c'].includes(node.id))).toHaveLength(3);
  });
});
