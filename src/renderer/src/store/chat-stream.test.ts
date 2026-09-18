/**
 * 会话级存活窗口 store 的回归测试 —— 盯的是**用户报的那个 bug**：
 *
 *   「我切换到其他的对话或者项目，只要一切换，再切换回去，
 *     就看不到整个聊天记录的过程，还有任务的列表是否完成等等那些参数。」
 *
 * 所以断言不是"函数返回了个东西"，而是三条可证伪的性质：
 *   ① 切走再切回，块序列**逐块相等**（顺序、条数、每块的关键字段）；
 *   ② 非当前会话的事件**不会丢**（旧实现在这里 `return` 掉了）；
 *   ③ 超容量时淘汰**最旧**的会话，且新写入的不被误删。
 *
 * ⚠️ 本文件还负责"反向对照"：把 `ChatStreamStore.snapshot()` 改成恒返回空窗口
 *    （= 旧实现的"切走就清空"），下面标了 `[反向对照]` 的那条必须立刻变红。
 *    做法与证据见 `verify/` 里的汇报，不写在代码里（避免注释与实现漂移）。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ContentBlock, InflightTurn, StreamEvent } from '@shared/types';
import {
  ChatStreamStore,
  MAX_BLOCKS_PER_SESSION,
  MAX_CACHED_SESSIONS,
  applyStreamEvent,
  emptySessionStream,
  panelTasks,
  toView,
  chatStreamStore,
} from './chat-stream';

let store: ChatStreamStore;

beforeEach(() => {
  store = new ChatStreamStore();
});

// ─────────────────────────────────────────────────────────────
// 事件构造器 —— 用真实形状（与 main 推给渲染层的一致）
// ─────────────────────────────────────────────────────────────

const textBlock = (index: number, delta: string): StreamEvent[] => [
  { type: 'block-start', index, kind: 'text' },
  { type: 'text-delta', index, delta },
];

const toolUse = (toolName: string, toolUseId: string, input: unknown): StreamEvent => ({
  type: 'tool-use',
  toolName,
  toolUseId,
  input,
});

const toolResult = (toolUseId: string, result: unknown, isError?: boolean): StreamEvent => ({
  type: 'tool-result',
  toolUseId,
  result,
  isError,
});

/** 喂一串事件（带显式时刻，便于让淘汰顺序可验证） */
function feed(storeRef: ChatStreamStore, sid: string, evs: StreamEvent[], at = 1): void {
  evs.forEach((ev, i) => storeRef.apply(sid, ev, at + i));
}

const kinds = (blocks: ContentBlock[]): string[] => blocks.map((b) => b.kind);

// ─────────────────────────────────────────────────────────────
// ① 同一会话：写入 → 读取，逐块相等
// ─────────────────────────────────────────────────────────────

