import { describe, expect, it } from 'vitest';
import { petStateFor, visibleAgentActivities, visibleAgentText } from './modeling-activity';

describe('数学建模伙伴状态只跟随真实活动', () => {
  it('空闲时待命，运行但没有工具时思考', () => {
    expect(petStateFor({ active: false, stopping: false, blocks: [], agents: [] })).toBe('resting');
    expect(petStateFor({ active: true, stopping: false, blocks: [], agents: [] })).toBe('thinking');
  });

  it('按照最后一个真实工具区分读取、求解、画图和写作', () => {
    const stateFor = (toolName: string) => petStateFor({
      active: true,
      stopping: false,
      blocks: [{ kind: 'tool_use', toolName }],
      agents: [],
    });
    expect(stateFor('Read')).toBe('reading');
    expect(stateFor('Bash')).toBe('solving');
    expect(stateFor('mcp__drawio__plot')).toBe('plotting');
    expect(stateFor('Write')).toBe('writing');
  });

  it('真实子智能体运行时优先显示协作，停止时优先显示收束', () => {
    const agents = [{
      taskId: 'a1', agentType: 'model-solver', description: '核对约束', status: 'running' as const,
    }];
    expect(petStateFor({ active: true, stopping: false, blocks: [], agents })).toBe('collaborating');
    expect(petStateFor({ active: true, stopping: true, blocks: [], agents })).toBe('stopping');
  });

  it('英文 SDK 摘要不直接显示给中文用户', () => {
    expect(visibleAgentText({
      taskId: 'a1', agentType: 'model-solver', description: 'Solve the model', summary: 'Checking constraints', status: 'running',
    })).toBe('正在独立核对这一部分');
  });

  it('演示面板优先显示正在工作的两位成员，其他记录保留给工作流', () => {
    const activities = [
      { taskId: 'done', agentType: 'data-analyst', description: '已完成数据核对', status: 'completed' as const },
      { taskId: 'run-1', agentType: 'model-solver', description: '正在求解', status: 'running' as const },
      { taskId: 'run-2', agentType: 'paper-reviewer', description: '正在复核', status: 'pending' as const },
      { taskId: 'run-3', agentType: 'figure-maker', description: '正在绘图', status: 'running' as const },
    ];
    expect(visibleAgentActivities(activities).map((item) => item.taskId)).toEqual(['run-1', 'run-2']);
    expect(activities).toHaveLength(4);
  });
});
