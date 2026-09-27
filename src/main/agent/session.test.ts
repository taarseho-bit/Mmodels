/**
 * `AgentSession.run()` 层面的判据 —— 卡在**缺陷真正发生的那一层**。
 *
 * `session-loop.test.ts` 验的是收尾判定的纯逻辑；本文件验的是 `run()` 真的把它接上了：
 *   · A 组（护栏）：一轮里没有后台任务时，**事件序列与修复前字段一致**
 *     （一个文本块、一次 session-end、运行会结束、result 只被消费一次）。
 *     回归护栏：把 `query({ prompt: input })` 改回字符串 → 本组**必须仍然通过**
 *     —— 它是「默认路径不变」的护栏，不是新功能的判据。
 *   · B 组（新功能）：后台任务在跑时本轮**不结束**、输入队列**不关**；
 *     直到「集合清空之后又来一个 result」才收尾，且唤醒回合的内容**一条不丢**。
 *     回归护栏：把 `shouldConcludeTurn` 改回 `return state.sawResult` → 本组真红。
 *
 * ⚠️ 证伪边界：这里跑的是**假 SDK**（真 SDK 要拉起 285MB 的 CLI 子进程）。
 *    所以本文件证明的是"宿主侧的调度与判定接对了"，**不**证明"CLI 一定会发这些帧"。
 *    后者只能靠运行测试 e2e。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentBlock, ProviderConfig, StreamEvent } from '@shared/types';
import { AgentSession, SessionRegistry } from './session';
import { SessionInputQueue } from './session-loop';
import { applyStreamEvent } from '../ipc/stream-blocks';
import type { WorkflowRun } from '@shared/workflow';

const h = vi.hoisted(() => ({
  /** 每个用例装一个假的 `query()` 实现 */
  queryImpl: null as null | ((args: { prompt: unknown; options: Record<string, unknown> }) => unknown),
}));

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/mmodels-test', isPackaged: false },
}));

// 这两个模块会把 electron 拖进来，且与本用例无关
vi.mock('./skills-plugin', () => ({
  materializeSkillsPlugin: () => '/tmp/skills-plugin',
  warmupSkillsPlugin: async () => '/tmp/skills-plugin',
}));
vi.mock('../store/config', () => ({ getSettings: () => ({}), getRuntimeMcpServers: () => [] }));
vi.mock('../ipc/project', () => ({ findProjectByRoot: () => null }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { prompt: unknown; options: Record<string, unknown> }) => h.queryImpl!(args),
}));

// ─────────────────────────────────────────────────────────────
// 假 SDK
// ─────────────────────────────────────────────────────────────

interface FakeSdk {
  /** 每一次取帧时"stdin 是否已经关了" */ 
  queueClosedBeforeFrame: boolean[];
  /** 被交给 query() 的 prompt（用来钉「是 AsyncIterable 不是 string」） */
  prompt: unknown;
  /** prompt 是常驻队列时的那一个实例 */
  queue: SessionInputQueue | null;
  /** query() 被调了几次 —— 一次运行必须只有一次 */
  calls: number;
  options: Record<string, unknown> | null;
  appliedSettings: Array<Record<string, unknown>>;
  closed: boolean;
}

/**
 * 装一个假 `query()`。
 *
 * 假流**刻意模拟真实 CLI 的生命周期**（这是本文件能不能算证据的关键）：
 *   · stdin 还开着 → 脚本吐完之后挂在那儿等（真实 CLI 就是这样等下一轮输入）；
 *   · stdin 一关（SDK 的 `streamInput()` 走到 `transport.endInput()`）→ 立刻收尾、stdout 结束，
 *     **不会再有下一帧**；
 *   · `prompt` 是字符串时按 SDK 的 `isSingleUserTurn` 语义，**首个 `result` 之后就等于关了 stdin**
 *     —— 这正好把修复前的缺陷原样复现出来，让 B 组的回归护栏有意义。
 */
