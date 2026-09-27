/**
 * 会话导出 / 导入 —— **按字段实现会话交互协议**。
 *
 * 应用约定把这件事做成了两条本地 HTTP 路由 + 两个 IPC 落盘通道：
 *   `GET  /api/sessions/:id/export` → `gS()` 产出的 JSON → `mathmodel:save-text-file`
 *   `POST /api/sessions/import`     ← `mathmodel:open-text-file` 读到的 JSON
 * 当前实现沿用同一套分工（本文件只负责**产/验 JSON**，落盘仍在渲染层走 IPC）。
 *
 * ── 协议字段记录（用于回归复核） ──
 *   `gS()` 导出构造器
 *   `fS()` 消息读取
 *   `/:id/export` 路由       （404 `{error:'not_found'}`）
 *   `/import` 路由           （201，永远新建）
 *   `cs` 导入 schema
 *   `ls` 消息 schema          区段内
 *   `Zn` parts schema        （discriminatedUnion('type')，7 个变体）
 *   `uw()` 文件名生成器
 *
 * ── 与应用约定的**语义差异**（都是当前实现侧数据结构决定的，见 P1/P2 报告） ──
 *   1. 应用约定 `messages` 有 `content`(纯文本) 与 `parts`(结构化) **两列**；当前实现只有 `blocks`。
 *      → 导出时 `content` 由 `text` part 拼接得出；导入时 `blocks` 由 `parts` 映射回来。
 *   2. 应用约定有 `durationMs` / `costUsd` / `effort`，当前实现没有对应列 → 导出填 `null`，导入丢弃。
 *   3. 应用约定 `toolUse.result` 是 `{text, isError?, exitCode?, truncated?, sources?}`；
 *      当前实现的 `toolResult` 是 SDK 的原始 content（通常是 `[{type:'text',text}]`）。
 *      → 导出时**规整成应用约定的 `{text}` 形状**（这正是应用约定的语义），导入时原样写回。
 *      因此「当前实现 → 导出 → 导入」在 tool 结果上是**文本等价、结构规整**，
 *      从第二次导出起是**不动点**（这一点由 `export.test.ts` 的往返用例断言）。
 */
import { z } from 'zod';
import type { ChatMessage, ContentBlock, SessionMeta } from '@shared/types';

// ─────────────────────────────────────────────────────────────
// 会话交换数据的形状（沿用协议字段 `Zn` / `Vn` / `Xn` / `ls` / `cs`）
// ─────────────────────────────────────────────────────────────

/** 工具结果 —— 应用约定 `Vn`  */
export interface ExportToolResult {
  text: string;
  isError?: boolean;
  exitCode?: number;
  truncated?: boolean;
  sources?: Array<{ title: string; url: string }>;
}

/** 工具调用 —— 应用约定 `Gn`  */
export interface ExportToolUse {
  id: string;
  name: string;
  input: unknown;
  result?: ExportToolResult;
}

/** turn-diff 的一个文件 —— 应用约定 `Jn`  */
export interface ExportTurnDiffFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

/**
 * 会话消息的一段 —— 应用约定 `Zn` （`discriminatedUnion('type')`，7 个变体）。
 * 顺序与应用约定一致，便于逐条对照。
 */
export type SessionPart =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool-use'; toolUse: ExportToolUse }
  | { type: 'attachment'; path: string; name: string; mediaType: string; kind: 'image' | 'file' }
  | { type: 'proposed-plan'; planMarkdown: string }
  | { type: 'turn-diff'; files: ExportTurnDiffFile[]; versionId?: string }
  | { type: 'turn-end'; state: 'interrupted' | 'failed'; errorMessage?: string; faultId?: string };

/** 导出的一条消息 —— 应用约定 `ls`  */
export interface ExportMessage {
  role: 'user' | 'assistant';
  content: string;
  parts: SessionPart[];
  durationMs: number | null;
  model: string | null;
  effort: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  createdAt: number;
}

/** 导出文件的顶层 —— 应用约定 `gS()`  的返回体，逐字段一致 */
export interface SessionExportPayload {
  format: 'mathmodel-session';
  version: 1;
  exportedAt: number;
  session: {
    title: string;
    providerId: string | null;
    model: string | null;
    createdAt: number;
    updatedAt: number;
  };
  messages: ExportMessage[];
}

// ─────────────────────────────────────────────────────────────
// blocks → parts（导出方向）
// ─────────────────────────────────────────────────────────────

function safeStringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

