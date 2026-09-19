import { describe, expect, it } from 'vitest';
import type { WorkflowNode, WorkflowRun } from '@shared/workflow';
import { FLOW_ROOT, layoutWorkflow } from './workflow-layout';
const n = (id: string, parentId?: string, status: WorkflowNode['status'] = 'running'): WorkflowNode => ({ id, parentId, name: id, agentType: id === 'main' ? 'main' : 'general-purpose', status, tools: [], startedAt: 1 });
const run = (nodes: WorkflowNode[], status: WorkflowRun['status'] = 'running'): WorkflowRun => ({ id: 'r', sessionId: 's', startedAt: 1, updatedAt: 1, revision: 1, status, nodes, truncated: false, collaborationEnabled: true });
describe('动态有向工作流布局', () => {
  it('真正的派发边使用父成员，未知归属单列为参与本轮', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b')]), false);
    expect(graph.edges.map(e => [e.source, e.target, e.kind])).toEqual([[FLOW_ROOT, 'main', 'execution'], ['main', 'a', 'delegation'], [FLOW_ROOT, 'b', 'participation']]);
  });
  it('多层派发向右展开，箭头有源与目标', () => {
    const graph = layoutWorkflow(run([n('main'), n('a', 'main'), n('b', 'a')]), false);
    expect(graph.nodes[3].x).toBeGreaterThan(graph.nodes[2].x);
    expect(graph.edges[2].path.startsWith('M ')).toBe(true);
  });
  it('只有正在工作的目标有流动线，结束与停止立即移除', () => {
    const nodes = [n('main'), n('a', 'main', 'returned'), n('b', 'main', 'stopped')];
    expect(layoutWorkflow(run(nodes), false).edges.map(e => e.active)).toEqual([true, false, false]);
    expect(layoutWorkflow(run(nodes, 'stopped'), false).edges.every(e => !e.active)).toBe(true);
  });
  it('新增成员不会删除已交回成员，颜色彼此不同', () => {
    const old = layoutWorkflow(run([n('main'), n('a', 'main', 'returned')]), false);
    const next = layoutWorkflow(run([n('main'), n('a', 'main', 'returned'), n('b', 'main')]), false);
    expect(next.nodes.map(p => p.id)).toEqual([FLOW_ROOT, 'main', 'a', 'b']);
    expect(next.nodes[2].color).toBe(old.nodes[2].color);
    expect(new Set(next.nodes.map(p => p.color)).size).toBe(4);
  });
  it('收起已结束仅改变展示高度，不移除历史与关系', () => {
    const nodes = [n('main'), n('a', 'main', 'returned')];
    const full = layoutWorkflow(run(nodes), false), folded = layoutWorkflow(run(nodes), true);
    expect(folded.nodes[2].height).toBeLessThan(full.nodes[2].height);
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
    expect(Math.abs(graph.nodes[1].y - graph.nodes[2].y)).toBeGreaterThan(128);
  });
});
