/**
 * 工具调用行的**可读动作文案** + **连续工具组折叠**。
 *
 * 规格：`chat.toolUseRow.*` 与 `chat.toolCallGroup.*` 两族键
 * （来源于项目资料 `i18n/zh.ts:415-463`，**键值本身就是功能规格**，本文件按它反推映射，
 * 不自己编文案）。
 *
 * 早期实现曾在 `ChatPage.tsx` 里直接调用 `block.toolName?.split('__').pop()` —— 把
 * 原始工具名（`mcp__xxx__yyy` 去掉前缀）**直接当行文案渲染**，用户看到的是
 * `list_projects` 这种内部标识符，不是「使用了工具」。
 *
 * ## ⚠️ 两条不能踩的线
 *
 * 1. **`split('__').pop()` 这个"取短名"的口径要保留**（见 `shortToolName`）：
 *    它把 `mcp__mathmodel__list_projects` 归一成 `list_projects` 再去查映射表，
 *    于是 MCP 服务器换前缀不影响命中。但**绝不等于**拿短名当文案 ——
 *    查不到映射时一律落 `genericTool`（'使用工具'），不是回落短名。
 * 2. **行文案永远不能是空串或 `undefined`**：`tx()` 缺键会返回路径字符串，
 *    若这里写 `?? ''` 就会直接空掉。所以每一条分支的落点都是一个**真实存在的键**
 *    （`tool-row.test.ts` 里有"未知工具"与"不带 `__`"两条用例钉死这一点）。
 *
 * ## 映射的口径（Key 族 → 工具）
 *
 * | 工具 | 行的动作键 | 折叠组键 |
 * |---|---|---|
 * | `Bash` / `BashOutput` / `KillShell` | `ran` | `command` |
 * | `Read` / `NotebookRead` | `read` | `read` |
 * | `Edit` / `MultiEdit` / `NotebookEdit` | `edited` | `edit` |
 * | `Write` | `wrote` | `edit` |
 * | `Grep` / `Glob` | `searched` | `search` |
 * | `WebSearch` | `searchedWeb` | `web` |
 * | `WebFetch` | `fetched` | `web` |
 * | `TodoWrite` / `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | `updatedTodoList` | `tool` |
 * | `Task` | `subtask` | `agent` |
 * | 生图类 | `imageGenerating` / `imageGenerated` / `imageFailed` | `tool` |
 * | **其余全部** | `genericTool` | `tool` |
 *
 * `Write` 归 `edit` 组是**键族逼出来的**：`chat.toolCallGroup` 只有
 * agent/command/edit/read/search/tool/web 七个组，没有 write 组 ——
 * 「编辑了 N 个文件」本就是写文件的自然说法。
 *
 * ## `value` 从哪来
 *
 * `ran` / `read` / `edited` / `wrote` / `searched` / `searchedWeb` / `fetched` /
 * `subtask` 的文案里都带 `{{value}}`，按 `valueFields` 顺序去 `toolInput` 里取
 * 第一个非空字符串。**取不到不是回落到工具名**，而是换用同族的通用键
 * （`ranGeneric` / `searchedGeneric` / `searchedWebGeneric` / `fetchedGeneric` /
 * `subtaskGeneric`）；`read` / `edited` / `wrote` 这三条**项目契约没给通用键**，
 * 取不到值时落 `genericTool`。这是本文件唯一一处"当前没有明文、由我定的"口径，
 * 理由：宁可显示「使用工具」，也不能把 `Read` 这种内部名或空串给用户看。
 */
import type { ContentBlock } from '@shared/types';
import { tx, txPlural } from '../i18n';

/** 折叠组的分类 —— 与 `chat.toolCallGroup.*` 的七个组键**一一对应** */
export type ToolKind = 'agent' | 'command' | 'edit' | 'read' | 'search' | 'tool' | 'web';

/**
 * 行文案键的**字面量**表（不用 `chat.toolUseRow.${k}` 拼）。
 * 理由：`i18n/keys.test.ts` 的护栏扫的是**字面量**，拼串会被当成盲区跳过 ——
 * 写成字面量等于顺手让护栏管住这些键（少一个键当场红）。
 */