function installFakeQuery(script: unknown[]): FakeSdk {
  const sdk: FakeSdk = {
    queueClosedBeforeFrame: [],
    prompt: undefined,
    queue: null,
    calls: 0,
    options: null,
    appliedSettings: [],
    closed: false,
  };

  const isQueue = (p: unknown): p is SessionInputQueue =>
    typeof p === 'object' && p !== null && typeof (p as SessionInputQueue).isClosed === 'boolean';

  const waitUntilClosed = async (p: unknown): Promise<void> => {
    if (!isQueue(p)) return;
    const deadline = Date.now() + 2000;
    while (!p.isClosed && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2));
    }
  };

  h.queryImpl = (args) => {
    sdk.calls += 1;
    sdk.options = args.options;
    sdk.prompt = args.prompt;
    sdk.queue = isQueue(args.prompt) ? args.prompt : null;
    const stringMode = !isQueue(args.prompt);
    /** 字符串（单轮）模式下，SDK 在首个 result 之后就 endInput 了 */
    let stringModeStdinClosed = false;
    let i = 0;

    /** stdin 已经关了？关了就不该再有帧 —— 真实 CLI 此刻已经退出 */
    const stdinClosed = (): boolean => sdk.closed || (stringMode ? stringModeStdinClosed : isQueue(args.prompt) && args.prompt.isClosed);

    return {
      getContextUsage: async () => ({
        categories: [], totalTokens: 91_000, maxTokens: 200_000, rawMaxTokens: 200_000,
        percentage: 45.5, gridRows: [], model: 'test-model', memoryFiles: [], mcpTools: [],
        agents: [], autoCompactThreshold: 180_000, isAutoCompactEnabled: true, apiUsage: null,
      }),
      applyFlagSettings: async (settings: Record<string, unknown>) => {
        sdk.appliedSettings.push(settings);
      },
      close: () => {
        sdk.closed = true;
      },
      [Symbol.asyncIterator](): AsyncIterator<unknown> {
        return {
          next: async (): Promise<IteratorResult<unknown>> => {
            if (stdinClosed()) {
              sdk.queueClosedBeforeFrame.push(true);
              return { done: true, value: undefined };
            }
            if (i >= script.length) {
              // 脚本吐完、stdin 还开着 → 挂在等（真实 CLI 一直在等下一轮输入）
              await waitUntilClosed(args.prompt);
              sdk.queueClosedBeforeFrame.push(true);
              return { done: true, value: undefined };
            }
            sdk.queueClosedBeforeFrame.push(false);
            const value = script[i];
            i += 1;
            if (stringMode && (value as { type?: string })?.type === 'result') {
              stringModeStdinClosed = true;
            }
            return { done: false, value };
          },
        };
      },
    };
  };

  return sdk;
}

// ─────────────────────────────────────────────────────────────
// 帧样式（字段名按字段对齐 sdk.d.ts）
// ─────────────────────────────────────────────────────────────

const assistant = (text: string) => ({
  type: 'assistant',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 3, output_tokens: 2 },
  },
  session_id: 'sdk-1',
});
const result = () => ({
  type: 'result',
  subtype: 'success',
  usage: { input_tokens: 1, output_tokens: 1 },
  session_id: 'sdk-1',
});
const bgChanged = (ids: string[]) => ({
  type: 'system',
  subtype: 'background_tasks_changed',
  tasks: ids.map((id) => ({ task_id: id, task_type: 'bash', description: id })),
  uuid: 'u',
  session_id: 'sdk-1',
});
const taskNotification = (id: string) => ({
  type: 'system',
  subtype: 'task_notification',
  task_id: id,
  status: 'completed',
  output_file: '/tmp/o',
  summary: 'done',
  uuid: 'u',
  session_id: 'sdk-1',
});

const subagentStarted = (id: string, agentType: string) => ({
  type: 'system', subtype: 'task_started', task_id: id, subagent_type: agentType,
  description: '正在独立核对约束', uuid: 'u', session_id: 'sdk-1',
});
const subagentProgress = (id: string, agentType: string) => ({
  type: 'system', subtype: 'task_progress', task_id: id, subagent_type: agentType,
  description: '正在独立核对约束', summary: '已经复算目标函数', last_tool_name: 'Bash',
  usage: { total_tokens: 120, tool_uses: 2, duration_ms: 3000 }, uuid: 'u', session_id: 'sdk-1',
});

const PROVIDER: ProviderConfig = {
  id: 'p1',
  name: '测试供应商',
  apiFormat: 'anthropic',
  baseUrl: 'https://example.invalid',
  apiKey: 'k',
  enabled: true,
};

