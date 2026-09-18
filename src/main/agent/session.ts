/**
 * Agent 会话运行器 —— 整个应用的心脏。
 *
 * 职责：把「一条用户消息」变成「一串流式事件」，并在中途管理进程生命周期。
 *
 * 设计要点（对照原版行为）：
 *  1. 每个会话一个长驻 `query()` 迭代器，而不是每条消息重启进程
 *     —— 这样 Claude Code 才能保留上下文、复用 warm 状态
 *  2. 事件先落进内存队列再广播，避免渲染层还没挂载监听就丢事件
 *  3. abort 必须走 SDK 的 abortController，不能杀进程（否则会话无法续传）
 *  4. 出错时发 `session-error` 而不是 reject，让界面能显示可读信息
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type {
  ApprovalDecision,
  ApprovalRequest,
  AskUserQuestion,
  AskUserRequest,
  ContentBlock,
  ProviderConfig,
  SessionMeta,
  StreamEvent,
  TokenUsage,
} from '@shared/types';
import { buildChildEnv, buildProviderEnv, resolveClaudeExecutable } from './env';
import {
  approvalDetailOf,
  approvalKindOf,
  canonicalPermissionMode,
  gateStepFor,
  sdkPermissionModeFor,
  type AppPermissionMode,
  type CanonicalPermissionMode,
  type InteractionMode,
} from './permissions';
import { materializeSkillsPlugin, warmupSkillsPlugin } from './skills-plugin';
import {
  BACKGROUND_WAIT_CAP_MS,
  SessionInputQueue,
  runSessionLoop,
  type SessionLoopOutcome,
} from './session-loop';

/** SDK 是按需加载的 —— 加载失败要给用户可读信息，而不是崩溃 */
type QueryFn = typeof import('@anthropic-ai/claude-agent-sdk')['query'];
type QueryHandle = ReturnType<QueryFn>;

/**
 * 推理强度取值域**不手写**，直接从 SDK 的 options 类型里取
 * （`sdk.d.ts:553` 的 `EffortLevel`；SDK 里它写作 `(...) | number`，
 * 这里用 `Extract<…, string>` 只留具名档位）。
 *
 * 只做类型推导、不引入运行时依赖 —— 编译后抹掉，不影响上面「SDK 按需加载」的设计。
 */
type SdkOptions = NonNullable<Parameters<QueryFn>[0]['options']>;
type EffortLevel = Extract<NonNullable<SdkOptions['effort']>, string>;

let queryFn: QueryFn | null = null;
let sdkLoadError: string | null = null;

async function loadSdk(): Promise<QueryFn> {
  if (queryFn) return queryFn;
  if (sdkLoadError) throw new Error(sdkLoadError);
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = mod.query;
    return queryFn;
  } catch (err) {
    sdkLoadError =
      `无法加载 Claude Agent SDK：${err instanceof Error ? err.message : String(err)}。` +
      `请确认依赖已完整安装（npm install）。`;
    throw new Error(sdkLoadError);
  }
}

export interface RunOptions {
  sessionId: string;
  prompt: string;
  provider: ProviderConfig;
  model: string;
  /** 项目工作目录 —— agent 的 cwd，所有产物落在这里 */
  cwd: string;
  /** 已物化的技能插件目录（省略时自动物化 `<userData>/skills-plugin`） */
  skillsPluginPath?: string;
  /** 系统提示词 */
  systemPrompt?: string;
  /** 工作区指令（写进 AGENTS.md 的内容） */
  workspaceInstructions?: string;
  /** 是否启用内置 MCP 工具 */
  builtinMcpEnabled?: boolean;
  /**
   * 推理强度。
   *
   * ⚠️ 取值域**直接取自 SDK 的 `EffortLevel`**（`sdk.d.ts:553`：
   * `'low' | 'medium' | 'high' | 'xhigh' | 'max'`），不再手写联合类型 ——
   * 手写的后果是「设置里多两档、这里少两档」，tsc 会在渲染层拦下，
   * 但主进程会**静默忽略**掉它不认识的值（选了等于没选）。
   *
   * 原版是 5 档、默认 `high`；`xhigh`/`max` 是「更深/最大」，SDK 会在
   * 不支持该档的模型上**自动回落**（`sdk.d.ts:550-551`：`'xhigh'` 在
   * Fable 5 / Opus 4.7+ / Sonnet 5 之外回落 `'high'`，`'max'` 仅部分模型支持）。
   */
  effort?: EffortLevel | null;
  /**
   * 关闭思考。
   * ⚠️ DeepSeek V4 系列默认 effort=high，会烧光输出预算导致正文为空。
   */
  disableThinking?: boolean;
  /** 对支持该能力的模型启用 Claude Agent SDK 快速模式 */
  fastMode?: boolean;
  /** 续传的 SDK 会话 id */
  resumeSessionId?: string;
  /** 协议桥地址（OpenAI 协议供应商需要） */
  bridgeBaseUrl?: string;
  debug?: boolean;
  /**
   * 用户在设置/输入区选的权限模式（复刻口径 `'full' | 'approval'`）。
   *
   * ⚠️ 这里**原样传复刻口径**，不要在这里换名字 ——
   *    换算成原版口径的那一步**只在 `permissions.ts` 里做一次**
   *    （见该文件头"口径映射"）。少写一处映射，就少一个"两处各写一半"的坑。
   */
  permissionMode?: AppPermissionMode;
  /**
   * 每条消息的交互模式（`'default' | 'plan'`）。
   *
   * B2（plan 模式）落地前**没有任何调用方会传它**，默认 `undefined` ⇒ 走权限分支。
   * 之所以现在就留出这个字段：原版 `jh()` 的三元里 **plan 必须先判**
   * （`plan + 完全访问` 要得 `'plan'` 而不是 `'bypassPermissions'`），
   * 这个**顺序**是极易写错的，留出字段 + 单测钉住顺序，B2 只需要往里传值。
   */
  interactionMode?: InteractionMode;
}