const ROW_KEY = {
  edited: 'chat.toolUseRow.edited',
  fetched: 'chat.toolUseRow.fetched',
  fetchedGeneric: 'chat.toolUseRow.fetchedGeneric',
  genericTool: 'chat.toolUseRow.genericTool',
  imageFailed: 'chat.toolUseRow.imageFailed',
  imageGenerated: 'chat.toolUseRow.imageGenerated',
  imageGenerating: 'chat.toolUseRow.imageGenerating',
  ran: 'chat.toolUseRow.ran',
  ranGeneric: 'chat.toolUseRow.ranGeneric',
  read: 'chat.toolUseRow.read',
  searched: 'chat.toolUseRow.searched',
  searchedGeneric: 'chat.toolUseRow.searchedGeneric',
  searchedWeb: 'chat.toolUseRow.searchedWeb',
  searchedWebGeneric: 'chat.toolUseRow.searchedWebGeneric',
  subtask: 'chat.toolUseRow.subtask',
  subtaskGeneric: 'chat.toolUseRow.subtaskGeneric',
  updatedTodoList: 'chat.toolUseRow.updatedTodoList',
  wrote: 'chat.toolUseRow.wrote',
} as const;

/** 折叠组键的**字面量**表（同样是为了让护栏看得见） */
const GROUP_KEY: Record<ToolKind, string> = {
  agent: 'chat.toolCallGroup.agent',
  command: 'chat.toolCallGroup.command',
  edit: 'chat.toolCallGroup.edit',
  read: 'chat.toolCallGroup.read',
  search: 'chat.toolCallGroup.search',
  tool: 'chat.toolCallGroup.tool',
  web: 'chat.toolCallGroup.web',
};

/** 行文案里 `{{value}}` 的展示上限（超出截断加 `…`）。
 *  ⚠️ 这是**展示口径**，不是项目契约明文：`toolInput.command` 可能是几百字符的
 *  一行命令，不截断会把整行撑爆。取不到项目契约证据，所以单测把它钉住，
 *  免得日后有人"顺手改大"而没人发现。 */
export const ROW_VALUE_MAX = 80;

interface ToolSpec {
  kind: ToolKind;
  /** 取到 value 时用 */
  rowKey: keyof typeof ROW_KEY;
  /** 取不到 value / 未知工具时用（必须是真实存在的键） */
  fallbackKey: keyof typeof ROW_KEY;
  /** 依次尝试的 `toolInput` 字段名 */
  valueFields: readonly string[];
  /** 生图类：行文案随「无结果 / 失败 / 完成」三态变（键族里的 image* 三条） */
  imageState?: boolean;
}