describe('应用约定核心选项对齐', () => {
  it('保留基础系统提示，追加中文约定和工作区说明，额外插件不丢失', async () => {
    const sdk = installFakeQuery([assistant('完成'), result()]);
    const { done } = runOnce('任务', { systemPrompt: '中文交流', workspaceInstructions: '应用约定', extraPluginPaths: ['/tmp/project-plugin'], effort: 'max' });
    await done;
    expect(sdk.options?.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: '应用约定\n\n中文交流' });
    expect(sdk.options?.plugins).toEqual([{ type: 'local', path: '/tmp/skills-plugin' }, { type: 'local', path: '/tmp/project-plugin' }]);
    expect(sdk.options?.thinking).toEqual({ type: 'enabled', display: 'summarized' });
    expect(sdk.options?.effort).toBe('max');
  });
  it('启动检查发现必需技能缺失时，不发送用户任务并关闭SDK', async () => {
    let closed = false;
    let prompt: SessionInputQueue | undefined;
    h.queryImpl = args => {
      prompt = args.prompt as SessionInputQueue;
      return { supportedCommands: async () => [], close: () => { closed = true; } };
    };
    const { events, done } = runOnce('/write-paper 写论文');
    await done;
    expect(closed).toBe(true);
    expect(prompt?.isClosed).toBe(true);
    expect(events.some(e => e.type === 'session-error' && e.message.includes('没有把任务降级'))).toBe(true);
  });
});

function runOnce(promptText: string, extra: Partial<Parameters<AgentSession['run']>[0]> = {}) {
  const session = new AgentSession('s1');
  const events: StreamEvent[] = [];
  session.on('event', (ev: StreamEvent) => events.push(ev));
  const done = session.run({
    sessionId: 's1',
    prompt: promptText,
    provider: PROVIDER,
    model: 'test-model',
    cwd: '/tmp',
    // 传死路径 ⇒ 跳过技能插件物化（那是文件系统副作用，与本用例无关）
    skillsPluginPath: '/tmp/skills-plugin',
    ...extra,
  });
  return { session, events, done };
}

/** 把事件流折成"一次运行落库的那条 assistant 消息"的块 */
function collectBlocks(events: StreamEvent[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const ev of events) applyStreamEvent(blocks, ev);
  return blocks.filter(Boolean);
}

const textDeltas = (events: StreamEvent[]): string[] =>
  events
    .filter((e): e is Extract<StreamEvent, { type: 'text-delta' }> => e.type === 'text-delta')
    .map((e) => e.delta);

beforeEach(() => {
  h.queryImpl = null;
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────
// A 组护栏：默认路径不变（没有后台任务）
// ─────────────────────────────────────────────────────────────

describe('A 组护栏 —— 没有后台任务的一轮，行为与修复前一致', () => {
  it('一次运行 → 恰好一条 assistant 内容 → 运行结束；事件序列固定', async () => {
    const sdk = installFakeQuery([assistant('你好'), result()]);
    const { events, done } = runOnce('打个招呼');

    await expect(done).resolves.toBeUndefined();

    // 事件序列：正文事件不变；assistant/result 后各刷新一次 SDK 的真实上下文占用。
    expect(events.map((e) => e.type)).toEqual([
      'session-start',
      'usage',
      'block-start',
      'text-delta',
      'context-usage',
      'usage',
      'context-usage',
      'session-end',
    ]);
    expect(events[0]).toEqual({ type: 'session-start', sessionId: 's1' });
    expect(events.at(-1)).toEqual({ type: 'session-end', sessionId: 's1' });

    // 恰好一条 assistant 内容，且**没有被重复发送**
    expect(textDeltas(events)).toEqual(['你好']);

    // 落库视角：一次运行只对应一条 assistant 消息（一个文本块）
    const blocks = collectBlocks(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'text', text: '你好' });

    // 一次运行只开一次 query，且只发一次 session-end
    expect(sdk.calls).toBe(1);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'session-error')).toHaveLength(0);
  });

  it('session-start / session-end 各一次，不产生多余副作用', async () => {
    installFakeQuery([assistant('a'), result()]);
    const { events, done } = runOnce('x');
    await done;
    expect(events.filter((e) => e.type === 'session-start')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
  });
});