/**
 * 把 SDK 的原始 tool 结果压平成应用约定的 `text`。
 *
 * 应用约定 `Vn.text` 是**必填 string**，所以这里必须永远产出字符串 ——
 * 否则导出的文件应用约定自己都导不回去（zod 会拒）。
 * 常见形态是 `[{type:'text',text:'…'}]`（SDK 的 content 数组），逐块取 `text` 拼起来。
 */
export function flattenToolResult(result: unknown): string {
  if (result === undefined || result === null) return '';
  if (typeof result === 'string') return result;
  if (Array.isArray(result)) {
    return result
      .map((b) => {
        if (typeof b === 'string') return b;
        if (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string') {
          return (b as { text: string }).text;
        }
        return safeStringify(b);
      })
      .join('\n');
  }
  if (typeof result === 'object' && typeof (result as { text?: unknown }).text === 'string') {
    return (result as { text: string }).text;
  }
  return safeStringify(result);
}

/**
 * 当前实现的 `ContentBlock[]` → 应用约定的 `parts[]`。
 *
 * 映射表（详见规格书 §A.2 与 P1 报告）：
 *   text       → {type:'text'}
 *   thinking   → {type:'thinking'}
 *   tool_use   → {type:'tool-use', toolUse:{id,name,input,result}}
 *   error      → {type:'turn-end', state:'failed'}     ← 借应用约定已有的"本轮失败"语义
 *   tool_result→ {type:'text'}（应用约定没有独立类型；当前实现侧实际也不会产出这种 block）
 */
export function blocksToParts(blocks: ContentBlock[]): SessionPart[] {
  const parts: SessionPart[] = [];
  for (const b of blocks) {
    switch (b.kind) {
      case 'text':
        parts.push({ type: 'text', text: b.text ?? '' });
        break;
      case 'thinking':
        parts.push({ type: 'thinking', text: b.text ?? '' });
        break;
      case 'tool_use': {
        const toolUse: ExportToolUse = {
          id: b.toolUseId ?? '',
          name: b.toolName ?? '',
          input: b.toolInput ?? null,
        };
        // 应用约定 `result` 可选：没结果时**不要**塞一个空对象，否则 zod 里的 `text` 虽然满足，
        // 但会让"这个工具还没返回"和"返回了空字符串"混淆。
        if (b.toolResult !== undefined) {
          const result: ExportToolResult = { text: flattenToolResult(b.toolResult) };
          // 应用约定 `Vn` 本来就有 `isError?`；当前实现的 `ContentBlock.isError` 已在本轮透传
          // （`ipc/session.ts` 的 `tool-result` 分支）。只在 `true` 时写这个键 ——
          // `false` 与"没有这个键"在应用约定语义里等价，少写一个键更接近"没失败"的原样导出。
          if (b.isError === true) result.isError = true;
          toolUse.result = result;
        }
        parts.push({ type: 'tool-use', toolUse });
        break;
      }
      case 'error':
        parts.push({
          type: 'turn-end',
          state: 'failed',
          errorMessage: b.text ?? '',
        });
        break;
      case 'tool_result':
        // 应用约定把结果挂在 toolUse 上，没有独立的 tool_result part。
        // 当前实现的 `SESSION_SEND` 也是"把结果并进 tool_use"（ipc/session.ts），
        // 所以这里正常不会走到；真走到就降级成文本，**不丢内容**。
        parts.push({ type: 'text', text: flattenToolResult(b.toolResult) });
        break;
    }
  }
  return parts;
}

/** 消息纯文本 —— 应用约定 `content` 列。取各 `text` part 拼接（不含 thinking / 工具） */
export function blocksToContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b) => b.kind === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

// ─────────────────────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────────────────────

/**
 * 产出导出 JSON —— 对应应用约定 `gS(session, messages, exportedAt)` 。
 *
 * 字段名、顺序、`null` 的用法都直接采用；当前实现没有的列（`durationMs`/`effort`/`costUsd`）一律 `null`。
 */
export function buildExportPayload(
  session: SessionMeta,
  messages: ChatMessage[],
  exportedAt: number,
): SessionExportPayload {
  return {
    format: 'mathmodel-session',
    version: 1,
    exportedAt,
    session: {
      title: session.title,
      providerId: session.providerId || null,
      model: session.model || null,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
    messages: messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: blocksToContent(m.blocks),
      parts: blocksToParts(m.blocks),
      // 当前实现 messages 表没有这三列 —— 显式填 null，不编造
      durationMs: null,
      model: m.model ?? null,
      effort: null,
      inputTokens: m.usage?.inputTokens ?? null,
      outputTokens: m.usage?.outputTokens ?? null,
      costUsd: null,
      createdAt: m.createdAt,
    })),
  };
}

