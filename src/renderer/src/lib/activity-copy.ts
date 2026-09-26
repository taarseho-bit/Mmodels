import type { ContentBlock } from '@shared/types';
import { toolKindOf, type ToolRow } from './tool-row';

/**
 * 把活动行压成一条清楚、稳定的中文短句。
 *
 * 模型偶尔会把同一个标点连续写很多次，或者把换行和空格混在状态行里。
 * 这里只处理“展示层”的旁白，不改工具参数、正文和诊断信息；因此不会影响
 * 复现，也不会把用户真正写的内容悄悄改掉。
 */
export function compactActivityText(value: string, maxLength = 120): string {
  const text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([。！？!?，,、；;：:])\1+/g, '$1')
    .replace(/\.{2,}/g, '…')
    .replace(/…{2,}/g, '…')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

/** 对话还在运行时轮换显示。文案刻意只说正在做什么，不暴露内部工具。 */
export const MODEL_WAITING_MESSAGES = [
  '正在把题目条件整理成可计算的关系…',
  '正在检查模型有没有漏掉约束…',
  '正在比较几条更稳妥的解题路线…',
  '正在让数据、图表和结论互相对上…',
  '正在做一遍结果复核…',
] as const;

function inputRecord(block: ContentBlock): Record<string, unknown> {
  return block.toolInput && typeof block.toolInput === 'object'
    ? block.toolInput as Record<string, unknown>
    : {};
}

function inputText(block: ContentBlock): string {
  return Object.values(inputRecord(block)).filter((value): value is string => typeof value === 'string').join(' ').toLowerCase();
}

/**
 * 2026-09-25 用户要求：状态行要「完全准确地知道在干什么」。
 * 模型给工具写的 `description` 若已是中文，就是第一手事实 —— 原样上屏（截断到 60 字），
 * 不再套启发式模板。英文旁白仍走原启发式收敛。
 */
function chineseDescriptionOf(block: ContentBlock): string | null {
  const raw = inputRecord(block).description;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().replace(/\s+/g, ' ');
  if (text.length < 4) return null;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const han = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  if (han < 4 || han < latin) return null;
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
}

const HIDDEN_TOOL_NARRATION_FIELDS = new Set([
  'description',
  'explanation',
  'reason',
  'summary',
  'thinking',
]);

/**
 * 工具详情只保留真正执行所需的参数。模型写给工具的旁白字段经常是英文，
 * 既不影响复现，也不该绕过中文过程层直接暴露在对话里。
 */
export function toolInputForDisplay(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toolInputForDisplay);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !HIDDEN_TOOL_NARRATION_FIELDS.has(key.toLowerCase()))
      .map(([key, nested]) => [key, toolInputForDisplay(nested)]),
  );
}

/**
 * 根据正在执行的真实工具与文件类型生成状态，不额外调用模型，也不虚构进度。
 * 找不到具体动作时才回到通用建模文案。
 */
export function activityMessagesFor(blocks: readonly ContentBlock[], userText = ''): string[] {
  const tools = blocks.filter((block) => block?.kind === 'tool_use');
  const last = tools.at(-1);
  if (last) {
    // 第一手事实优先：模型自己写的中文 description 一字不改地上屏
    const own = chineseDescriptionOf(last);
    if (own) return [own];
    const name = (last.toolName ?? '').split('__').pop() ?? '';
    const detail = inputText(last);
    const running = last.toolResult === undefined;
    const prefix = running ? '正在' : '接下来会';

    if (/\.pdf\b|pdf/.test(detail)) return [`${prefix}逐页检查论文中的公式、表格和图表…`];
    if (/\.tex\b|latex|xelatex|latexmk/.test(detail)) return [`${prefix}重新编译论文并检查版面…`];
    if (/draw\.?(?:io)?|\.drawio\b|流程图|路线图/.test(detail)) return [`${prefix}调整技术路线图和流程图…`];
    if (/python|\.py\b|matplotlib|scipy|numpy|pandas/.test(detail)) return [`${prefix}运行模型并核对计算结果…`];
    if (/\.csv\b|\.xlsx?\b|数据/.test(detail)) return [`${prefix}清洗数据并检查异常值…`];

    switch (toolKindOf(name)) {
      case 'read': return [`${prefix}阅读材料并标出关键条件…`];
      case 'search': return [`${prefix}在项目里查找相关数据和公式…`];
      case 'web': return [`${prefix}核验数据来源和引用信息…`];
      case 'edit': return [`${prefix}把最新结果整理进论文和附件…`];
      case 'command': return [`${prefix}运行计算并检查结果是否合理…`];
      case 'agent': return [`${prefix}分头核对模型、数据和写作内容…`];
      default: return [`${prefix}推进当前步骤并核对产出…`];
    }
  }

  const prompt = userText.toLowerCase();
  if (/论文|paper|pdf|评审/.test(prompt)) return ['正在梳理论文结构和需要重点核对的内容…'];
  if (/数据|csv|excel|xlsx/.test(prompt)) return ['正在确认数据字段、缺失值和可用范围…'];
  if (/绘图|图表|流程图|draw/.test(prompt)) return ['正在确定图表要表达的关系和重点…'];
  if (/模型|优化|预测|回归|分类/.test(prompt)) return ['正在把题目条件整理成可计算的模型…'];
  return [...MODEL_WAITING_MESSAGES];
}

