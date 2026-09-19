import { describe, expect, it } from 'vitest';
import { mergeWorkflowRuns, workflowArtifactPath } from './workflow';
import type { WorkflowRun } from '@shared/workflow';
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
