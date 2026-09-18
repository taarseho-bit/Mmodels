import { describe, expect, it } from 'vitest';
import { petStateFor, visibleAgentText } from './modeling-activity';

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
});
