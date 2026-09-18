/**
 * 会话 IPC —— 驱动 agent 的核心通道。
 *
 * 数据流：
 *   渲染层 session.send(sessionId, text)
 *     → 主进程落库（user 消息）
 *     → 取 AgentSession runner
 *     → runner 发 StreamEvent
 *     → 这里转发到渲染层（SESSION_STREAM）
 *     → 结束后把 assistant 消息落库
 *
 * ⚠️ 为什么先落库再跑：
 *   如果 agent 崩了/用户关了窗口，至少用户发过的话还在。
 *   反过来（跑完再落库）会丢消息。
 */
import { ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  IPC,
  type ApprovalDecision,
  type ApprovalRequest,
  type AskUserRequest,
  type ChatMessage,
  type InflightTurn,
  type SessionMeta,
  type StreamEvent,
  type ContentBlock,
} from '@shared/types';
import { getDb } from '../db';
import {
  clearSpill,
  inflightOf,
  shouldFlushSpill,
  writeSpill,
} from '../db/turn-spills';
import { getSettings, findProvider, activeProvider } from '../store/config';
import { SessionRegistry } from '../agent/session';
import { bridgeRegistry } from '../agent/bridge-registry';
import { PROJECT_INSTRUCTIONS, detectSlashCommand } from '../agent/prompts';
import { initPaperProjectConfig, listPaperTemplates, paperConfigPath } from '../scan/paper-templates';
import { safeWrap, pushToRenderer, type IpcContext } from './index';
import { applyStreamEvent } from './stream-blocks';
import { currentProjectRoot } from './file';
import { saveVersion } from '../git';
import { resolveResourcesRoot } from '../resources';

/** 全局会话注册表（整个应用一份） */
export const sessionRegistry = new SessionRegistry();

interface SessionRow {
  id: string;
  project_id: string;
  title: string;
  provider_id: string;
  model: string;
  status: string;
  sdk_session_id: string | null;
  created_at: number;
  updated_at: number;
  message_count: number;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  error: string | null;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  blocks: string;
  model: string | null;
  created_at: number;
  input_tokens: number;
  output_tokens: number;
  /** 这条消息发出**之前**的工作区快照 ref（只有 user 行有值，见 captureCheckpoint） */
  checkpoint_ref: string | null;
  /** agent 侧的消息 id（只有 assistant 行有值），分叉的 resumable 判据要用 */
  agent_msg_uuid: string | null;
}

function rowToSession(r: SessionRow): SessionMeta {
  return {
    id: r.id,
    title: r.title,
    projectId: r.project_id,
    providerId: r.provider_id,
    model: r.model,
    status: r.status as SessionMeta['status'],
    sdkSessionId: r.sdk_session_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    totalUsage: {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      reasoningTokens: r.reasoning_tokens || undefined,
    },
    error: r.error ?? undefined,
  };
}