describe('chat-stream —— 同一会话写入后读取，块序列逐块相等', () => {
  it('条数、类型、关键字段（thinking 文本 / text 文本 / toolName / toolResult）全部一致', () => {
    feed(store, 'A', [
      { type: 'session-start', sessionId: 'A' },
      ...textBlock(0, '先看一下题目'),
      { type: 'block-start', index: 1, kind: 'thinking' },
      { type: 'thinking-delta', index: 1, delta: '要建一个优化模型' },
      ...textBlock(2, '开始求解'),
      toolUse('TaskCreate', 'tu1', { subject: '跑数据', activeForm: '正在跑数据' }),
      toolUse('Bash', 'tu2', { command: 'python solve.py' }),
      toolResult('tu2', 'exit 0', false),
    ]);

    const got = store.snapshot('A').blocks;

    // 条数与顺序（不是"长度相等"就算过）
    expect(got).toHaveLength(5);
    expect(kinds(got)).toEqual(['text', 'thinking', 'text', 'tool_use', 'tool_use']);

    // 逐块比对关键字段
    expect(got[0]).toEqual({ kind: 'text', text: '先看一下题目' });
    expect(got[1]).toEqual({ kind: 'thinking', text: '要建一个优化模型' });
    expect(got[2]).toEqual({ kind: 'text', text: '开始求解' });
    expect(got[3]).toEqual({
      kind: 'tool_use',
      toolName: 'TaskCreate',
      toolUseId: 'tu1',
      toolInput: { subject: '跑数据', activeForm: '正在跑数据' },
    });
    expect(got[4].toolName).toBe('Bash');
    expect(got[4].toolUseId).toBe('tu2');
    expect(got[4].toolResult).toBe('exit 0');

    // 第二次读必须与第一次**深相等**（读不改变内容）
    expect(store.snapshot('A').blocks).toEqual(got);
  });

  it('tool-result 落到同 toolUseId 的块上（含 isError 透传），不新增块', () => {
    feed(store, 'A', [
      toolUse('Bash', 'tu1', { command: 'ls' }),
      toolResult('tu1', 'boom', true),
    ]);
    const blocks = store.snapshot('A').blocks;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].toolResult).toBe('boom');
    expect(blocks[0].isError).toBe(true);
  });

  it('session-end 只改轮次状态，不清块也不清错误（后台会话切回来才能看到）', () => {
    feed(store, 'A', [
      { type: 'session-start', sessionId: 'A' },
      ...textBlock(0, '做完了'),
      { type: 'session-error', message: '网络断了' },
      { type: 'session-end', sessionId: 'A' },
    ]);
    const entry = store.snapshot('A');
    expect(entry.phase).toBe('done');
    expect(entry.blocks).toHaveLength(1);
    expect(entry.error).toBe('网络断了');
    expect(toView(entry).active).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// ② 用户报的核心场景：A 写 → 切 B 写 → 读 A
// ─────────────────────────────────────────────────────────────

describe('chat-stream —— 切到别的会话再切回来，内容原样', () => {
  it('[反向对照] 会话 A 写入 → 切到 B 写入 → 读 A，A 逐块等于切走前的那份', () => {
    // A 这一轮：思考 + 正文 + 一个工具调用
    feed(store, 'A', [
      { type: 'session-start', sessionId: 'A' },
      { type: 'block-start', index: 1, kind: 'thinking' },
      { type: 'thinking-delta', index: 1, delta: 'A 的思路' },
      ...textBlock(2, 'A 的正文'),
      toolUse('Write', 'wa', { file_path: 'a.tex' }),
      toolResult('wa', 'ok'),
    ]);
    // 切走之前眼里的那份（用户"原来是怎么样的"）
    const before = store.snapshot('A').blocks;
    const beforeView = toView(store.snapshot('A'));
    expect(beforeView.active).toBe(true);

    // 切到 B 干活（B 的事件不该影响 A）
    feed(store, 'B', [
      { type: 'session-start', sessionId: 'B' },
      ...textBlock(0, 'B 的正文'),
      toolUse('Read', 'rb', { file_path: 'b.tex' }),
    ], 5000);

    // 切回 A
    const after = store.snapshot('A').blocks;

    // ① 与切走前逐块相等
    expect(after).toEqual(before);
    // ② 与独立写死的期望值也一致（防止 before 本身就已经是错的）
    expect(kinds(after)).toEqual(['thinking', 'text', 'tool_use']);
    expect(after[0].text).toBe('A 的思路');
    expect(after[1].text).toBe('A 的正文');
    expect(after[2].toolInput).toEqual({ file_path: 'a.tex' });
    expect(after[2].toolResult).toBe('ok');
    // ③ 视图也是"还在流式"，不会被误判成收尾
    expect(toView(store.snapshot('A')).active).toBe(true);
    // ④ B 没被 A 串味
    expect(kinds(store.snapshot('B').blocks)).toEqual(['text', 'tool_use']);
  });

  it('A 的事件在"当前会话 = B"时到达也不丢：A 槽位多一块，B 视图不动', () => {
    // 走的是 ChatPage 订阅回调用的那条路径（`store.receive`）：
    // 写槽位一律执行，"要不要重渲染"由 isCurrent 决定。
    let current: string | null = 'B';
    let viewBlocks: ContentBlock[] = [];
    const onEvent = (sid: string, ev: StreamEvent, at: number): void => {
      const { entry, isCurrent } = store.receive(sid, ev, current, at);
      if (isCurrent) viewBlocks = toView(entry).blocks;
    };

    onEvent('B', { type: 'session-start', sessionId: 'B' }, 100);
    onEvent('B', toolUse('Bash', 'b1', { command: 'b' }), 101);
    const bBefore = viewBlocks.length;

    // 当前在 B，但 A 的流事件到了（用户切走前发起的那一轮还在跑）
    onEvent('A', { type: 'session-start', sessionId: 'A' }, 102);
    onEvent('A', toolUse('Bash', 'a1', { command: 'a' }), 103);
    onEvent('A', toolUse('Bash', 'a2', { command: 'a2' }), 104);

    // ① A 的槽位真的多出了两块（旧实现这里直接被 return 丢掉）
    expect(store.get('A')?.blocks.map((b) => b.toolUseId)).toEqual(['a1', 'a2']);
    // ② B 的视图没有被 A 的事件污染（也没被清零）
    expect(viewBlocks).toHaveLength(bBefore);
    expect(viewBlocks.every((b) => b.toolUseId !== 'a1' && b.toolUseId !== 'a2')).toBe(true);
    // ③ 切回 A 能拿到（current 变了 → isCurrent 变 true）
    current = 'A';
    const back = store.receive('A', { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } }, current, 105);
    expect(back.isCurrent).toBe(true);
    expect(store.snapshot('A').blocks).toHaveLength(2);
  });

  it('模块级单例在"组件卸载重建"后仍在（模拟切到设置页再回来）', () => {
    feed(chatStreamStore, 'singleton-1', [...textBlock(0, '卸载前写下的')], 7);
    // ChatPage 卸载 → 再挂载：组件 state 没了，但 store 是模块级的，还在
    const restored = chatStreamStore.snapshot('singleton-1');
    expect(restored.blocks).toHaveLength(1);
    expect(restored.blocks[0].text).toBe('卸载前写下的');
    chatStreamStore.clear('singleton-1');
    expect(chatStreamStore.get('singleton-1')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// ③ 容量上限
// ─────────────────────────────────────────────────────────────

describe('chat-stream —— 容量上限', () => {
  it('会话数超限淘汰最旧的，新写入的与较新的都在', () => {
    for (let i = 0; i < MAX_CACHED_SESSIONS; i++) {
      feed(store, `s${i}`, [...textBlock(0, `第 ${i} 个`)], 1000 + i);
    }
    expect(store.size).toBe(MAX_CACHED_SESSIONS);

    // 第 9 个会话
    feed(store, 's-new', [...textBlock(0, '新的')], 9000);

    expect(store.size).toBe(MAX_CACHED_SESSIONS);
    expect(store.get('s0')).toBeUndefined(); // 最旧（updatedAt=1000）被淘汰
    expect(store.get('s-new')).toBeDefined(); // 刚写的没被误删
    expect(store.get('s-new')?.blocks[0].text).toBe('新的');
    expect(store.get('s1')).toBeDefined(); // 次旧的还在
    expect(store.get(`s${MAX_CACHED_SESSIONS - 1}`)).toBeDefined();
  });

  it('刚写入的槽位永远不被自己这次淘汰掉（即使它的时刻最小）', () => {
    for (let i = 0; i < MAX_CACHED_SESSIONS; i++) {
      feed(store, `s${i}`, [...textBlock(0, `第 ${i} 个`)], 2000 + i);
    }
    feed(store, 's-new', [...textBlock(0, '新的')], 1); // 时刻比谁都小

    expect(store.get('s-new')).toBeDefined();
    expect(store.get('s0')).toBeUndefined(); // 被淘汰的是 s0（2001，除新写入外最旧）
    expect(store.get('s1')).toBeDefined();
  });

  it('单会话块数超限从头丢，且后续 text-delta 不串块（索引偏移被还原）', () => {
    const total = MAX_BLOCKS_PER_SESSION + 5;
    for (let i = 0; i < total; i++) {
      store.apply('A', { type: 'block-start', index: i, kind: 'text' }, 1);
      store.apply('A', { type: 'text-delta', index: i, delta: `x${i}` }, 1);
    }

    const entry = store.snapshot('A');
    expect(entry.blocks).toHaveLength(MAX_BLOCKS_PER_SESSION);
    expect(entry.firstIndex).toBe(5); // 前面 5 块被丢掉
    // 偏移还原：留下的是 x5..x(total-1)，没有错位/串块
    expect(entry.blocks[0].text).toBe('x5');
    expect(entry.blocks[MAX_BLOCKS_PER_SESSION - 1].text).toBe(`x${total - 1}`);
    expect(new Set(entry.blocks.map((b) => b.text)).size).toBe(MAX_BLOCKS_PER_SESSION);
  });

  it('被裁掉的老块收到迟到的 delta 时被忽略（不会越界写到别的块上）', () => {
    let entry = emptySessionStream('A');
    for (let i = 0; i < MAX_BLOCKS_PER_SESSION + 2; i++) {
      entry = applyStreamEvent(entry, { type: 'block-start', index: i, kind: 'text' }, 1);
    }
    expect(entry.firstIndex).toBe(2);
    const before = entry.blocks.map((b) => b.text);
    // 迟到的 delta：index 0 已被裁掉 → 整条忽略
    entry = applyStreamEvent(entry, { type: 'text-delta', index: 0, delta: '迟到' }, 1);
    expect(entry.blocks.map((b) => b.text)).toEqual(before);
  });
});

// ─────────────────────────────────────────────────────────────
// ④ 任务进度面板：文本集合 + 勾选集合逐条相等（对应需求 C）
// ─────────────────────────────────────────────────────────────

const subjects = (s: { list: Array<{ subject: string }> }): string[] => s.list.map((t) => t.subject);
const checks = (s: { list: Array<{ subject: string; status: string }> }): string[] =>
  s.list.map((t) => `${t.subject}:${t.status}`);

/** TaskCreate / TaskUpdate 的真实事件序列（tool_result 文本逐字照实机格式） */
function taskEvents(): StreamEvent[] {
  return [
    toolUse('TaskCreate', 'c1', { subject: '跑数据', activeForm: '正在跑数据' }),
    toolResult('c1', 'Task #1 created successfully: 跑数据'),
    toolUse('TaskCreate', 'c2', { subject: '画图', activeForm: '正在画图' }),
    toolResult('c2', 'Task #2 created successfully: 画图'),
    toolUse('TaskCreate', 'c3', { subject: '写论文', activeForm: '正在写论文' }),
    toolResult('c3', 'Task #3 created successfully: 写论文'),
    toolUse('TaskUpdate', 'u1', { taskId: '1', status: 'completed' }),
    toolResult('u1', 'Updated task #1 status'),
    toolUse('TaskUpdate', 'u2', { taskId: '2', status: 'in_progress' }),
    toolResult('u2', 'Updated task #2 status'),
  ];
}

describe('chat-stream —— 任务清单随会话隔离（文本集合 + 勾选集合逐条相等）', () => {
  it('[反向对照] 切走再切回，子任务文本集合与勾选集合逐一相等', () => {
    store.apply('A', { type: 'session-start', sessionId: 'A' }, 1);
    taskEvents().forEach((ev, i) => store.apply('A', ev, 2 + i));

    const before = panelTasks([], toView(store.snapshot('A')));
    expect(subjects(before)).toEqual(['跑数据', '画图', '写论文']);
    expect(checks(before)).toEqual(['跑数据:completed', '画图:in_progress', '写论文:pending']);

    // 切到 B 跑一轮（B 也有自己的任务清单，不能与 A 混）
    store.apply('B', toolUse('TaskCreate', 'bc1', { subject: 'B 的任务' }), 100);
    store.apply('B', toolResult('bc1', 'Task #1 created successfully: B 的任务'), 101);

    const after = panelTasks([], toView(store.snapshot('A')));
    expect(subjects(after)).toEqual(subjects(before));
    expect(checks(after)).toEqual(checks(before));
    expect(subjects(panelTasks([], toView(store.snapshot('B'))))).toEqual(['B 的任务']);
  });

  it('收尾且整批完成后自动收起，不让旧任务永久停留', () => {
    // 历史里已经有 TaskCreate #1（主进程已落库）
    const history: ContentBlock[] = [
      {
        kind: 'tool_use',
        toolName: 'TaskCreate',
        toolUseId: 'c1',
        toolInput: { subject: '跑数据' },
        toolResult: 'Task #1 created successfully: 跑数据',
      },
    ];
    // 存活窗口里是**同一批**（收尾那一两帧会重叠）+ 一条更新的状态
    store.apply('A', toolUse('TaskCreate', 'c1', { subject: '跑数据' }), 1);
    store.apply('A', toolResult('c1', 'Task #1 created successfully: 跑数据'), 2);
    store.apply('A', toolUse('TaskUpdate', 'u1', { taskId: '1', status: 'completed' }), 3);
    store.apply('A', { type: 'session-end', sessionId: 'A' }, 4);

    const merged = panelTasks(history, toView(store.snapshot('A')));
    expect(subjects(merged)).toEqual([]);
  });

  it('存活窗口为空时，历史中的已完成批次也不会重新冒出来', () => {
    const history: ContentBlock[] = [
      {
        kind: 'tool_use',
        toolName: 'TaskCreate',
        toolUseId: 'c1',
        toolInput: { subject: 'A' },
        toolResult: 'Task #1 created successfully: A',
      },
      {
        kind: 'tool_use',
        toolName: 'TaskUpdate',
        toolUseId: 'u1',
        toolInput: { taskId: '1', status: 'completed' },
        toolResult: 'Updated task #1 status',
      },
    ];
    expect(checks(panelTasks(history, toView(store.snapshot('nope'))))).toEqual([]);
    expect(checks(panelTasks(history, null))).toEqual([]);
  });

  it('新一轮一开始旧任务立刻退出，新任务创建后进入当前清单', () => {
    const history: ContentBlock[] = [
      {
        kind: 'tool_use', toolName: 'TaskCreate', toolUseId: 'old-c',
        toolInput: { subject: '旧论文任务' },
        toolResult: 'Task #1 created successfully: 旧论文任务',
      },
    ];
    store.beginTurn('A', 1);
    expect(subjects(panelTasks(history, toView(store.snapshot('A'))))).toEqual([]);

    store.apply('A', toolUse('TaskCreate', 'new-c', { subject: '重新调整摘要' }), 2);
    store.apply('A', toolResult('new-c', 'Task #2 created successfully: 重新调整摘要'), 3);
    expect(subjects(panelTasks(history, toView(store.snapshot('A'))))).toEqual(['重新调整摘要']);
  });
});

// ─────────────────────────────────────────────────────────────
// ⑤ 轮次生命周期：beginTurn / interrupt / hydrate（给 DB 复原留的口）
// ─────────────────────────────────────────────────────────────

describe('chat-stream —— 收尾清错误面板（块照留）', () => {
  it('clearError 只清 error：块与 phase 都不动', () => {
    feed(store, 'A', [
      { type: 'session-start', sessionId: 'A' },
      ...textBlock(0, '跑到一半'),
      { type: 'session-error', message: '网络断了' },
      { type: 'session-end', sessionId: 'A' },
    ]);
    expect(store.snapshot('A').error).toBe('网络断了');

    const cleaned = store.clearError('A', 99);
    expect(cleaned.error).toBeNull();
    expect(cleaned.phase).toBe('done');
    expect(cleaned.blocks).toEqual([{ kind: 'text', text: '跑到一半' }]);
    expect(toView(store.snapshot('A')).error).toBeNull();
  });

  it('本来没有错误时什么都不改（不白写一次 updatedAt）', () => {
    feed(store, 'A', [...textBlock(0, '正常')], 500);
    const before = store.snapshot('A');
    store.clearError('A', 999_999);
    const after = store.snapshot('A');
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.blocks).toEqual(before.blocks);
  });
});

describe('chat-stream —— 轮次生命周期与 hydrate 口子', () => {
  it('beginTurn 清空上一轮，新事件从空窗口重新积累', () => {
    feed(store, 'A', [...textBlock(0, '上一轮')], 1);
    const fresh = store.beginTurn('A', 2);
    expect(fresh.blocks).toEqual([]);
    expect(fresh.phase).toBe('running');
    expect(toView(fresh).active).toBe(true);

    store.apply('A', { type: 'block-start', index: 0, kind: 'text' }, 3);
    store.apply('A', { type: 'text-delta', index: 0, delta: '这一轮' }, 4);
    expect(store.snapshot('A').blocks).toEqual([{ kind: 'text', text: '这一轮' }]);
  });

  it('interrupt（点停止 / 发送失败）置为收尾态但保留已产生的块', () => {
    feed(store, 'A', [...textBlock(0, '跑到一半')], 1);
    const stopped = store.interrupt('A', 2);
    expect(toView(stopped).active).toBe(false);
    expect(stopped.blocks).toEqual([{ kind: 'text', text: '跑到一半' }]);
    // 切走再回来仍是收尾态，不会显示成"正在运行"
    expect(toView(store.snapshot('A')).active).toBe(false);
  });

  it('hydrate（从 DB 灌块）与流式写入共用同一槽位，可继续追加', () => {
    const fromDb: ContentBlock[] = [
      { kind: 'text', text: '库里的一段' },
      { kind: 'tool_use', toolName: 'Bash', toolUseId: 'd1', toolInput: { command: 'pwd' } },
    ];
    const entry = store.hydrate('A', fromDb, { phase: 'done', updatedAt: 10 });
    expect(entry.blocks).toEqual(fromDb);
    expect(toView(store.snapshot('A')).active).toBe(false);

    // 之后又开了一轮：从这一份继续（内部逻辑不假设块一定来自流式）
    store.beginTurn('A', 11);
    feed(store, 'A', [toolUse('Read', 'd2', { file_path: 'x' })], 12);
    expect(store.snapshot('A').blocks.map((b) => b.toolUseId)).toEqual(['d2']);
  });

  it('get/snapshot 对未知会话：get 给 undefined，snapshot 给空窗口（不是新建槽位）', () => {
    expect(store.get('nope')).toBeUndefined();
    expect(store.get(null)).toBeUndefined();
    const empty = store.snapshot('nope');
    expect(empty.blocks).toEqual([]);
    expect(empty.phase).toBe('idle');
    expect(store.size).toBe(0); // 只读不写
    expect(store.snapshot(null).sessionId).toBe('');
    expect(toView(undefined)).toEqual({
      blocks: [],
      active: false,
      sessionId: null,
      phase: 'idle',
      interrupted: false,
      stopping: false,
      usage: null,
      contextUsage: null,
      lastCompaction: null,
      agents: [],
      error: null,
    });
  });

  it('硬停止后忽略旧 runner 的迟到事件，新一轮仍可立即正常开始', () => {
    store.beginTurn('A', 1);
    store.apply('A', { type: 'block-start', index: 0, kind: 'text' }, 2);
    store.apply('A', { type: 'text-delta', index: 0, delta: '停在这里' }, 3);
    const stopped = store.interrupt('A', 4);

    expect(stopped.interrupted).toBe(true);
    store.apply('A', { type: 'session-start', sessionId: 'A' }, 5);
    store.apply('A', { type: 'text-delta', index: 0, delta: '迟到内容' }, 6);
    expect(toView(store.snapshot('A')).active).toBe(false);
    expect(store.snapshot('A').blocks[0]?.text).toBe('停在这里');

    const restarted = store.beginTurn('A', 7);
    expect(restarted.interrupted).toBe(false);
    expect(restarted.phase).toBe('running');
    expect(restarted.blocks).toEqual([]);
  });

  it('点停止后先进入 stopping，内容不消失；历史接管后才清空临时窗口', () => {
    feed(store, 'A', [
      { type: 'session-start', sessionId: 'A' },
      ...textBlock(0, '已经生成的内容'),
    ], 1);

    const stopping = store.requestStop('A', 10);
    expect(stopping.phase).toBe('stopping');
    expect(toView(stopping)).toMatchObject({ active: true, stopping: true });
    expect(stopping.blocks).toEqual([{ kind: 'text', text: '已经生成的内容' }]);

    const ended = store.apply('A', { type: 'session-end', sessionId: 'A' }, 11);
    expect(ended.phase).toBe('done');
    expect(ended.blocks).toEqual([{ kind: 'text', text: '已经生成的内容' }]);

    const reconciled = store.settleFromHistory('A', 12);
    expect(reconciled.blocks).toEqual([]);
    expect(reconciled.phase).toBe('done');
  });

  it('保存 SDK 实测上下文，并记录自动压缩边界', () => {
    const store = new ChatStreamStore();
    store.apply('A', {
      type: 'context-usage',
      usage: {
        used: 181_000,
        total: 200_000,
        percentage: 90.5,
        autoCompactThreshold: 180_000,
        autoCompactEnabled: true,
      },
    }, 10);
    store.apply('A', { type: 'context-compacted', before: 181_000, after: 48_000, trigger: 'auto' }, 11);

    const view = toView(store.snapshot('A'));
    expect(view.contextUsage?.percentage).toBe(90.5);
    expect(view.contextUsage?.autoCompactEnabled).toBe(true);
    expect(view.lastCompaction).toMatchObject({ before: 181_000, after: 48_000, trigger: 'auto' });
  });
});

// ─────────────────────────────────────────────────────────────
// ⑥ 进行中回合快照（`session.get` 的 `inflight`）→ 界面槽位
// ─────────────────────────────────────────────────────────────
//
// 场景：用户在 A 发一轮、跑到一半切到 B、再切回 A。
// 那一轮的 assistant 消息要等跑完才落库，历史里根本没有它 —— 只有主进程
// 的快照（`turn_spills`）能把"过程"还给用户。本节的断言就是这条链路的证据。

/** 主进程写的进行中快照（形状见 shared/types.ts 的 InflightTurn） */
function inflightOf(over: Partial<InflightTurn> = {}): InflightTurn {
  return {
    messageId: 'm-running',
    blocks: [
      { kind: 'thinking', text: '先看题目' },
      { kind: 'text', text: '开始建模' },
      {
        kind: 'tool_use',
        toolName: 'Bash',
        toolUseId: 't1',
        toolInput: { command: 'python solve.py' },
      },
    ],
    updatedAt: 1000,
    ...over,
  };
}

describe('chat-stream —— inflight 快照灌进槽位（切回正在跑的会话能看见过程）', () => {
  it('[反向对照] 带 inflight → 槽位里有那批块，phase = running', () => {
    const snap = inflightOf();
    const adopted = store.adoptInflight('A', snap, []);

    expect(adopted).not.toBeNull();
    // 槽位真的有了那批块（顺序、条数、每块关键字段）
    const kept = store.get('A');
    expect(kept?.blocks).toEqual(snap.blocks);
    expect(kept?.blocks.map((b) => b.kind)).toEqual(['thinking', 'text', 'tool_use']);
    expect(kept?.phase).toBe('running');
    // firstIndex 归零 = 后续事件的 index 与快照同一坐标系（续写的前提）
    expect(kept?.firstIndex).toBe(0);

    // 界面视图：`active` 为真（显示"正在思考/流式中"），且是**本会话**的窗口
    const view = toView(store.snapshot('A'));
    expect(view.active).toBe(true);
    expect(view.blocks).toHaveLength(3);
    expect(view.sessionId).toBe('A');
  });

  it('不带 inflight → 什么也不灌：空会话切进去不会凭空多出块', () => {
    // 与 ChatPage.loadHistory 里那一行同构（省略则整段不执行）
    const res: { messages: Array<{ id: string }>; inflight?: InflightTurn } = { messages: [] };
    const adopted = res.inflight
      ? store.adoptInflight('empty-1', res.inflight, res.messages.map((m) => m.id))
      : null;

    expect(adopted).toBeNull();
    expect(store.get('empty-1')).toBeUndefined(); // 连槽位都没被创建
    expect(store.size).toBe(0);
    const view = toView(store.snapshot('empty-1'));
    expect(view.blocks).toEqual([]);
    expect(view.active).toBe(false);
    expect(view.error).toBeNull();
  });

  it('快照的 messageId 已在历史里 → 整份丢弃（同一过程不画两遍）', () => {
    const snap = inflightOf({ messageId: 'm-done' });
    const history = [{ id: 'm-user' }, { id: 'm-done' }];

    const adopted = store.adoptInflight('A', snap, history.map((m) => m.id));

    expect(adopted).toBeNull();
    expect(store.get('A')).toBeUndefined(); // 一个字节都没写
    expect(toView(store.snapshot('A')).blocks).toEqual([]);
  });

  it('空 blocks 的快照不灌（不会凭空多一个空气泡、也不会假装在跑）', () => {
    const adopted = store.adoptInflight('A', inflightOf({ blocks: [] }), []);
    expect(adopted).toBeNull();
    expect(store.get('A')).toBeUndefined();
    expect(toView(store.snapshot('A')).active).toBe(false);
  });

  it('灌完之后来的流事件是"续写"：块序列 = 快照 + 新增，不是冻结副本', () => {
    store.adoptInflight('A', inflightOf(), []);

    // ① tool-result 落在**快照里那一块**上（不是新开一块）
    const settled = store.receive('A', toolResult('t1', 'exit 0', false), 'A', 2000);
    expect(settled.isCurrent).toBe(true);
    expect(settled.entry.blocks).toHaveLength(3);
    expect(settled.entry.blocks[2].toolResult).toBe('exit 0');
    expect(settled.entry.blocks[2].toolUseId).toBe('t1');

    // ② 追加一个新块 → 快照那 3 块都在，后面多一块
    const grown = store.receive('A', toolUse('Read', 't2', { file_path: 'x.tex' }), 'A', 2001).entry;
    expect(grown.blocks.map((b) => b.kind)).toEqual(['thinking', 'text', 'tool_use', 'tool_use']);
    expect(grown.blocks[0]).toEqual({ kind: 'thinking', text: '先看题目' });
    expect(grown.blocks[1]).toEqual({ kind: 'text', text: '开始建模' });
    expect(grown.blocks[3].toolUseId).toBe('t2');

    // ③ 续写正文：delta 追加在快照的同一块上
    const cont = store.receive('A', { type: 'text-delta', index: 1, delta: '，先估算' }, 'A', 2002)
      .entry;
    expect(cont.blocks[1]).toEqual({ kind: 'text', text: '开始建模，先估算' });
    expect(cont.blocks).toHaveLength(4);
    expect(cont.phase).toBe('running');

    // ④ 槽位里就是最新那份（后续切回来读到的就是它）
    expect(store.get('A')?.blocks).toEqual(cont.blocks);
  });

  it('槽位里在跑的同一轮比快照新时不覆盖（快照有 300ms 节流，覆盖会把回答截掉）', () => {
    // 槽位：本轮刚收到的两块，updatedAt = 5001
    feed(
      store,
      'A',
      [{ type: 'session-start', sessionId: 'A' }, ...textBlock(0, '很新的一段')],
      5000,
    );
    const older = inflightOf({ updatedAt: 1000, blocks: [{ kind: 'text', text: '旧快照' }] });

    expect(store.adoptInflight('A', older, [])).toBeNull();
    expect(store.get('A')?.blocks).toEqual([{ kind: 'text', text: '很新的一段' }]);
    expect(store.get('A')?.phase).toBe('running');

    // 另一面：槽位是空的（刚开始这一轮、还没收到块）→ 该灌就灌，不因"更新"而丢过程
    const fresh = new ChatStreamStore();
    fresh.beginTurn('A', 9999);
    expect(fresh.get('A')?.blocks).toEqual([]);
    const adopted = fresh.adoptInflight('A', inflightOf({ updatedAt: 1000 }), []);
    expect(adopted).not.toBeNull();
    expect(fresh.get('A')?.blocks).toHaveLength(3);
  });
});
