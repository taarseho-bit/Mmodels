import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HookInput } from '@anthropic-ai/claude-agent-sdk';
import { WorkflowTrace } from './workflow-trace';
import type { WorkflowRun } from '@shared/workflow';

const base = { session_id: 'sdk', transcript_path: 'private', cwd: 'D:/private' };
const invoke = (trace: WorkflowTrace, input: object, id?: string) => trace.hook({ ...base, ...input } as HookInput, id, { signal: new AbortController().signal });
const pre = (id: string, owner?: string, name = 'Skill', input: object = { skill: 'mathmodel:paper-search' }) => ({
  hook_event_name: 'PreToolUse', tool_use_id: id, tool_name: name, tool_input: input,
  ...(owner ? { agent_id: owner, agent_type: 'general-purpose' } : { agent_type: 'general-purpose' }),
});
afterEach(() => vi.useRealTimers());
describe('真实事件工作流观察器', () => {
  it('用消息与工具的真实标识补齐父子关系，支持消息先到或后到', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('dispatch', undefined, 'Agent', { description: '角色名：模型核验员' }));
    trace.observeMessage({ type: 'tool_progress', tool_use_id: 'read', parent_tool_use_id: 'dispatch' });
    await invoke(trace, pre('read', 'child', 'Read'));
    expect(trace.run.nodes[1].parentId).toBe('main');
    expect(trace.run.nodes[1].name).toBe('模型核验员');
    await invoke(trace, pre('nested', 'child', 'Agent', {}));
    await invoke(trace, pre('calc', 'grandchild', 'Bash'));
    trace.observeMessage({ type: 'assistant', parent_tool_use_id: 'nested', message: { content: [{ type: 'tool_use', id: 'calc' }] } });
    expect(trace.run.nodes[2].parentId).toBe('child');
    trace.finish('completed');
  });
  it('只记录确认发送给已有成员的交流，不保存消息正文', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('read', 'child', 'Read'));
    await invoke(trace, { ...pre('send', undefined, 'SendMessage', { recipient: 'child', content: 'SECRET' }), hook_event_name: 'PostToolUse', tool_response: {} });
    expect(trace.run.exchanges).toEqual([{ id: 'send', source: 'main', target: 'child' }]);
    expect(JSON.stringify(trace.run)).not.toContain('SECRET');
    trace.finish('completed');
  });
  it('成功阅读技能说明与真正调用技能区分显示', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, { ...pre('read', 'child', 'Read', { file_path: 'D:/plugin/skills/paper-search/SKILL.md' }), hook_event_name: 'PostToolUse', tool_response: {} });
    expect(trace.run.nodes[1].tools[0]).toMatchObject({ skill: 'paper-search', skillSource: 'read' });
    trace.finish('completed');
  });
  it('无 agent_id 的工具归主助手，不把主助手的 agent_type 误认为子成员', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    expect(await invoke(trace, pre('t'))).toEqual({});
    expect(trace.run.nodes).toHaveLength(1);
    expect(trace.run.nodes[0].tools[0].skill).toBe('mathmodel:paper-search');
    trace.finish('completed');
  });
  it('同类并行成员不再用编号凑名称，工具仍不串线', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('t1', 'agent-a'));
    await invoke(trace, pre('t2', 'agent-b'));
    expect(trace.run.nodes.map(n => n.name)).toEqual(['建模主助手', '综合研究员', '综合研究员']);
    expect(trace.run.nodes.map(n => n.tools.length)).toEqual([0, 1, 1]);
    trace.finish('completed');
  });
  it('并行成员达到预算后拒绝继续创建临时成员', async () => {
    const trace = new WorkflowTrace('a', true, () => {}, 2);
    await invoke(trace, pre('dispatch-a', undefined, 'Agent', { description: '角色名：数据核验员' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child-a', agent_type: 'data-analyst' }, 'dispatch-a');
    await invoke(trace, pre('dispatch-b', undefined, 'Agent', { description: '角色名：模型求解员' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child-b', agent_type: 'model-solver' }, 'dispatch-b');
    const denied = await invoke(trace, pre('dispatch-c', undefined, 'Agent', { description: '角色名：图表制作员' }));
    expect(denied).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    expect(JSON.stringify(denied)).toContain('并行上限');
    expect(trace.run.nodes.map(node => node.id)).not.toContain('child-c');
    trace.finish('completed');
  });
  it('按真实工具活动推进阶段并在结束时标记阶段轨完成', async () => {
    const trace = new WorkflowTrace('a', true, () => {}, 2, 4, ['题意', '计算', '核验']);
    expect(trace.run).toMatchObject({ workflowStages: ['题意', '计算', '核验'], currentStage: 0, stageStatus: 'running' });
    await invoke(trace, { ...pre('calc', undefined, 'Bash', { command: 'python model.py' }), hook_event_name: 'PostToolUse', tool_response: {} });
    expect(trace.run.currentStage).toBe(1);
    await invoke(trace, { ...pre('audit', undefined, 'Skill', { skill: 'competition-audit' }), hook_event_name: 'PostToolUse', tool_response: {} });
    expect(trace.run.currentStage).toBe(2);
    trace.finish('completed');
    expect(trace.run.stageStatus).toBe('completed');
  });
  it('允许一层受控嵌套，但仍共享并行预算', async () => {
    const trace = new WorkflowTrace('a', true, () => {}, 2, 4);
    await invoke(trace, pre('dispatch-parent', undefined, 'Agent', { description: '角色名：模型求解员' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'parent', agent_type: 'model-solver' }, 'dispatch-parent');
    const nested = await invoke(trace, pre('dispatch-child', 'parent', 'Agent', { description: '角色名：灵敏度核验员' }));
    expect(nested).toEqual({});
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child', agent_type: 'paper-reviewer' }, 'dispatch-child');
    expect(trace.run.nodes.find(node => node.id === 'child')?.parentId).toBe('parent');
    trace.finish('completed');
  });
  it('成员陆续完成后仍受整轮总预算约束', async () => {
    const trace = new WorkflowTrace('a', true, () => {}, 1, 2);
    for (const [index, name] of ['第一位', '第二位'].entries()) {
      await invoke(trace, pre(`dispatch-${index}`, undefined, 'Agent', { description: `角色名：${name}核验员` }));
      await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: `child-${index}`, agent_type: 'general-purpose' }, `dispatch-${index}`);
      await invoke(trace, { hook_event_name: 'SubagentStop', agent_id: `child-${index}`, agent_type: 'general-purpose' });
    }
    const denied = await invoke(trace, pre('dispatch-third', undefined, 'Agent', { description: '角色名：第三位核验员' }));
    expect(denied).toMatchObject({ hookSpecificOutput: { permissionDecision: 'deny' } });
    expect(JSON.stringify(denied)).toContain('预算已用完');
    trace.finish('completed');
  });
  it('仅凭真实调用标识关联中文临时角色名，没有标识不猜归属', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('dispatch', undefined, 'Agent', { description: '角色名：灵敏度核验员；任务：复算结果', prompt: 'PRIVATE' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child', agent_type: 'general-purpose' }, 'dispatch');
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'other', agent_type: 'mystery' });
    expect(trace.run.nodes[1].name).toBe('灵敏度核验员');
    expect(trace.run.nodes[1].parentId).toBe('main');
    expect(trace.run.nodes[1].assignment).toBe('复算结果');
    expect(trace.run.nodes[2].name).toBe('协作研究员');
    expect(trace.run.nodes[2].parentId).toBeUndefined();
    expect(JSON.stringify(trace.run)).not.toContain('PRIVATE');
    trace.finish('completed');
  });
  it('启动事件缺少调用标识时，只在唯一待关联派发存在时补回具体分工', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('only-dispatch', undefined, 'Agent', { description: '角色名：约束边界核验员；任务：复核容量约束' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child', agent_type: 'general-purpose' });
    expect(trace.run.nodes[1]).toMatchObject({ parentId: 'main', name: '约束边界核验员', assignment: '复核容量约束' });
    trace.finish('completed');
  });
  it('没有手写角色名时也按真实任务生成具体中文分工，且不保存完整任务正文', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('files', undefined, 'Agent', { description: '检查附件中各工作表字段、缺失值和文件结构', prompt: 'PRIVATE-FILES' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'file-child', agent_type: 'general-purpose' }, 'files');
    await invoke(trace, pre('forecast', undefined, 'Agent', { description: '', prompt: '负责建立时间序列需求预测模型 PRIVATE-FORECAST' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'forecast-child', agent_type: 'general-purpose' }, 'forecast');
    expect(trace.run.nodes.find(n => n.id === 'file-child')?.name).toBe('附件结构核验员');
    expect(trace.run.nodes.find(n => n.id === 'forecast-child')?.name).toBe('预测模型研究员');
    expect(JSON.stringify(trace.run)).not.toContain('PRIVATE');
    trace.finish('completed');
  });
  it('旧的通用编号名称可以按已经发生的技能与操作保守还原', async () => {
    const { workflowAgentDisplayName } = await import('@shared/workflow');
    expect(workflowAgentDisplayName({ id: 'old', agentType: 'mystery', name: '专项研究员 0', status: 'returned', startedAt: 1,
      tools: [{ id: 's', name: 'Skill', label: '调用技能 · 文献检索', skill: 'paper-search', status: 'completed', startedAt: 1 }] })).toBe('文献检索员');
    expect(workflowAgentDisplayName({ id: 'old2', agentType: 'mystery', name: '专项研究员 · 2', status: 'returned', startedAt: 1,
      tools: [{ id: 'b', name: 'Bash', label: '运行计算或命令', status: 'completed', startedAt: 1 }] })).toBe('计算实验员');
  });
  it('前后事件按工具 id 去重，重复前置事件不使完成状态倒退', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('t'));
    await invoke(trace, { ...pre('t'), hook_event_name: 'PostToolUse', tool_response: 'secret response' });
    await invoke(trace, pre('t'));
    expect(trace.run.nodes[0].tools).toHaveLength(1);
    expect(trace.run.nodes[0].tools[0].status).toBe('completed');
    expect(JSON.stringify(trace.run)).not.toContain('secret response');
    trace.finish('completed');
  });
  it('子成员继续派发时记录真正的上级，新增成员与已交回成员同时保留', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('dispatch-child', 'parent', 'Agent', { description: '角色名：约束核验员；任务：核对约束' }));
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'child', agent_type: 'general-purpose' }, 'dispatch-child');
    await invoke(trace, { hook_event_name: 'SubagentStop', agent_id: 'child', agent_type: 'general-purpose' });
    await invoke(trace, { hook_event_name: 'SubagentStart', agent_id: 'next', agent_type: 'model-solver' });
    expect(trace.run.nodes.find(n => n.id === 'child')).toMatchObject({ parentId: 'parent', status: 'returned', name: '约束核验员' });
    expect(trace.run.nodes.find(n => n.id === 'next')?.status).toBe('running');
    trace.finish('completed');
  });
  it('观察回调不可干预执行，发布失败不抛到模型', async () => {
    const trace = new WorkflowTrace('a', true, () => { throw new Error('storage'); });
    expect(await invoke(trace, pre('t'))).toEqual({});
    expect(() => trace.finish('completed')).not.toThrow();
  });
  it('停止立即发布、取消节流、保留已完成记录，迟到事件不能复活', async () => {
    vi.useFakeTimers();
    const snapshots: WorkflowRun[] = [];
    const trace = new WorkflowTrace('a', true, r => snapshots.push(r));
    await invoke(trace, pre('t', 'child'));
    trace.finish('stopped');
    expect(snapshots.at(-1)?.nodes[1].tools[0].status).toBe('stopped');
    await invoke(trace, pre('late', 'new-child'));
    trace.finish('completed');
    vi.runAllTimers();
    expect(snapshots).toHaveLength(2);
    expect(snapshots.at(-1)?.status).toBe('stopped');
    expect(snapshots.at(-1)?.stageStatus).toBe('waiting');
    expect(snapshots[0].nodes).toHaveLength(1);
  });
  it('子成员返回不冒充核验通过，丢失结束事件也不永远转圈', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, pre('t', 'child'));
    await invoke(trace, { hook_event_name: 'SubagentStop', agent_id: 'child', agent_type: 'general-purpose' });
    expect(trace.run.nodes[1].status).toBe('returned');
    expect(trace.run.nodes[1].tools[0].status).toBe('unknown');
    await invoke(trace, pre('pending', 'other'));
    trace.finish('completed');
    expect(trace.run.nodes[2].status).toBe('unknown');
  });
  it('只从真实写入返回记录产物，不从命令猜测文件', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, { ...pre('write', undefined, 'Write', { file_path: 'D:/p/result.md', content: 'private' }), hook_event_name: 'PostToolUse', tool_response: {} });
    await invoke(trace, { ...pre('bash', undefined, 'Bash', { command: 'echo secret > a.pdf' }), hook_event_name: 'PostToolUse', tool_response: {} });
    expect(trace.run.nodes[0].tools[0].artifact).toBe('D:/p/result.md');
    expect(trace.run.nodes[0].tools[1].artifact).toBeUndefined();
    expect(JSON.stringify(trace.run)).not.toContain('echo secret');
    trace.finish('completed');
  });
  it('入口指令展开独立记录，不冒充 Skill 工具调用或保存全文', async () => {
    const trace = new WorkflowTrace('a', false, () => {});
    await invoke(trace, { hook_event_name: 'UserPromptExpansion', expansion_type: 'slash_command', command_name: '/mathmodel:write-paper', command_args: 'SECRET', prompt: 'SECRET' });
    expect(trace.run.nodes[0].tools[0].label).toBe('载入入口指令 · 论文写作');
    expect(trace.run.nodes[0].tools[0].skill).toBe('mathmodel:write-paper');
    expect(trace.run.nodes[0].tools[0].skillSource).toBe('entry');
    expect(JSON.stringify(trace.run)).not.toContain('SECRET');
    trace.finish('completed');
  });
  it('技能候选与真实调用分开记录，不把预加载方向误报成已执行', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    trace.recordSkillPrelude([{ id: 'paper-page-fit', label: '正文页数优化', reason: '检查正文页数和排版' }]);
    expect(trace.run.nodes[0].tools[0]).toMatchObject({ skill: 'paper-page-fit', skillSource: 'preload', verified: false, status: 'unknown' });
    await invoke(trace, pre('real-skill', undefined, 'Skill', { skill: 'paper-page-fit' }));
    expect(trace.run.nodes[0].tools[1]).toMatchObject({ skill: 'paper-page-fit', verified: true, status: 'running' });
    trace.finish('completed');
  });
  it('发布节流，不跟随 token 刷新，每轮记录有界', async () => {
    vi.useFakeTimers();
    const publish = vi.fn();
    const trace = new WorkflowTrace('a', true, publish);
    for (let i = 0; i < 510; i++) await invoke(trace, pre(`t${i}`));
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(trace.run.nodes[0].tools).toHaveLength(500);
    expect(trace.run.truncated).toBe(true);
    trace.finish('completed');
  });
  it('失败与中断工具显示如实状态，不保存错误原文', async () => {
    const trace = new WorkflowTrace('a', true, () => {});
    await invoke(trace, { ...pre('a'), hook_event_name: 'PostToolUseFailure', error: 'SECRET' });
    await invoke(trace, { ...pre('b'), hook_event_name: 'PostToolUseFailure', error: 'SECRET', is_interrupt: true });
    expect(trace.run.nodes[0].tools.map(t => t.status)).toEqual(['unsuccessful', 'stopped']);
    expect(JSON.stringify(trace.run)).not.toContain('SECRET');
    trace.finish('interrupted');
  });
});
