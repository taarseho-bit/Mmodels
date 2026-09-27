/**
 * 全局共享类型契约。
 *
 * 这个文件被 main / preload / renderer 三端共同引用，
 * 必须保持**零运行时依赖**：type / interface / const 字面量 / **纯函数**，
 * 并且**不得 import 任何模块**。
 * 一旦这里 import 了任何带副作用的模块，渲染层的编译图会被污染。
 *
 * （`pickLocalizedText` / `makeLocalizedText` 是本文件仅有的两个纯函数 ——
 *   主进程写盘与渲染层显示必须用同一套「项目契约 `Np` 本地化文案」读写规则，
 *   放在这里才不会两边各写一遍、各偏一半。）
 */

// ─────────────────────────────────────────────────────────────
// 模型供应商
// ─────────────────────────────────────────────────────────────

/** 供应商的协议形态 —— 决定要不要走协议转换桥 */
export type ApiFormat = 'anthropic' | 'openai';

/** Anthropic 系认证方式 */
export type AnthropicAuthMode = 'apiKey' | 'authToken';

export interface ProviderConfig {
  id: string;
  name: string;
  /** 协议形态 */
  apiFormat: ApiFormat;
  /** 接口基址，如 https://api.minimaxi.com/anthropic */
  baseUrl: string;
  /** 密钥（存 userData，不进项目目录） */
  apiKey: string;
  /** anthropic 协议下的认证头选择 */
  anthropicAuthMode?: AnthropicAuthMode;
  /** 可选模型列表（用户可手填） */
  models?: string[];
  /** 按模型配置的容量（Token），最大1M；未填写时自动识别。 */
  contextWindows?: Record<string, number>;
  /** 声明支持 SDK 快速模式的模型 id；未声明的模型不会显示快速模式入口 */
  fastModeModels?: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 是否内置预设（内置的不可删） */
  builtin?: boolean;
}

export interface PresetProvider {
  key: string;
  name: string;
  apiFormat: ApiFormat;
  baseUrl: string;
  defaultModel: string;
  docsUrl?: string;
  /** 注释说明，界面展示 */
  note?: string;
}

// ─────────────────────────────────────────────────────────────
// 会话
// ─────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'system';

export type BlockKind =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error';