const TOOL_SPECS: Readonly<Record<string, ToolSpec>> = {
  // ── 命令 ──────────────────────────────────────────────
  Bash: { kind: 'command', rowKey: 'ran', fallbackKey: 'ranGeneric', valueFields: ['command'] },
  BashOutput: { kind: 'command', rowKey: 'ran', fallbackKey: 'ranGeneric', valueFields: ['command', 'bash_id'] },
  KillShell: { kind: 'command', rowKey: 'ran', fallbackKey: 'ranGeneric', valueFields: ['shell_id'] },

  // ── 读 ────────────────────────────────────────────────
  // 项目契约没给 read 的通用键 ⇒ 取不到路径时落 genericTool（见文件头口径说明）
  Read: { kind: 'read', rowKey: 'read', fallbackKey: 'genericTool', valueFields: ['file_path', 'path', 'filePath', 'notebook_path'] },
  NotebookRead: { kind: 'read', rowKey: 'read', fallbackKey: 'genericTool', valueFields: ['notebook_path', 'file_path', 'path'] },

  // ── 写 / 改 ───────────────────────────────────────────
  Edit: { kind: 'edit', rowKey: 'edited', fallbackKey: 'genericTool', valueFields: ['file_path', 'path', 'filePath'] },
  MultiEdit: { kind: 'edit', rowKey: 'edited', fallbackKey: 'genericTool', valueFields: ['file_path', 'path', 'filePath'] },
  NotebookEdit: { kind: 'edit', rowKey: 'edited', fallbackKey: 'genericTool', valueFields: ['notebook_path', 'file_path', 'path'] },
  Write: { kind: 'edit', rowKey: 'wrote', fallbackKey: 'genericTool', valueFields: ['file_path', 'path', 'filePath'] },

  // ── 搜（本地）─────────────────────────────────────────
  Grep: { kind: 'search', rowKey: 'searched', fallbackKey: 'searchedGeneric', valueFields: ['pattern', 'query'] },
  Glob: { kind: 'search', rowKey: 'searched', fallbackKey: 'searchedGeneric', valueFields: ['pattern', 'glob', 'path'] },

  // ── 搜（网络）─────────────────────────────────────────
  WebSearch: { kind: 'web', rowKey: 'searchedWeb', fallbackKey: 'searchedWebGeneric', valueFields: ['query'] },
  WebFetch: { kind: 'web', rowKey: 'fetched', fallbackKey: 'fetchedGeneric', valueFields: ['url'] },

  // ── 任务清单（本仓 Task* 与 TodoWrite 同族，见 store/tasks.ts:181）──
  TodoWrite: { kind: 'tool', rowKey: 'updatedTodoList', fallbackKey: 'updatedTodoList', valueFields: [] },
  TaskCreate: { kind: 'tool', rowKey: 'updatedTodoList', fallbackKey: 'updatedTodoList', valueFields: [] },
  TaskUpdate: { kind: 'tool', rowKey: 'updatedTodoList', fallbackKey: 'updatedTodoList', valueFields: [] },
  TaskList: { kind: 'tool', rowKey: 'updatedTodoList', fallbackKey: 'updatedTodoList', valueFields: [] },
  TaskGet: { kind: 'tool', rowKey: 'updatedTodoList', fallbackKey: 'updatedTodoList', valueFields: [] },

  // ── 子代理 ────────────────────────────────────────────
  Task: { kind: 'agent', rowKey: 'subtask', fallbackKey: 'subtaskGeneric', valueFields: ['description', 'prompt', 'subagent_type'] },

  // ── 生图（本仓当前没有生图工具，键族里有这三条，先接上）──
  GenerateImage: { kind: 'tool', rowKey: 'imageGenerated', fallbackKey: 'imageGenerated', valueFields: [], imageState: true },
  ImageGenerate: { kind: 'tool', rowKey: 'imageGenerated', fallbackKey: 'imageGenerated', valueFields: [], imageState: true },
  ImageGen: { kind: 'tool', rowKey: 'imageGenerated', fallbackKey: 'imageGenerated', valueFields: [], imageState: true },
  generate_image: { kind: 'tool', rowKey: 'imageGenerated', fallbackKey: 'imageGenerated', valueFields: [], imageState: true },
};

/**
 * 取短名 —— **保留项目契约口径**（`store/tasks.ts:64` 的 `shortToolName` 逐字同形）。
 *
 * `mcp__server__tool` → `tool`；不带 `__` 的名字 `'Bash'` → `'Bash'`（原样，
 * 正是项目契约那条回退的行为）。**短名只用来查表，不作为文案**。
 */
export function shortToolName(name: string): string {
  return name.split('__').pop() ?? name;
}