/**
 * SDK 传给 `canUseTool` 的第三个参数里我们**真正用到**的两个字段。
 *
 * 完整形状见 `sdk.d.ts:206-266`（`CanUseTool`）。这里只声明用到的两个，
 * 其余（`title` / `displayName` / `description` / `requestId` / `toolUseID` …）
 * 暂时不用：审批框的直接文案走渲染层 i18n（原版词典里已有
 * `composer.composerPendingApprovalPanel.*` 整套），不消费 CLI 渲染的句子。
 *
 * ⚠️ 用可选字段而不是 required：这个参数是 SDK 给的，**我们不能假定它一定给全**
 *    （`signal` 缺失时审批仍然要能走通，只是少一条"被 SDK 取消"的松开路径）。
 */
interface CanUseToolContext {
  /** SDK 的取消信号；被 abort 时把挂着的审批按 `'cancel'` 松开 */
  signal?: AbortSignal;
  /**
   * SDK 给的权限建议。用户选「本次会话始终允许」时原样回传为 `updatedPermissions`，
   * CLI 侧据此不再问（`sdk.d.ts:209-217`）。
   */
  suggestions?: unknown;
}

/**
 * 把 AskUserQuestion 工具的原始 input 规整成渲染层能直接吃的形状。
 *
 * 模型偶尔会给出畸形字段（缺 options、options 不是数组等），
 * 这里一律丢弃畸形项而不是抛错 —— 抛错会让整个回合失败。
 */
function normalizeQuestions(input: Record<string, unknown>): AskUserQuestion[] {
  const raw = Array.isArray(input.questions) ? input.questions : [];
  const out: AskUserQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const q = item as Record<string, unknown>;
    if (typeof q.question !== 'string' || !q.question.trim()) continue;
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((opt) => {
        if (!opt || typeof opt !== 'object') return null;
        const o = opt as Record<string, unknown>;
        if (typeof o.label !== 'string' || !o.label.trim()) return null;
        return {
          label: o.label,
          ...(typeof o.description === 'string' ? { description: o.description } : {}),
          ...(typeof o.preview === 'string' ? { preview: o.preview } : {}),
        };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null);
    if (options.length === 0) continue;
    out.push({
      question: q.question,
      ...(typeof q.header === 'string' ? { header: q.header } : {}),
      options,
      ...(q.multiSelect === true ? { multiSelect: true } : {}),
    });
    if (out.length >= 4) break;
  }
  return out;
}

/** 会话运行器：一个会话一个实例 */
export class AgentSession extends EventEmitter {
  private abortController: AbortController | null = null;
  private running = false;
  /** 累积的用量统计 */
  private usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  /** 当前正在接收的 content block */
  private blocks: ContentBlock[] = [];
  private streamIndex = -1;
  /** 控制请求不能并发堆积；一次真实上下文探测没回来前忽略重复触发。 */
  private contextProbeBusy = false;
  /**
   * 正在等待用户作答的提问：requestId → resolve。
   *
   * ⚠️ 这里的 promise **必须保持 pending**，直到用户真的作答或取消 ——
   * 不能超时后自己编一个答案塞回去，否则 agent 会拿着假前提继续跑。
   */
  private pendingQuestions = new Map<string, (answers: Record<string, string> | null) => void>();

  /**
   * 正在等待用户审批的工具调用：requestId → resolve。
   *
   * 对应原版 `pendingApprovals` @760956（`Map<requestId, {sessionId, resolve}>`）。
   * 与 `pendingQuestions` 同理：**必须保持 pending 直到用户真的决定**。
   * 松开它的三条路径：用户作答、abort、SDK 的 `signal` 被 abort。
   */
  private pendingApprovals = new Map<string, (decision: ApprovalDecision) => void>();

  /**
   * 本次会话内用户点过「始终允许」的工具名。
   *
   * 对应原版 `sessionAllowedTools`（逐 sessionId 分组；复刻一个会话一个
   * `AgentSession` 实例，所以这里一个 `Set` 就够，不必再按 sessionId 分）。
   * **不落库**：原版也是内存态，重启应用后重新问 —— 这一点照抄。
   */
  private sessionAllowedTools = new Set<string>();

  /**
   * 本次 run 生效的**原版口径**权限值 —— 在 `run()` 里算好。
   *
   * ⚠️ 它**不是**交给 SDK 的那个值（那个是 `sdkPermissionModeFor()` 的结果）。
   *    原版也是如此：`buildCanUseTool` 门内比的是 app 级值（`'full-access'`），
   *    SDK 拿到的是 `jh()` 的产物。见 `permissions.ts` 文件头"二"。
   */
  private canonicalPermissionMode: CanonicalPermissionMode = 'full-access';