export interface ContentBlock {
  kind: BlockKind;
  /** text / thinking 正文 */
  text?: string;
  /** 用户消息的后台完整指令；界面、复制与编辑只使用 text。 */
  modelText?: string;
  /** tool_use */
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  /** tool_result */
  toolResult?: unknown;
  isError?: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  blocks: ContentBlock[];
  createdAt: number;
  /** 该条消息所属的模型 */
  model?: string;
  /** 用量统计 */
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** 推理模型单独统计，否则成本严重偏低 */
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/**
 * 「进行中回合」快照 —— `session.get` 返回体的**可选**字段。
 *
 * 为什么需要它：assistant 消息是**这一轮跑完那一刻**才落库的
 * （见 `main/ipc/session.ts` 的 `insertMessage`），所以「跑着的时候切走、
 * 再切回来」这一轮在 `messages` 表里根本不存在，无从复原。
 * 主进程把这一轮的块序列按节流写进 `turn_spills` 表（一会话最多一行），
 * 这里原样带给渲染层。
 *
 * ⚠️ 只在**真的有一轮在跑**时才返回该字段；没有时 `SESSION_GET` **不带这个键**。
 *    不要返回空 blocks 冒充"有"——渲染层区分不开"有一轮在跑但还没内容"
 *    与"没有在跑"，会多渲染一个空气泡。
 */
export interface InflightTurn {
  /** 到目前为止的块序列。形状与 `ChatMessage.blocks` 完全一致，可直接拿去折任务面板 */
  blocks: ContentBlock[];
  /**
   * 这一轮**即将**落库的 assistant 消息 id。
   *
   * ⚠️ 它在回合开始时就定好，收尾时 `insertMessage` 用的是**同一个 id** ——
   *    「这条消息已存在于 messages 表」因此等价于「这一轮已经收尾」，
   *    也就是「这行快照是收尾路径漏删的陈旧残留」（见 ipc/session.ts 的 inflightOf）。
   *    改动这个 id 的生成位置会让陈旧判定静默失效。
   */
  messageId: string;
  /** 最后一次快照写入时间（`Date.now()`） */
  updatedAt: number;
}

export type SessionStatus = 'idle' | 'running' | 'error' | 'aborted';

export interface SessionMeta {
  id: string;
  title: string;
  /** 所属项目目录 */
  projectId: string;
  providerId: string;
  model: string;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  totalUsage?: TokenUsage;
  /** 用于 SDK 续传 */
  sdkSessionId?: string;
  /** 错误信息 */
  error?: string;
}

// ─────────────────────────────────────────────────────────────
// 项目
// ─────────────────────────────────────────────────────────────

export interface ProjectMeta {
  id: string;
  name: string;
  /** 项目根目录绝对路径 */
  root: string;
  createdAt: number;
  updatedAt: number;
  /** 最近一次打开时间，用于排序 */
  lastOpenedAt: number;
}

/** SDK 返回的真实上下文窗口占用，不是历史消息 token 的累计值。 */
export interface ContextWindowUsage {
  capacitySource?: 'configured' | 'known' | 'reference';
  estimated?: boolean;
  used: number;
  total: number;
  percentage: number;
  /** SDK 当前启用自动压缩时的触发线（token）。 */
  autoCompactThreshold?: number;
  autoCompactEnabled: boolean;
  model?: string;
}

export type AgentActivityStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'killed'
  | 'paused';

/** SDK 子智能体的实时状态；只描述真实任务，不生成模拟进度。 */
export interface AgentActivity {
  taskId: string;
  agentType: string;
  description: string;
  status: AgentActivityStatus;
  summary?: string;
  lastToolName?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

// ─────────────────────────────────────────────────────────────
// 流式事件（main → renderer）
// ─────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'session-start'; sessionId: string }
  | { type: 'session-stopping'; sessionId: string }
  | { type: 'message-start'; messageId: string }
  | { type: 'block-start'; index: number; kind: BlockKind }
  | { type: 'text-delta'; index: number; delta: string }
  | { type: 'thinking-delta'; index: number; delta: string }
  | { type: 'tool-use'; toolName: string; toolUseId: string; input: unknown }
  | { type: 'tool-result'; toolUseId: string; result: unknown; isError?: boolean }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'context-usage'; usage: ContextWindowUsage }
  | { type: 'context-compacted'; before: number; after?: number; trigger: 'manual' | 'auto' }
  | { type: 'agent-start'; activity: AgentActivity }
  | { type: 'agent-progress'; activity: AgentActivity }
  | { type: 'agent-end'; activity: AgentActivity }
  | { type: 'message-stop'; messageId: string }
  | { type: 'session-error'; message: string }
  | { type: 'session-end'; sessionId: string; reason?: string };

// ─────────────────────────────────────────────────────────────
// Agent 提问（AskUserQuestion 工具 → 宿主确认框）
// ─────────────────────────────────────────────────────────────

/** 提问的一个选项（对应 AskUserQuestion 工具的 options[]） */
export interface AskUserOption {
  label: string;
  description?: string;
  /** 预览内容（长文本/HTML/markdown，项目契约支持 preview 卡片） */
  preview?: string;
}

/** 一个问题（对应 AskUserQuestion 工具的 questions[]） */
export interface AskUserQuestion {
  /** 短标题，如「题目来源」 */
  header?: string;
  question: string;
  options: AskUserOption[];
  /** 多选（答案用 ", " 连接） */
  multiSelect?: boolean;
}

/** 主进程推给渲染层的提问请求 */
export interface AskUserRequest {
  requestId: string;
  sessionId: string;
  questions: AskUserQuestion[];
}

// ─────────────────────────────────────────────────────────────
// 工具审批（权限模式「需要批准」→ 宿主弹审批框）
// ─────────────────────────────────────────────────────────────

/**
 * 审批类别 —— **来源于项目资料** zod（协议实现）：
 * `requestKind: z.enum(['command','file-read','file-change'])`
 *
 * 渲染层据此选 `composer.composerPendingApprovalPanel.prompt{Command,FileRead,FileChange,Plan}`。
 */
export type ApprovalKind = 'command' | 'file-read' | 'file-change' | 'plan';

/**
 * 用户在审批框里的四种选择 —— 由本项目的权限桥统一处理
 * 的 `switch(decision)` 四个分支（项目契约保留字面量 `accept` / `acceptForSession` /
 * `cancel`，`default` 分支代表"拒绝"）。
 *
 * 语义（与项目契约一一对应）：
 *   · `accept`           → `{behavior:'allow'}`
 *   · `acceptForSession` → 记住这个工具，本次会话不再问；并回传 SDK 的 `updatedPermissions`
 *   · `cancel`           → `{behavior:'deny', interrupt:true}`（**中断本轮**）
 *   · `decline`          → `{behavior:'deny'}`（拒绝这一次，但让 Agent 继续）
 */
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'cancel' | 'decline';

/**
 * 主进程推给渲染层的审批请求（对应项目契约 `approval-request` 流事件 ：
 * `{type:'approval-request', requestId, requestKind, detail?}`）。
 *
 * 比项目契约多带 `toolName`：当前渲染层拿 `requestKind` 就够（它只显示"有命令等待审批"），
 * 当前实现的审批框要把**工具名**显示出来，否则用户不知道在批准哪个工具。
 */
export interface ApprovalRequest {
  requestId: string;
  sessionId: string;
  kind: ApprovalKind;
  /** 项目契约 `Dh()` 生成的细节串：`工具名: <JSON 输入>`，超 400 字符截断加 `…` */
  detail: string;
  /** 工具名（当前实现新增，用于界面显示与"本次会话始终允许"的粒度） */
  toolName: string;
}

// ─────────────────────────────────────────────────────────────
// 技能
// ─────────────────────────────────────────────────────────────

export interface SkillMeta {
  /** 目录名 */
  dirName: string;
  /** frontmatter name */
  name: string;
  description: string;
  /** 来源：builtin=随包内置，user=用户放置 */
  source: 'builtin' | 'user';
  /** 绝对路径 */
  path: string;
  /** 是否默认禁用（存在 .disabled-by-default 空文件） */
  disabledByDefault: boolean;
  /** 当前是否启用 */
  enabled: boolean;
  /** 文件数与体积，界面展示"重"技能 */
  fileCount: number;
  byteSize: number;
  /** 是否有 scripts/ */
  hasScripts: boolean;
}

// ─────────────────────────────────────────────────────────────
// 文件与产物
// ─────────────────────────────────────────────────────────────

export interface FileNode {
  name: string;
  /** 相对项目根的路径，POSIX 分隔 */
  relPath: string;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  children?: FileNode[];
}

export interface FilePreview {
  kind: 'text' | 'image' | 'pdf' | 'audio' | 'video' | 'binary' | 'too-large';
  relPath: string;
  size: number;
  /** text 时的内容（已截断） */
  text?: string;
  /** image/pdf 时的 data URL */
  dataUrl?: string;
  /**
   * audio/video 时的可播放 URL —— 自定义协议 `mm-media://`（主进程流式读盘）。
   * ⚠️ 音视频**绝不内联 base64**：几 MB 的 base64 字符串会撑爆渲染层内存。
   */
  mediaUrl?: string;
  truncated?: boolean;
  mime?: string;
  /** 文件修改时间 —— 编辑器用它检测「磁盘上被改过」 */
  mtimeMs?: number;
}

/** 项目内 PDF 的轻量信息；不把整份文件传到渲染层。 */
export interface PdfInfo {
  relPath: string;
  pages: number | null;
  size: number;
}

// ─────────────────────────────────────────────────────────────
// 设置
// ─────────────────────────────────────────────────────────────

export interface AppSettings {
  /** 当前选中的供应商 */
  activeProviderId: string | null;
  /** 默认模型 */
  defaultModel: string | null;
  /** 是否启用内置 MCP 工具（browser_* 等） */
  builtinMcpEnabled: boolean;
  /**
   * 推理强度。
   *
   * ⚠️ 取值域**必须与 SDK 的 `EffortLevel` 一致**（`sdk.d.ts:553`：
   * `'low' | 'medium' | 'high' | 'xhigh' | 'max'`），项目契约同样是这 5 档、默认 `high`。
   * `shared` 层不能 import SDK（它只在主进程按需加载），所以在这里手写；
   * 主进程 `agent/session.ts` 那份是从 SDK 推导出来的 —— **两边不一致时 tsc 会报错**。
   */
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | null;
  /**
   * 是否关闭思考。
   * DeepSeek V4 系列默认开思考会烧光输出预算导致正文为空，必须能关。
   */
  disableThinking: boolean;
  /** 是否为支持该能力的模型启用 SDK 快速模式 */
  fastMode?: boolean;
  /** 界面语言 */
  locale: 'zh-CN' | 'en-US';
  /** 最近打开的项目 id */
  recentProjectId: string | null;
  /** 首次运行向导是否已完成（完成后不再自动弹出） */
  onboardingDone?: boolean;
  /** 引导巡览是否已看过 */
  tourDone?: boolean;
  /**
   * Agent 权限模式（对应 Composer 底部的权限选择器）。
   * 完全访问 = 不逐次询问；需要批准 = 每次敏感操作前问。
   */
  permissionMode?: 'full' | 'approval';
  /** 本会话发送时让 Agent 先规划、不修改工作区；输入区 Shift+Tab 切换。 */
  planMode?: boolean;
  /** 复杂建模任务是否允许主智能体调用专门的子智能体并行分析。 */
  multiAgentEnabled?: boolean;
  /** 数学建模任务的质量检查强度；决定是否优先做验证、敏感性分析和交付核对。 */
  modelingQualityMode?: 'fast' | 'balanced' | 'strict';
  /** 是否允许智能体根据题目自动选择匹配技能。 */
  skillAutoSelect?: boolean;
  /** 多智能体默认并行上限。 */
  maxParallelAgents?: number;
  /** 多智能体默认总人数上限。 */
  maxTotalAgents?: number;
  /** 是否显示跟随真实任务状态变化的数学建模伙伴。 */
  modelingPetEnabled?: boolean;
  modelingPetAppearance?: 'student' | 'pixel' | 'researcher' | 'astronaut' | 'owl-3d' | 'robot-3d' | 'fox-3d' | 'bear-3d';
  modelingPetQuiet?: boolean;
  modelingPetSize?: 'small' | 'normal';
  modelingPetMotion?: 'lively' | 'gentle';
  modelingPetBubble?: 'progress' | 'always';
  /** 桌面小模窗口上次停留的位置。 */
  modelingPetPosition?: { x: number; y: number };
  /** 输入区的任务模式（自由对话 / 写论文 / 画图 / 评审 / 找数据） */
  composerMode?: 'chat' | 'paper' | 'figure' | 'review' | 'data' | 'sprint';
  /**
   * 决策模式 —— 与任务模式**正交**的另一个维度（2026-09-20，用户需求）：
   * 任务模式决定「做什么」，决策模式决定「AI 怎么做决定」，两者可自由组合
   * （如「AI 自动 + 写论文」「精细人工 + 写论文」）。
   *
   *   - `manual`（默认）：精细化人工选择 —— 模型选型、假设、论文结构等关键决策
   *     逐项弹 AskUserQuestion 征求用户选择。
   *   - `auto`：AI 自动决策 —— 一次询问完成所有内容，不再打扰人工；兜底由主进程
   *     把 AskUserQuestion 调用挡回去（deny + 「自主选择并继续」指令）。
   *   - `plan`：先规划，不改文件 —— 原「选项」菜单里的 planMode 升格而来。
   *     settings.planMode 保留为它的**投影**（渲染层切换时同步写入，
   *     主进程 interactionMode / buildSystemPrompt 的老读取点不用改）。
   */
  decisionMode?: 'manual' | 'auto' | 'plan';
  /** 选中的论文模板 id */
  paperTemplateId?: string | null;
  /** 个人资料：显示名（本地存储，无账号体系） */
  profileName?: string;
  /** 个人资料：@句柄 */
  profileHandle?: string;
  /**
   * 是否允许系统通知（自动化完成等场景）。
   * **读取点在主进程** `src/main/notify.ts`（`createSystemNotification` 的唯一门禁），
   * 两个通知创建点都经过它；默认 true（遵循项目契约 `settings.notifications ?? true`）。
   */
  notifyEnabled?: boolean;
  /** 附加系统提示词（追加到 Agent 的系统层，本地存储） */
  systemPrompt?: string;
  /**
   * 论文与比赛：**默认**队伍档案的扁平快照（写封面用，本地存储）。
   * 由 `paperDefaultProfileId` 指向的档案同步而来，供 Composer 的「使用队伍档案」直接读取。
   */
  paperTeam?: { school?: string; teamName?: string; members?: string };
  /** 论文与比赛：可复用的队伍档案列表（多档案管理，本地存储） */
  paperProfiles?: PaperTeamProfile[];
  /** 论文与比赛：默认选中的队伍档案 id */
  paperDefaultProfileId?: string | null;
  /** 论文与比赛：新论文默认使用队伍档案 */
  paperProfileEnabled?: boolean;
  /** 论文与比赛：初始化论文项目配置 */
  paperInitProjectConfig?: boolean;
  /** 键盘快捷键覆盖（action → 按键），本地存储 */
  keybindings?: Record<string, string>;
  /**
   * MCP 服务器列表（对应项目契约 settings.mcpServers / /api/mcp）。
   * stdio 型走本机命令（uvx/npx）；http 型直连 URL。
   * 传给 Agent SDK 的 mcpServers 选项。
   */
  mcpServers?: McpServerConfig[];
  /** 用户明确启用的本地 Claude Code 插件目录。 */
  localPlugins?: { path: string; enabled: boolean }[];
  /**
   * 网络代理（对应项目契约 `settings.proxySection`）。
   * 存在这里而不是渲染层 localStorage —— 因为**主进程要用它**：
   * `main/store/config.ts` 每次写入都会同步给 `main/agent/env.ts` 的运行时缓存，
   * 由 `buildChildEnv()` 注入 HTTP_PROXY/HTTPS_PROXY/NO_PROXY。
   */
  proxy?: ProxySettings;
  /**
   * 机器人（飞书 / 微信）。**只存非敏感部分**：
   * App ID、启用开关。App Secret 单独走 `network:set-bot-secret`
   * 用 safeStorage 加密后落在 conf 的 `botSecrets` 里，不回传渲染层。
   */
  bots?: BotSettings;
}

/** MCP 服务器配置（与项目契约条目形状一致） */
export interface McpServerConfig {
  name: string;
  enabled?: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** 是否内置预设（builtin: 前缀的只读项既有语义） */
  builtin?: boolean;
  /** 原生连接器：由 MModels 内置适配器提供，不需要外部 npx/uvx 包。 */
  native?: boolean;
  /** 连接器归类，用于设置页和任务路由。 */
  category?: ConnectorCategory;
  /** 面向用户的名称和用途说明。 */
  displayName?: string;
  description?: string;
  capabilities?: string[];
  /** 只读连接器不会修改远端内容。默认 true。 */
  readOnly?: boolean;
  /** 运行时权限：只读、写入当前项目、外部写入。 */
  permission?: ConnectorPermission;
  /** 为空表示全局；有值时只对指定项目启用。 */
  projectIds?: string[];
}

export type ConnectorCategory =
  | 'literature'
  | 'datasets'
  | 'research'
  | 'files'
  | 'code'
  | 'compute'
  | 'collaboration'
  | 'utility';

export type ConnectorPermission = 'read' | 'project-write' | 'external-write';

export interface ConnectorTestResult {
  ok: boolean;
  name: string;
  displayName?: string;
  detail: string;
  checkedAt: number;
  latencyMs?: number;
}

// ─────────────────────────────────────────────────────────────
// 网络代理（设置 → 网络；对应项目契约 settings.proxySection.*）
// ─────────────────────────────────────────────────────────────

/**
 * 代理来源。
 *  - `system`：读系统代理设置 / PAC（Electron `session.resolveProxy`），
 *     拿不到时回退启动环境里的 `*_proxy`
 *  - `manual`：忽略系统设置，始终用 `manualUrl`
 */
export type ProxyMode = 'system' | 'manual';

export interface ProxySettings {
  /** 是否让 Agent 流量走代理 */
  enabled: boolean;
  mode: ProxyMode;
  /** mode=manual 时的代理地址，如 `http://127.0.0.1:7890` */
  manualUrl: string;
}

/** 一次代理检测的结果（「当前生效」那一行显示的就是它） */
export interface ProxyDetection {
  /** 真正会被注入子进程的代理地址；null = 直连 */
  url: string | null;
  /** 这个地址是哪来的 */
  source: 'manual' | 'system' | 'none';
  /**
   * 地址是 SOCKS 而被忽略。
   * 既有语义：Agent 子进程只支持 HTTP 代理（`proxySection.socksUnsupported`）。
   */
  unsupported: boolean;
  /** 系统代理检测的原始结果（Electron resolveProxy 原文），便于排障 */
  raw?: string;
}

// ─────────────────────────────────────────────────────────────
// 机器人（设置 → 机器人；对应项目契约 integrations.feishuSection / weChatSection）
// ─────────────────────────────────────────────────────────────

export interface BotSettings {
  feishu: {
    enabled: boolean;
    appId: string;
  };
  wechat: {
    enabled: boolean;
  };
}

/** 机器人密钥的配置状态（**只回状态，不回密钥本身**） */
export interface BotSecretStatus {
  /** 是否已经存了一份密钥 */
  configured: boolean;
  /** 存的这份是不是 safeStorage 加密过的（false = 明文回退） */
  encrypted: boolean;
  /** 本机能不能用 safeStorage（false 时新密钥只能明文存） */
  available: boolean;
}

// ─────────────────────────────────────────────────────────────
// 新手教程（设置 → 新手教程；对应项目契约 onboarding.tutorialCenter.items.*）
// ─────────────────────────────────────────────────────────────

/**
 * 教程 id —— 与项目契约「新手教程」页 7 张卡一一对应。
 * 放在 shared 而不是组件里：设置页（发起）、store（传参）、GuidedTour（消费）
 * 三层都要用它，放在组件里会让 store 反向依赖组件。
 */
export type TourId =
  | 'quickStart'
  | 'modes'
  | 'templates'
  | 'gallery'
  | 'skills'
  | 'collaboration'
  | 'paperSharing';

/**
 * 队伍档案（「论文与比赛」页可复用的一套参赛信息）。
 *
 * 对应项目契约 settings 的 teamProfiles：跨比赛复用的学校 / 队员 / 指导老师，
 * 题号、参赛队号、组别这些**每场比赛都不同**的字段不放这里。
 */
export interface PaperTeamProfile {
  id: string;
  /** 档案名称，例如「2026 国赛队」 */
  name: string;
  /** 学校全称 */
  school?: string;
  /** 参赛队员（按顺序） */
  members?: string[];
  /** 指导老师 */
  advisor?: string;
  /** 联系方式（可选） */
  contact?: string;
}

// ─────────────────────────────────────────────────────────────
// 用量统计（全部由本地数据库聚合，不出网）
// ─────────────────────────────────────────────────────────────

/** 一天的活跃度（供热力图） */
export interface UsageDay {
  /** YYYY-MM-DD（本地时区） */
  day: string;
  tokens: number;
  messages: number;
}

export interface UsageStats {
  /** 累计 Token（输入+输出） */
  totalTokens: number;
  /** 提示词总数（role=user 的消息数） */
  promptCount: number;
  /** 会话总数 */
  sessionCount: number;
  /** 活跃天数（有消息的天数） */
  activeDays: number;
  /** 最高活跃日 */
  peakDay: UsageDay | null;
  /** 当前连续天数 */
  currentStreak: number;
  /** 最长连续天数 */
  longestStreak: number;
  /** 热力图数据（最近 300 天，按天） */
  heatmap: UsageDay[];
  /** 最活跃时段（0-23 小时） */
  peakHour: number | null;
  /** 按模型聚合 */
  byModel: { model: string; tokens: number; sessions: number }[];
  /** 按供应商聚合 */
  byProvider: { providerId: string; name: string; tokens: number }[];
  /** 按项目聚合 */
  byProject: { projectId: string; name: string; tokens: number; sessions: number }[];
  /**
   * 按插件（Skill / Agent / 连接器）聚合 —— 对应项目契约「最常用插件」卡。
   * 从本地消息块的 tool_use 统计，不出网。
   */
  byPlugin: { name: string; runs: number; sessions: number }[];
  /** 探索过的 Skills：用过的插件种类数 */
  skillsExplored: number;
  /** 使用过的 Skills 总数：插件调用总次数 */
  skillsUsed: number;
  /** 已安装技能数 */
  skillCount: number;
  enabledSkillCount?: number;
  skillEntryCount?: number;
  skillLoadCount?: number;
  agentRuns?: number;
  connectorRuns?: number;
  bySkill?: { name: string; runs: number; sessions: number }[];
  byAgent?: { name: string; runs: number; sessions: number }[];
  byConnector?: { name: string; runs: number; sessions: number }[];
}

// ─────────────────────────────────────────────────────────────
// 内置 IPC 通道名（单一真相源，main 与 preload 共用）
// ─────────────────────────────────────────────────────────────

export const IPC = {
  SKILL_RUNTIME: 'skill:runtime',
  PLUGIN_ADD: 'plugin:add',
  // 应用
  APP_VERSION: 'app:version',
  APP_QUIT_COMPLETELY: 'app:quit-completely',
  APP_OPEN_PATH: 'app:open-path',
  APP_SHOW_IN_FOLDER: 'app:show-item-in-folder',
  APP_SET_THEME: 'app:set-native-theme',
  APP_SERVER_INFO: 'app:server-info',
  /** keybindings.json 的落盘路径（设置页「键盘快捷键」用；文件不存在时按当前设置生成） */
  APP_KEYBINDINGS_FILE: 'app:keybindings-file',

  // 文件
  FILE_SELECT_DIR: 'file:select-directory',
  FILE_SELECT_FILES: 'file:select-files',
  FILE_SAVE_TEXT: 'file:save-text',
  FILE_SAVE_BINARY: 'file:save-binary',
  /** 打开外部文本文件（对话框选 JSON/文本 → 返回 {path, content}），对应项目契约 openTextFile */
  FILE_OPEN_TEXT: 'file:open-text',
  /** 把一段 HTML 渲染成分享图并保存（隐藏窗口截图），对应项目契约 saveShareImage */
  FILE_SAVE_SHARE_IMAGE: 'file:save-share-image',
  FILE_READ_PREVIEW: 'file:read-preview',
  FILE_PDF_INFO: 'file:pdf-info',
  FILE_TREE: 'file:tree',
  FILE_WRITE: 'file:write',
  FILE_RENAME: 'file:rename',
  FILE_DELETE: 'file:delete',
  FILE_DUPLICATE: 'file:duplicate',

  // 系统通知（对应项目契约 notifications.isSupported / show / onNotificationOpenSession）
  NOTIFY_IS_SUPPORTED: 'notify:is-supported',
  NOTIFY_SHOW: 'notify:show',
  /** main → renderer：用户点了带 sessionId 的通知，要求打开对应会话 */
  NOTIFY_OPEN_SESSION: 'notify:open-session',

  // 项目
  PROJECT_LIST: 'project:list',
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_REMOVE: 'project:remove',
  /** 只改项目显示名（DB 的 projects.name），**不动磁盘目录** */
  PROJECT_RENAME: 'project:rename',
  PROJECT_CURRENT: 'project:current',
  /** 启动时播种的默认项目 id（项目契约通道名 mathmodel:get-default-project-id） */
  PROJECT_DEFAULT_ID: 'project:defaultId',

  // 会话
  SESSION_LIST: 'session:list',
  SESSION_CREATE: 'session:create',
  SESSION_GET: 'session:get',
  SESSION_DELETE: 'session:delete',
  SESSION_RENAME: 'session:rename',
  SESSION_SEND: 'session:send',
  SESSION_ABORT: 'session:abort',
  /** main → renderer 的流式推送 */
  SESSION_STREAM: 'session:stream',
  /** main → renderer：Agent 调 AskUserQuestion 提问，要求宿主弹出确认框 */
  SESSION_ASK_USER: 'session:ask-user',
  /** renderer → main：用户对上面那条提问的作答（answers=null 表示取消） */
  SESSION_ANSWER_USER: 'session:answer-user',
  /**
   * main → renderer：**工具审批**（权限模式 = 需要批准时，canUseTool 拦下工具调用）。
   * 对应项目契约 `approval-request` 流事件（协议实现）。
   */
  SESSION_APPROVAL_ASK: 'session:approval-ask',
  /** renderer → main：用户对上面那条审批的决定（`ApprovalDecision`） */
  SESSION_ANSWER_APPROVAL: 'session:answer-approval',

  // 模型
  LLM_LIST_PROVIDERS: 'llm:list-providers',
  LLM_UPSERT_PROVIDER: 'llm:upsert-provider',
  LLM_DELETE_PROVIDER: 'llm:delete-provider',
  LLM_TEST_PROVIDER: 'llm:test-provider',
  LLM_PRESETS: 'llm:presets',
  LLM_LIST_MODELS: 'llm:list-models',

  // 设置
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_CHANGED: 'settings:changed',

  // 桌面小模
  PET_SHOW_MAIN: 'pet:show-main',
  PET_SET_INTERACTIVE: 'pet:set-interactive',
  PET_DRAG_START: 'pet:drag-start',
  PET_DRAG_MOVE: 'pet:drag-move',
  PET_DRAG_END: 'pet:drag-end',

  // 网络代理与机器人（设置 → 网络 / 机器人）
  /** 读取代理设置（等价于 settings.proxy，单独一条便于语义清晰） */
  NETWORK_GET_PROXY: 'network:get-proxy',
  /** 保存代理设置（主进程会把结果同步给 Agent 子进程环境） */
  NETWORK_SET_PROXY: 'network:set-proxy',
  /** 真实检测一次当前生效代理（Electron session.resolveProxy） */
  NETWORK_DETECT_PROXY: 'network:detect-proxy',
  /** 机器人密钥配置状态（只回状态，不回密钥） */
  NETWORK_BOT_SECRET_STATUS: 'network:bot-secret-status',
  /** 写入机器人密钥（主进程用 safeStorage 加密后落 conf） */
  NETWORK_SET_BOT_SECRET: 'network:set-bot-secret',
  /** 清除机器人密钥 */
  NETWORK_CLEAR_BOT_SECRET: 'network:clear-bot-secret',

  // 连接器诊断
  CONNECTOR_TEST: 'connector:test',

  // 技能
  SKILL_LIST: 'skill:list',
  SKILL_TOGGLE: 'skill:toggle',
  SKILL_READ: 'skill:read',
  SKILL_IMPORT: 'skill:import',
  /** 删除用户技能目录下的技能（内置技能拒绝删除） */
  SKILL_DELETE: 'skill:delete',

  // 终端
  TERM_CREATE: 'term:create',
  TERM_WRITE: 'term:write',
  TERM_RESIZE: 'term:resize',
  TERM_KILL: 'term:kill',
  /** main → renderer 终端输出 */
  TERM_DATA: 'term:data',
  TERM_EXIT: 'term:exit',

  // 自动化
  AUTOMATION_LIST: 'automation:list',
  AUTOMATION_UPSERT: 'automation:upsert',
  AUTOMATION_DELETE: 'automation:delete',
  AUTOMATION_TOGGLE: 'automation:toggle',
  AUTOMATION_RUN_NOW: 'automation:run-now',
  AUTOMATION_RUNS: 'automation:runs',
  /** main → renderer 自动化变更通知 */
  AUTOMATION_CHANGED: 'automation:changed',
  /** 本地用量统计聚合（设置页 · 个人资料） */
  STATS_GET: 'stats:get',

  // 算法市场 + Python 运行时（对应项目契约 /api/algorithms 与 /install-python）
  ALG_LIST: 'algorithms:list',
  ALG_INSTALL: 'algorithms:install',
  ALG_INSTALL_PYTHON: 'algorithms:install-python',
  /** main → renderer：安装日志行（pip 输出 / 下载进度） */
  ALG_INSTALL_PROGRESS: 'algorithms:install-progress',

  // 版本历史（git）
  GIT_INFO: 'git:info',
  GIT_STATUS: 'git:status',
  GIT_DIFF: 'git:diff',
  GIT_VERSIONS: 'git:versions',
  GIT_SAVE_VERSION: 'git:save-version',
  GIT_RESTORE: 'git:restore',
  /** main → renderer 版本/变更变更通知 */
  GIT_CHANGED: 'git:changed',

  // 流程图（draw.io）
  DIAGRAM_LIST: 'diagram:list',

  // 内置浏览器
  BROWSER_CAPTURE: 'browser:capture',
  BROWSER_OPEN_EXTERNAL: 'browser:open-external',
  BROWSER_SET_ZOOM: 'browser:set-zoom',

  // 数据集
  DATASET_LIST: 'dataset:list',
  DATASET_IMPORT: 'dataset:import',

  // 运行环境检查
  ENV_CHECK: 'env:check',

  // 论文模板与比赛信息
  PAPER_TEMPLATES: 'paper:templates',
  PAPER_GET_CONFIG: 'paper:get-config',
  PAPER_SAVE_CONFIG: 'paper:save-config',
  // 受管模板库：读合并列表 + 两条写操作
  // （项目契约 `/api/paper-templates` 的 GET / 、POST /fork 与 DELETE /:id）
  PAPER_TEMPLATE_LIBRARY: 'paper:template-library',
  PAPER_TEMPLATE_FORK: 'paper:template-fork',
  PAPER_TEMPLATE_DELETE: 'paper:template-delete',

  // 局域网协作（**非云端**：房主本机起 HTTP + WS 服务，UDP 广播做附近发现）
  COLLAB_START: 'collab:start',
  COLLAB_STOP: 'collab:stop',
  COLLAB_INFO: 'collab:info',
  COLLAB_JOIN: 'collab:join',
  COLLAB_LEAVE: 'collab:leave',
  COLLAB_APPROVE: 'collab:approve',
  COLLAB_REJECT: 'collab:reject',
  COLLAB_REMOVE: 'collab:remove',
  COLLAB_REFRESH_CODE: 'collab:refresh-code',
  COLLAB_DISCOVER: 'collab:discover',
  /** 房主提交一个 Agent 任务给房间（guest 走 HTTP 转发） */
  COLLAB_TASK_SUBMIT: 'collab:task-submit',
  /** 房主批准 / 拒绝队员提交的 Agent 任务 */
  COLLAB_TASK_DECIDE: 'collab:task-decide',
  /** 房主 Agent 执行完后回写任务状态，让全房间看到进度 */
  COLLAB_TASK_STATUS: 'collab:task-status',
  /** 是否自动批准队员任务 */
  COLLAB_SET_AUTO_APPROVE: 'collab:set-auto-approve',

  // ── 协作 · 项目文件共同编辑（房主权威落盘）──
  /** 房主把一个项目文件加入共享清单 */
  COLLAB_SHARE_FILE: 'collab:share-file',
  /** 读共享文件（相对路径 + 已知版本号 → 内容） */
  COLLAB_FILE_READ: 'collab:file-read',
  /** 写共享文件（相对路径 + 内容 + 基版本号；版本不一致返回冲突） */
  COLLAB_FILE_WRITE: 'collab:file-write',
  /** 冲突处置「另存」：把自己的内容写成副本，不动原文件 */
  COLLAB_FILE_SAVE_COPY: 'collab:file-save-copy',
  /** 房主把共享文件移出清单 */
  COLLAB_UNSHARE_FILE: 'collab:unshare-file',

  /** main → renderer：成员变化 / 待批准 / 任务 / 文件变更 / 房间关闭 */
  COLLAB_EVENT: 'collab:event',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

// ─────────────────────────────────────────────────────────────
// 版本历史（与 src/main/git 对齐）
// ─────────────────────────────────────────────────────────────

export type VersionKind = 'manual' | 'auto' | 'restore' | 'restore-backup';

export interface GitInfo {
  /** 本机是否安装了 git */
  available: boolean;
  /** 当前项目是否是 git 仓库 */
  isRepo: boolean;
}

export interface VersionRecord {
  sha: string;
  name: string;
  kind: VersionKind;
  at: number;
  author: string;
}

export type ChangeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked';

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  from?: string;
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'meta';
  text: string;
}

/**
 * 论文模板类型 —— 这里仅保留当前项目需要的结构结论，避免把整段实现细节塞进源码注释。
 *
 * 这里留存三个局部类型变量 —— 本地化文案对象、字段 id 的
 * 正则约束（小写字母开头 + 字母数字）、`source` 的两值枚举 —— 加一条
 * **跨字段校验**：`source` 为自定义时 `sourcePath` 不许为 `null`。
 *
 * ⚠️ 项目契约**只有那一条**跨字段校验。**不要多写** —— 曾误加过一条针对内置来源的，当前没有。
 *
 * ⚠️ 这是**单一真相源**：主进程写盘（`scan/paper-templates.ts`）、提示词侧
 *    （`agent/prompts.ts` 的 `describeTemplateSource()`）、渲染层弹层都引这一份，
 *    不要各写一遍。
 *
 * ⚠️ **`name` / `label` 落成项目契约那种"本地化对象"**（之前是普通字符串，那处偏离已修）。
 *    读侧必须同时接受 string 与对象（见 `pickLocalizedText`）—— 早期版本写进用户磁盘的
 *    字符串还在，一读就判空会把用户已有的比赛信息搞丢。
 */
export interface PaperLocalizedText {
  'zh-CN': string;
  en: string;
}

/**
 * 读侧兼容取值：磁盘上的文案有两种合法形态
 *   · 项目契约 `Np` 对象 —— `{ 'zh-CN': '国赛 CUMCM', en: 'CUMCM' }`
 *   · 本项目早期版本写下的**普通字符串** —— `'国赛 CUMCM'`
 * 取不到就返回空串，由调用方决定兜底（不要在这里编造内容）。
 */
export function pickLocalizedText(v: unknown, lang = 'zh-CN'): string {
  if (typeof v === 'string') return v;
  if (!v || typeof v !== 'object') return '';
  const o = v as Record<string, unknown>;
  // 顺序：精确语言 → 基名（zh / en）→ 中文 → 英文。
  // 让「英文界面读只带 zh-CN 的对象」也能拿到中文，而不是显示空白。
  for (const k of [lang, lang.split('-')[0], 'zh-CN', 'en']) {
    const hit = o[k];
    if (typeof hit === 'string' && hit) return hit;
  }
  const first = Object.values(o).find((x): x is string => typeof x === 'string' && !!x);
  return first ?? '';
}

/**
 * 写侧构造：**一律落成项目契约 `Np` 对象，且两个键都非空**（项目契约 `min(1)`）。
 *
 * `en` 缺省时用中文原文兜底 —— 宁可重复，也不能写出一个项目契约 schema 读不回来的对象。
 * （内置模板的 `en` 取自 `template.json` 的 `name.en` / `fields[].label.en`；
 *   用户手填的自定义字段只有中文，走兜底，这是**有意**的。）
 */
export function makeLocalizedText(zh: string, en?: string | null): PaperLocalizedText {
  const zhText = (zh ?? '').trim();
  const enText = (en ?? '').trim();
  const finalZh = zhText || enText || '未命名';
  return { 'zh-CN': finalZh, en: enText || finalZh };
}

export interface PaperTemplateRef {
  /** 模板目录名（内置 = `assets/template/<id>/` 的目录名）。项目契约 schema：`z.string()` */
  id: string;
  /** 模板显示名（内置取自 template.json 的 name / name.en）。项目契约 `Np`：两键必填非空 */
  name: PaperLocalizedText;
  /** 论文入口文件（内置取自 template.json 的 entryFile，如 document.tex） */
  entryFile: string;
  source: 'builtin' | 'custom';
  /** source=custom 时的模板源绝对路径；builtin 必须为 null（项目契约 default(null)） */
  sourcePath: string | null;
}

/**
 * 比赛字段 —— 项目契约 `contestFields: z.array(z.object({ id, label, value }))`，
 * 其中 `id: Gk = z.string().min(1).max(64).regex(/^[a-z][A-Za-z0-9]*$/)`。
 *
 * ⚠️ 是**数组**而不是 map：这正是「自定义字段」能存在的原因 ——
 *    用户新增一个字段就是往数组里追加一项（`label` 由用户填，`id` 由本地生成），
 *    不需要先改模板元数据。
 *
 * ⚠️ `id` 必须满足 `^[a-z][A-Za-z0-9]*$` —— **不能带下划线**。
 *    渲染层生成自定义 id 时按这条来（见 `Composer.tsx` 的 `CUSTOM_FIELD_PREFIX`）。
 */
export interface PaperContestField {
  id: string;
  /**
   * 字段显示名。项目契约 `Np` 本地化对象，两键必填非空。
   *
   * 用户**自己加**的字段只有中文名 —— 写盘时 `en` 用中文原文兜底（见 `makeLocalizedText`），
   * 而不是编造一个翻译。
   */
  label: PaperLocalizedText;
  value: string;
}

/** 写进项目配置的队伍档案快照（项目契约 `teamProfile`） */
export interface PaperTeamProfileSnapshot {
  id: string;
  name: string;
  school?: string;
  members?: string[];
  advisor?: string;
  phone?: string;
  email?: string;
}

/**
 * 当前比赛的页数规则。
 *
 * 比赛规则会随年份变化，因此这里只保存用户按当届通知确认过的数字与计页口径，
 * 不把某个年份的上限永久写死在模板里。正文起止页均指最终 PDF 的物理页码。
 */
export interface PaperPageLimit {
  /** 允许的最大页数 */
  maxPages: number;
  /** `body` 只计算正文；`total` 计算整份 PDF */
  scope: 'body' | 'total';
  /** 正文在最终 PDF 中的起始页；留空时由检查脚本识别 */
  startPage?: number;
  /** 正文在最终 PDF 中的结束页；留空时由检查脚本识别 */
  endPage?: number;
}

/**
 * 比赛信息（存 `<项目>/.mathmodel/paper/config.json`，同一项目内的所有对话共享）。
 *
 * 配置结构由 MModels 自己维护：版本号、管理标记、模板引用、比赛字段和队伍信息。
 * 项目配置统一写入 `.mathmodel/paper/config.json`；旧目录只在迁移工具中识别，不作为新项目格式。
 */
export interface PaperConfig {
  schemaVersion: 1;
  managedBy: 'mathmodel';
  template: PaperTemplateRef;
  contestFields: PaperContestField[];
  teamProfile: PaperTeamProfileSnapshot | null;
  /** 本届比赛的页数规则；未确认时为 null，禁止由模型自行猜测 */
  pageLimit: PaperPageLimit | null;
}

/**
 * `paper:save-config` 的入参：**部分更新**，只带本次要改的键。
 * 未带的键由主进程从磁盘原样保留（含用户手写进配置里的额外字段）。
 */
export interface PaperConfigPatch {
  template?: PaperTemplateRef;
  contestFields?: PaperContestField[];
  teamProfile?: PaperTeamProfileSnapshot | null;
  pageLimit?: PaperPageLimit | null;
}

/** `paper:save-config` 的返回 */
export interface PaperSaveResult {
  ok: boolean;
  reason?: 'no-project' | 'unsafe-path' | 'custom-needs-sourcePath' | string;
  path?: string;
}

/** `paper:get-config` 的返回 */
export interface PaperGetConfigResult {
  config: PaperConfig | null;
  path: string | null;
}

/** `paper:templates` 的返回（`PaperTemplate` 的定义在本文件下方） */
export interface PaperTemplatesResult {
  available: boolean;
  dir: string;
  templates: PaperTemplate[];
}

/**
 * `paper:template-library` 的返回 —— **受管模板库**（内置 + 「我的模板」合并）。
 *
 * ⚠️ 为什么和 `paper:templates` 分开两条通道，而不是把合并结果塞进同一条：
 *   `paper:templates` 的消费方是**输入区的比赛模板选择器**（`Composer.tsx`），
 *   它整段渲染在一个 `builtinTemplatesGroup` 标签下，且**选中时写死
 *   `source: 'builtin'`**。把自定义模板混进去，用户在那儿点一条 fork 出来的模板
 *   就会被记成"内置模板"（`sourcePath` 也被清空）—— 那是把一条真实可用的模板
 *   写坏。项目契约中的 Composer 是按 source 分两组渲染的（`builtinTemplatesGroup` /
 *   `customTemplatesGroup`），当前实现的 Composer 侧还没做这个分组，
 *   所以**先不往那条通道里混**：合并列表只喂给扩展页。
 */
export interface PaperTemplateLibraryResult {
  /**
   * 受管自定义模板库根目录（项目契约 `customTemplatesRoot`）。
   *
   * 这是**受管库**（fork 出来的模板存这儿），与设置页那个「指一个本地目录当模板源」
   * 的增强入口（写进项目 `.mathmodel/paper/config.json` 的 `sourcePath`）**不是一回事**，
   * 两者并存、互不替换。
   */
  customRoot: string;
  /** 内置 + 自定义合并（按 order 升序；自定义 order=1000 排在内置之后） */
  templates: PaperTemplate[];
}

/**
 * 模板库写操作的**错误码** —— 来源于项目资料。
 *
 * 实证（`.baseline/app/out/main/index.js` 的 `PaperTemplateService`）：
 *   · `delete()`：找不到 → `template_not_found`；`source !== 'custom'` →
 *     **`builtin_template_readonly`**；没有自定义库 → `custom_template_library_unavailable`；
 *     删不动 → `delete_failed`。
 *   · `fork()`：没有自定义库 → `custom_template_library_unavailable`；
 *     找不到来源 → `template_not_found`；来源含符号链接 → `unsafe_template`；
 *     名字空或长度 > 80 → `invalid_template_name`。
 *
 * ⚠️ 判据硬约束（BACKLOG §3-3 的风险段）：**内置模板的"删除"必须是"拒绝"**，
 *    而且这道闸要落在**主进程**（通道可达），不是"UI 上不渲染按钮"。
 */
export type PaperTemplateErrorCode =
  | 'template_not_found'
  | 'builtin_template_readonly'
  | 'delete_failed'
  | 'custom_template_library_unavailable'
  | 'invalid_template_name'
  | 'unsafe_template';

/** 错误对象：`code` 给渲染层映射文案，`status` 遵循项目契约 HTTP 状态码（取证/日志用） */
export interface PaperTemplateError {
  code: PaperTemplateErrorCode;
  status: number;
}

/** `paper:template-delete` 的返回 */
export type PaperTemplateDeleteResult =
  | { ok: true; id: string }
  | { ok: false; error: PaperTemplateError };

/** `paper:template-fork` 的返回 */
export type PaperTemplateForkResult =
  | { ok: true; template: PaperTemplate }
  | { ok: false; error: PaperTemplateError };

/**
 * 字段的一个可选项 —— 模板元数据 `fields[].options[]`。
 *
 * 实证（`assets/template/changsanjiao/template.json` 的「赛道」字段）：
 * ```json
 * "options": [
 *   { "value": "本科生", "label": { "zh-CN": "本科生", "en": "Undergraduate" } },
 *   { "value": "研究生", "label": { "zh-CN": "研究生", "en": "Graduate" } }
 * ]
 * ```
 */
export interface PaperTemplateOption {
  /** 落进 `contestFields[].value` 的字面值 */
  value: string;
  /** 下拉里显示的名字（项目契约 `Np`） */
  label: PaperLocalizedText;
}

/** 论文模板（元数据来自模板目录里的 template.json） */
export interface PaperTemplateField {
  id: string;
  /** 中文标签（template.json 的 `fields[].label`，读侧按 zh-CN 解析后的字符串） */
  label: string;
  /**
   * 英文标签（template.json 的 `fields[].label.en`）。
   *
   * 写 `contestFields` 时要落成项目契约 `Np` 对象，`en` 就取这里 ——
   * 与 `PaperTemplate.name` / `nameEn` 是同一套「已解析主语言 + 英文另存」的约定。
   * 内置模板的 `template.json` 本来就是 `Np`（如 cumcm 的 `{ "zh-CN":"题号", "en":"Problem" }`）。
   */
  labelEn?: string;
  placeholder?: string;
  required?: boolean;
  /**
   * 可选项 —— 有它就渲染**下拉框**，没有才是文本框。
   *
   * 项目契约就是这条判据（`pe.options.length > 0 ? <Select> : <Input>`）；
   * 长三角 / 东三省 / 五一杯三个内置模板的「赛道 / 参赛组别」字段本来就带 `options`。
   *
   * ⚠️ **没有可选项时是 `undefined`，不是 `[]`** —— 渲染层只判一次 `?.length`，
   *    不用区分「没这个键」与「空数组」两种空。
   */
  options?: PaperTemplateOption[];
}

export interface PaperTemplate {
  id: string;
  name: string;
  /** 英文名（template.json 的 name.en；英文界面显示用） */
  nameEn?: string;
  /** 英文描述（template.json 的 description.en） */
  descriptionEn?: string;
  description: string;
  language: string;
  entryFile: string;
  order: number;
  /**
   * 这个模板是哪些语言的**默认项**（如 `cumcm` → `['zh-CN']`、`mcm` → `['en']`）。
   * 项目契约靠它决定首屏默认选中哪个比赛；空数组表示不是任何语言的默认。
   */
  defaultFor: string[];
  fields: PaperTemplateField[];
  profileFields: string[];
  dir: string;
  /**
   * 模板来源 —— 项目契约详情行渲染的是
   * `{来源} · {source === 'custom' ? customSource : 'write-paper'}`（install asar 实证）。
   * 内置模板恒为 `'builtin'`；「自定义模板库」里的模板为 `'custom'`。
   */
  source: 'builtin' | 'custom';
}

export interface FileDiff {
  path: string;
  status: ChangeStatus;
  lines: DiffLine[];
  truncated?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 局域网协作（与 src/main/collab/server.ts 对齐）
//
// ⚠️ 这是**局域网**协作，不经任何云端：房主在自己机器上起一个 HTTP + WebSocket
// 服务，队友在同一网段内通过「房主地址 + 6 位加入码」接入；附近房间靠 UDP 广播发现。
// 所有协作方必须跑同一份协议版本，版本不一致按既有语义提示「房主版本过旧」。
// ─────────────────────────────────────────────────────────────

/**
 * 房间里的角色 —— 对应项目契约 `roles.owner / editor / viewer`。
 *
 * ℹ️ 协议版本、加入码有效期、UDP 发现端口这些**运行时**常量由
 *    `src/main/collab/server.ts` 独占持有（那边要能脱离 electron 直接跑联调脚本，
 *    而本文件不能带运行时依赖）。这里只放类型契约。
 */
export type CollabRole = 'owner' | 'editor' | 'viewer';

export interface CollabMember {
  id: string;
  name: string;
  role: CollabRole;
  /** 心跳超时后置为离线（项目契约 `offlineSuffix` 的「（离线）」） */
  online: boolean;
  /** 是不是本机这位用户 */
  self: boolean;
  joinedAt: number;
}

export interface CollabPendingRequest {
  id: string;
  name: string;
  at: number;
}

/** 加入失败语义 —— 每个值对应一个 `dock.collabPanel.join*` 文案键 */
export type CollabJoinError =
  | 'joinFailed'
  | 'joinInvalidCode'
  | 'joinRoomClosed'
  | 'joinRejected'
  | 'joinSameAccountNotAllowed'
  | 'joinIncompatibleRoom'
  | 'joinMembershipRequired';

export type CollabTaskStatus = 'pending' | 'queued' | 'running' | 'done' | 'failed' | 'rejected';

export interface CollabSharedTask {
  id: string;
  /** 提交者显示名 */
  from: string;
  /** 是不是本机提交的（决定要不要显示批准按钮） */
  mine: boolean;
  title: string;
  prompt: string;
  status: CollabTaskStatus;
  at: number;
}

export interface CollabRoomInfo {
  /** 房间是否在运行中（渲染层拿不到房间时主进程返回 null，此字段用于事件推送） */
  active: boolean;
  /** 本机在房间里的身份 */
  self: 'host' | 'guest';
  /** 房主显示名 */
  roomName: string;
  /** 房间绑定的项目（项目契约：协作以项目为单位） */
  projectId: string;
  projectName: string;
  /** host 侧是本机地址，guest 侧是房主地址，形如 `192.168.1.5:47820` */
  address: string;
  /** 加入码 —— **只有房主**拿得到（队友靠口头/群聊传递） */
  code?: string;
  codeExpiresAt?: number;
  members: CollabMember[];
  pending: CollabPendingRequest[];
  tasks: CollabSharedTask[];
  /** 房间共享的项目文件（只带元数据，内容按需读） */
  sharedFiles: CollabSharedFile[];
  autoApproveTasks: boolean;
}

/**
 * 共享文件 —— 协作编辑的基本单位。
 * `version` 是**房主**维护的单调递增版本号，写入时作为「基版本」比对：
 * 不一致说明别人已经改过，写入会被拒并要求「覆盖 / 放弃 / 另存」。
 */
export interface CollabSharedFile {
  /** 项目内相对路径（正斜杠） */
  path: string;
  version: number;
  /** 最后一次改动者显示名 */
  by: string;
  updatedAt: number;
}

/** 共享文件操作的失败语义 */
export type CollabFileError =
  /** 查看者（只读）不能写 */
  | 'fileReadOnly'
  /** 基版本过期：别人已经改过 */
  | 'fileConflict'
  /** 文件太大 / 二进制 / 路径越界 / 读不到 */
  | 'fileFailed'
  /** 这个文件没被共享过 */
  | 'fileNotShared';

export interface CollabFileResult {
  ok: boolean;
  error?: CollabFileError;
  path: string;
  /** 读：当前版本号；写：新版本号；冲突：磁盘上的版本号 */
  version: number;
  /** 读/写成功是文件内容；冲突时是磁盘上的最新内容（供界面处置冲突） */
  content: string;
  /** 冲突时磁盘上的版本号（= 用「覆盖」时要带的基版本） */
  diskVersion?: number;
  /** 「另存」成功后新文件的项目内相对路径 */
  savedAs?: string;
}

export interface CollabNearbyRoom {
  /** 房主显示名 */
  name: string;
  address: string;
  projectName: string;
}

export interface CollabDiscoverResult {
  /** 本机能不能做 UDP 广播发现（校园网/公司网被拦时也可能拿到空列表） */
  available: boolean;
  rooms: CollabNearbyRoom[];
}

export interface CollabJoinResult {
  ok: boolean;
  error?: CollabJoinError;
  /** true = 已送达房主，等待批准（项目契约 `waitingApproval`） */
  pending?: boolean;
  room?: CollabRoomInfo;
}

/** main → renderer 的协作事件 */
export type CollabEvent =
  /** 成员/待批准/任务/共享清单任一变化后的整房间快照 */
  | { type: 'room'; room: CollabRoomInfo }
  /** 某个共享文件被改动（房主落盘后广播给所有人，含改动时的新版本与全文） */
  | { type: 'file'; path: string; version: number; content: string; by: string }
  /** 房间关闭（房主结束协作 / 网络断开） */
  | { type: 'closed'; error?: CollabJoinError }
  /** 房主拒绝了这次加入请求 */
  | { type: 'rejected' }
  /** 操作失败（按文案键给渲染层） */
  | { type: 'error'; error: CollabJoinError };