/** 取 `toolInput` 里的 `{{value}}`：按 `valueFields` 找第一个非空字符串 */
function pickValue(input: unknown, fields: readonly string[]): string | null {
  if (!input || typeof input !== 'object') return null;
  const rec = input as Record<string, unknown>;
  for (const f of fields) {
    const v = rec[f];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** 展示用截断（见 `ROW_VALUE_MAX` 的说明） */
function clampValue(value: string): string {
  return value.length > ROW_VALUE_MAX ? `${value.slice(0, ROW_VALUE_MAX)}…` : value;
}

/** 工具名 → 映射表条目；查不到返回 `null`（调用方落通用文案） */
function specOf(toolName: string | undefined): ToolSpec | null {
  if (!toolName) return null;
  return TOOL_SPECS[toolName] ?? TOOL_SPECS[shortToolName(toolName)] ?? null;
}

/** 工具名 → 折叠分类（未知工具恒为 `'tool'`） */
export function toolKindOf(toolName: string | undefined): ToolKind {
  return specOf(toolName)?.kind ?? 'tool';
}

/**
 * 一行工具的**动作文案**（`chat.toolUseRow.*`）。
 *
 * 落点有三层，**每一层都是真实存在的键**，所以返回值不可能是空串或 `undefined`：
 *   ① 有 `{{value}}` ⇒ `ran` / `read` / … 插值；
 *   ② 无 `{{value}}` 或取不到 ⇒ 同族通用键（`ranGeneric` / `genericTool` / …）；
 *   ③ 工具名不在表里（MCP 新工具、`SomeFutureTool`）⇒ `genericTool`。
 */
export function toolRowLabel(block: Pick<ContentBlock, 'toolName' | 'toolInput' | 'toolResult' | 'isError'>): string {
  const spec = specOf(block.toolName);

  if (spec?.imageState) {
    const key = block.toolResult === undefined
      ? ROW_KEY.imageGenerating
      : block.isError
        ? ROW_KEY.imageFailed
        : ROW_KEY.imageGenerated;
    return tx(key);
  }

  if (!spec) return tx(ROW_KEY.genericTool);

  const value = pickValue(block.toolInput, spec.valueFields);
  if (value === null) return tx(ROW_KEY[spec.fallbackKey]);
  return tx(ROW_KEY[spec.rowKey], { value: clampValue(value) });
}

/** 一行工具 → 折叠用的一行描述 */
export interface ToolRow {
  /** `toolUseId` 优先，缺失时用下标（与项目契约 key 的生成口径一致） */
  id: string;
  label: string;
  kind: ToolKind;
  /** 原块 —— 展开这个组的时**逐行渲染回完整的 `ToolCard`**（带参数/返回），
   *  否则折叠会把「看过程」这个能力本身吃掉。 */
  block: ContentBlock;
}

/** 折叠阈值：**连续 ≥ 2 个**工具才折叠（1 个仍然单独一行，见判据①） */
export const TOOL_GROUP_MIN = 2;

/** 把连续的一批工具行合成一个折叠组 */
export interface ToolGroup {
  kind: ToolKind;
  /** `chat.toolCallGroup.*` 出来的整组文案 */
  label: string;
  /** 展开后逐行渲染用 —— **组里那几条一行不少地放在这儿** */
  rows: ToolRow[];
}

/** 组内种类一致用那个种类，否则 `tool` */
export function toolGroupKind(rows: readonly ToolRow[]): ToolKind {
  const first = rows[0]?.kind ?? 'tool';
  return rows.every((r) => r.kind === first) ? first : 'tool';
}

/**
 * 折叠组文案：**同一种类**才用它的专属键（3 条命令 →「运行了 3 条命令」），
 * 混着来就落 `tool`（「使用了 N 个工具」）。
 */
export function toolGroupLabel(rows: readonly ToolRow[]): string {
  return txPlural(GROUP_KEY[toolGroupKind(rows)], rows.length);
}

/** `BlockList` 的渲染单元：原样的块，或者一个折叠组 */
export type DisplayItem =
  | { type: 'block'; block: ContentBlock }
  | { type: 'group'; group: ToolGroup };

/**
 * 把一个会话的过程块切成渲染单元：**连续**的 `tool_use` 且数量 ≥ `TOOL_GROUP_MIN`
 * 合成一个组，其余块原样透传（顺序不变）。
 *
 * ⚠️ 只合并**相邻**的工具：中间夹了文本/思考就一定断开，否则
 * 「说了一句话 → 又跑工具」会被折叠成一组，用户就看不出中间那句解释了。
 */
export function buildDisplay(blocks: readonly ContentBlock[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  /** 正在累积的连续工具 */
  let run: ToolRow[] = [];

  const flush = (): void => {
    if (run.length === 0) return;
    if (run.length >= TOOL_GROUP_MIN) {
      items.push({ type: 'group', group: { kind: toolGroupKind(run), label: toolGroupLabel(run), rows: run } });
    } else {
      // 单个工具**不折叠**，原样透传（判据①：一条命令要直接看到「运行命令」）
      for (const r of run) items.push({ type: 'block', block: r.block });
    }
    run = [];
  };

  blocks.forEach((b, i) => {
    if (!b) return;
    if (b.kind === 'tool_use') {
      run.push({
        id: b.toolUseId ?? `tu-${i}`,
        label: toolRowLabel(b),
        kind: toolKindOf(b.toolName),
        block: b,
      });
      return;
    }
    flush();
    items.push({ type: 'block', block: b });
  });
  flush();
  return items;
}