describe('快速模式 —— 只通过 SDK settings 层注入', () => {
  it('开启时传 fastMode 与会话内 opt-in', async () => {
    const sdk = installFakeQuery([assistant('ok'), result()]);
    const { done } = runOnce('x', { fastMode: true });
    await done;
    expect(sdk.options?.settings).toEqual({
      autoCompactEnabled: true,
      precomputeCompactionEnabled: true,
      fastMode: true,
      fastModePerSessionOptIn: true,
    });
  });

  it('未开启快速模式时只注入自动压缩设置', async () => {
    const sdk = installFakeQuery([assistant('ok'), result()]);
    const { done } = runOnce('x');
    await done;
    expect(sdk.options?.settings).toEqual({
      autoCompactEnabled: true,
      precomputeCompactionEnabled: true,
    });
  });
});

describe('工作流观察接线', () => {
  it('异常结果不显示成本轮正常完成', async () => {
    installFakeQuery([{ ...result(), subtype: 'error_max_turns' }]);
    const snapshots: WorkflowRun[] = [];
    await runOnce('验证', { onWorkflow: r => snapshots.push(r) }).done;
    expect(snapshots.at(-1)?.status).toBe('interrupted');
  });
  it('只把明确的停止/错误原因映射为非正常结束', async () => {
    const snapshots: WorkflowRun[] = [];
    installFakeQuery([{ ...result(), reason: 'provider-finished' }]);
    await runOnce('供应商正常收尾', { onWorkflow: r => snapshots.push(r) }).done;
    expect(snapshots.at(-1)?.status).toBe('completed');
  });
  it('真实 run 选项挂观察钩子，完成后发布快照但不混入对话正文', async () => {
    const sdk = installFakeQuery([assistant('完成'), result()]);
    const snapshots: WorkflowRun[] = [];
    const { done, events } = runOnce('验证', { multiAgentEnabled: true, onWorkflow: r => snapshots.push(r) });
    await done;
    expect(Object.keys(sdk.options?.hooks ?? {})).toEqual(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'UserPromptExpansion']);
    expect(sdk.options?.forwardSubagentText).toBe(false);
    expect(snapshots.at(-1)?.status).toBe('completed');
    expect(textDeltas(events)).toEqual(['完成']);
  });
  it('停止同步发布停止状态，无需等待 SDK 完全收尾', async () => {
    installFakeQuery([]);
    const snapshots: WorkflowRun[] = [];
    const { session, done } = runOnce('验证停止', { onWorkflow: r => snapshots.push(r) });
    session.abort();
    expect(snapshots.at(-1)?.status).toBe('stopped');
    await done;
    expect(snapshots.at(-1)?.status).toBe('stopped');
  });
});

describe('数学建模多智能体 —— SDK 原生 agents 与真实进度事件', () => {
  it('开启后注册七个专门角色并转发开始、进度、完成状态', async () => {
    const sdk = installFakeQuery([
      subagentStarted('agent-1', 'model-solver'),
      subagentProgress('agent-1', 'model-solver'),
      taskNotification('agent-1'),
      assistant('已经汇总'),
      result(),
    ]);
    const { events, done } = runOnce('复杂建模任务', { multiAgentEnabled: true });
    await done;

    expect(Object.keys(sdk.options?.agents as Record<string, unknown>)).toEqual([
      'problem-analyst', 'data-analyst', 'model-solver', 'literature-researcher', 'paper-writer', 'figure-maker', 'paper-reviewer',
    ]);
    expect(sdk.options?.agentProgressSummaries).toBe(true);
    expect(sdk.options?.forwardSubagentText).toBe(false);
    expect(events).toContainEqual({
      type: 'agent-start',
      activity: expect.objectContaining({ taskId: 'agent-1', agentType: 'model-solver', status: 'running' }),
    });
    expect(events).toContainEqual({
      type: 'agent-progress',
      activity: expect.objectContaining({ summary: '已经复算目标函数', totalTokens: 120, toolUses: 2 }),
    });
    expect(events).toContainEqual({
      type: 'agent-end',
      activity: expect.objectContaining({ taskId: 'agent-1', status: 'completed' }),
    });
  });

  it('关闭时不向 SDK 注册协作组', async () => {
    const sdk = installFakeQuery([assistant('ok'), result()]);
    const { done } = runOnce('简单问题', { multiAgentEnabled: false });
    await done;
    expect(sdk.options?.agents).toBeUndefined();
    expect(sdk.options?.agentProgressSummaries).toBeUndefined();
  });
});