// ─────────────────────────────────────────────────────────────
// 导入（P2）
// ─────────────────────────────────────────────────────────────

/**
 * 导入校验 —— 对应应用约定 `cs`（协议实现）。
 *
 * ⚠️ **有意比应用约定宽松的地方**：`parts` 只校验成 `unknown[]`，不在这里做判别联合。
 *    应用约定是 `z.array(Zn)`，**任何一段 part 不认识就整个文件 400**。
 *    对用户来说"文件没错、只是有一个新版本才有的段落"却完全导不进来，
 *    比"那一段降级、其余照导"更糟。所以这里**信封严格、parts 逐段宽松**：
 *      - 信封（format / version / session / messages[].role/content/createdAt）严格 ——
 *        拿错文件（比如随便一个 JSON）必须在**动数据库之前**被挡住；
 *      - 每段 part 在 `partToBlocks` 里单独 `safeParse`，坏的只降级那一段。
 *    放宽的部分由 `degradedParts` 计数**显式回报**，不静默吞掉。
 */
export const sessionImportSchema = z.object({
  format: z.literal('mathmodel-session'),
  version: z.literal(1),
  exportedAt: z.number(),
  session: z.object({
    title: z.string(),
    providerId: z.string().nullable(),
    model: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
      parts: z.array(z.unknown()),
      // 应用约定这几个是 `number().nullable()` / 可选 —— 直接采用，免得应用约定导出的文件被当前实现拒收
      durationMs: z.number().nullable(),
      model: z.string().nullable().optional(),
      effort: z.string().nullable().optional(),
      inputTokens: z.number().nullable().optional(),
      outputTokens: z.number().nullable().optional(),
      costUsd: z.number().nullable().optional(),
      createdAt: z.number(),
    }),
  ),
});

export type SessionImportPayload = z.infer<typeof sessionImportSchema>;

/** part 的判别联合 —— 与应用约定 `Zn`  对应 */
const partSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('tool-use'),
    toolUse: z.object({
      id: z.string(),
      name: z.string(),
      input: z.unknown(),
      result: z
        .object({
          text: z.string(),
          isError: z.boolean().optional(),
          exitCode: z.number().optional(),
          truncated: z.boolean().optional(),
          sources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
        })
        .optional(),
    }),
  }),
  z.object({
    type: z.literal('attachment'),
    path: z.string(),
    name: z.string(),
    mediaType: z.string(),
    kind: z.enum(['image', 'file']),
  }),
  z.object({ type: z.literal('proposed-plan'), planMarkdown: z.string() }),
  z.object({
    type: z.literal('turn-diff'),
    files: z.array(
      z.object({
        path: z.string(),
        status: z.string(),
        additions: z.number(),
        deletions: z.number(),
      }),
    ),
    versionId: z.string().optional(),
  }),
  z.object({
    type: z.literal('turn-end'),
    state: z.enum(['interrupted', 'failed']),
    errorMessage: z.string().optional(),
    faultId: z.string().optional(),
  }),
]);

