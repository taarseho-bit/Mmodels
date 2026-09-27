/**
 * 任务进度面板的数据层回归测试。
 *
 * 输入覆盖 TaskCreate/TaskUpdate 的 input 与 tool_result 文本，只把 subject
 * 换成 A/B/C/D 便于断言。
 */
import { describe, expect, it } from 'vitest';
import type { ContentBlock } from '@shared/types';
import { extractTasks, latestTaskBlocks, progressOf, type TaskState } from './tasks';
import { setLang, tx } from '../i18n';

let seq = 0;
function create(subject: string, result: string): ContentBlock {
  seq++;
  return {
    kind: 'tool_use',
    toolName: 'TaskCreate',
    toolUseId: `c${seq}`,
    toolInput: { subject, description: `做 ${subject}`, activeForm: `正在做 ${subject}` },
    // 运行测试原文格式："Task #1 created successfully: 修复并跑通 problem3/problem4 求解脚本"
    toolResult: result,
  };
}

function update(taskId: string, status: string): ContentBlock {
  seq++;
  return {
    kind: 'tool_use',
    toolName: 'TaskUpdate',
    toolUseId: `u${seq}`,
    toolInput: { taskId, status },
    // 运行测试原文："Updated task #1 status"
    toolResult: `Updated task #${taskId} status`,
  };
}

/** 生成 N 个 TaskCreate（结果文本里的编号即 Tool 侧 task id） */
function createN(n: number): ContentBlock[] {
  return Array.from({ length: n }, (_, i) => create(`任务${i + 1}`, `Task #${i + 1} created successfully: 任务${i + 1}`));
}

function statuses(s: TaskState): string[] {
  return s.list.map((t) => `${t.subject}:${t.status}`);
}

describe('extractTasks —— 从工具调用流还原任务清单', () => {
  it('TaskCreate×4 + Update(1→completed, 2→in_progress)：顺序不变、状态正确、计数 1/4', () => {
    const blocks: ContentBlock[] = [
      ...createN(4),
      update('1', 'completed'),
      update('2', 'in_progress'),
    ];
    const state = extractTasks(blocks);

    // ① 顺序 = 创建顺序（不是按状态重排）
    expect(state.list.map((t) => t.subject)).toEqual(['任务1', '任务2', '任务3', '任务4']);
    // ② 状态
    expect(statuses(state)).toEqual([
      '任务1:completed',
      '任务2:in_progress',
      '任务3:pending',
      '任务4:pending',
    ]);
    // ③ x/y 计数
    const p = progressOf(state);
    expect(p.completed).toBe(1);
    expect(p.total).toBe(4);
    expect(p.current?.subject).toBe('任务2');
    // ④ Tool 侧 id 是从 tool_result 文本里抠出来的
    expect(state.list.map((t) => t.toolId)).toEqual(['1', '2', '3', '4']);
  });

  it('全部完成 → 2/2 且 current 为 null', () => {
    const state = extractTasks([...createN(2), update('1', 'completed'), update('2', 'completed')]);
    const p = progressOf(state);
    expect(p.completed).toBe(2);
    expect(p.total).toBe(2);
    expect(p.current).toBeNull();
  });

  it('deleted 从列表移除，分母随之减一', () => {
    const state = extractTasks([...createN(4), update('2', 'deleted'), update('1', 'completed')]);
    expect(state.list.map((t) => t.subject)).toEqual(['任务1', '任务3', '任务4']);
    const p = progressOf(state);
    expect(p.completed).toBe(1);
    expect(p.total).toBe(3); // 4 - 1(deleted)
  });

  it('跨消息累积：第二轮的块折在上一轮结果之上（未全完成时绝不重置）', () => {
    // 第 1 轮结束在 1/2 —— 这时任务2 还是 pending，第二批**不是**新活
    const turn1 = extractTasks([...createN(2), update('1', 'completed')]);
    expect(statuses(turn1)).toEqual(['任务1:completed', '任务2:pending']);

    const turn2 = extractTasks(
      [update('2', 'in_progress'), create('任务3', 'Task #3 created successfully: 任务3')],
      turn1,
    );
    expect(statuses(turn2)).toEqual(['任务1:completed', '任务2:in_progress', '任务3:pending']);
    expect(progressOf(turn2).total).toBe(3);
    expect(progressOf(turn2).current?.subject).toBe('任务2');
  });

  it('上一批全完成后又出现 TaskCreate → 开新一批（不带上旧条目）', () => {
    const turn1 = extractTasks([...createN(2), update('1', 'completed'), update('2', 'completed')]);
    const turn2 = extractTasks([create('新任务', 'Task #3 created successfully: 新任务')], turn1);
    expect(turn2.list.map((t) => t.subject)).toEqual(['新任务']);
    expect(progressOf(turn2)).toEqual({ completed: 0, total: 1, current: null });
  });

  it('归零：没有任务工具调用时不产出任何条目（面板据此不渲染）', () => {
    const state = extractTasks([
      { kind: 'text', text: '我在思考' },
      { kind: 'thinking', text: '……' },
      { kind: 'tool_use', toolName: 'Bash', toolInput: { command: 'ls' }, toolResult: 'ok' },
      { kind: 'tool_use', toolName: 'mcp__mathmodel__TaskCreateX', toolInput: { subject: '假的' } },
    ]);
    expect(state.list).toEqual([]);
    expect(progressOf(state).total).toBe(0);
  });

  it('TodoWrite 整表替换，且认 content/status/activeForm', () => {
    const state = extractTasks([
      {
        kind: 'tool_use',
        toolName: 'TodoWrite',
        toolInput: {
          todos: [
            { content: '读数据', status: 'completed', activeForm: '正在读数据' },
            { content: '建模', status: 'in_progress', activeForm: '正在建模' },
            { content: '写论文', status: 'pending', activeForm: '正在写论文' },
          ],
        },
      },
    ]);
    expect(statuses(state)).toEqual(['读数据:completed', '建模:in_progress', '写论文:pending']);
    expect(progressOf(state)).toMatchObject({ completed: 1, total: 3 });
  });

  it('tool_result 还没回来（流式途中）也能先出一行，状态为 pending', () => {
    const state = extractTasks([
      { kind: 'tool_use', toolName: 'TaskCreate', toolUseId: 'x', toolInput: { subject: '任务1' } },
    ]);
    expect(state.list).toHaveLength(1);
    expect(state.list[0].status).toBe('pending');
    expect(state.list[0].toolId).toBeUndefined(); // 兜底键 k1（见 tasks.ts 注释）
    expect(state.list[0].key).toBe('k1');
  });
});