describe('上下文窗口 —— 真实占用与 90% 自动压缩', () => {
  it.each([1_000_000, 300_000, 200_000, 128_000])('配置 %i 容量会传递 90%% 阈值并在用量中显示', async (capacity) => {
    const sdk = installFakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sdk-capacity', model: 'test-model' },
      assistant('ok'), result(),
    ]);
    const { events, done } = runOnce('x', { provider: { ...PROVIDER, contextWindows: { 'test-model': capacity } } });
    await done;
    await Promise.resolve();
    expect(sdk.options?.settings).toMatchObject({ autoCompactWindow: Math.floor(capacity * .9) });
    expect(sdk.appliedSettings).toContainEqual(expect.objectContaining({ autoCompactWindow: Math.floor(capacity * .9) }));
    expect(events).toContainEqual({ type: 'context-usage', usage: expect.objectContaining({ total: capacity, capacitySource: 'configured' }) });
  });
  it('初始化后按原始窗口的 90% 配置，并推送真实占用', async () => {
    const sdk = installFakeQuery([
      { type: 'system', subtype: 'init', session_id: 'sdk-1', model: 'test-model' },
      assistant('ok'),
      result(),
    ]);
    const { events, done } = runOnce('x');
    await done;
    await Promise.resolve();

    expect(sdk.appliedSettings).toContainEqual({
      autoCompactEnabled: true,
      precomputeCompactionEnabled: true,
      autoCompactWindow: 180_000,
    });
    expect(events).toContainEqual({
      type: 'context-usage',
      usage: expect.objectContaining({ used: 91_000, total: 200_000, percentage: 45.5 }),
    });
  });

  it('兼容端点一直返回同一个窗口值时，第二轮仍按真实 usage 推进', async () => {
    installFakeQuery([assistant('ok'), result()]);
    const session = new AgentSession('s-fixed-context');
    const events: StreamEvent[] = [];
    session.on('event', (event: StreamEvent) => events.push(event));
    const options = {
      sessionId: 's-fixed-context',
      prompt: '第一轮',
      provider: PROVIDER,
      model: 'test-model',
      cwd: '/tmp',
      skillsPluginPath: '/tmp/skills-plugin',
    };

    await session.run(options);
    const first = events
      .filter((event): event is Extract<StreamEvent, { type: 'context-usage' }> => event.type === 'context-usage')
      .at(-1)?.usage.used;

    await session.run({ ...options, prompt: '第二轮' });
    const second = events
      .filter((event): event is Extract<StreamEvent, { type: 'context-usage' }> => event.type === 'context-usage')
      .at(-1)?.usage.used;

    expect(first).toBe(91_000);
    expect(second).toBeGreaterThan(first ?? 0);
  });
});

// ─────────────────────────────────────────────────────────────
// 传输层：prompt 必须是 AsyncIterable（多轮模式）
// ─────────────────────────────────────────────────────────────

describe('传输层 —— prompt 形态决定 SDK 会不会在首个 result 后自杀', () => {
  /**
   * ⚠️ 这一条**不属于 A 组护栏**：它是"新机制接上了"的判据。
   * 把 `query({ prompt: input })` 改回 `prompt: opts.prompt`，这条真红
   * （而 A 组必须仍然是绿的 —— 否则说明 A 组绑上了实现细节）。
   */
  it('交给 query() 的 prompt 是可迭代的会话队列，不是字符串', async () => {
    const sdk = installFakeQuery([assistant('ok'), result()]);
    const { done } = runOnce('随便');
    await done;
    expect(typeof sdk.prompt).not.toBe('string');
    expect(typeof (sdk.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]).toBe('function');
    expect(sdk.queue).toBeInstanceOf(SessionInputQueue);
  });
});