  constructor(public readonly sessionId: string) {
    super();
    // 事件监听器过多时不要报警（我们会挂多个订阅者）
    this.setMaxListeners(50);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get totalUsage(): TokenUsage {
    return { ...this.usage };
  }

  private emitEvent(ev: StreamEvent): void {
    this.emit('event', ev);
  }

  private async emitContextUsage(query: QueryHandle): Promise<void> {
    if (this.contextProbeBusy) return;
    this.contextProbeBusy = true;
    try {
      const usage = await query.getContextUsage();
      const total = Math.max(1, Number(usage.rawMaxTokens || usage.maxTokens || 0));
      const used = Math.max(0, Number(usage.totalTokens || 0));
      this.emitEvent({
        type: 'context-usage',
        usage: {
          used,
          total,
          percentage: Math.min(100, Math.max(0, (used / total) * 100)),
          autoCompactThreshold: usage.autoCompactThreshold,
          autoCompactEnabled: usage.isAutoCompactEnabled,
          model: usage.model,
        },
      });
    } catch (err) {
      // 这是辅助状态，不得让聊天因为统计不可用而失败。
      console.debug('[agent] 暂时无法读取上下文用量：', err instanceof Error ? err.message : err);
    } finally {
      this.contextProbeBusy = false;
    }
  }

  /** SDK 初始化后把自动压缩窗口设到模型原始窗口的 90%。 */
  private async configureContextWindow(query: QueryHandle): Promise<void> {
    try {
      const initial = await query.getContextUsage();
      const rawMax = Number(initial.rawMaxTokens || initial.maxTokens || 0);
      const target = Math.floor(rawMax * 0.9);
      await query.applyFlagSettings({
        autoCompactEnabled: true,
        precomputeCompactionEnabled: true,
        ...(target >= 100_000 && target <= 1_000_000 ? { autoCompactWindow: target } : {}),
      });
    } catch (err) {
      console.debug('[agent] 自动压缩沿用 SDK 默认阈值：', err instanceof Error ? err.message : err);
    }
    await this.emitContextUsage(query);
  }

  /** 中断当前运行。不杀进程，只是通知 SDK 停 */
  abort(): void {
    // 先把挂着的提问放掉，否则 canUseTool 的 promise 永远不 resolve，
    // SDK 侧那一次 tool 调用会卡到进程退出。
    this.settleAllQuestions(null);
    // 审批同理：挂着的审批不松开，整个回合就卡死在等用户点按钮上。
    // 松开时给 `'cancel'`（原版语义：中断本轮），而不是 `'decline'` ——
    // 用户按的是「停止」，不该让模型以为"用户拒绝了但可以接着干别的"。
    this.settleAllApprovals('cancel');
    this.abortController?.abort();
  }

  /**
   * 渲染层提交（或取消）一个提问的答案。
   *
   * @param answers 问题原文 → 答案字符串（多选用 ", " 连接）；`null` = 用户取消
   * @returns 是否命中了一个正在等待的提问
   */
  answerUserQuestion(requestId: string, answers: Record<string, string> | null): boolean {
    const resolve = this.pendingQuestions.get(requestId);
    if (!resolve) return false;
    this.pendingQuestions.delete(requestId);
    resolve(answers);
    return true;
  }

  private settleAllQuestions(answers: Record<string, string> | null): void {
    if (this.pendingQuestions.size === 0) return;
    const pending = [...this.pendingQuestions.values()];
    this.pendingQuestions.clear();
    for (const resolve of pending) resolve(answers);
  }

  /**
   * 渲染层提交一条审批决定。
   *
   * 对应原版 `resolveApproval(sessionId, requestId, decision)` @770166 ——
   * 原版会核对 sessionId，复刻一个实例只管一个会话，所以只需按 requestId 命中。
   *
   * @returns 是否命中了一条正在等待的审批（没命中说明它已经被 abort 或已经答过了）
   */
  answerApproval(requestId: string, decision: ApprovalDecision): boolean {
    const resolve = this.pendingApprovals.get(requestId);
    if (!resolve) return false;
    this.pendingApprovals.delete(requestId);
    resolve(decision);
    return true;
  }

  private settleAllApprovals(decision: ApprovalDecision): void {
    if (this.pendingApprovals.size === 0) return;
    const pending = [...this.pendingApprovals.values()];
    this.pendingApprovals.clear();
    for (const resolve of pending) resolve(decision);
  }

  /**
   * `canUseTool` —— 宿主的工具放行闸门。**权限模式"真生效"就落在这个函数里。**
   *
   * ── 为什么必须有这个回调（实机取证，别再删） ──
   *   CLI 的 AskUserQuestion 工具 `isEnabled()` 在**非交互会话**（SDK/`--print`）里
   *   要求 `permissionPromptToolName` 非空，否则工具被过滤掉，模型调用时会收到
   *   `No such tool available: AskUserQuestion` 然后退化成纯文本提问。
   *   而 SDK 只有在传了 `canUseTool` 时才会给 CLI 加 `--permission-prompt-tool stdio`
   *   （见 sdk.mjs：`if(canUseTool) push("--permission-prompt-tool","stdio")`）。
   *   → 所以「只加 onUserDialog + supportedDialogKinds」不能解锁这个工具，必须给 canUseTool。
   *
   * ── ⚠️ 顺序不能动（逐字对应原版 `buildCanUseTool()` @771414 的 if 链） ──
   *
   *   ① `AskUserQuestion`  **最先**。若排到权限门后面，在"需要批准"模式下
   *      会先弹一个"要不要允许 AskUserQuestion"的审批框 —— 用户要批准一次
   *      "能不能问你问题"，荒谬且会把弹窗链路变成两层。
   *   ② （原版此处是 `ExitPlanMode` → 捕获计划并 deny；复刻没有 plan 模式，
   *      B2 落地时这一支必须插在**③ 之前** —— 原版就是插在这儿的。
   *      插到 ③ 之后的话，plan + 完全访问 会先被 ③ 全放行、计划永远捕获不到。）
   *   ③ `'full-access'` 全放行      ← 见 `gateStepFor`
   *   ④ 只读工具白名单 放行          ← 见 `gateStepFor`
   *   ⑤ 本次会话已允许 放行          ← 见 `gateStepFor`
   *   ⑥ 其余 → 发审批请求并等待
   *
   * ── 与 SDK `permissionMode` 的关系（这条最容易搞错） ──
   *   门内比的是**原版口径的 app 级权限值**（`'full-access'`），
   *   **不是**交给 SDK 的 `'bypassPermissions'`。原版同样如此，理由见
   *   `permissions.ts` 文件头"二"。所以下面用 `this.canonicalPermissionMode`。
   *
   * ── 关于 `[CLAUDE_SDK_CAN_USE_TOOL_SHADOWED]` ──
   *   SDK 在 `permissionMode === 'bypassPermissions'` 时会打这个警告，说
   *   "canUseTool 不会被调用，因为每个工具都被自动放行了"（`sdk.mjs` @844471 的
   *   `BSe()`）。**这正是"完全访问"该有的样子**：用户选了完全访问，就该全自动放行。
   *   在"需要批准"模式下 SDK 拿到的是 `'default'`（不是 bypass），
   *   于是**每个工具都会真的进这个回调**，警告消失 —— 这就是"切了有反应"的机械证据。
   */
  private async canUseTool(
    toolName: string,
    input: Record<string, unknown>,
    ctx: CanUseToolContext = {},
  ): Promise<unknown> {
    // ① AskUserQuestion：永远最先，**不受权限模式影响**（两种模式下弹窗链路都在）
    if (toolName === 'AskUserQuestion') {
      return this.handleAskUserQuestion(input);
    }

    // ②~⑤ 权限门
    const step = gateStepFor(this.canonicalPermissionMode, toolName, this.sessionAllowedTools);
    if (step !== 'approval') {
      return { behavior: 'allow', updatedInput: input };
    }

    // ⑥ 其余 → 发审批请求并等待用户决定
    return this.requestApproval(toolName, input, ctx);
  }

  /**
   * AskUserQuestion → 宿主的提问确认框（**逐字保留改造前的行为**）。
   *
   * 这段链路是花了很多次实机调通的，本轮只是把它从 `canUseTool` 里抽成一个方法，
   * **逻辑一行没改**（否则就是在动那条好不容易调通的链）。
   */
  private async handleAskUserQuestion(input: Record<string, unknown>): Promise<unknown> {
    const questions = normalizeQuestions(input);
    if (questions.length === 0) {
      return { behavior: 'allow', updatedInput: input };
    }

    const requestId = randomUUID();
    const request: AskUserRequest = { requestId, sessionId: this.sessionId, questions };

    const answers = await new Promise<Record<string, string> | null>((resolve) => {
      if (this.abortController?.signal.aborted) {
        resolve(null);
        return;
      }
      this.pendingQuestions.set(requestId, resolve);
      // 推给渲染层弹确认框（IPC 层订阅 'ask-user'）
      this.emit('ask-user', request);
    });

    if (!answers) {
      // 用户取消 → 按 SDK 语义 deny，让模型知道「没拿到答案」而不是收到空答案
      return { behavior: 'deny', message: '用户关闭了提问，没有作答。' };
    }

    // 工具答案走 updatedInput.answers：question 原文 → 答案字符串
    return { behavior: 'allow', updatedInput: { ...input, answers } };
  }

  /**
   * 发一条审批请求给渲染层，并**一直等到用户做出决定**。
   *
   * 逐字对应原版 `buildCanUseTool()` @771414 里 ⑥ 的那段（@772335 起）。
   * ⚠️ 那段**逐字原文**已搬到
   *    `.workbuddy/ui-audit/verify/original-code-dumps.md §4`
   *    （搬出去的理由见 `WRITE-RULES.md §8`：注释里逐字引用的原文会被 `grep -c`
   *    一起数上，给出看起来像样的错数字）。这里只留**照抄不改的语义**。
   *
   * 三处**照抄不改**的语义：
   *   · `'cancel'` 带 `interrupt: true` —— 用户按「取消回合」是要**停下**，
   *     不是"拒绝这一下、你接着干"。
   *   · `'acceptForSession'` 回传 SDK 给的 `suggestions` 作为 `updatedPermissions`
   *     （SDK 的 `canUseTool` 第三个参数里就有，`sdk.d.ts:209-217` 写明"presenting
   *     the user an option 'always allow' 时就把这整套 suggestions 回传"）。
   *   · 没有超时。**故意不加**：超时替用户做决定（无论是允许还是拒绝）都是撒谎，
   *     而且会掩盖"渲染层根本没接上"这个真问题。松开 pending 的路径只有三条：
   *     用户作答、`abort()`、SDK 的 `signal` 被 abort。
   */
  private async requestApproval(
    toolName: string,
    input: Record<string, unknown>,
    ctx: CanUseToolContext,
  ): Promise<unknown> {
    const requestId = randomUUID();
    const request: ApprovalRequest = {
      requestId,
      sessionId: this.sessionId,
      kind: approvalKindOf(toolName),
      detail: approvalDetailOf(toolName, input),
      toolName,
    };

    // 推给渲染层弹审批框（IPC 层订阅 'approval-ask'，对应原版 approval-request 流事件）
    this.emit('approval-ask', request);

    const decision = await new Promise<ApprovalDecision>((resolve) => {
      this.pendingApprovals.set(requestId, resolve);
      // SDK 给的 signal：它被 abort 时（SDK 侧取消了这次工具调用）把我们松开，
      // 否则这条 promise 会挂到永远 —— 这是原版的处理方式，不是我自己加的。
      ctx.signal?.addEventListener(
        'abort',
        () => {
          if (this.pendingApprovals.delete(requestId)) resolve('cancel');
        },
        { once: true },
      );
    });

    this.emit('approval-resolved', { requestId });

    switch (decision) {
      case 'accept':
        return { behavior: 'allow', updatedInput: input };
      case 'acceptForSession': {
        this.sessionAllowedTools.add(toolName);
        return {
          behavior: 'allow',
          updatedInput: input,
          updatedPermissions: ctx.suggestions,
        };
      }
      case 'cancel':
        return { behavior: 'deny', message: 'User cancelled this turn', interrupt: true };
      default:
        return { behavior: 'deny', message: 'User declined this tool use' };
    }
  }

  /**
   * 执行一轮对话。
   *
   * 注意：这个方法是「跑到底」的语义 —— 它会一直消费事件直到 SDK 流结束。
   * 调用方应当 await 它，但**不要**在 UI 线程里同步等待。
   */
  async run(opts: RunOptions): Promise<void> {
    if (this.running) {
      throw new Error('该会话已有正在执行的任务，请先中断或等待完成');
    }
    this.running = true;
    /**
     * 本轮的取消控制器。留一个局部引用给下面的消费循环用 ——
     * `this.abortController` 会在 `finally` 里被置空，而循环的收尾路径（排空阶段）在那之后还会跑。
     */
    const controller = new AbortController();
    this.abortController = controller;
    this.blocks = [];
    this.streamIndex = -1;

    this.emitEvent({ type: 'session-start', sessionId: this.sessionId });

    try {
      const query = await loadSdk();
      const claudePath = resolveClaudeExecutable();
      const providerEnv = buildProviderEnv(opts.provider, opts.model, opts.bridgeBaseUrl);
      const childEnv = buildChildEnv(providerEnv);

      if (opts.debug) {
        console.log('[agent] provider =', opts.provider.name, opts.provider.apiFormat);
        console.log('[agent] cwd      =', opts.cwd);
        console.log('[agent] claude   =', claudePath ?? '(SDK 内置)');
        console.log(
          '[agent] env keys =',
          Object.keys(providerEnv).join(','),
          'baseUrl=',
          providerEnv.ANTHROPIC_BASE_URL ?? '(默认)',
        );
      }

      // ── 组装 SDK 选项 ──────────────────────────────────────
      /**
       * 权限值**在这里算一次**，两处消费共用（见 `permissions.ts` 文件头）：
       *   · `sdkMode`      → 交给 SDK 的 `permissionMode`（等价原版 `jh()` @669203）
       *   · `this.canonicalPermissionMode` → `canUseTool` 门内比的 app 级值
       *
       * 顺带把测试环境那条"默认值分支"钉在这里：`opts.permissionMode` 为 `undefined`
       * （设置里没这个字段）时走 `'full-access'` ⇒ SDK 侧 `'bypassPermissions'`，
       * 与改造前完全一致（老用户升级后行为不变）。
       */
      const canonical = canonicalPermissionMode(opts.permissionMode);
      const sdkMode = sdkPermissionModeFor(opts.permissionMode, opts.interactionMode);
      this.canonicalPermissionMode = canonical;

      const options: Record<string, unknown> = {
        cwd: opts.cwd,
        abortController: this.abortController,
        // 关掉 SDK 自己去读磁盘上的 .claude 配置，避免宿主环境污染
        settingSources: [],
        env: childEnv,
        /**
         * ⚠️ 这一行**以前是硬编码 `'bypassPermissions'`** —— 也就是输入区那个
         *    「完全访问 / 需要批准」选择器曾经是纯装饰品：切过去什么都不会变。
         *
         * 现在：`'full' → bypassPermissions`（全自动放行，原行为）
         *       `'approval' → 'default'`（每个工具都真的会进 `canUseTool`，
         *                        SDK 文档 `sdk.d.ts:1733`：'Standard permission
         *                        behavior, prompts for dangerous operations'）
         *       plan 模式下 `→ 'plan'`（且**优先于**权限判断，顺序见 `permissions.ts`）
         */
        permissionMode: sdkMode,
        // ⚠️ **无条件 true，不要跟着 permissionMode 改。**
        //    原版 @668260 的同对象里 `'allowDangerouslySkipPermissions': !0x0` 也是无条件的
        //    （连 plan 模式下都是 true）。拦不拦工具是 `permissionMode` 管的事，
        //    这个开关只管"允许不允许用 bypassPermissions 这个模式本身"
        //    （SDK 的硬要求：`sdk.d.ts:1748` 'Must be set to true when using
        //     permissionMode: bypassPermissions'）。
        allowDangerouslySkipPermissions: true,
        // ⚠️ 必须传 canUseTool：SDK 只有看到它才会给 CLI 加
        //    `--permission-prompt-tool stdio`，而 CLI 的 AskUserQuestion 工具在
        //    非交互会话里正是靠这个开关才被启用（否则会报
        //    `No such tool available: AskUserQuestion`，模型退化成纯文本提问）。
        //    现在它同时承担第二件事：在「需要批准」模式下拦截工具调用、发审批请求。
        //    第三个参数必须转发 —— `signal`（SDK 取消时松开挂着的审批）与
        //    `suggestions`（「本次会话始终允许」要回传成 `updatedPermissions`）都在里面。
        canUseTool: (
          toolName: string,
          input: Record<string, unknown>,
          ctx?: CanUseToolContext,
        ) => this.canUseTool(toolName, input, ctx ?? {}),
        settings: {
          autoCompactEnabled: true,
          precomputeCompactionEnabled: true,
        },
      };

      if (claudePath) options.pathToClaudeCodeExecutable = claudePath;
      if (opts.model) options.model = opts.model;
      // SDK 的快速模式属于 settings 层，而不是 query options 顶层字段。
      // 只有调用方确认当前供应商/模型支持时才注入，避免第三方端点收到未知配置。
      if (opts.fastMode === true) {
        options.settings = {
          ...(options.settings as Record<string, unknown>),
          fastMode: true,
          fastModePerSessionOptIn: true,
        };
      }
      if (opts.systemPrompt) options.systemPrompt = opts.systemPrompt;
      if (opts.resumeSessionId) options.resume = opts.resumeSessionId;

      // 用户配置的 MCP 服务器（设置/扩展里的「连接器」，原版 settings.mcpServers 语义）：
      // stdio 型 → SDK stdio server；http 型 → SDK http server。
      // 延迟 import 避免循环依赖（config store 不依赖本模块）。
      try {
        const { getSettings } = await import('../store/config');
        const userMcp = getSettings().mcpServers ?? [];
        if (userMcp.length) {
          options.mcpServers = userMcp.map((m) =>
            m.transport === 'http'
              ? { type: 'http' as const, name: m.name, url: m.url ?? '', headers: m.headers ?? {} }
              : { type: 'stdio' as const, name: m.name, command: m.command ?? '', args: m.args ?? [], env: m.env ?? {} },
          );
        }
      } catch {
        /* 设置读不到就不注入 MCP，会话照常 */
      }

      // ── 技能插件 ────────────────────────────────────────────
      // 技能必须作为**完整的 Claude Code 插件**交给 SDK，否则 CLI 不注册斜杠命令，
      // `/mma-paper` 之类的模式会静默失效（agent 侧只看得到 `Unknown command`）。
      // 踩过的坑：
      //   1. 传 string[]（技能目录列表）→ SDK 抛 `Unsupported plugin type: undefined`
      //      （`plugins` 只接受 `{ type: 'local', path }`，会被翻译成 `--plugin-dir <path>`）
      //   2. 传「只有 SKILL.md 的目录」→ 不报错，但命令**不注册**
      //      （缺 `.claude-plugin/plugin.json` 清单，CLI 不认它是插件）
      // 因此这里先物化 `<userData>/skills-plugin`（含清单 + skills/ 子目录），
      // 再把整个插件目录挂上去。物化是幂等的，失败也只降级（聊天仍可用）。
      // 正常路径：启动时已预热，这里 await 到的是同一个 promise（多半已完成）；
      // 万一预热失败，再用同步物化兜底重试一次。
      let skillsPluginDir = opts.skillsPluginPath;
      if (!skillsPluginDir) {
        try {
          skillsPluginDir = await warmupSkillsPlugin();
        } catch {
          try {
            skillsPluginDir = materializeSkillsPlugin();
          } catch (err) {
            console.warn(
              '[agent] 技能插件物化失败，本次会话没有斜杠命令：',
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
      if (skillsPluginDir) {
        options.plugins = [{ type: 'local' as const, path: skillsPluginDir }];
      }

      if (opts.effort) options.effort = opts.effort;
      if (opts.disableThinking) options.thinking = { type: 'disabled' };

      // ── 消费事件流 ────────────────────────────────────────
      /**
       * ⚠️⚠️ **这里是本次缺陷的根因点，不要改回 `prompt: opts.prompt`（字符串）。**
       *
       * SDK 的判断是 `isSingleUserTurn: typeof prompt === "string"`（`sdk.mjs` 的 `Qwt()`）。
       * 传字符串 ⇒ 单轮模式 ⇒ 首个 `result` 一到就 `transport.endInput()` 关掉 stdin
       * （日志字面量 `First result received for single-turn query, closing stdin`）
       * ⇒ CLI 随 stdin EOF 退出 ⇒ **在跑的后台任务被连坐收掉** ⇒
       *   模型等的那个"后台任务跑完唤醒我"**永远不会来**，回合停在半路。
       *
       * 传 `AsyncIterable<SDKUserMessage>`（`sdk.d.ts:2640`）才进多轮模式：stdin 保持打开，
       * CLI 自己把后台任务完成的通知作为 machine-injected 回合续跑（`sdk.d.ts:4165-4212`
       * 的 `SDKMessageOrigin` 有 `kind:'task-notification'` / `'auto-continuation'`）。
       *
       * 队列里**只有这一条**用户提示词；后续续跑不靠我们写 stdin，靠 CLI 自己的通知队列。
       * 收尾靠 `runSessionLoop` 的显式条件（见 `session-loop.ts` 文件头）。
       */
      const input = new SessionInputQueue();
      input.push(opts.prompt);

      const stream = query({ prompt: input, options });
      let contextConfigured = false;

      // abort 时立刻关队列：让 SDK 的 `streamInput()` 走完 `for await`，CLI 干净退出
      const onAbort = (): void => input.close();
      controller.signal.addEventListener('abort', onAbort, { once: true });

      let outcome: SessionLoopOutcome;
      try {
        outcome = await runSessionLoop({
          stream,
          onMessage: (msg) => {
            this.handleSdkMessage(msg);
            const frame = msg && typeof msg === 'object' ? msg as Record<string, unknown> : null;
            if (!contextConfigured && frame?.type === 'system' && frame.subtype === 'init') {
              contextConfigured = true;
              void this.configureContextWindow(stream);
            } else if (
              frame?.type === 'assistant' ||
              frame?.type === 'result' ||
              (frame?.type === 'system' && frame.subtype === 'compact_boundary')
            ) {
              void this.emitContextUsage(stream);
            }
          },
          onConclude: () => input.close(),
          isAborted: () => controller.signal.aborted,
        });
      } finally {
        controller.signal.removeEventListener('abort', onAbort);
        input.close();
      }

      if (outcome.kind === 'capped') {
        // 有界兜底被触发：既不静默挂死，也不假装正常结束
        this.emitEvent({
          type: 'session-error',
          message:
            `等待后台任务结束超过 ${Math.round(BACKGROUND_WAIT_CAP_MS / 60_000)} 分钟，` +
            `已强制结束本轮。后台任务可能仍在运行。`,
        });
        this.emitEvent({
          type: 'session-end',
          sessionId: this.sessionId,
          reason: 'background-timeout',
        });
      } else {
        this.emitEvent({ type: 'session-end', sessionId: this.sessionId });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitEvent({ type: 'session-error', message });
      this.emitEvent({ type: 'session-end', sessionId: this.sessionId, reason: 'error' });
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  /**
   * 把 SDK 的一帧翻译成我们的 StreamEvent。
   *
   * SDK 的消息形态（Anthropic Messages 流语义）：
   *   { type: 'system', subtype: 'init', session_id, tools, model }
   *   { type: 'assistant', message: { content: [...], usage } }
   *   { type: 'user',      message: { content: [tool_result...] } }
   *   { type: 'result',    subtype: 'success'|'error_max_turns'|..., usage, total_cost_usd }
   */
  private handleSdkMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, any>;

    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init' && typeof m.session_id === 'string') {
          this.emit('sdk-session', m.session_id as string);
          if (m.model) this.emit('model', m.model as string);
          return;
        }
        this.handleSystemSubtype(m);
        return;
      }

      case 'assistant': {
        const inner = m.message as { content?: unknown[]; usage?: any } | undefined;
        if (inner?.usage) this.absorbUsage(inner.usage);
        for (const block of inner?.content ?? []) {
          this.handleContentBlock(block);
        }
        return;
      }

      case 'user': {
        // 用户角色回流的是 tool_result
        const inner = m.message as { content?: unknown[] } | undefined;
        for (const block of inner?.content ?? []) {
          const b = block as Record<string, any>;
          if (b.type === 'tool_result') {
            this.emitEvent({
              type: 'tool-result',
              toolUseId: String(b.tool_use_id ?? ''),
              result: b.content,
              isError: Boolean(b.is_error),
            });
          }
        }
        return;
      }

      case 'result': {
        if (m.usage) this.absorbUsage(m.usage);
        if (m.subtype && m.subtype !== 'success') {
          // max_turns / error_* 都要让用户看见
          const detail = m.result ?? m.subtype;
          this.emitEvent({
            type: 'session-error',
            message:
              m.subtype === 'error_max_turns'
                ? `已达到最大轮次上限，任务可能未完成。${typeof detail === 'string' ? detail : ''}`
                : `任务异常结束：${m.subtype}`,
          });
        }
        /**
         * 一个 `result` = 一个回合的边界。
         *
         * 常驻会话下，后台任务跑完会让 CLI **自动续跑**，于是同一次运行里会出现
         * 「result → （唤醒）→ 新的 assistant 帧 → 又一个 result」。
         * 这里把文本流的游标归零，续跑的正文才会**另起一个文本块**（渲染成新的一段），
         * 而不是黏在上一段末尾（"…等它跑完它跑完了，我接着做"）。
         *
         * 与既有约定一致：`tool_use` 分支同样用 `streamIndex = -1` 打断文本流。
         * 默认路径（一轮只有一个 result，且它是最后一帧）**不受影响**。
         */
        this.streamIndex = -1;
        return;
      }

      default:
        /**
         * ⚠️ **不要改回静默 `return`。**
         *
         * 静默吞帧本身就是上一个缺陷的组成部分：改造前 `case 'system'` 只认
         * `subtype==='init'`，其余（含全部后台任务帧）连同这个 `default` 一起被吃掉，
         * 于是"到底有没有后台任务在跑"这个信息在宿主侧根本不存在。
         */
        console.debug('[agent] 未识别的 SDK 帧类型（已知未消费）:', m.type);
        return;
    }
  }

  /**
   * `system` 类帧里除 `init` 之外的**显式**处理。
   *
   * ── 三类后台任务帧（类型原文见 `sdk.d.ts`） ──
   *   · `background_tasks_changed`（`sdk.d.ts:3054-3069`）—— **判定收尾的正规依据**。
   *     注释原文写明它是 **level 信号、REPLACE 语义**：
   *     "consumers that only need 'is background work running' should replace their set
   *      with each payload rather than pairing edges, so a missed bookend cannot wedge a
   *      stale running indicator"。它的状态累积在 `session-loop.ts` 的 `TurnState` 里
   *     （那里才是收尾判定的家），这里只留一条可诊断日志。
   *   · `task_started`（`:4663`）/ `task_progress`（`:4641`）/ `task_updated`（`:4687`）/
   *     `task_notification`（`:4623`）—— **已知未消费**。
   *
   * ── 为什么"未消费"也要写出来 ──
   *   本轮**不**把它们转发到渲染层：`shared/types.ts:168-179` 的 `StreamEvent` 联合里
   *   没有 task 类事件，只加主进程侧会造成"发了没人收"。按"显式落日志 + 写明已知未消费"
   *   处理，而不是用默认分支藏起来 —— 藏起来正是这个 bug 的一部分。
   */
  private handleSystemSubtype(m: Record<string, any>): void {
    const subtype = typeof m.subtype === 'string' ? m.subtype : '(缺失)';
    switch (subtype) {
      case 'compact_boundary': {
        const metadata = (m.compact_metadata ?? m.compactMetadata ?? {}) as Record<string, unknown>;
        this.emitEvent({
          type: 'context-compacted',
          before: Number(metadata.pre_tokens ?? metadata.preTokens ?? 0),
          ...(Number.isFinite(Number(metadata.post_tokens ?? metadata.postTokens))
            ? { after: Number(metadata.post_tokens ?? metadata.postTokens) }
            : {}),
          trigger: metadata.trigger === 'manual' ? 'manual' : 'auto',
        });
        return;
      }
      case 'background_tasks_changed': {
        const count = Array.isArray(m.tasks) ? m.tasks.length : 0;
        console.debug(
          `[agent] background_tasks_changed：当前存活后台任务 ${count} 个（REPLACE 语义）`,
        );
        return;
      }
      case 'task_started':
        console.debug(
          `[agent] task_started（已知未消费，不转发渲染层）：${String(m.task_id ?? '')} ${String(m.description ?? '')}`,
        );
        return;
      case 'task_progress':
        console.debug(`[agent] task_progress（已知未消费）：${String(m.task_id ?? '')}`);
        return;
      case 'task_updated':
        console.debug(
          `[agent] task_updated（已知未消费）：${String(m.task_id ?? '')} ${String(m.patch?.status ?? '')}`,
        );
        return;
      case 'task_notification':
        console.debug(
          `[agent] task_notification（已知未消费）：${String(m.task_id ?? '')} ${String(m.status ?? '')}`,
        );
        return;
      default:
        console.debug('[agent] 未消费的 system 子类型（已知未处理）:', subtype);
        return;
    }
  }

  private absorbUsage(u: Record<string, any>): void {
    const input = Number(u.input_tokens ?? 0);
    const output = Number(u.output_tokens ?? 0);
    const reasoning = Number(u.reasoning_tokens ?? 0);
    const cacheRead = Number(u.cache_read_input_tokens ?? 0);
    const cacheWrite = Number(u.cache_creation_input_tokens ?? 0);

    // SDK 给的是「每轮增量」，累加
    this.usage.inputTokens += input;
    this.usage.outputTokens += output;
    if (reasoning) this.usage.reasoningTokens = (this.usage.reasoningTokens ?? 0) + reasoning;
    if (cacheRead) this.usage.cacheReadTokens = (this.usage.cacheReadTokens ?? 0) + cacheRead;
    if (cacheWrite) this.usage.cacheWriteTokens = (this.usage.cacheWriteTokens ?? 0) + cacheWrite;

    this.emitEvent({ type: 'usage', usage: { ...this.usage } });
  }

  private handleContentBlock(block: unknown): void {
    if (!block || typeof block !== 'object') return;
    const b = block as Record<string, any>;

    if (b.type === 'text' && typeof b.text === 'string') {
      if (this.streamIndex < 0 || this.blocks[this.streamIndex]?.kind !== 'text') {
        this.streamIndex = this.blocks.length;
        this.blocks.push({ kind: 'text', text: '' });
        this.emitEvent({ type: 'block-start', index: this.streamIndex, kind: 'text' });
      }
      const cur = this.blocks[this.streamIndex];
      cur.text = (cur.text ?? '') + b.text;
      this.emitEvent({ type: 'text-delta', index: this.streamIndex, delta: b.text });
      return;
    }

    if (b.type === 'thinking' && typeof b.thinking === 'string') {
      if (this.streamIndex < 0 || this.blocks[this.streamIndex]?.kind !== 'thinking') {
        this.streamIndex = this.blocks.length;
        this.blocks.push({ kind: 'thinking', text: '' });
        this.emitEvent({ type: 'block-start', index: this.streamIndex, kind: 'thinking' });
      }
      const cur = this.blocks[this.streamIndex];
      cur.text = (cur.text ?? '') + b.thinking;
      this.emitEvent({ type: 'thinking-delta', index: this.streamIndex, delta: b.thinking });
      return;
    }

    if (b.type === 'tool_use') {
      this.blocks.push({
        kind: 'tool_use',
        toolName: String(b.name ?? ''),
        toolUseId: String(b.id ?? ''),
        toolInput: b.input,
      });
      // 工具调用会打断文本流
      this.streamIndex = -1;
      this.emitEvent({
        type: 'tool-use',
        toolName: String(b.name ?? ''),
        toolUseId: String(b.id ?? ''),
        input: b.input,
      });
    }
  }
}

/** 会话注册表：sessionId → runner */
export class SessionRegistry {
  private runners = new Map<string, AgentSession>();
  private metas = new Map<string, SessionMeta>();

  get(sessionId: string): AgentSession {
    let r = this.runners.get(sessionId);
    if (!r) {
      r = new AgentSession(sessionId);
      this.runners.set(sessionId, r);
    }
    return r;
  }

  has(sessionId: string): boolean {
    return this.runners.has(sessionId);
  }

  /** 中断并丢弃（会话被删除时） */
  dispose(sessionId: string): void {
    const r = this.runners.get(sessionId);
    if (!r) return;
    r.abort();
    r.removeAllListeners();
    this.runners.delete(sessionId);
    this.metas.delete(sessionId);
  }

  /** 中断全部（应用退出时） */
  disposeAll(): void {
    for (const id of [...this.runners.keys()]) this.dispose(id);
  }

  setMeta(meta: SessionMeta): void {
    this.metas.set(meta.id, meta);
  }

  getMeta(sessionId: string): SessionMeta | undefined {
    return this.metas.get(sessionId);
  }

  listRunning(): string[] {
    return [...this.runners.values()].filter((r) => r.isRunning).map((r) => r.sessionId);
  }
}