/** 把模型偶尔泄漏的英文过程旁白收敛成与真实动作对应的中文进度。 */
export function localizeProcessNarration(text: string): string {
  const source = text.trim();
  if (!source || source.includes('```')) return text;
  const latin = (source.match(/[A-Za-z]/g) ?? []).length;
  const han = (source.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const lower = source.toLowerCase();
  const looksLikeNarration = /(?:^|[.!?]\s+)(?:i(?:'ll| will|'m| am| need| should| found| see)\b|let me\b|first[, ]|next[, ]|we need\b|my\s+.+?\s+is\s+(?:wrong|incorrect)\b)/i.test(source)
    || /\b(?:still drives|stop guessing|correct (?:it|this)|try again|binding constraint)\b/i.test(source);
  const looksLikeCode = /^(?:\s*(?:import |from |def |class |function |const |let |var |[$>]\s)|\s*[A-Za-z_$][\w$]*\s*=)/m.test(source);
  const shortEnglishProcess = source.length <= 600 && !looksLikeCode;
  if ((!looksLikeNarration && !shortEnglishProcess) || latin < 8 || han > Math.max(2, latin / 4)) return text;

  if (/\b(?:soc|battery|charge|discharge|energy storage)\b/.test(lower)) {
    return '正在重新核对储能状态递推、充放电顺序和上下限…';
  }
  if (/\b(?:wrong|incorrect|negative|infeasible|violat|constraint|boundary|bound)\b/.test(lower)) {
    return '刚才的推演发现约束或边界条件没有对齐，正在修正后重新计算…';
  }
  if (/\b(?:solver|linear program|\blp\b|optimi[sz]|objective|binding)\b/.test(lower)) {
    return '正在让求解器复核约束，并确认结果是不是当前最优…';
  }
  if (/locat|read|paper|pdf|document/.test(lower)) return '正在查找并阅读相关论文和材料…';
  if (/review|check|inspect|verify/.test(lower)) return '正在检查材料里的关键信息…';
  if (/search|find|look for/.test(lower)) return '正在查找需要的数据和资料…';
  if (/analy|model|reason/.test(lower)) return '正在分析题目条件和建模思路…';
  if (/run|test|calculat|compute|propagat/.test(lower)) return '正在运行计算并核对结果…';
  if (/edit|write|update|revise/.test(lower)) return '正在整理结果并写入文件…';
  return '正在继续处理当前任务…';
}

/** 思考详情如果主体是英文，不把整段内部推理直接暴露给中文用户。 */
export function localizeThinkingDetail(text: string): string {
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  const han = (text.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  if (latin >= 20 && latin > han * 2) {
    return '正在梳理当前步骤，详细推理过程已省略。';
  }
  return text;
}

export function friendlyToolActivity(block: ContentBlock, streaming: boolean): string {
  if (block.isError) {
    return streaming ? '这一步没走通，正在换一种办法…' : '这一步没走通，已继续处理';
  }

  const running = block.toolResult === undefined;
  if (running) return activityMessagesFor([block])[0] ?? '正在继续处理…';
  switch (toolKindOf(block.toolName)) {
    case 'read':
    case 'search':
    case 'web':
      return '已找到需要的信息';
    case 'edit':
      return '已整理好相关文件';
    case 'command':
      return '已完成一次计算与检查';
    case 'agent':
      return '一项分工已完成';
    default:
      return '这一步已完成';
  }
}

export function friendlyGroupActivity(rows: readonly ToolRow[], streaming: boolean): string {
  if (rows.some((row) => row.block.isError)) {
    return streaming ? '有一步没走通，正在继续处理…' : '处理过程中换过一种办法';
  }
  const running = rows.some((row) => row.block.toolResult === undefined);
  if (running) return activityMessagesFor(rows.map((row) => row.block))[0] ?? '正在继续处理…';
  switch (rows.at(-1)?.kind) {
    case 'read': return '已读完这一批材料';
    case 'search': return '已完成项目内查找';
    case 'web': return '已核验需要的资料来源';
    case 'edit': return '已整理好这一阶段的文件';
    case 'command': return '已完成一轮计算与检查';
    case 'agent': return '分工内容已汇总';
    default: return '这一阶段已处理完成';
  }
}

export interface FriendlyStreamError {
  softwareFault: boolean;
  title: string;
  description: string;
}

/**
 * 只有明显的程序异常才称为“软件问题”。网络、服务繁忙、超时和命令失败都用可重试文案。
 * 原始信息仍保留在“查看详情”，这里不吞诊断信息。
 */
export function friendlyStreamError(message: string): FriendlyStreamError {
  const softwareFault = /(?:TypeError|ReferenceError|RangeError|SyntaxError|SQLITE_CORRUPT|renderer process|Cannot read propert|undefined is not|软件内部|窗口(?:意外)?崩溃)/i.test(
    message,
  );
  return softwareFault
    ? {
        softwareFault: true,
        title: '软件遇到问题',
        description: '这次没有顺利完成。可以先重试；如果仍然出现，再用详情里的编号继续排查。',
      }
    : {
        softwareFault: false,
        title: '这次没有完成',
        description: '刚才的连接或执行没有走通，可以重试一次。',
      };
}
