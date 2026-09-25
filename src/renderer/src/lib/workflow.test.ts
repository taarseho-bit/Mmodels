import { describe, expect, it } from 'vitest';
import { buildProjectWorkflow, mergeProjectWorkflowRuns, mergeWorkflowRuns, workflowArtifactPath } from './workflow';
import type { WorkflowNode, WorkflowRun } from '@shared/workflow';
const run = (id: string, sessionId = 'a', revision = 1, startedAt = 1): WorkflowRun => ({
  id, sessionId, revision, startedAt, updatedAt: 1, status: 'running', collaborationEnabled: true, nodes: [], truncated: false,
});
describe('工作流快照合并', () => {
  it('拒绝其他任务记录', () => expect(mergeWorkflowRuns([run('1')], [run('2', 'b')], 'a')).toHaveLength(1));
  it('历史读取晚于订阅事件时不回退', () => expect(mergeWorkflowRuns([run('1', 'a', 3)], [run('1')], 'a')[0].revision).toBe(3));
  it('新轮次先显示，旧轮次迟到不覆盖新任务', () => expect(mergeWorkflowRuns([run('new', 'a', 1, 2)], [run('old', 'a', 10)], 'a').map(r => r.id)).toEqual(['new', 'old']));
  it('最多保留20轮', () => expect(mergeWorkflowRuns([], Array.from({ length: 30 }, (_, i) => run(String(i), 'a', 1, i)), 'a')).toHaveLength(20));
});
describe('工作流项目内成果路径', () => {
  it('Windows路径转换为项目相对路径', () => expect(workflowArtifactPath('D:\\Project\\paper\\a.pdf', 'd:/project')).toBe('paper/a.pdf'));
  it('支持项目相对路径', () => expect(workflowArtifactPath('./paper/a.pdf', 'd:/project')).toBe('paper/a.pdf'));
  it.each(['D:/elsewhere/a.pdf', 'd:/project2/a.pdf', '../secret', 'paper/../../secret', '//host/share', 'C:secret', 'file:stream'])('不打开外部路径或跳目录 %s', file => expect(workflowArtifactPath(file, 'd:/project')).toBeNull());
});

describe('项目级工作流汇总', () => {
  const node = (id: string, name: string, parentId?: string): WorkflowNode => ({
    id, parentId, agentType: id === 'main' ? 'main' : 'model-solver', name,
    status: 'returned', tools: [], startedAt: 1, endedAt: 2,
  });
  const projectRun = (id: string, sessionId: string, title: string, startedAt: number): WorkflowRun => ({
    id, sessionId, projectId: 'project-1', sessionTitle: title, revision: 1,
    startedAt, updatedAt: startedAt + 1, status: 'completed', collaborationEnabled: true,
    nodes: [node('main', '主助手'), node('solver', '模型求解研究员', 'main')], truncated: false,
  });

  it('同一项目的多轮任务会合并为一棵树，而不是互相覆盖', () => {
    const runs = mergeProjectWorkflowRuns([], [projectRun('run-2', 'session-2', '第二轮求解', 20), projectRun('run-1', 'session-1', '题意分析', 10)], 'project-1');
    const workflow = buildProjectWorkflow('project-1', runs);
    expect(workflow?.id).toBe('project:project-1');
    expect(workflow?.nodes.map(item => item.id)).toEqual(['main', 'task:run-1', 'run-1:solver', 'task:run-2', 'run-2:solver']);
    expect(workflow?.nodes.find(item => item.id === 'task:run-1')?.name).toBe('任务：题意分析');
    expect(workflow?.nodes.find(item => item.id === 'run-2:solver')?.parentId).toBe('task:run-2');
  });

  it('不会把其他项目的实时快照混入当前项目', () => {
    const other = { ...projectRun('other', 'session-other', '其他项目', 30), projectId: 'project-2' };
    expect(mergeProjectWorkflowRuns([], [projectRun('mine', 'session-mine', '我的任务', 10), other], 'project-1').map(item => item.id)).toEqual(['mine']);
  });
});