describe('立即停止后同一会话可重新运行', () => {
  it('replace 切断旧 runner，新 runner 不等待旧轮收尾即可启动', async () => {
    const waiting = installFakeQuery([bgChanged(['old-bg']), assistant('旧任务仍在等'), result()]);
    const registry = new SessionRegistry();
    const oldRunner = registry.get('restartable');
    const oldDone = oldRunner.run({
      sessionId: 'restartable',
      prompt: '旧任务',
      provider: PROVIDER,
      model: 'test-model',
      cwd: '/tmp',
      skillsPluginPath: '/tmp/skills-plugin',
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(oldRunner.isRunning).toBe(true);
    expect(waiting.queue?.isClosed).toBe(false);

    const nextRunner = registry.replace('restartable');
    expect(nextRunner).not.toBe(oldRunner);
    expect(registry.get('restartable')).toBe(nextRunner);

    installFakeQuery([assistant('新任务已开始'), result()]);
    const nextDone = nextRunner.run({
      sessionId: 'restartable',
      prompt: '新任务',
      provider: PROVIDER,
      model: 'test-model',
      cwd: '/tmp',
      skillsPluginPath: '/tmp/skills-plugin',
    });

    await expect(nextDone).resolves.toBeUndefined();
    await expect(oldDone).resolves.toBeUndefined();
    expect(nextRunner.isRunning).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// B 组：后台任务未清空 ⇒ 本轮不结束
// ─────────────────────────────────────────────────────────────

describe('B 组 —— 后台任务在跑时，本轮不结束（这正是唤醒能发生的前提）', () => {
  /** 运行测试时序：result#1（后台任务还在跑）→ 集合清空 → 通知 → 唤醒回合 → result#2 */
  const WAKEUP_SCRIPT = [
    bgChanged(['bg1']),
    assistant('我先交还，等它跑完再接着做'),
    result(), // ← 修复前 / 改回收尾条件后，就在这一帧结束，CLI 被关掉
    bgChanged([]),
    taskNotification('bg1'),
    assistant('它跑完了，我接着做'),
    result(),
  ];

  it('整轮跑完：唤醒回合的内容一条不丢，且运行最终会结束', async () => {
    const sdk = installFakeQuery(WAKEUP_SCRIPT);
    const { events, done } = runOnce('跑个长任务');

    await expect(done).resolves.toBeUndefined();

    // ⚠️ 回归护栏锚点：改回「收到 result 就结束」后，这里只剩第 1 条，本断言真红
    expect(textDeltas(events)).toEqual(['我先交还，等它跑完再接着做', '它跑完了，我接着做']);
    expect(events.filter((e) => e.type === 'session-end')).toHaveLength(1);
    expect(sdk.calls).toBe(1);
  });

  it('从「后台任务还在跑」到「唤醒回合」之间，输入队列始终没有关闭', async () => {
    const sdk = installFakeQuery(WAKEUP_SCRIPT);
    const { done } = runOnce('跑个长任务');
    await done;

    // 交付每一帧之前队列都必须是开的 ——
    // 队列一关，SDK 就会 endInput，CLI 随即退出，唤醒永远不来。
    const beforeFrames = sdk.queueClosedBeforeFrame.slice(0, WAKEUP_SCRIPT.length);
    expect(beforeFrames).toHaveLength(WAKEUP_SCRIPT.length);
    expect(beforeFrames.every((closed) => closed === false)).toBe(true);
    // 收尾发生在最后一帧之后：此刻队列才被关掉（排在交付第 7 帧之后的那一次取帧）
    expect(sdk.queueClosedBeforeFrame.slice(WAKEUP_SCRIPT.length)).toEqual([true]);
  });

  it('C 条方案：续跑内容**追加到同一条消息**，但落在独立的文本块上（不黏连、不重复）', async () => {
    installFakeQuery(WAKEUP_SCRIPT);
    const { events, done } = runOnce('跑个长任务');
    await done;

    const blocks = collectBlocks(events);
    // 一次运行 → 一条 assistant 消息 → 两个文本块（回合边界处 `result` 归零了游标）
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'text']);
    expect(blocks[0].text).toBe('我先交还，等它跑完再接着做');
    expect(blocks[1].text).toBe('它跑完了，我接着做');
    // 不重复、不丢失
    const joined = blocks.map((b) => b.text ?? '').join('|');
    expect(joined.match(/我先交还/g)).toHaveLength(1);
    expect(joined.match(/它跑完了/g)).toHaveLength(1);
  });

  it('abort 时输入队列被关闭、运行干净退出（不挂死）', async () => {
    const sdk = installFakeQuery([bgChanged(['bg1']), assistant('等着'), result()]);
    const { session, events, done } = runOnce('长任务');

    // 等循环进到"等唤醒"那一步（脚本吐完 → 假 CLI 挂在等 stdin 关闭）
    await new Promise((r) => setTimeout(r, 30));
    expect(sdk.queue?.isClosed).toBe(false);

    session.abort();
    await expect(done).resolves.toBeUndefined();

    expect(sdk.queue?.isClosed).toBe(true);
    expect(sdk.closed).toBe(true);
    expect(events.some((e) => e.type === 'session-end')).toBe(true);
  });
});