function rowToMessage(r: MessageRow): ChatMessage {
  let blocks: ContentBlock[] = [];
  try {
    blocks = JSON.parse(r.blocks) as ContentBlock[];
  } catch {
    blocks = [{ kind: 'text', text: r.blocks }];
  }
  return {
    id: r.id,
    role: r.role as ChatMessage['role'],
    blocks,
    createdAt: r.created_at,
    model: r.model ?? undefined,
    usage: {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────

function listSessions(projectId: string): SessionMeta[] {
  const rows = getDb()
    .prepare<[string], SessionRow>(
      'SELECT * FROM sessions WHERE project_id = ? ORDER BY updated_at DESC',
    )
    .all(projectId);
  return rows.map(rowToSession);
}

function getSession(id: string): SessionMeta | null {
  const row = getDb().prepare<[string], SessionRow>('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? rowToSession(row) : null;
}

function getMessages(sessionId: string): ChatMessage[] {
  const rows = getDb()
    .prepare<[string], MessageRow>(
      'SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC',
    )
    .all(sessionId);
  return rows.map(rowToMessage);
}

function createSession(projectId: string, title: string): SessionMeta {
  const now = Date.now();
  const meta: SessionMeta = {
    id: randomUUID(),
    title: title || '新会话',
    projectId,
    providerId: getSettings().activeProviderId ?? '',
    model: getSettings().defaultModel ?? '',
    status: 'idle',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
  getDb()
    .prepare(
      `INSERT INTO sessions (id, project_id, title, provider_id, model, status, created_at, updated_at, message_count)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(meta.id, projectId, meta.title, meta.providerId, meta.model, 'idle', now, now, 0);
  sessionRegistry.setMeta(meta);
  return meta;
}

/**
 * 发消息前给工作区打一个快照，返回 ref（P0；供 P6 回退用）。
 *
 * ⚠️ **工作区干净时 `saveVersion` 返回 `{committed:false}` 且没有 sha，这时必须记 `null`。**
 *    不能退而求其次去用"上一个版本" —— 回退的语义是"回到**这条消息之前**"，
 *    拿一个更早的快照会让恢复出来的工作区比用户预期的**还要早一步**，
 *    属于静默的错误结果，比"不能回退"更糟。
 *
 * 快照失败一律**不阻断会话**：记不上 ref 最多是这条消息不能回退，
 * 不该让用户发不出消息。
 */
async function captureCheckpoint(cwd: string): Promise<string | null> {
  try {
    const r = await saveVersion(cwd, '发消息前自动快照', 'auto');
    return r.committed && r.sha ? r.sha : null;
  } catch (err) {
    console.warn('[checkpoint] 快照失败，本条消息不可回退：', err);
    return null;
  }
}

/** 落库一条消息，并维护会话的消息计数与更新时间 */
function insertMessage(
  sessionId: string,
  msg: ChatMessage,
  extra?: { checkpointRef?: string | null; agentMsgUuid?: string | null },
): void {
  getDb()
    .prepare(
      `INSERT INTO messages (id, session_id, role, blocks, model, created_at, input_tokens, output_tokens,
                             checkpoint_ref, agent_msg_uuid)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      msg.id,
      sessionId,
      msg.role,
      JSON.stringify(msg.blocks),
      msg.model ?? null,
      msg.createdAt,
      msg.usage?.inputTokens ?? 0,
      msg.usage?.outputTokens ?? 0,
      extra?.checkpointRef ?? null,
      extra?.agentMsgUuid ?? null,
    );
  getDb()
    .prepare('UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?')
    .run(Date.now(), sessionId);
}

// ─────────────────────────────────────────────────────────────
// 运行一轮
// ─────────────────────────────────────────────────────────────

/** 生成任务开始前，把 SDK 需要的环境准备好 */
async function buildRunOptions(sessionId: string, prompt: string, cwd: string) {
  const s = getSession(sessionId);
  if (!s) throw new Error('会话不存在');

  const provider = (s.providerId ? findProvider(s.providerId) : null) ?? activeProvider();
  if (!provider) {
    throw new Error(
      '尚未配置任何模型供应商。请到「设置 → 模型供应商」添加一个（内置了 MiniMax / DeepSeek / 智谱 / 通义等预设）。',
    );
  }
  const model = s.model || getSettings().defaultModel || provider.models?.[0] || '';
  if (!model) {
    throw new Error('尚未指定模型。请在设置中选择默认模型，或在该供应商下填写模型名。');
  }

  const settings = getSettings();
  const bridgeBaseUrl = await bridgeRegistry.ensureFor(provider);

  // 项目根写入原版的 AGENTS.md 工作约定（不覆盖已有内容）
  ensureProjectInstructions(cwd);
  // 论文任务：按设置自动初始化项目论文配置（`.mathmodel/paper/config.json`）
  ensurePaperProjectConfig(cwd, prompt);

  return {
    sessionId,
    prompt,
    provider,
    model,
    cwd,
    session: s,
    builtinMcpEnabled: settings.builtinMcpEnabled,
    effort: settings.effort ?? undefined,
    disableThinking: settings.disableThinking,
    fastMode:
      settings.fastMode === true &&
      (provider.fastModeModels ?? []).some((candidate) => candidate.trim() === model),
    resumeSessionId: s.sdkSessionId,
    bridgeBaseUrl: bridgeBaseUrl ?? undefined,
    systemPrompt: buildSystemPrompt(cwd, settings.planMode === true),
    multiAgentEnabled: settings.multiAgentEnabled !== false && settings.planMode !== true,
    /**
     * 权限模式（复刻口径 `'full' | 'approval'`）—— **原样透传，不在这里改名**。
     * 换算成原版口径 / SDK 口径的那一步只在 `agent/permissions.ts` 里做一次。
     *
     * 这一行就是"输入区那个选择器"与"实际行为"之间**唯一**的连接点：
     * 在此之前 `settings.permissionMode` 没有任何主进程读取点，
     * 所以切过去不影响任何行为（`capability-diff.md §4.1` 记的最危险一条）。
     */
    permissionMode: settings.permissionMode,
    interactionMode: settings.planMode === true ? 'plan' : 'default',
  };
}

/**
 * 组装系统提示词 —— 逐字还原原版。
 *
 * 原版并没有一个「人格设定」式的长 system prompt；它靠三件事给模型定调：
 *  1. 项目根写入 `AGENTS.md` / `CLAUDE.md`（PROJECT_INSTRUCTIONS），SDK 自动读入
 *  2. 每条用户消息由 `composePrompt()` 按任务类型预置起始指令
 *  3. 技能（SKILL.md）通过 plugins 挂载 —— 由 `agent/skills-plugin.ts` 物化成
 *     完整插件目录后挂载，斜杠命令（/mma-paper 等）因此才会被注册
 *
 * 因此这里只注入**工作目录**与**项目配置文件路径**这类机器事实，
 * 不自创「你是某某助手」的措辞 —— 那是原版没有的东西。
 *
 * ⚠️ 唯一一处**有意偏离原版**的追加：末尾的「交流语言与过程解说」「提问与继续执行」
 *    「长时任务：不要交还回合去等通知」三节。
 *    依据是用户实机反馈（2026-09-17）：
 *      1. agent 的过程解说全英文（"I'll start by reading the project config…"），中文用户读不懂；
 *      2. 用户答完 AskUserQuestion 后，agent 又反问「需要我用这两项设定开始建模和撰写论文吗?」，
 *         用户原话「我已经选择完之后，你应该是立刻运行，而不是让我确认了」。
 *    这不是人格设定，是**输出约定**，放在这里而不是 `agent/prompts.ts`，
 *    是为了不破坏那个文件「逐字取自原版」的保真语义。
 *
 *    第三节最初用于规避单轮 query 提前关闭 stdin；常驻 SessionInputQueue 修复后，
 *    SDK 的后台完成通知已经能继续同一次运行。现在该节改为要求等待真实结果并自行汇总。
 */
export function buildSystemPrompt(cwd: string, planOnly = false): string {
  const lines = [
    `当前项目根目录：${cwd}`,
    '论文模板与比赛字段配置位于 `.mathmodel/paper/config.json`（早期版本可能写在 `.mmodels/paper/config.json`，两者等价，都读得到）。',
    // 技能已由插件机制注册成斜杠命令（命令描述自带说明），这里只作一句提示，
    // 不复述技能目录路径 —— 否则 agent 会再去把每个 SKILL.md 读一遍，纯属浪费。
    '技能已挂载为插件，可直接用斜杠命令调用（/mma-paper、/mma-review、/mma-figure 等）；' +
      '仅当需要查看某个技能的完整说明时，才读取它自己的 SKILL.md。',

    // ── 本地版要求（用户实机反馈，非原版内容）────────────────────
    // 原版是英文开发者的产品，模型默认用英文解说；中文用户明确要求「全中文 + 讲人话」。
    // 另：AskUserQuestion 答完又反问「需要我继续吗」——用户点名要求去掉这道二次确认。
    '',
    '# 交流语言与过程解说（本地版要求）',
    '- 用户是中文用户：**所有面向用户的文字一律用简体中文**，包括且不限于：',
    '  过程解说、阶段小结、结论、待办、报错说明，**以及你的思考过程（thinking / 思考过程）** ——',
    '  思考过程在界面上是可展开给用户看的，用英文写等于让用户读不懂你在想什么。',
    '  代码、命令、路径、标识符、库名保持原文，不翻译。',
    '- 调用工具时，`description`、`summary`、`reason`、计划标题等会显示给用户的说明字段也必须用简体中文；',
    '  不得把英文旁白藏进工具参数。命令、路径和代码本身仍保持原文。',
    '- 过程解说用「跟同事汇报」的口吻，**不要罗列工具调用流水账**：',
    '  不要写 `Bash: python problem1.py`、不要贴大段命令/日志/报错栈、不要逐条念你调了哪些工具。',
    '  要讲人话：我在做什么、为什么这么做、看到了什么、下一步打算怎么办。',
    '- 中间过程只在有实质进展时更新，连续的命令、读取和检查合并成一句；不要一个工具调用发一条说明。',
    '- 默认隐藏 PATH、MSI、退出码、下载速度、参数和调用栈等技术细节；用户主动排查时再给关键详情。',
    '- 每个阶段结束给一句小结；可以带点口语和轻微的风味（"这里翻车了""换个思路"），',
    '  但**不要卖萌、不要油腔滑调、不要堆 emoji**。',
    '- 下载超时、网络波动、某条命令没走通等可恢复问题，不称为“错误”：直接说“正在重试”或“正在换一种办法”；',
    '  只有确定是软件自身故障时才明确提示错误。原始 stderr 与调用栈默认不展示。',
    '- 交付报告类内容（阶段结论、评审意见、数据说明）同理用中文；**只有论文正文、代码与图注按比赛要求用其规定语言**。',
    '',
    '# 提问与继续执行',
    '- 用 AskUserQuestion 提问后，**拿到用户答案就直接继续执行**，不要再用文字复述一遍问题、',
    '  更不要问"需要我继续吗/现在开始吗"这类二次确认。',
    '- 只有两种情况允许再发问：(a) 出现了原问题之外的新歧义；(b) 用户明确要求每步都确认。',
    '- 若流程里有 plan 环节，把 plan 一次性说清并紧接着开始执行，不要让用户再点头一次。',
    '- **收尾不要用问句结束**：做完事情就说清「做完了什么、结论是什么、还剩什么」，',
    '  需要用户决策时给出**具体选项与你的建议**，不要用"需要我继续吗/还需要我做什么吗"收尾。',
    '- **产出成品时必须明确报出它在哪**：编译出 PDF / 生成报告 / 导出文件之后，',
    '  **主动用一句中文说清「文件路径 + 体量（页数或大小）+ 里面有什么」**，',
    '  例如"论文已编译完成：`document.pdf`，52 页 10.0 MB，含五问正文、37 张图、14 条参考文献"。',
    '  **不要产出完却一声不吭** —— 用户看不到磁盘，只知道界面上有没有人跟他说话。',
    '- 若中途发现时间/轮次可能不够：**先保证能编译出「结构完整的成品」再打磨细节**，',
    '  并在小结里说明「哪些部分已完整、哪些还是骨架」，不要把话说到一半就停。',
    ...(planOnly
      ? [
          '',
          '# 当前工作方式：先规划',
          '- 这一次只分析问题并给出可执行方案，不修改文件、不运行会改变项目的命令。',
          '- 方案要说明目标、关键步骤、需要用户决定的地方和预计产物；完成方案后结束本轮。',
        ]
      : []),

    ...(!planOnly && getSettings().multiAgentEnabled !== false
      ? [
          '',
          '# 数学建模协作组',
          '- 面对含两个以上可独立核对部分的复杂任务，可以调用 Agent 工具，让题意分析、数据分析、建模求解、论文核验子智能体并行工作。',
          '- 一次最多并行 3 个，只派发边界清楚、能独立返回证据的任务；简单问答和单文件小改动不要调用子智能体。',
          '- 子智能体只负责分析与核验，正式代码、图表和论文文件由主智能体统一写入，避免并行覆盖。',
          '- 子智能体结论不能直接照抄：主智能体必须检查冲突、复算关键结果，再形成最终结论。',
          '- 多步骤工作先用 TaskCreate/TaskUpdate 或 TodoWrite 建立当前任务清单；新需求到来时建立新一批，新增任务及时加入，取消的任务及时删除。',
        ]
      : []),

    // ── 长时任务：不要交还回合去等通知（用户实机反馈，非原版内容）────
    // 实测两次：模型在后台下载 28/77、抓取 45/77 时交还回合，明确写着
    // 「它跑完会自动通知我接着做」，结果后台任务随进程一起被收掉，用户只能自己敲「继续」。
    // 常驻 SessionInputQueue 已接通 SDK 自动续跑；这里约束模型不要提前下最终结论。
    '',
    '# 长时任务与后台协作',
    '- SDK 会在后台命令或子智能体完成后继续当前运行；只要还有后台任务，就不要提前给出最终结论。',
    '- 等全部结果回来后再汇总、核验并完成当前任务，不要让用户额外回复“继续”。',
    '- 必须等待用户提供新信息时才停下来，并清楚说明缺少什么；不要假装仍在后台工作。',
  ];
  // 用户在「设置 → 系统提示词」里写的附加指令（本地存储，原版同位置功能）
  const custom = getSettings().systemPrompt?.trim();
  if (custom) lines.push('【用户附加指令】', custom);
  return lines.join('\n');
}

/**
 * 确保项目根存在 `AGENTS.md`（内容取原版 PROJECT_INSTRUCTIONS）。
 * 已存在则不覆盖 —— 原版明确要求「不覆盖已有论文或项目配置」。
 */
function ensureProjectInstructions(cwd: string): void {
  const target = join(cwd, 'AGENTS.md');
  if (existsSync(target)) return;
  try {
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true });
    writeFileSync(target, PROJECT_INSTRUCTIONS + '\n', 'utf8');
  } catch {
    /* 写不进去就跳过，不阻断会话 */
  }
}

/** 随包资源目录（打包后是 process.resourcesPath，开发期是 <appPath>/resources） */
function resourcesDir(): string {
  return resolveResourcesRoot(
    ['builtin-skills', 'mma-paper', 'assets', 'template'],
    '论文模板',
  );
}

/**
 * 「初始化论文项目配置」（设置 → 论文与比赛，对应原版 `writeProjectConfig` 的全局版）。
 *
 * ⚠️ 修复的是一个**死开关**：`paperInitProjectConfig` 之前只有默认值、类型和界面开关，
 *    全仓没有任何地方消费它 —— 用户点了「初始化论文项目配置」，项目里不会出现
 *    `.mathmodel/paper/config.json`，于是 agent 读不到比赛字段、模板来源，也就没有
 *    可填的 LaTeX 字段（用户实机抱怨的原始现象）。
 *
 * 触发条件（三条都要满足，缺一不写）：
 *   1. 本次确实是一条**论文任务** —— 判定用「提示词里有 `/mma-paper` 斜杠命令」。
 *      输入区在「写论文」模式下会自动给每条消息前置 `/mma-paper`（`Composer.tsx`
 *      的 `MODE_COMMAND`），用户手打命令也走同一条判定。
 *      ⚠️ 这里**不能**用 `settings.composerMode === 'paper'` —— 它的默认值就是
 *      `'paper'`，会导致任何一条普通消息都去建配置文件（过度写入）。
 *   2. 设置里 `paperInitProjectConfig !== false`（默认开；关掉用于反向对照）。
 *   3. 目标文件不存在 —— 已存在则原样不动，返回 `already-exists`。
 *
 * 失败一律**不阻断会话**：写不了配置最多是 agent 没有比赛字段，不该让用户发不出消息。
 */
function ensurePaperProjectConfig(cwd: string, prompt: string): void {
  const settings = getSettings();
  if (settings.paperInitProjectConfig === false) {
    console.log('[paper-config] skipped (paperInitProjectConfig=false)');
    return;
  }
  if (detectSlashCommand(prompt) !== 'mma-paper') return;
  if (!cwd) return;

  const templates = listPaperTemplates(resourcesDir());
  // 队伍档案只在设置里明确启用、且确实选中了一份时才预填
  const prof =
    settings.paperProfileEnabled && settings.paperDefaultProfileId
      ? (settings.paperProfiles ?? []).find((p) => p.id === settings.paperDefaultProfileId) ?? null
      : null;

  const r = initPaperProjectConfig({
    projectRoot: cwd,
    templates,
    preferTemplateId: settings.paperTemplateId,
    locale: settings.locale,
    profile: prof,
  });

  // 留一条日志便于取证（原版也有 `[paper-config] skipped `）
  if (r.created) {
    console.log(
      `[paper-config] created ${paperConfigPath(cwd)} template=${r.templateId} source=builtin` +
        (prof ? ` profile=${prof.id}` : ''),
    );
  } else {
    console.log(`[paper-config] skipped (${r.reason ?? 'unknown'}) ${paperConfigPath(cwd)}`);
  }
}

// ─────────────────────────────────────────────────────────────
// IPC 注册
// ─────────────────────────────────────────────────────────────

export function registerSessionHandlers(_ctx: IpcContext): void {
  ipcMain.handle(
    IPC.SESSION_LIST,
    safeWrap((_e, projectId: string) => listSessions(projectId), '读取会话列表'),
  );

  ipcMain.handle(
    IPC.SESSION_CREATE,
    safeWrap((_e, projectId: string, title: string) => createSession(projectId, title), '创建会话'),
  );

  ipcMain.handle(
    IPC.SESSION_GET,
    safeWrap((_e, id: string) => {
      const meta = getSession(id);
      if (!meta) throw new Error('会话不存在');
      const res: { meta: SessionMeta; messages: ChatMessage[]; inflight?: InflightTurn } = {
        meta,
        messages: getMessages(id),
      };
      /**
       * 进行中回合的快照（切走再切回来还能看到过程块与任务面板，就靠它）。
       *
       * ⚠️ 没有进行中回合时**不带这个键**，不要写成 `inflight: undefined` 或
       *    `{ blocks: [] }`：前者序列化后就没了（等价），后者会让渲染层以为
       *    "有一轮在跑但还没内容"，多渲染一个空气泡。
       *    陈旧快照的识别与清理在 `inflightOf` 内部完成（它返回 undefined）。
       */
      const inflight = inflightOf(getDb(), id);
      if (inflight) res.inflight = inflight;
      return res;
    }, '读取会话'),
  );

  ipcMain.handle(
    IPC.SESSION_RENAME,
    safeWrap((_e, id: string, title: string) => {
      getDb().prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now(), id);
      return getSession(id);
    }, '重命名会话'),
  );

  ipcMain.handle(
    IPC.SESSION_DELETE,
    safeWrap((_e, id: string) => {
      sessionRegistry.dispose(id);
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return true;
    }, '删除会话'),
  );

  ipcMain.handle(
    IPC.SESSION_ABORT,
    safeWrap((_e, id: string) => {
      const runner = sessionRegistry.get(id);
      pushToRenderer(IPC.SESSION_STREAM, {
        sessionId: id,
        event: { type: 'session-stopping', sessionId: id },
      });
      if (!runner.isRunning) {
        getDb().prepare("UPDATE sessions SET status = 'idle', updated_at = ? WHERE id = ?")
          .run(Date.now(), id);
        pushToRenderer(IPC.SESSION_STREAM, {
          sessionId: id,
          event: { type: 'session-end', sessionId: id },
        });
        return true;
      }
      runner.abort();
      return true;
    }, '中断会话'),
  );

  /**
   * 用户在「Agent 提问」确认框里作答（或取消）。
   * answers 为 null = 用户取消 → canUseTool 返回 deny，模型会知道没拿到答案。
   */
  ipcMain.handle(
    IPC.SESSION_ANSWER_USER,
    safeWrap(
      (_e, sessionId: string, requestId: string, answers: Record<string, string> | null) =>
        sessionRegistry.get(sessionId).answerUserQuestion(requestId, answers),
      '回答 Agent 提问',
    ),
  );

  /**
   * 用户在「工具审批」框里做出决定（权限模式 = 需要批准时才会出现）。
   *
   * 对应原版 `resolveApproval()` @770166。四个决定的语义见 `ApprovalDecision`
   * 的注释；`'cancel'` 会**中断本轮**，所以渲染层那个按钮是「取消回合」不是「关闭」。
   */
  ipcMain.handle(
    IPC.SESSION_ANSWER_APPROVAL,
    safeWrap(
      (_e, sessionId: string, requestId: string, decision: ApprovalDecision) =>
        sessionRegistry.get(sessionId).answerApproval(requestId, decision),
      '回答工具审批',
    ),
  );

  ipcMain.handle(
    IPC.SESSION_SEND,
    safeWrap(async (_e, sessionId: string, text: string) => {
      const cwd = currentProjectRoot();

      // 0) 先给工作区打快照，把 ref 记在**这条用户消息**上（P0）。
      //    语义是"回到这条消息发出之前的状态"，所以必须在落库/开跑**之前**打。
      //    顺序反了就会把 agent 这一轮的改动也拍进快照，回退等于没回。
      const checkpointRef = await captureCheckpoint(cwd);

      // 1) 先落库用户消息 —— 即便后面 agent 崩了，用户的话不丢
      const userMsg: ChatMessage = {
        id: randomUUID(),
        role: 'user',
        blocks: [{ kind: 'text', text }],
        createdAt: Date.now(),
      };
      insertMessage(sessionId, userMsg, { checkpointRef });

      // 2) 取 runner，挂事件转发
      const runner = sessionRegistry.get(sessionId);

      // 每次 send 都重挂，避免重复监听导致事件翻倍
      runner.removeAllListeners('event');
      runner.removeAllListeners('sdk-session');
      runner.removeAllListeners('ask-user');

      // Agent 调 AskUserQuestion → 推给渲染层弹确认框。
      // 用户在弹窗里选完 → SESSION_ANSWER_USER → runner.answerUserQuestion()，
      // 那边的 promise 才 resolve，SDK 才拿到答案。
      runner.on('ask-user', (req: AskUserRequest) => {
        pushToRenderer(IPC.SESSION_ASK_USER, req);
      });

      // 工具审批请求（权限模式 = 需要批准时，canUseTool 拦下工具调用后发出的）。
      // 对应原版 `approval-request` 流事件；用户在审批框里选完 → SESSION_ANSWER_APPROVAL
      // → runner.answerApproval()，那边挂着的 promise 才 resolve，SDK 才拿到决定。
      runner.on('approval-ask', (req: ApprovalRequest) => {
        pushToRenderer(IPC.SESSION_APPROVAL_ASK, req);
      });

      const collected: ContentBlock[] = [];
      /**
       * `AgentSession` 发出 session-end 时，外层 Promise 的 `.then()` 还没来得及把
       * assistant 消息写进数据库。先把结束事件扣住，落库完成后再转发，避免渲染层
       * 重新读取历史时撞上“最终消息尚不存在”的短暂空窗。
       */
      let pendingEndEvent: Extract<StreamEvent, { type: 'session-end' }> | null = null;

      /**
       * 这一轮**即将落库**的 assistant 消息 id —— 回合开始时就定好。
       *
       * ⚠️ 为什么要在开头就生成，而不是收尾时现 `randomUUID()`：
       *    进行中快照（`turn_spills`）要把它一起存下来，读侧才能判断
       *    "这条消息已经落库了 ⇒ 这行快照是陈旧残留"（见 `db/turn-spills.ts`
       *    的 `isStaleSpill`）。两处用**同一个 id** 是这个判定的全部依据。
       */
      const assistantMsgId = randomUUID();

      /** 上一次写快照的时间；0 = 还没写过（第一个事件就会写） */
      let lastSpillAt = 0;

      runner.on('event', (ev: StreamEvent) => {
        // 累积 assistant 内容用于落库（抽成纯函数，见 `stream-blocks.ts` —— 那里能单测）
        applyStreamEvent(collected, ev);

        /**
         * 进行中回合的快照 —— 「跑着的时候切走、再切回来还能看到过程」的唯一来源。
         * 节流策略：结构事件（块边界 / 工具调用 / 工具结果）**立即**写，
         * 纯文本增量攒到 ≥300ms 再写（见 `shouldFlushSpill`）。
         * 崩溃不清理：留着反而能看到「上次没跑完的那一轮」。
         */
        const now = Date.now();
        if (shouldFlushSpill(lastSpillAt, now, ev)) {
          lastSpillAt = now;
          // `filter(Boolean)` 同收尾路径：块是按下标写进去的，中间可能有空洞
          writeSpill(getDb(), sessionId, assistantMsgId, collected.filter(Boolean), now);
        }

        // 结束事件必须等最终消息与会话状态都落库后再发，其余事件继续实时转发。
        if (ev.type === 'session-end') {
          pendingEndEvent = ev;
        } else {
          pushToRenderer(IPC.SESSION_STREAM, { sessionId, event: ev });
        }
      });

      runner.on('sdk-session', (sdkId: string) => {
        // 记下来以便续传
        getDb()
          .prepare('UPDATE sessions SET sdk_session_id = ? WHERE id = ?')
          .run(sdkId, sessionId);
      });

      // 3) 跑（不 await，立即返回让界面进入流式状态）
      const opts = await buildRunOptions(sessionId, text, cwd);

      getDb()
        .prepare("UPDATE sessions SET status = 'running', updated_at = ? WHERE id = ?")
        .run(Date.now(), sessionId);

      void runner
        .run(opts as Parameters<typeof runner.run>[0])
        .then(() => {
          const blocks = collected.filter(Boolean);
          if (blocks.length) {
            // ⚠️ P0 只加列，这里**故意不传 agentMsgUuid**：它的值来自 agent 侧回的
            //    assistant 消息 uuid（原版取 `lastAssistantUuid`），要等 P7（分叉）
            //    把 agent/session.ts 的那个字段接出来才能填。在那之前该列恒为 NULL，
            //    表现为"分叉只能复制消息、不能续传 agent 上下文"。
            //    `id` 用的是回合开头生成的 assistantMsgId —— 与进行中快照同源，
            //    读侧靠它判断快照有没有陈旧（见 db/turn-spills.ts）。
            insertMessage(sessionId, {
              id: assistantMsgId,
              role: 'assistant',
              blocks,
              createdAt: Date.now(),
              model: opts.model,
              usage: runner.totalUsage,
            });
          }
          /**
           * ⚠️ **顺序不能反**：先落最终消息，再删进行中快照。
           *
           *   反过来（先删快照再落库）会出现一个空窗：这两步之间进程被杀，
           *   用户切回来看到的是"过程没了、最终消息也没落"—— 比原来更惨。
           *   按现在的顺序最坏情况只是留下一行**陈旧快照**：
           *   读侧一看"这条消息已经落库了"就把它当不存在并顺手删掉
           *   （见 db/turn-spills.ts 的 isStaleSpill）。
           *
           * ⚠️ 空 `blocks` 时也要删：这一轮跑完了，就不该再有"进行中回合"。
           */
          clearSpill(getDb(), sessionId);
          getDb()
            .prepare(
              `UPDATE sessions SET status = 'idle', updated_at = ?,
                 input_tokens = ?, output_tokens = ?, reasoning_tokens = ? WHERE id = ?`,
            )
            .run(
              Date.now(),
              runner.totalUsage.inputTokens,
              runner.totalUsage.outputTokens,
              runner.totalUsage.reasoningTokens ?? 0,
              sessionId,
            );
          pushToRenderer(IPC.SESSION_STREAM, {
            sessionId,
            event: pendingEndEvent ?? { type: 'session-end', sessionId },
          });
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          getDb()
            .prepare("UPDATE sessions SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
            .run(msg, Date.now(), sessionId);
          pushToRenderer(IPC.SESSION_STREAM, {
            sessionId,
            event: { type: 'session-error', message: '这次没有顺利收尾，已保留当前内容，可以重试。' },
          });
          pushToRenderer(IPC.SESSION_STREAM, {
            sessionId,
            event: pendingEndEvent ?? { type: 'session-end', sessionId, reason: 'error' },
          });
        });

      return { messageId: userMsg.id };
    }, '发送消息'),
  );
}

export { getSession, getMessages, listSessions, createSession };
