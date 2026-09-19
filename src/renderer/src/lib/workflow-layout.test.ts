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
  it('多层派发严格从上到下展开，并使用直角树枝', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b', 'a')]), false);
    expect(graph.nodes[3].y).toBeGreaterThan(graph.nodes[2].y);
    expect(graph.edges[2].path).toMatch(/^M .* V .* H .* V /);
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
  it('父成员位于整个子树上方，层级不会退化成无意义网格', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b', 'main'), n('c', 'a'), n('d', 'a')]), false);
    const at = (id: string) => graph.nodes.find(node => node.id === id)!;
    expect(at('a').y).toBeGreaterThan(at('main').y);
    expect(at('c').y).toBeGreaterThan(at('a').y);
    expect(at('d').y).toBe(at('c').y);
    const childCenter = (at('c').x + at('c').width / 2 + at('d').x + at('d').width / 2) / 2;
    expect(Math.abs(at('a').x + at('a').width / 2 - childCenter)).toBeLessThan(1);
  });
});