/** 一段 part → blocks，外加"是否发生了降级" */
function partToBlocks(raw: unknown): { blocks: ContentBlock[]; degraded: boolean } {
  const parsed = partSchema.safeParse(raw);
  if (!parsed.success) {
    // 连判别联合都过不了 —— 把原文当文本塞进去，**绝不丢**，并计入 degraded
    return { blocks: [{ kind: 'text', text: safeStringify(raw) }], degraded: true };
  }

  const p = parsed.data;
  switch (p.type) {
    case 'text':
      return { blocks: [{ kind: 'text', text: p.text }], degraded: false };
    case 'thinking':
      return { blocks: [{ kind: 'thinking', text: p.text }], degraded: false };
    case 'tool-use': {
      const block: ContentBlock = {
        kind: 'tool_use',
        toolName: p.toolUse.name,
        toolUseId: p.toolUse.id,
        toolInput: p.toolUse.input,
      };
      if (p.toolUse.result !== undefined) {
        block.toolResult = p.toolUse.result;
        // 把应用约定 `Vn.isError` 还原到 `ContentBlock.isError`（本轮刚补上透传的那个字段），
        // 否则"工具失败"这个事实会在 导入 → 再导出 的路上丢掉。
        if (p.toolUse.result.isError === true) block.isError = true;
      }
      return { blocks: [block], degraded: false };
    }
    // ↓↓↓ 以下四种当前实现的 `ContentBlock` 装不下，**降级成 text** 并计数。
    //     文案来自会话交换协议（不是渲染层 i18n）—— 因为它们要落进数据库当
    //     持久数据；用界面词典会让"同一次导入"在不同界面语言下产出不同内容。
    case 'attachment':
      // 应用约定 `Dy`  用的是 `📎 [name](ref)`；这里没有资源包可指，去掉链接
      return { blocks: [{ kind: 'text', text: `📎 ${p.name}` }], degraded: true };
    case 'proposed-plan':
      // 应用约定 share HTML  的计划卡标题字面量就是 `Plan`
      return { blocks: [{ kind: 'text', text: `**Plan**\n\n${p.planMarkdown}` }], degraded: true };
    case 'turn-diff': {
      // 应用约定 share HTML  的 summary 字面量：`✎ File changes ×N`（含 U+2212 减号）
      const head = `✎ File changes ×${p.files.length}`;
      const lines = p.files.map((f) => `- \`${f.path}\` +${f.additions} −${f.deletions}`);
      return { blocks: [{ kind: 'text', text: [head, ...lines].join('\n') }], degraded: true };
    }
    case 'turn-end': {
      // 应用约定 `Dy`  的字面量，直接采用
      const text =
        p.state === 'interrupted'
          ? '_Stopped_'
          : '> ⚠️ Turn failed' + (p.errorMessage ? `: ${p.errorMessage}` : '');
      return { blocks: [{ kind: 'text', text }], degraded: true };
    }
  }
}

/** 一段 part 数组 → blocks；返回降级段数 */
export function partsToBlocks(parts: unknown[]): { blocks: ContentBlock[]; degraded: number } {
  const blocks: ContentBlock[] = [];
  let degraded = 0;
  for (const raw of parts) {
    const r = partToBlocks(raw);
    blocks.push(...r.blocks);
    if (r.degraded) degraded += 1;
  }
  return { blocks, degraded };
}

/** 待插入的一条消息（已分配好新 id、已换算成当前实现的列） */
export interface PlannedMessage {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  createdAt: number;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  degraded: number;
}

/** 一次导入要落库的全部内容（**纯数据**，不碰数据库，便于单测） */
export interface ImportPlan {
  session: {
    id: string;
    title: string;
    providerId: string;
    model: string;
    createdAt: number;
    updatedAt: number;
  };
  messages: PlannedMessage[];
  /** 降级过的 part 总数（> 0 时接口会回报给渲染层，用于提示用户） */
  degradedParts: number;
}

/**
 * 把校验通过的导入文件**规划成待落库的行** —— 纯函数，不接触数据库。
 *
 * ⚠️ 三条与应用约定的差异，都是当前实现的数据结构决定的：
 *
 *  1. **`id` 一律新生成**（应用约定 `uuid()`， / ）。`cs` 里本来就没有
 *     `session.id`，所以导入**永远不会覆盖已有会话** —— 这是"只增不改"，
 *     同名也不去重。应用约定如此，直接采用。
 *  2. **`updatedAt` 用现在**（应用约定 `Date.now()`），`createdAt` 保留导出文件里的值。
 *     效果：导入的会话排在列表最前面。
 *  3. `providerId` / `model` 当前实现是 `NOT NULL DEFAULT ''`，而应用约定可空 ⇒ `null` 落成 `''`。
 */
export function planImport(
  payload: SessionImportPayload,
  sessionId: string,
  newMessageId: () => string,
  now: number,
): ImportPlan {
  let degradedParts = 0;
  const messages: PlannedMessage[] = payload.messages.map((m) => {
    const { blocks, degraded } = partsToBlocks(m.parts);
    degradedParts += degraded;
    return {
      id: newMessageId(),
      role: m.role,
      blocks,
      createdAt: m.createdAt,
      model: m.model ?? null,
      inputTokens: m.inputTokens ?? 0,
      outputTokens: m.outputTokens ?? 0,
      degraded,
    };
  });

  return {
    session: {
      id: sessionId,
      title: payload.session.title,
      providerId: payload.session.providerId ?? '',
      model: payload.session.model ?? '',
      createdAt: payload.session.createdAt,
      updatedAt: now,
    },
    messages,
    degradedParts,
  };
}