describe('latestTaskBlocks —— 重启后只恢复最近一批任务', () => {
  it('不会把前几轮已经结束的任务重新拼进当前清单', () => {
    const old = create('旧任务', 'Task #1 created successfully: 旧任务');
    const current = create('当前任务', 'Task #2 created successfully: 当前任务');
    const messages = [
      { role: 'assistant', blocks: [old, update('1', 'completed')] },
      { role: 'user', blocks: [{ kind: 'text' as const, text: '继续修改论文' }] },
      { role: 'assistant', blocks: [current] },
    ];
    const state = extractTasks(latestTaskBlocks(messages));
    expect(state.list.map((task) => task.subject)).toEqual(['当前任务']);
  });
});

/**
 * 面板文案必须真的**取到值**。
 *
 * 为什么值得单测：`tx()` 取不到路径时**原样返回路径字符串**（i18n/index.ts 的
 * `lookup(path) ?? path`），界面上就会直接显示 `composer.composerTaskListCard.progress`
 * —— 不报错、不像坏，只是很难看，而且只在界面样例里才看得见。
 * （第一版就写错成 `chat.composerTaskListCard.*`，界面样例才发现。）
 */
describe('任务面板文案 —— 应用约定键必须命中', () => {
  const KEYS = [
    'composer.composerTaskListCard.tasksLabel',
    'composer.composerTaskListCard.progress',
    'composer.composerTaskListCard.progressTitle',
    'composer.composerTaskListCard.expand',
    'composer.composerTaskListCard.collapse',
  ];

  it('zh-CN：每个键都能取到中文，且不等于键本身', () => {
    setLang('zh-CN');
    for (const k of KEYS) {
      const v = tx(k);
      expect(v, `${k} 未命中`).not.toBe(k);
      expect(v.length).toBeGreaterThan(0);
    }
    expect(tx('composer.composerTaskListCard.tasksLabel')).toBe('任务');
    expect(tx('composer.composerTaskListCard.progress', { completed: 1, total: 4 })).toBe(
      '已完成 1/4 个任务',
    );
  });

  it('en-US：取到英文，不硬编码中文', () => {
    setLang('en-US');
    for (const k of KEYS) {
      const v = tx(k);
      expect(v, `${k} 未命中`).not.toBe(k);
      expect(/[A-Za-z]/.test(v)).toBe(true);
    }
    setLang('zh-CN');
  });
});
