/**
 * 输入区（Composer）—— 当前实现项目契约的结构。
 *
 * 项目契约的输入区远不止一个文本框，自上而下三层：
 *   ① 上下文栏：项目选择器 · 任务模式选择器 · 比赛模板选择器 ……… 比赛信息
 *   ② 附件 chips + 文本框
 *   ③ 底部栏：＋ 添加文件 · 权限选择器 ……… 模型·推理强度 · 发送
 *
 * 文案来源于项目资料 `composer.composerContextBar.*` / `composer.composerPermissionPicker.*` /
 * `chat.modelPicker.*` / `composer.composerAttachments.*`。
 *
 * 项目契约发送按钮左侧的计费提示依赖在线积分体系，当前版本不显示这一项。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  makeLocalizedText,
  pickLocalizedText,
  type PaperConfigPatch,
  type PaperContestField,
  type PaperPageLimit,
  type PaperTemplate,
  type PaperTemplateField,
  type PaperTemplateRef,
} from '@shared/types';
import { followUpItemsFor, readFollowUpBehavior, useApp, type QueuedFollowUp } from '../store/app';
import { Icon } from './Icon';
import { ResizeHandle } from './ResizeHandle';
import { PastedTextChip } from './PastedTextChip';
import { Popover } from './Popover';
import {
  PlusMenu,
  PLUS_POPOVER_MAX_HEIGHT,
  type PlusDatasetEntry,
  type PlusManageSection,
  type PlusSkillEntry,
  type PlusSubmenuId,
} from './PlusMenu';
import { openRoute } from '../lib/settings-nav';
import { registerCommand } from '../keybindings/dispatch';
import { t, tx } from '../i18n';
import { appendPasted, makePastedText, shouldFoldPasted, type PastedText } from '../lib/pasted-text';

export type ComposerMode = 'chat' | 'paper' | 'figure' | 'review' | 'data' | 'sprint';
export type PermissionMode = 'full' | 'approval';
/**
 * 决策模式 —— 与任务模式（ComposerMode）**正交**的另一个维度：
 * 任务模式决定「做什么」，决策模式决定「AI 怎么做决定」，可自由组合
 * （如「AI 自动 + 写论文」「精细人工 + 写论文」）。
 *
 *   - `manual`（默认）：精细化人工选择 —— 关键决策逐项弹窗征求用户；
 *   - `auto`：AI 自动决策 —— 一次问完自主交付，不再打扰人工；
 *   - `plan`：先规划，不改文件 —— 原「选项」菜单里的 planMode 升格而来，
 *     settings.planMode 作为它的投影同步写盘（主进程老读取点不变）。
 */
export type DecisionMode = 'manual' | 'auto' | 'plan';
const DECISION_MODES: DecisionMode[] = ['plan', 'manual', 'auto'];
const DECISION_MODE_ICON: Record<DecisionMode, string> = {
  plan: 'list-checks',
  manual: 'hand',
  auto: 'sparkles',
};
/** chip 上显示的短字（菜单里才是全名 + 描述；2026-09-26 用户钦定命名） */
const DECISION_MODE_SHORT: Record<DecisionMode, string> = {
  plan: '先规划',
  manual: '人工精细',
  auto: 'AI 全自动',
};

interface PaperPageLimitDraft {
  maxPages: string;
  scope: PaperPageLimit['scope'];
  startPage: string;
  endPage: string;
}

const EMPTY_PAGE_LIMIT: PaperPageLimitDraft = {
  maxPages: '',
  scope: 'body',
  startPage: '',
  endPage: '',
};

function positivePage(value: string): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function pageLimitFromDraft(draft: PaperPageLimitDraft): PaperPageLimit | null {
  const maxPages = positivePage(draft.maxPages);
  if (!maxPages) return null;
  if (draft.scope === 'total') return { maxPages, scope: 'total' };
  const startPage = positivePage(draft.startPage);
  const endPage = positivePage(draft.endPage);
  return {
    maxPages,
    scope: 'body',
    ...(startPage ? { startPage } : {}),
    ...(endPage ? { endPage } : {}),
  };
}

/** 模式 → 发送时自动附加的斜杠命令（项目契约行为：模式本质是预设命令） */
const MODE_COMMAND: Record<ComposerMode, string | null> = {
  chat: null,
  paper: '/write-paper',
  figure: '/draw-figures',
  review: '/review-paper',
  data: '/data-search',
  sprint: '/competition-sprint',
};

/**
 * 自定义比赛字段的 id 前缀。
 *
 * 项目契约 `contestFields` 是数组，加一项就是自定义字段；这里给本地生成的 id 一个前缀，
 * 好处是**重开弹层时只靠文件内容就能认出哪些是自定义行**，不必等模板列表加载完
 * （否则每换一次模板都要重新判定，判定错会让用户填的值看起来"丢了"）。
 */
/**
 * 「用户自己加的字段」的 id 前缀。
 *
 * ⚠️ 后缀里**不能带下划线**：项目契约 `contestFields` 的字段 id schema 是
 *    `z.string().min(1).max(64).regex(/^[a-z][A-Za-z0-9]*$/)`（从项目契约未混淆的渲染层
 *    bundle 里挖到，`Gk` 定义：`q().min(1).max(64).regex(/^[a-z][A-Za-z0-9]*$/)`）——
 *    小驼峰、只允许 [A-Za-z0-9]。所以前缀用 `custom`（而不是 `custom_`），
 *    后半段也只用 `toString(36)` 的字母数字。
 */
const CUSTOM_FIELD_PREFIX = 'custom';

// ── # 任务面板 ──
/**
 * 输入框里打 `#` 唤起的任务面板（2026-09-26 用户钦定的差异化改版）。
 *
 * 用户原话：「删除这个选择……改成和其他的智能体一样，打一个 # 然后后面出现一大列的选择，
 * 现在这个本质上也是选择哪个 skill 吧，改成大量的进行选择自己想要的，
 * 把全流程论文写作放在最上面的位置。」
 *
 * 与旧「任务模式」菜单的关系：
 *  - 旧菜单的六种模式 = 这里前六项（工作流项）：选中即切 `composerMode`（隐式命令前缀
 *    机制不变，`MODE_COMMAND` / WorkbenchPage 的 ask 流零漂移），并在输入框**显式**落下
 *    斜杠命令 —— 用户看得见自己选了什么；
 *  - 其余为细分任务项（对应真实内置技能）：只插入一句指令模板，不切模式；
 *  - 「全流程论文写作」按用户要求固定在第一位。
 */
interface HashTask {
  id: string;
  icon: string;
  /** 选中后替换 `#token` 的插入文本（命令带尾随空格，方便续写） */
  insert: string;
  /** 工作流项给出 —— 同时切换 composerMode；细分任务项不切 */
  mode?: ComposerMode;
  /** 过滤关键词（中英混合，仅用于匹配不进 i18n） */
  keywords: string[];
}
const HASH_TASKS: HashTask[] = [
  { id: 'paper', icon: 'file-text', insert: '/write-paper ', mode: 'paper', keywords: ['论文', '写作', 'write', 'paper', 'latex', '成稿', 'wp'] },
  { id: 'sprint', icon: 'zap', insert: '/competition-sprint ', mode: 'sprint', keywords: ['冲刺', '参赛', '72', '赛程', '比赛', 'sprint', 'schedule', 'cs'] },
  { id: 'figure', icon: 'chart-column', insert: '/draw-figures ', mode: 'figure', keywords: ['图', '绘图', '图表', '画图', 'figure', 'plot', 'chart', 'df'] },
  { id: 'review', icon: 'clipboard-check', insert: '/review-paper ', mode: 'review', keywords: ['评审', '评阅', '打分', '诊断', 'review', 'score', 'rp'] },
  { id: 'data', icon: 'database', insert: '/data-search ', mode: 'data', keywords: ['数据', '找数据', '下载', '数据集', 'data', 'dataset', 'ds'] },
  { id: 'chat', icon: 'message-square', insert: '', mode: 'chat', keywords: ['聊天', '对话', '自由', 'chat'] },
  { id: 'abstract', icon: 'pen-line', insert: '请使用 abstract-writer 技能撰写并润色摘要：', keywords: ['摘要', 'abstract', 'summary'] },
  { id: 'problem', icon: 'scan-eye', insert: '请使用 problem-parser 技能解析题目，输出目标、约束、决策变量与数据需求：', keywords: ['题目', '审题', '解析', 'problem', 'parser'] },
  { id: 'method', icon: 'target', insert: '请使用 method-selector 技能对比候选建模方法并给出选型建议：', keywords: ['方法', '选型', '模型选择', 'method'] },
  { id: 'literature', icon: 'book-open', insert: '请使用 literature-search 技能检索真实文献并核验可得性：', keywords: ['文献', '检索', 'literature', 'search', '论文搜索'] },
  { id: 'litReview', icon: 'notebook-tabs', insert: '请使用 literature-review 技能撰写文献综述：', keywords: ['综述', '文献综述', 'review'] },
  { id: 'citation', icon: 'text-quote', insert: '请使用 citation-management 技能整理文中引用与参考文献：', keywords: ['引用', '参考文献', 'citation', 'reference'] },
  { id: 'bibVerify', icon: 'shield-check', insert: '请使用 verifying-bibliography 技能逐条核验参考文献真实性：', keywords: ['核真', '参考文献', '真实性', 'bibliography', 'verify'] },
  { id: 'dataAudit', icon: 'file-spreadsheet', insert: '请使用 data-auditor-cleaner 技能审计并清洗 data/ 目录下的数据：', keywords: ['数据', '审计', '清洗', 'audit', 'clean'] },
  { id: 'robust', icon: 'activity', insert: '请使用 robustness-checker 技能做灵敏度与稳健性分析：', keywords: ['灵敏度', '稳健', '敏感性', 'robustness', 'sensitivity'] },
  { id: 'proof', icon: 'sigma', insert: '请使用 proof-audit 技能逐条审查推导与公式：', keywords: ['推导', '公式', '证明', 'proof', 'audit'] },
  { id: 'pagefit', icon: 'gauge', insert: '请使用 paper-page-fit 技能核验论文页数并压缩到比赛上限内：', keywords: ['页数', '压缩', 'page', 'fit'] },
  { id: 'table', icon: 'columns-2', insert: '请使用 table-layout-audit 技能检查表格宽度、裁切与分页：', keywords: ['表格', 'table', '裁切'] },
  { id: 'diagram', icon: 'git-branch', insert: '请使用 paper-diagram 技能绘制问题求解流程 / 模型结构图：', keywords: ['流程图', '结构图', 'diagram', 'flow'] },
  { id: 'figureTpl', icon: 'blocks', insert: '请使用 mathmodel-figure-templates 技能按论文场景选择建模图表模板：', keywords: ['图表', '模板', 'template'] },
  { id: 'submission', icon: 'package-check', insert: '请使用 submission-package-audit 技能按竞赛要求逐项检查提交材料：', keywords: ['提交', '检查', 'submission', '材料'] },
  { id: 'defense', icon: 'graduation-cap', insert: '请使用 defense-ppt 技能生成答辩提纲与幻灯片：', keywords: ['答辩', 'ppt', '幻灯片', 'defense'] },
];

// ── 思考强度 ──
/**
 * 推理强度档位。
 *
 * ⚠️ **必须与 SDK 的 `EffortLevel` 一致**（`sdk.d.ts:553`：
 * `'low' | 'medium' | 'high' | 'xhigh' | 'max'`）。渲染层不能直接 import SDK
 * （它只在主进程按需加载），所以这里手写；主进程侧 `agent/session.ts` 用
 * `Parameters<QueryFn>[0]['options']['effort']` 从 SDK 推导 ——
 * **两边不一致时，tsc 会在这里报 TS2820 把问题挡下来**，不会静默漏到运行时。
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
/** 项目契约模型 chip 默认显示「高」。设置里没选过时按 高 展示（不写回设置，避免挂载即写入） */
const DEFAULT_EFFORT: EffortLevel = 'high';
/**
 * 档位 → 词典键。
 *
 * ⚠️ **不能机械拼 `effort${首字母大写}`**：项目契约这两个档位的键名不是规则拼法 ——
 * `xhigh` 的键是 `effortExtra`（'超高'）、`max` 的键是 `effortMax`（'最大'）。
 * 机械拼会得到 `effortXhigh`，而那个键**在词典里不存在** ——
 * `tx()` 取不到值时会把**键路径原样渲染到界面上**（本项目的静默失败形态）。
 */
const EFFORT_LABEL_KEY: Record<EffortLevel, string> = {
  low: 'chat.modelPicker.effortLow',
  medium: 'chat.modelPicker.effortMedium',
  high: 'chat.modelPicker.effortHigh',
  xhigh: 'chat.modelPicker.effortExtra',
  max: 'chat.modelPicker.effortMax',
};
const effortLabel = (lv: EffortLevel): string => tx(EFFORT_LABEL_KEY[lv]);

const EFFORT_HINT: Record<EffortLevel, string> = {
  low: '快速回答',
  medium: '日常分析',
  high: '复杂建模',
  xhigh: '深入推演',
  max: '最深思考',
};

// ── 模型目录 ──
interface ModelOption {
  /** 所属服务商 id（内置目录为空串） */
  providerId: string;
  /** 显示给用户的服务商名称，便于多个供应商同名模型的区分 */
  providerName?: string;
  id: string;
  /** 右侧的上下文窗口徽标（项目契约：1M / 200K） */
  badge?: string;
}

/**
 * 内置模型目录 —— 项目契约 14-menu-model 列出的 5 个模型，直接采用。
 *
 * 数据来源优先级：**本机已配置的供应商/模型**（`useApp().providers`）；
 * 一个都没配时回落到这份内置目录，保证模型选择器与原生 UI 一致且可点选
 * （而不是只留一行「尚未配置供应商」的空态）。
 */
const BUILTIN_MODELS: ModelOption[] = [
  { providerId: '', id: 'claude-fable-5-1' },
  { providerId: '', id: 'claude-fable-5', badge: '1M' },
  { providerId: '', id: 'claude-opus-5', badge: '1M' },
  { providerId: '', id: 'claude-sonnet-5', badge: '1M' },
  { providerId: '', id: 'claude-haiku-4-5', badge: '200K' },
];

/** 未配置任何模型时 chip 显示哪个（项目契约选中项就是 claude-sonnet-5） */
const DEFAULT_MODEL_ID = 'claude-sonnet-5';

/** 供应商自带的模型名里若写了 `[1M]` / `[200K]`，取出来当徽标 */
function badgeOf(modelId: string): string | undefined {
  const m = /\[(1M|200K|500K|2M)\]/i.exec(modelId);
  return m ? m[1].toUpperCase() : undefined;
}

/**
 * 「完全访问」的图标 —— lucide `shield-alert`（盾牌 + 感叹号）。
 *
 * 图标表里只提取到了 `shield-check`，而项目契约 15-menu-permission 用的是带感叹号的
 * 盾牌（托盘文案也是「完全访问」而非「已批准」）。图标在这里直接绘制，
 * 避免为一个小图标改动整张图标数据表。
 */
function ShieldAlertIcon({ size = 13 }: { size?: number }): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block' }}
      aria-hidden
      data-icon="shield-alert"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

/**
 * 附件图标选择。
 *
 * 项目契约渲染附件只有两种形态：图片给缩略图，其余给「小图标 + 文件名」。
 * 这里对齐它 —— **只用图标区分类型，不显示任何文字标签**。
 * （曾经用文字徽标且无扩展名时退化成英文 "file"，界面上会突然冒出一个英文单词。）
 */
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);
const FILE_ICON: Record<string, string> = {
  pdf: 'file-text',
  tex: 'file-code-corner',
  bib: 'file-text',
  md: 'file-text',
  txt: 'file-text',
  doc: 'file-text',
  docx: 'file-text',
  csv: 'file-spreadsheet',
  xls: 'file-spreadsheet',
  xlsx: 'file-spreadsheet',
  json: 'file-braces',
  yaml: 'file-braces',
  yml: 'file-braces',
  py: 'file-code-corner',
  ipynb: 'file-code-corner',
  m: 'file-code-corner',
  r: 'file-code-corner',
  zip: 'file-archive',
  '7z': 'file-archive',
  tar: 'file-archive',
  gz: 'file-archive',
  mp3: 'file-music',
  wav: 'file-music',
};

interface Attachment {
  id: string;
  name: string;
  /**
   * 小写扩展名（不含点），用于挑图标。空串表示没有扩展名。
   *
   * ⚠️ 早先这里是个文字徽标，还写成 `ext || 'file'` —— 没有扩展名的文件
   *    会在附件上渲染出英文单词 "file"。**项目契约没有这种东西**：
   *    它渲染附件只有两种形态 —— 图片给缩略图，其余给「小图标 + 文件名」。
   *    所以这里只保留扩展名用来选图标，不显示任何文字标签。
   */
  ext: string;
  path?: string;
}


/** 发送选项 —— 目前只有「本次取反」（Ctrl/Cmd+Enter 触发） */
export interface ComposerSendOptions {
  displayText?: string;
  /**
   * **对设置里选的行为取反**（不是恒定打断）。
   * 项目契约设置页描述：「Ctrl/Cmd+Enter 可为单条消息临时使用相反行为」——
   * 所以设置为「排队」时它打断，设置为「调整当前任务」时它排队。
   */
  invertFollowUp?: boolean;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  /**
   * 发送。**参数是拼装好的最终文本**（含模式命令、附件路径、比赛信息），
   * 由父级直接发给 Agent。
   *
   * 回合运行中要不要入队、要不要打断，由**父级**按设置决定（见 ChatPage.doSend）；
   * 这里只把「这次取反」作为覆盖项传下去。
   *
   * ⚠️ 不要改成「先 onChange 再 queueMicrotask(onSend)」那种写法：
   *    React 的 state 更新是异步的，父级闭包里读到的 value 会是旧值。
   */
  onSend: (text: string, opts?: ComposerSendOptions) => void;
  onAbort: () => void;
  isRunning: boolean;
  isStopping?: boolean;
  /** 文本框 ref 由父级持有（自动撑高 / 聚焦用） */
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  /** 空会话时居中显示（去掉上边框） */
  inline?: boolean;
  /** SDK 实测的当前上下文窗口，不使用历史消息累计值冒充。 */
  contextUsage?: {
    capacitySource?: 'configured' | 'known' | 'reference';
    estimated?: boolean;
    used: number;
    total: number;
    percentage: number;
    autoCompactThreshold?: number;
    autoCompactEnabled: boolean;
    autoCompactState?: 'guaranteed' | 'unknown' | 'failed';
    compacted?: boolean;
  };
}

/**
 * 追问队列徽标 —— 回合运行中按 Enter 走「排队」时，积压的消息在这里可见：
 * 几条、分别是哪条、哪条失败了。失败条目**留在原位**并标红，自动消化停在它那里
 * （不静默丢弃，也不对同一条无限重试），右侧「重试」清掉标记继续。
 *
 * 为什么抽成独立组件：SSR（renderToStaticMarkup）下 zustand 只能读到初始 state，
 * 直接渲染整个 Composer 是断言不到动态队列的；拆出来就能单独喂数据做渲染回归。
 */
export function FollowUpQueueBadge({
  queue,
  onRemove,
  onRetry,
  onClear,
}: {
  queue: QueuedFollowUp[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onClear: () => void;
}): JSX.Element | null {
  if (queue.length === 0) return null;
  return (
    <div className="cz-queue">
      <span className="cz-queue-head">
        <Icon name="list-checks" size={13} />
        <span className="cz-queue-title">{t('已排队 {{count}} 条', { count: queue.length })}</span>
        <span className="cz-queue-hint">{t('回合结束后按顺序自动发出')}</span>
        <span className="grow" />
        <button className="cz-queue-clear" onClick={onClear}>
          {t('全部清除')}
        </button>
      </span>
      {queue.map((q, i) => (
        <span key={q.id} className={`cz-queue-item${q.error ? ' is-failed' : ''}`}>
          <span className="cz-queue-idx">{i + 1}</span>
          <span className="truncate" title={q.displayText ?? q.text}>
            {q.displayText ?? q.text}
          </span>
          {q.error ? (
            <>
              <span className="cz-queue-err">{q.error}</span>
              <button className="cz-queue-retry" onClick={() => onRetry(q.id)}>
                {t('重试')}
              </button>
            </>
          ) : null}
          <button className="cz-chip-x" title={t('从队列移除这条')} onClick={() => onRemove(q.id)}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  onAbort,
  isRunning,
  isStopping = false,
  textareaRef,
  inline,
  contextUsage,
}: ComposerProps): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const projects = useApp((s) => s.projects);
  const providers = useApp((s) => s.providers);
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const openProject = useApp((s) => s.openProject);
  const createProject = useApp((s) => s.createProject);
  const setSidePanel = useApp((s) => s.setSidePanel);

  // ── 追问队列（「设置 → 对话 → 追问行为 = 排队」时积压的消息）──
  /**
   * 回合运行中排队的追问 —— 徽标要把「已排队 N 条」显示出来。
   *
   * ⚠️ 徽标只统计**属于当前会话**的条目（`followUpItemsFor`，与出队同一口径）：
   *    队列本身是全局的，但消化只吃当前会话的那一份 ——
   *    在 B 里显示「已排队 3 条」却一条也发不出去、点开还管不了，是拿数字骗人。
   */
  const followUpQueue = useApp((s) => s.followUpQueue);
  const activeSessionId = useApp((s) => s.activeSessionId);
  const myFollowUps = followUpItemsFor(followUpQueue, activeSessionId);
  const removeFollowUp = useApp((s) => s.removeFollowUp);
  const retryFollowUp = useApp((s) => s.retryFollowUp);
  const clearFollowUps = useApp((s) => s.clearFollowUps);

  /** 内部 ref，父级没传时自己用 */
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? innerRef;

  // ── 下拉开关 ──
  const [openMenu, setOpenMenu] = useState<
    null | 'project' | 'decision' | 'quality' | 'template' | 'perm' | 'model' | 'plus' | 'options'
  >(null);
  const [contextOpen, setContextOpen] = useState(false);

  // ── # 任务面板（输入 `#` 唤起，见 HASH_TASKS 注释）──
  /** start = `#` 字符在 value 中的下标；query = `#` 到光标之间的过滤词 */
  const [hash, setHash] = useState<{ start: number; query: string } | null>(null);
  const [hashIndex, setHashIndex] = useState(0);
  /** 光标前的文本以 `#token` 结尾（# 在行首或空白后）⇒ 面板打开 */
  const detectHash = (text: string, caret: number): void => {
    const before = text.slice(0, caret);
    const m = /(^|\s)#([^\s#]*)$/.exec(before);
    if (m) {
      setHash({ start: caret - m[2].length - 1, query: m[2] });
      setHashIndex(0);
    } else {
      setHash(null);
    }
  };
  const hashItems = useMemo<HashTask[]>(() => {
    if (!hash) return [];
    const q = hash.query.trim().toLowerCase();
    if (!q) return HASH_TASKS;
    return HASH_TASKS.filter(
      (it) =>
        tx(`composer.hashPalette.items.${it.id}`).toLowerCase().includes(q) ||
        tx(`composer.hashPalette.items.${it.id}Description`).toLowerCase().includes(q) ||
        it.keywords.some((k) => k.toLowerCase().includes(q)),
    );
    // tx 是模块级函数（非 hook），不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);
  /** 选中一项：替换 `#token` 为插入文本；工作流项带上中文名让输入框可见（2026-09-26 用户要求） */
  const applyHashTask = (task: HashTask): void => {
    if (!hash) return;
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    // 工作流项：'/write-paper ' + '全流程论文写作' + '：' —— 命令仍可被 SDK 识别，
    // 后面的中文是给用户看的任务名，接着写题目即可；细分任务项 insert 本身已是完整句子
    const insert = task.mode
      ? `${task.insert}${tx(`composer.hashPalette.items.${task.id}`)}：`
      : task.insert;
    const next = value.slice(0, hash.start) + insert + value.slice(caret);
    onChange(next);
    if (task.mode) void patchSettings({ composerMode: task.mode });
    setHash(null);
    // 光标落在插入文本末尾；顺带复算高度（value 变了但没走 textarea 的 onChange）
    requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
      const pos = hash.start + insert.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  // ── 「＋」菜单（项目契约 `data-tour="composer-plus"` 那个 Popover）──
  /**
   * 二级子菜单开关。与「思考强度」同一套"悬停展开 + 点击固定 + 延时关闭"，
   * 只是这里要记**哪一个**子菜单开着。
   */
  const [plusSub, setPlusSub] = useState<PlusSubmenuId | null>(null);
  const plusSubTimer = useRef<number | null>(null);
  /**
   * ⚠️ 这里**故意没有** `research` / `webSearch` 两个开关的 state。
   *
   * 项目契约那两个开关是"只有状态、没有消费者"的（拨了不改变任何东西，取证贴在
   * `PlusMenu.tsx` 文件头），所以当前实现把它们降级成**不可交互的展示项**，
   * 不再持有状态 —— 见裁决「宁可少一个开关，也不要多一个骗人的开关」。
   */
  /** 数据集子菜单里要列的文件（打开菜单时扫一次当前项目） */
  const [plusDatasets, setPlusDatasets] = useState<PlusDatasetEntry[]>([]);
  const skills = useApp((s) => s.skills);

  const close = useCallback(() => {
    setOpenMenu(null);
    setPlusSub(null);
    if (plusSubTimer.current !== null) {
      window.clearTimeout(plusSubTimer.current);
      plusSubTimer.current = null;
    }
  }, []);

  // ── 模板 ──
  const [templates, setTemplates] = useState<PaperTemplate[]>([]);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplLoadFailed, setTplLoadFailed] = useState(false);
  const [paperFields, setPaperFields] = useState<Record<string, string>>({});
  const [pageLimitDraft, setPageLimitDraft] = useState<PaperPageLimitDraft>(EMPTY_PAGE_LIMIT);
  const [setupOpen, setSetupOpen] = useState(false);
  /**
   * 用户**自己加**的比赛字段（项目契约 `contestFields` 是数组，加一项就是自定义字段）。
   * 只存 id + label，值统一在 `paperFields[id]` 里，读写只有一处。
   */
  const [customFields, setCustomFields] = useState<{ id: string; label: string }[]>([]);
  /** 当前本地比赛信息属于哪个项目；未读完时为 null，禁止把上一项目的值保存过去。 */
  const [paperConfigProjectId, setPaperConfigProjectId] = useState<string | null>(null);
  /**
   * 项目配置里当前的 `template` 原样（含 `source`/`sourcePath`）。
   * 保存时要与它比对：同 id 就**不要把 source 改回 builtin** ——
   * 否则用户在设置页选了「自定义模板目录」，一开比赛信息弹层就被打回内置。
   * 同时它也是「自定义模板源」下弹层仍能打开的依据（那时没有内置 template 元数据）。
   */
  const [srcTpl, setSrcTpl] = useState<PaperTemplateRef | null>(null);

  // ⚠️ 兜底必须是 'paper' 而不是 'chat'。
  //    项目契约 composerMode 默认就是 "paper"（zod schema 与运行时兜底都是），
  //    只有 paper 模式才会显示「比赛模板选择器 + 比赛信息」，并把占位文字
  //    换成「粘贴题目，或拖入题目 PDF / 附件…」。
  //    兜底写成 chat 会让首屏看不到任何比赛相关内容 —— 用户会以为功能没做。
  const mode: ComposerMode = settings?.composerMode ?? 'paper';
  /**
   * 决策模式：新键 `decisionMode` 优先；老数据只有 `planMode: true` 时视为 plan。
   * planMode 保留为 decisionMode 的投影（见 DecisionMode 注释），派生一次供横幅等复用。
   */
  const decisionMode: DecisionMode =
    settings?.decisionMode ?? (settings?.planMode === true ? 'plan' : 'manual');
  const planMode = decisionMode === 'plan';
  const multiAgentEnabled = settings?.multiAgentEnabled !== false;
  const qualityMode = settings?.modelingQualityMode ?? 'balanced';
  const qualityLabel = qualityMode === 'fast' ? '快速' : qualityMode === 'strict' ? '深度' : '标准';

  // ── 决策模式切换（统一入口）──
  /** 从 plan 切走时回到的模式（Shift+Tab 来回切换用） */
  const lastDecisionRef = useRef<DecisionMode>('manual');
  /**
   * 写决策模式的**唯一出口**：同时把 planMode 投影写盘 ——
   * 主进程的 interactionMode 与 buildSystemPrompt 仍读 planMode（2026-09-20 决策：
   * 不动主进程老读取点，渲染层负责两键一致）。
   */
  const patchDecisionMode = useCallback(
    (next: DecisionMode): void => {
      if (next !== 'plan') lastDecisionRef.current = next;
      void patchSettings({ decisionMode: next, planMode: next === 'plan' });
    },
    [patchSettings],
  );
  /** plan ↔ 上一个非 plan 决策模式（Shift+Tab 快捷键用） */
  const toggleDecisionMode = useCallback((): void => {
    patchDecisionMode(decisionMode === 'plan' ? lastDecisionRef.current : 'plan');
  }, [decisionMode, patchDecisionMode]);
  const perm: PermissionMode = settings?.permissionMode ?? 'full';
  // 项目里已经保存过模板时，以项目配置为准；全局值只作为“新项目尚未配置”的默认模板。
  const templateId =
    srcTpl?.source === 'builtin' && srcTpl.id ? srcTpl.id : settings?.paperTemplateId ?? null;
  const template = templates.find((t) => t.id === templateId) ?? null;

  /**
   * 该写进配置的模板来源。
   *
   * `srcTpl` 与当前内置模板同 id → 原样沿用（保住 `source='custom'` + `sourcePath`）；
   * 否则说明用户换过模板 → 按内置模板生成一份新的 ref。
   */
  const templateRefForSave = useCallback((): PaperTemplateRef | null => {
    // 磁盘上已经是「自定义模板源」时，弹层**不下发**内置模板 ——
    // 否则用户在设置页选好的 source='custom' + sourcePath 会被这里的默认值静默打回 builtin。
    // 想换回内置只有一条路：设置页的「恢复内置模板」。
    if (srcTpl?.source === 'custom') return srcTpl;
    if (srcTpl && template && srcTpl.id === template.id) return srcTpl;
    if (!template) return srcTpl;
    return {
      id: template.id,
      // 落成项目契约 `Np` 对象（两键必填非空）；en 取 template.json 的 name.en
      name: makeLocalizedText(template.name, template.nameEn),
      entryFile: template.entryFile,
      source: 'builtin',
      sourcePath: null,
    };
  }, [srcTpl, template]);

  /** 弹层里能渲染的「模板」：内置元数据优先，其次项目里已有的自定义来源 */
  const effectiveTpl: {
    name: string;
    description: string;
    fields: PaperTemplateField[];
    source: string;
    sourcePath?: string | null;
  } | null = (() => {
    const ref = templateRefForSave();
    // 磁盘上的 `ref.name` 现在是项目契约 `Np` 对象 —— 渲染前按界面语言取一个字符串
    const lang = settings?.locale ?? 'zh-CN';
    if (template) {
      // 自定义模板源下，名字/描述以磁盘上的 ref 为准 ——
      // 内置元数据是按 settings.paperTemplateId 选的，跟自定义源不是同一个东西。
      const custom = ref?.source === 'custom';
      return {
        name: custom ? pickLocalizedText(ref?.name, lang) || ref?.id || template.name : template.name,
        description: custom ? '' : template.description,
        fields: template.fields,
        source: ref?.source ?? 'builtin',
        sourcePath: ref?.sourcePath ?? null,
      };
    }
    return srcTpl
      ? {
          name: pickLocalizedText(srcTpl.name, lang) || srcTpl.id,
          description: '',
          fields: [],
          source: srcTpl.source,
          sourcePath: srcTpl.sourcePath,
        }
      : null;
  })();

  /** 组装要落盘的 contestFields：模板自带的在前，用户自定义的在后（顺序稳定，便于比对） */
  const contestFieldsForSave = useCallback((): PaperContestField[] => {
    const out: PaperContestField[] = [];
    // 写侧**一律落成项目契约 `Np` 对象**：模板自带字段的 en 取 template.json 的
    // `fields[].label.en`（如「题号」→「Problem」）；用户手填的自定义字段只有中文名，
    // en 用中文原文兜底 —— 但两个键都必须非空（项目契约 `Np` 是 `min(1)`）。
    for (const f of template?.fields ?? []) {
      const v = (paperFields[f.id] ?? '').trim();
      if (v) out.push({ id: f.id, label: makeLocalizedText(f.label, f.labelEn), value: v });
    }
    for (const c of customFields) {
      const v = (paperFields[c.id] ?? '').trim();
      if (v) out.push({ id: c.id, label: makeLocalizedText(c.label.trim() || c.id), value: v });
    }
    return out;
  }, [template, paperFields, customFields]);

  const addCustomField = useCallback((): void => {
    // 后缀只用 base36 的字母数字，整体满足项目契约 id schema（见 CUSTOM_FIELD_PREFIX 注释）
    const id = `${CUSTOM_FIELD_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    setCustomFields((prev) => [...prev, { id, label: '' }]);
  }, []);

  const removeCustomField = useCallback((id: string): void => {
    setCustomFields((prev) => prev.filter((c) => c.id !== id));
    setPaperFields((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /**
   * 读取模板列表。
   *
   * 这里不能只在组件挂载时读一次：便携版刚启动、资源仍在解包，或旧进程的临时目录
   * 曾被清理时，第一次读取可能暂时为空。以前 catch 后就永久保留 []，并且「比赛信息」
   * 又依赖 effectiveTpl 才渲染，于是用户只能重启软件。现在弹层入口始终保留，点击即可重试。
   */
  const loadTemplates = useCallback(async (): Promise<void> => {
    setTplLoading(true);
    try {
      const r = await window.mathmodel.paper.templates();
      const next = r.templates ?? [];
      setTemplates(next);
      setTplLoadFailed(next.length === 0);
    } catch {
      setTplLoadFailed(true);
    } finally {
      setTplLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadTemplates().catch(() => {
      if (!cancelled) setTplLoadFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loadTemplates]);

  /**
   * 没人选过比赛时，自动认领一个。
   *
   * 规则直接采用模板自带的标记：优先 `defaultFor` 命中当前语言的，其次 `order` 最小的。
   * 中文界面下就是 `cumcm`（国赛 CUMCM）—— 与项目契约首屏一致。
   *
   * ⚠️ 不做这一步，输入区只会显示「暂无模板」，
   *    而「比赛信息」按钮依赖 template 才渲染，于是永远不出现 ——
   *    用户看到的就是"没有比赛选择、也没有比赛信息"，会认为功能没做。
   */
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || templateId || templates.length === 0) return;
    autoPicked.current = true;
    const locale = settings?.locale ?? 'zh-CN';
    const base = locale.split('-')[0];
    const preferred =
      templates.find((t) => t.defaultFor.includes(locale)) ??
      templates.find((t) => t.defaultFor.some((l) => l.split('-')[0] === base)) ??
      templates[0];
    if (preferred) void patchSettings({ paperTemplateId: preferred.id });
  }, [templates, templateId, settings?.locale, patchSettings]);

  /** 模板名按界面语言挑（template.json 自带 name.en，如 cumcm → 'CUMCM'） */
  const tplName = (tp: { name: string; nameEn?: string } | null | undefined): string =>
    !tp ? '' : settings?.locale === 'en-US' && tp.nameEn ? tp.nameEn : tp.name;
  /** 模板描述按界面语言挑 */
  const tplDesc = (tp: { description: string; descriptionEn?: string } | null | undefined): string =>
    !tp ? '' : settings?.locale === 'en-US' && tp.descriptionEn ? tp.descriptionEn : tp.description;

  // 读当前项目的比赛信息。
  // ⚠️ 依赖里带上 `setupOpen`：弹层每次开/合都重新读一遍磁盘 ——
  //    否则「设置页刚改完模板源 → 回聊天填比赛信息」用的还是打开项目时的旧快照。
  useEffect(() => {
    let cancelled = false;
    // 切换项目的同一帧先清空旧值。以前这里要等 IPC 返回才替换，用户若立即打开并保存，
    // 会把上一项目的比赛字段写进新项目，视觉上也像“所有项目共用一份”。
    setPaperConfigProjectId(null);
    setPaperFields({});
    setPageLimitDraft(EMPTY_PAGE_LIMIT);
    setCustomFields([]);
    setSrcTpl(null);
    if (!project) {
      return;
    }
    const targetProjectId = project.id;
    void (async () => {
      try {
        const r = await window.mathmodel.paper.getConfig(targetProjectId);
        if (cancelled) return;
        const list = r.config?.contestFields ?? [];
        const values: Record<string, string> = {};
        for (const f of list) values[f.id] = f.value;
        setPaperFields(values);
        const limit = r.config?.pageLimit;
        setPageLimitDraft(
          limit
            ? {
                maxPages: String(limit.maxPages),
                scope: limit.scope,
                startPage: limit.startPage ? String(limit.startPage) : '',
                endPage: limit.endPage ? String(limit.endPage) : '',
              }
            : EMPTY_PAGE_LIMIT,
        );
        // 「自定义字段」的判定：id 带本地生成的前缀（见 addCustomField）。
        // 用前缀而不是「不在 template.fields 里」是为了不依赖模板列表是否已加载 ——
        // 否则模板还没到就先渲染成自定义行，会闪一下。
        setCustomFields(
          list
            .filter((f) => f.id.startsWith(CUSTOM_FIELD_PREFIX))
            // 读侧兼容：磁盘上的 `label` 可能是项目契约 `Np` 对象，也可能是早期版本写下的
            // 普通字符串 —— 只认一种，用户存好的字段名就丢了。
            .map((f) => ({ id: f.id, label: pickLocalizedText(f.label, settings?.locale ?? 'zh-CN') })),
        );
        setSrcTpl(r.config?.template ?? null);
        setPaperConfigProjectId(targetProjectId);
      } catch {
        if (!cancelled) setNotice(t('暂时无法读取这个项目的比赛信息，请重试'));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id, setupOpen]);

  // ── 附件 ──
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  /**
   * 折叠起来的粘贴长文本。
   *
   * ⚠️ 与 `attachments` 是**两个独立数组**（项目契约也是两个独立 setter）：
   *    附件走「路径清单」进正文，粘贴文本走正文末尾的 `<pasted_text>` 尾巴，
   *    两者在发送时的拼法完全不同，合并成一个数组会分不开。
   */
  const [pastedTexts, setPastedTexts] = useState<PastedText[]>([]);
  /** 有文件拖到输入区上方时为真，用来显示落点提示 */
  const [dragging, setDragging] = useState(false);
  /** 路径解析失败的提示（拖进来的文件拿不到磁盘路径就没法交给 Agent） */
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * 保存项目论文配置，并**如实把失败原因显示出来**。
   *
   * 之前这两个调用点是 `void saveConfig(...)` —— 失败被完全吞掉：用户点了「保存」，
   * 项目里那份 `.mathmodel/paper/config.json` 是用户手写的（`managedBy` 不是 mathmodel）
   * 时，主进程按项目契约语义**拒绝写入**，而界面一声不响，用户以为存上了。
   * 现在三种原因各自对应项目契约那条文案（`chat.newChatPage.paperConfig*`）。
   */
  const savePaperConfig = useCallback(async (patch: PaperConfigPatch): Promise<void> => {
    const targetProjectId = project?.id;
    if (!targetProjectId || paperConfigProjectId !== targetProjectId) {
      setNotice(t('正在读取当前项目的比赛信息，请稍候再保存'));
      return;
    }
    try {
      const r = await window.mathmodel.paper.saveConfig(patch, targetProjectId);
      if (r?.ok) {
        setNotice(null);
        return;
      }
      setNotice(
        r?.reason === 'config-conflict'
          ? tx('chat.newChatPage.paperConfigConflict')
          : r?.reason === 'unsafe-path'
            ? tx('chat.newChatPage.paperConfigUnsafePath')
            : tx('chat.newChatPage.paperConfigSaveFailed'),
      );
    } catch {
      setNotice(tx('chat.newChatPage.paperConfigSaveFailed'));
    }
  }, [project?.id, paperConfigProjectId]);

  /**
   * 把「系统拖入 / 剪贴板粘贴」进来的 File 对象登记为附件。
   *
   * ⚠️ 必须走 `webUtils.getPathForFile()` 才能拿到真实磁盘路径 ——
   *    Electron 32 起 `File.path` 已被移除，直接读是 undefined。
   *    而 Agent 只能靠**绝对路径**读文件，所以拿不到路径的文件对我们没有价值，
   *    与其塞一个假的 chip 让用户以为传上去了，不如明确跳过并告知。
   */
  const addFromFiles = useCallback((files: File[]): void => {
    if (!files.length) return;
    const next: Attachment[] = [];
    let skipped = 0;
    for (const [i, f] of files.entries()) {
      let p = '';
      try {
        p = window.mathmodel.app.getPathForFile(f);
      } catch {
        /* 拿不到就算了，下面统一计数 */
      }
      if (!p) {
        skipped++;
        continue;
      }
      const name = f.name || (p.split(/[\\/]/).pop() ?? p);
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      next.push({ id: `att-${Date.now()}-${i}`, name, ext, path: p });
    }
    if (next.length) setAttachments((prev) => [...prev, ...next]);
    setNotice(
      skipped
        ? t('有 {{n}} 个文件无法取得磁盘路径（可能来自网页拖拽），已跳过。请用 ＋ 按钮从本机选择。', { n: skipped })
        : null,
    );
    if (next.length && skipped === 0) setNotice(null);
  }, []);

  const removeAttachment = (id: string): void =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  // ── 「＋」菜单：添加文件（⌘U）──────────────────────────────
  /**
   * 从**绝对路径**登记附件。
   *
   * `addFromFiles` 那条路是给"拖入 / 粘贴"的 `File` 对象用的（要 `getPathForFile`
   * 把 File 换成路径）；而系统「选择文件」对话框**直接给路径**，没必要再绕一圈 File。
   */
  const addFromPaths = useCallback((paths: string[]): void => {
    if (!paths.length) return;
    const next: Attachment[] = paths.map((p, i) => {
      const name = p.split(/[\\/]/).pop() ?? p;
      const ext = (name.split('.').pop() ?? '').toLowerCase();
      return { id: `att-${Date.now()}-${i}`, name, ext, path: p };
    });
    setAttachments((prev) => [...prev, ...next]);
    setNotice(null);
  }, []);

  /**
   * 弹系统「选择文件」对话框并把选中的文件挂成附件 —— 这就是 `composer.attach`
   * 那条命令（⌘U）与「＋」菜单首行共用的动作。
   *
   * ⚠️ 在这之前，附件入口**只有拖入和粘贴**：`addFromFiles` 的提示语里那句
   *    "请用 ＋ 按钮从本机选择"当时是**假的**（点了 ＋ 是推开右栏文件面板）。
   */
  const pickAttachments = useCallback((): void => {
    void window.mathmodel.file
      .selectFiles()
      .then((paths) => {
        if (paths?.length) addFromPaths(paths);
      })
      .catch(() => {
        /* 对话框被系统拒绝/取消都不该冒泡成未处理 rejection */
      });
  }, [addFromPaths]);

  // ⌘U —— 项目契约 `Vk` 里 `composer.attach` 的键位，走统一分发器（不要再挂 keydown 监听）
  useEffect(
    () => registerCommand('composer.attach', () => pickAttachments()),
    [pickAttachments],
  );

  /**
   * 把一段文本放进输入框 —— 「＋」菜单里三个"插入"项共用（技能 / 图库模板 / 数据集路径）。
   *
   * 语义是**替换**，与本仓既有那条一致（`ChatPage.tsx:645` 取走 `pendingPrompt` 时
   * 也是 `setInput(pending)`）。插入后把光标和高度也一起收拾好，否则
   * 大段模板提示词会顶着一个 2 行高的输入框。
   */
  const insertIntoComposer = useCallback(
    (text: string): void => {
      onChange(text);
      requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
      });
    },
    [onChange, ref],
  );

  /** 打开「＋」菜单时扫一次当前项目的数据文件（项目契约这三行是写死的样例名） */
  useEffect(() => {
    if (openMenu !== 'plus' || !project) return;
    let alive = true;
    void window.mathmodel.dataset
      .list()
      .then((r) => {
        if (!alive) return;
        const files = (r as { files?: Array<{ relPath: string; name: string }> }).files ?? [];
        setPlusDatasets(files.map((f) => ({ relPath: f.relPath, name: f.name })));
      })
      .catch(() => {
        if (alive) setPlusDatasets([]);
      });
    return () => {
      alive = false;
    };
  }, [openMenu, project]);

  /** 二级子菜单：悬停展开（与「思考强度」同一套延时，140ms） */
  const openPlusSub = useCallback((id: PlusSubmenuId): void => {
    if (plusSubTimer.current !== null) {
      window.clearTimeout(plusSubTimer.current);
      plusSubTimer.current = null;
    }
    setPlusSub(id);
  }, []);
  /** 悬停离开时延迟收起 —— 鼠标从父行移到子菜单的路上有间隙，立刻关会闪 */
  const holdPlusSub = useCallback((): void => {
    if (plusSubTimer.current !== null) window.clearTimeout(plusSubTimer.current);
    plusSubTimer.current = window.setTimeout(() => {
      plusSubTimer.current = null;
      setPlusSub(null);
    }, 140);
  }, []);
  const togglePlusSub = useCallback((id: PlusSubmenuId): void => {
    setPlusSub((cur) => (cur === id ? null : id));
  }, []);

  const plusSkills: PlusSkillEntry[] = useMemo(
    () => skills.filter((s) => s.enabled).map((s) => ({ dirName: s.dirName, name: s.name })),
    [skills],
  );
  const plusConnectors = useMemo(
    () => (settings?.mcpServers ?? []).map((m) => m.name),
    [settings],
  );
  const managePlus = useCallback((section: PlusManageSection): void => {
    openRoute('extensions', undefined, section);
  }, []);

  // ── 模式覆盖：用户在输入框里手打了 /命令 就不再附加预设 ──
  const manualCommand = /^\s*\/\S+/.test(value);
  const effectiveCommand = manualCommand ? null : MODE_COMMAND[mode];

  /**
   * 真正发送时把模式命令、附件、比赛信息拼进去，交给父级发送。
   *
   * 回合运行中这里**不再直接中止**：按设置该排队还是该打断，由父级
   * （ChatPage.doSend，读 `mm-follow-up-behavior`）决定；
   * 鼠标点「停止」按钮仍然走 onAbort（那个按钮在运行中就是停止语义）。
   * `invert` 只有 Ctrl/Cmd+Enter 会传 —— 让本次改用设置里那个值的反面。
   */
  const handleSend = (invert = false): void => {
    const parts: string[] = [];
    if (effectiveCommand) parts.push(effectiveCommand);
    if (attachments.length) {
      parts.push(`参考以下文件：\n${attachments.map((a) => `- ${a.path ?? a.name}`).join('\n')}`);
    }
    if (effectiveTpl) {
      // 用 contestFieldsForSave() 而不是直接遍历 paperFields：顺序稳定（模板字段在前、
      // 自定义字段在后），并且带上 label —— 用户自定义的字段名（"组别"）才是模型要看的。
      // ⚠️ `label` 是项目契约 `Np` 对象，拼进正文前必须按语言解析，否则会写出 `[object Object]`。
      const lang = settings?.locale ?? 'zh-CN';
      const kv = contestFieldsForSave();
      if (kv.length) {
        parts.push(
          `比赛信息（${effectiveTpl.name}）：\n${kv
            .map((f) => `- ${pickLocalizedText(f.label, lang)}: ${f.value}`)
            .join('\n')}`,
        );
      }
      const pageLimit = pageLimitFromDraft(pageLimitDraft);
      if (pageLimit && (mode === 'paper' || mode === 'review' || mode === 'sprint')) {
        const range =
          pageLimit.scope === 'total'
            ? '整份 PDF'
            : `正文${pageLimit.startPage ? `从 PDF 第 ${pageLimit.startPage} 页开始` : '起始页自动识别'}${
                pageLimit.endPage ? `，到第 ${pageLimit.endPage} 页结束` : '，结束页自动识别'
              }`;
        parts.push(
          `页数要求：${range}，最多 ${pageLimit.maxPages} 页。写作完成后必须调用 paper-page-fit 检查并压缩到上限内。`,
        );
      }
    }
    const body = value.trim();
    if (body) parts.push(body);
    // ★1 空判据也要算上 pastedTexts：只粘了一段长文、一个字没打，也应该能发出去
    if (parts.length === 0 && pastedTexts.length === 0) return;

    // 附件已随消息送出，清掉 chips 避免下一条重复带
    setAttachments([]);
    // ★2 粘贴 chip 同理：发完就清，否则下一条会把同一段长文再送一遍
    setPastedTexts([]);
    // ★3 尾巴**不进 parts**：照项目契约 `n0e` 用两个换行接在正文**之后**（见 lib/pasted-text.ts）。
    //    不要把 serializePasted(...) 塞进 parts —— 那会让尾巴与「参考以下文件：…」
    //    这类段落平级，正文为空时还会多出一个前导换行。
    // 最终文本交给父级（父级负责清空输入框）
    const displayText = [body, ...pastedTexts.map(p => p.text),
      ...(attachments.length ? [`附件：${attachments.map(a => a.name).join('、')}`] : [])].filter(Boolean).join('\n\n');
    onSend(appendPasted(parts.join('\n\n'), pastedTexts), { displayText, ...(invert ? { invertFollowUp: true } : {}) });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // # 任务面板打开时接管导航键（IME 组合中不拦，让输入法先收字）
    if (hash && hashItems.length > 0 && !e.nativeEvent.isComposing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHashIndex((i) => (i + 1) % hashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHashIndex((i) => (i - 1 + hashItems.length) % hashItems.length);
        return;
      }
      if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
        e.preventDefault();
        applyHashTask(hashItems[Math.min(hashIndex, hashItems.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setHash(null);
        return;
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      toggleDecisionMode();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!value.trim() && attachments.length === 0 && pastedTexts.length === 0) return;
      // Ctrl/Cmd+Enter = 本次取反（项目契约：「临时使用相反行为」）；普通 Enter 按设置走
      handleSend(e.ctrlKey || e.metaKey);
    }
  };

  // ── 模型 / 思考强度 ──────────────────────────────────────
  /**
   * 可选模型列表：优先本机已配置的供应商，一个都没有时回落到内置目录。
   * 内置目录对齐项目契约 14-menu-model 的 5 项，保证未配置时菜单也不是空的。
   */
  const modelOptions = useMemo<ModelOption[]>(() => {
    const fromProviders: ModelOption[] = [];
    for (const p of providers) {
      for (const m of p.models ?? []) {
        fromProviders.push({ providerId: p.id, providerName: p.name, id: m, badge: badgeOf(m) });
      }
    }
    return fromProviders.length > 0 ? fromProviders : BUILTIN_MODELS;
  }, [providers]);

  /** 当前模型：设置里没选过就默认 claude-sonnet-5（项目契约选中项） */
  const model =
    settings?.defaultModel ||
    (modelOptions.some((o) => o.id === DEFAULT_MODEL_ID)
      ? DEFAULT_MODEL_ID
      : (modelOptions[0]?.id ?? ''));

  const activeProvider = providers.find(
    (p) => p.id === settings?.activeProviderId,
  );
  const fastModeSupported =
    !!activeProvider && (activeProvider.fastModeModels ?? []).some((candidate) => candidate.trim() === model);
  const fastMode = settings?.fastMode === true && fastModeSupported;

  const effort: EffortLevel = settings?.effort ?? DEFAULT_EFFORT;

  const placeholder = tx(`composer.composerContextBar.placeholders.${mode}`);

  return (
    // ⚠️ 外层 shell 存在的唯一理由：给拖拽落点提示做定位上下文。
    //    提示用 absolute 铺满输入区，但不能挡住鼠标事件（CSS 里已 pointer-events:none）。
    <div className="composer-shell">
      {dragging && (
        <div className="composer-drop-hint">
          <Icon name="paperclip" size={14} />
          <span>{t('松手即可添加为附件')}</span>
        </div>
      )}
      <div
        className={`composer-box${inline ? ' inline' : ''}${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          // ⚠️ 不 preventDefault 的话浏览器根本不会派发 drop 事件，
          //    表现为「拖进去毫无反应」。
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          // 鼠标在子元素之间移动也会触发 dragleave，
          // 只有真正离开整个容器（relatedTarget 不在容器内）才收起提示。
          const to = e.relatedTarget as Node | null;
          if (!to || !e.currentTarget.contains(to)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFromFiles(Array.from(e.dataTransfer.files));
        }}
      >
        {notice ? <div className="composer-notice">{notice}</div> : null}

        {planMode ? (
          <div className="composer-work-mode" role="status">
            <Icon name="list-checks" size={12} />
            <span>{t('先给出方案，不会改文件')}</span>
          </div>
        ) : null}

        {/* ── ① 上下文栏 ── */}
        <div className="cz-bar">
        {/* 项目 */}
        <div className="cz-slot">
          <button
            className="cz-btn"
            title={tx('composer.composerContextBar.projectTooltip')}
            onClick={() => setOpenMenu(openMenu === 'project' ? null : 'project')}
          >
            <Icon name="folder-open" size={13} />
            <span className="truncate">
              {project?.name ?? tx('composer.composerContextBar.workspaceDefault')}
            </span>
            <Icon name="chevron-down" size={11} />
          </button>
          <Popover open={openMenu === 'project'} onClose={close}>
            {/* 项目契约顺序：默认工作区（标题 + 副标题）→ 项目当前项(✓) → ⋯ → 导入文件夹… → 新建项目…
                项目契约没有「项目」分组标题，也没有地球图标 */}
            <button
              className="cz-pop-item"
              onClick={() => {
                // 项目契约：切回全局「默认工作区」。这里落到启动时播种的默认项目上。
                void (async () => {
                  const id = await window.mathmodel.project.defaultId();
                  if (id) await openProject(id);
                })();
                close();
              }}
            >
              <div className="col" style={{ minWidth: 0 }}>
                <span>{tx('composer.composerContextBar.workspaceDefault')}</span>
                <span className="cz-pop-hint">
                  {tx('composer.composerContextBar.workspaceDefaultHint')}
                </span>
              </div>
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                className={`cz-pop-item${p.id === project?.id ? ' selected' : ''}`}
                onClick={() => {
                  void openProject(p.id);
                  close();
                }}
              >
                <Icon name="folder" size={13} />
                <span className="truncate">{p.name}</span>
                <span className="grow" />
                {p.id === project?.id ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ))}
            <div className="cz-pop-sep" />
            <button
              className="cz-pop-item"
              onClick={() => {
                // 项目契约的「导入文件夹…」= 挑一个已存在的目录登记成项目。
                // 现有主进程能力里 PROJECT_CREATE 弹出的就是「选择或新建项目目录」
                // 对话框（允许 openDirectory），目录已登记时只更新名称与打开时间 ——
                // 语义正好是导入，直接复用，不新增 IPC。
                void createProject('');
                close();
              }}
            >
              <Icon name="folder-input" size={13} />
              <span>{tx('composer.composerContextBar.importFolder')}</span>
            </button>
            <button
              className="cz-pop-item"
              onClick={() => {
                void createProject('');
                close();
              }}
            >
              <Icon name="folder-plus" size={13} />
              <span>{tx('composer.composerContextBar.newProject')}</span>
            </button>
          </Popover>
        </div>

        {/* 任务模式菜单已删（2026-09-26）：任务选择改由输入框 `#` 任务面板承担，
            见 HASH_TASKS。composerMode 机制保留（隐式命令前缀 / placeholder）。 */}

        {/* 决策模式 chip 已移到底部栏（2026-09-26：放「数模协作」旁边，见 cz-foot）。 */}


        <div className="grow" />

        {/* 比赛信息 */}
        <button
          className="cz-btn ghost"
          title={positivePage(pageLimitDraft.maxPages)
            ? t('比赛信息，正文最多 {{pages}} 页', { pages: pageLimitDraft.maxPages })
            : t('填写比赛信息和页数要求')}
          onClick={() => {
            setSetupOpen(true);
            if (templates.length === 0 && !tplLoading) void loadTemplates();
          }}
        >
          <Icon name="clipboard-list" size={13} />
          <span>{tx('composer.composerContextBar.paperSetup')}</span>
        </button>
      </div>

      {/* ── ② 附件 chips + 粘贴 chip + 文本框 ── */}
      {(attachments.length > 0 || pastedTexts.length > 0) && (
        <div className="cz-chips">
          {/* ⚠️ 附件在前、粘贴 chip 在后 —— **这个先后顺序没有从项目契约确证**
              （项目契约是同一容器里的两块列表，压缩码里读不出相对位置）。
              待 `diff-chat` 补一张"同时放一个附件 + 一段长文本"的界面样例后对齐。 */}
          {attachments.map((a) => (
            <span key={a.id} className="cz-chip" title={a.path ?? a.name}>
              <Icon name={IMAGE_EXT.has(a.ext) ? 'file-image' : FILE_ICON[a.ext] ?? 'file'} size={13} />
              <span className="truncate">{a.name}</span>
              <button
                className="cz-chip-x"
                title={tx('composer.composerAttachments.removeAttachment')}
                onClick={() => removeAttachment(a.id)}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}

          {pastedTexts.map((p) => (
            <PastedTextChip
              key={p.id}
              item={p}
              onShowInTextField={() => {
                // 项目契约语义：**展开进正文 + 移除 chip**
                // （不是"复制一份进正文、chip 留着" —— 那样再发一次会重复带同一段）
                onChange(value.trim() ? `${value.trim()}\n\n${p.text}` : p.text);
                setPastedTexts((prev) => prev.filter((x) => x.id !== p.id));
              }}
              onRemove={() => setPastedTexts((prev) => prev.filter((x) => x.id !== p.id))}
            />
          ))}
        </div>
      )}

      <FollowUpQueueBadge
        queue={myFollowUps}
        onRemove={removeFollowUp}
        onRetry={retryFollowUp}
        onClear={clearFollowUps}
      />

      <div className="composer-input-region">
      <ResizeHandle storageKey="mm-composer-height" label="调整输入区高度" edge="top" initial={96} min={64} max={360} fraction={.35} viewport optional />
      {/* # 任务面板：输入 `#` 唤起（见 HASH_TASKS）。mousedown 用 preventDefault 保住输入框焦点 */}
      {hash && hashItems.length > 0 && (
        <div className="cz-pop hash-pop" role="listbox" aria-label={tx('composer.hashPalette.title')}>
          <div className="cz-pop-label">{tx('composer.hashPalette.title')}</div>
          {hashItems.map((it, i) => (
            <button
              key={it.id}
              type="button"
              role="option"
              aria-selected={i === hashIndex}
              className={`cz-pop-item${i === hashIndex ? ' active' : ''}`}
              title={tx(`composer.hashPalette.items.${it.id}Description`)}
              onMouseDown={(e) => {
                e.preventDefault();
                applyHashTask(it);
              }}
              onMouseEnter={() => setHashIndex(i)}
            >
              <Icon name={it.icon} size={13} />
              <span className="truncate">{tx(`composer.hashPalette.items.${it.id}`)}</span>
              <span className="grow" />
              {it.insert ? (
                <span className="cz-pop-hint hash-pop-cmd">{it.insert.trim()}</span>
              ) : null}
            </button>
          ))}
          <div className="cz-pop-note">{tx('composer.hashPalette.hint')}</div>
        </div>
      )}
      <textarea
        id="tour-composer"
        ref={ref}
        className="composer-input"
        placeholder={
          isRunning
            ? // 项目契约为运行中准备了两条占位文案，正是「追问行为」两个取值：
              // 排队 → 「按 Enter 将下一条消息加入队列…」；调整 → 「按 Enter 可引导当前回合…」
              readFollowUpBehavior() === 'steer'
              ? tx('composer.composer.placeholderBusySteer')
              : tx('composer.composer.placeholderBusyQueue')
            : placeholder
        }
        value={value}
        // 运行中**不再禁用**：追问行为（排队 / 调整当前任务）要求运行中仍能输入并回车
        onChange={(e) => {
          onChange(e.target.value);
          detectHash(e.target.value, e.target.selectionStart ?? e.target.value.length);
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
        }}
        onPaste={(e) => {
          // 项目契约 `so` 的三分支（顺序不能换）：
          // ① 剪贴板里是**文件** → 登记成附件并阻止默认粘贴（否则会把文件名或二进制垃圾塞进输入框）
          // ② 是**长文本**（≥4000 字符 或 ≥25 行）→ 折成 chip，同样吞掉这次粘贴
          // ③ 都不是 → **什么都不做**，让浏览器默认粘贴生效
          // ⚠️ 不能写成无条件 e.preventDefault()：那会让普通短文本也粘不进去。
          //    这是本项唯一的破坏性风险面（§11.6 R1）。
          const files = Array.from(e.clipboardData.files);
          if (files.length) {
            e.preventDefault();
            addFromFiles(files);
            return;
          }
          const text = e.clipboardData.getData('text/plain');
          if (shouldFoldPasted(text)) {
            e.preventDefault();
            setPastedTexts((prev) => [...prev, makePastedText(text)]);
          }
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setHash(null)}
      />
      </div>

      {/* ── ③ 底部栏 ── */}
      <div className="cz-foot">
        {/* 加号：项目契约点它弹出「添加附件、技能及更多内容」的弹层（不是直接推开右栏）。
            ⚠️ 改动前这里是 `onClick={() => setSidePanel('files')}` —— tooltip 与项目契约
            字段一致、行为却完全不同。那条"一键打开文件面板"的路径**没有丢**：
            弹层最后一组里有一行「打开面板 · 文件」，指向同一个动作（见 PlusMenu.tsx）。 */}
        <div className="cz-slot">
          <button
            id="tour-plus"
            className="cz-icon-btn"
            title={tx('composer.composerPlusMenu.triggerTooltip')}
            onClick={() => setOpenMenu(openMenu === 'plus' ? null : 'plus')}
          >
            <Icon name="plus" size={15} />
          </button>
          {/* `maxHeight` 只给这个菜单用（见 Popover 的注释）：11 行 ≈374px 全部可见，
              对齐项目契约 `max-h-[var(--available-height,28rem)]`；`.cz-pop` 那个
              320px 还压在另外 5 个选择器上，所以不动它。 */}
          <Popover open={openMenu === 'plus'} onClose={close} maxHeight={PLUS_POPOVER_MAX_HEIGHT}>
            <PlusMenu
              subOpen={plusSub}
              onSubEnter={openPlusSub}
              onSubLeave={holdPlusSub}
              onSubToggle={togglePlusSub}
              onClose={close}
              projects={projects}
              skills={plusSkills}
              datasets={plusDatasets}
              connectors={plusConnectors}
              onAddFiles={pickAttachments}
              onOpenFilesPanel={() => setSidePanel('files')}
              onInsertSkill={(name) => insertIntoComposer(`/${name} `)}
              onInsertPrompt={(prompt) => insertIntoComposer(prompt)}
              onInsertDataset={(relPath) => insertIntoComposer(`@${relPath}`)}
              onManageDatasets={() => openRoute('datasets')}
              onOpenGallery={() => openRoute('gallery')}
              onManage={managePlus}
            />
          </Popover>
        </div>

        {/* 多智能体协作 —— 独立常驻开关（2026-09-20 从「选项」菜单拎出；2026-09-26 定名）：
            开启时高亮，一眼可见当前是否在协作模式。 */}
        <div className="cz-slot">
          <button
            type="button"
            className={`cz-btn ghost${multiAgentEnabled ? ' active' : ''}`}
            aria-label="多智能体协作"
            aria-pressed={multiAgentEnabled}
            title={multiAgentEnabled
              ? '多智能体协作：开 —— 复杂任务按需分给建模伙伴并行推进（点击关闭）'
              : '多智能体协作：关 —— 全部由主助手单干（点击开启）'}
            onClick={() => void patchSettings({ multiAgentEnabled: !multiAgentEnabled })}
          >
            <Icon name="brain" size={14} />
            <span>多智能体协作</span>
          </button>
        </div>

        {/* 决策模式 —— 与任务模式（# 面板）正交的另一个维度：怎么决定，而不是做什么。
            2026-09-26 从顶部上下文栏移到左下角、放在「数模协作」旁边（用户钦定）。 */}
        <div className="cz-slot">
          <button
            type="button"
            className={`cz-btn ghost${decisionMode !== 'manual' ? ' active' : ''}`}
            title={tx('composer.composerContextBar.decisionModeTooltip')}
            onClick={() => setOpenMenu(openMenu === 'decision' ? null : 'decision')}
          >
            <Icon name={DECISION_MODE_ICON[decisionMode]} size={13} />
            <span className="truncate">
              {DECISION_MODE_SHORT[decisionMode]}
            </span>
            <Icon name="chevron-down" size={11} />
          </button>
          <Popover open={openMenu === 'decision'} onClose={close}>
            {DECISION_MODES.map((dm) => (
              <button
                key={dm}
                className={`cz-pop-item${dm === decisionMode ? ' selected' : ''}`}
                onClick={() => {
                  patchDecisionMode(dm);
                  close();
                }}
              >
                <Icon name={DECISION_MODE_ICON[dm]} size={13} />
                <div className="col" style={{ minWidth: 0 }}>
                  <span className="cz-pop-title">
                    {tx(`composer.composerContextBar.decisionModes.${dm}`)}
                  </span>
                  <span className="cz-pop-hint">
                    {tx(`composer.composerContextBar.decisionModes.${dm}Description`)}
                  </span>
                </div>
                <span className="grow" />
                {dm === decisionMode ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ))}
            <div className="cz-pop-note">{tx('composer.composerContextBar.hashHint')}</div>
          </Popover>
        </div>

        {/* 任务深度 chip 已移到右侧模型选择旁（2026-09-26 用户钦定），见 cz-context-slot 之后。 */}
        <div className="cz-slot">
          <button
            className="cz-btn ghost"
            title={
              perm === 'full'
                ? tx('composer.composerPermissionPicker.fullAccessTooltip')
                : tx('composer.composerPermissionPicker.approvalRequiredTooltip')
            }
            onClick={() => setOpenMenu(openMenu === 'perm' ? null : 'perm')}
          >
            {perm === 'full' ? <ShieldAlertIcon /> : <Icon name="hand" size={13} />}
            <span className="truncate">
              {perm === 'full'
                ? tx('composer.composerPermissionPicker.fullAccess')
                : tx('composer.composerPermissionPicker.approvalRequired')}
            </span>
            <Icon name="chevron-down" size={11} />
          </button>
          {/* 项目契约是**单行**项（没有第二行描述），选中项右侧独立 ✓，图标统一灰色描边 */}
          <Popover open={openMenu === 'perm'} onClose={close}>
            {(['full', 'approval'] as PermissionMode[]).map((pm) => (
              <button
                key={pm}
                className={`cz-pop-item${pm === perm ? ' selected' : ''}`}
                onClick={() => {
                  void patchSettings({ permissionMode: pm });
                  close();
                }}
              >
                {pm === 'full' ? <ShieldAlertIcon /> : <Icon name="hand" size={13} />}
                <span>
                  {pm === 'full'
                    ? tx('composer.composerPermissionPicker.fullAccess')
                    : tx('composer.composerPermissionPicker.approvalRequired')}
                </span>
                <span className="grow" />
                {pm === perm ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ))}
          </Popover>
        </div>

        <div className="grow" />

        {/* 模型 · 思考强度 */}
        <div className="cz-slot cz-context-slot">
          {(() => {
            const pct = Math.round(Math.min(100, Math.max(0, contextUsage?.percentage ?? 0)));
            const tone = pct >= 90 ? ' danger' : pct >= 75 ? ' warn' : '';
            const used = contextUsage?.used ?? 0;
            const total = contextUsage?.total ?? 0;
            const threshold = contextUsage?.autoCompactThreshold ?? (total > 0 ? Math.floor(total * .9) : 0);
            const title = contextUsage && contextUsage.total > 0
              ? t('上下文已用 {{percentage}}%，{{used}} / {{total}}', {
                percentage: pct,
                used: used.toLocaleString('zh-CN'),
                total: total.toLocaleString('zh-CN'),
                })
              : t('上下文用量将在对话开始后显示');
            return (
              <>
                <button className={`cz-context-trigger${contextOpen ? ' is-open' : ''}`} type="button" onClick={() => setContextOpen(v => !v)} aria-expanded={contextOpen} aria-label={title} title="查看上下文用量">
                  <span className={`cz-context-ring${tone}`} aria-hidden>
                    <svg viewBox="0 0 24 24">
                      <circle className="cz-context-ring-bg" cx="12" cy="12" r="9" pathLength="100" />
                      <circle className="cz-context-ring-value" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${pct} 100`} />
                    </svg>
                    {contextUsage?.compacted ? <span className="cz-context-ring-dot" /> : null}
                  </span>
                  {pct >= 75 ? <span className="cz-context-pct">{pct}%</span> : null}
                </button>
                <Popover open={contextOpen} onClose={() => setContextOpen(false)} align="right">
                  <div className="cz-context-popover" role="dialog" aria-label="上下文用量详情">
                    <div className="cz-pop-label">上下文用量</div>
                    {total > 0 ? <>
                      <div className="cz-context-summary"><strong>{pct}%</strong><span>{used.toLocaleString('zh-CN')} / {total.toLocaleString('zh-CN')}</span></div>
                      <div className="cz-context-bar"><i style={{ width: `${pct}%` }} /></div>
                      <div className="cz-context-meta"><span>自动整理线</span><strong>{threshold ? `${Math.round(threshold / 1000)}K` : '等待确认'}</strong></div>
                    </> : <p className="cz-pop-note">开始一次对话后，这里会显示当前回合的上下文用量。</p>}
                    <p className="cz-context-note">{contextUsage?.autoCompactState === 'failed'
                      ? '自动整理还没有确认成功，可以重试当前回合；原有内容不会被删除。'
                      : contextUsage?.autoCompactState === 'guaranteed'
                        ? '接近上限时会自动整理旧内容，保留关键结论继续工作。'
                        : '正在确认自动整理状态，当前先按参考容量显示。'}</p>
                    <p className="cz-context-source">{contextUsage?.estimated ? '当前数字包含估算' : contextUsage?.capacitySource === 'configured' ? '容量来自模型设置' : contextUsage?.capacitySource === 'known' ? '容量已由模型确认' : '容量为运行器参考值'}{contextUsage?.compacted ? ' · 最近已整理过一次' : ''}</p>
                  </div>
                </Popover>
              </>
            );
          })()}
          <button
            className="cz-btn ghost"
            title={tx('chat.modelPicker.selectModel')}
            onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
          >
            <span className="truncate">{model}</span>
            {fastMode ? (
              <span className="cz-fast-badge" title={tx('chat.modelPicker.fastMode')}>
                <Icon name="zap" size={12} />
                <span>{tx('chat.modelPicker.fast')}</span>
              </span>
            ) : null}
            <span className="cz-effort">{effortLabel(effort)}</span>
            <Icon name="chevron-down" size={11} />
          </button>
          <Popover open={openMenu === 'model'} onClose={close} align="right">
            {/* 项目契约：5 个模型 + 右侧上下文徽标 + 选中项 ✓，底部单行「思考强度 高 ›」二级入口 */}
            {modelOptions.map((o) => (
              <button
                key={o.providerId + o.id}
                className={`cz-pop-item${o.id === model ? ' selected' : ''}`}
                onClick={() => {
                  void patchSettings({
                    ...(o.providerId ? { activeProviderId: o.providerId } : {}),
                    defaultModel: o.id,
                  });
                  close();
                }}
              >
                <Icon name="bot" size={13} />
                <span className="col" style={{ gap: 1, minWidth: 0 }}>
                  <span className="truncate">{o.id}</span>
                  {o.providerName ? <span className="muted" style={{ fontSize: 10 }}>{o.providerName}</span> : null}
                </span>
                <span className="grow" />
                {o.badge ? <span className="cz-pop-badge">{o.badge}</span> : null}
                {o.id === model ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ))}
            <div className="cz-pop-sep" />
            {fastModeSupported ? (
              <button
                className={`cz-pop-item${fastMode ? ' selected' : ''}`}
                onClick={() => {
                  void patchSettings({ fastMode: !fastMode });
                }}
              >
                <Icon name="zap" size={13} />
                <span className="col" style={{ gap: 1 }}>
                  <span>{tx('chat.modelPicker.fastMode')}</span>
                  <span className="muted" style={{ fontSize: 10 }}>{tx('chat.modelPicker.fastModeHint')}</span>
                </span>
                <span className="grow" />
                {fastMode ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ) : null}
            <div
              className="cz-effort-slider"
              data-effort={effort}
              style={{ '--effort-step': EFFORT_LEVELS.indexOf(effort) } as React.CSSProperties}
            >
              <div className="cz-effort-slider-head">
                <span>{tx('chat.modelPicker.effort')}</span>
                <strong>{effortLabel(effort)}</strong>
                <span className="cz-effort-slider-hint">{EFFORT_HINT[effort]}</span>
              </div>
              <div className="cz-effort-range-shell">
                <span className="cz-effort-visual-track" aria-hidden>
                  <span className="cz-effort-particles" />
                </span>
                <input
                  className="cz-effort-range"
                  type="range"
                  min={0}
                  max={EFFORT_LEVELS.length - 1}
                  step={1}
                  value={EFFORT_LEVELS.indexOf(effort)}
                  aria-label={tx('chat.modelPicker.effort')}
                  aria-valuetext={`${effortLabel(effort)}，${EFFORT_HINT[effort]}`}
                  onChange={(event) => {
                    const next = EFFORT_LEVELS[Number(event.currentTarget.value)] ?? DEFAULT_EFFORT;
                    void patchSettings({ effort: next });
                  }}
                />
              </div>
              <div className="cz-effort-ticks" aria-hidden>
                {EFFORT_LEVELS.map((level) => (
                  <span key={level} className={level === effort ? 'active' : ''}>
                    {effortLabel(level)}
                  </span>
                ))}
              </div>
            </div>
          </Popover>
        </div>

        {/* 任务深度（建模质量策略）—— 2026-09-26 从左侧挪到模型选择旁边（用户钦定） */}
        <div className="cz-slot">
          <button
            type="button"
            className="cz-btn ghost"
            title="任务深度：这一轮建模、写论文、找数据要做得多细 —— 快速先出思路，标准常规推进，深度会全面验证、敏感性分析、引用核对并反复打磨。随时可改，只对之后的回合生效。"
            onClick={() => setOpenMenu(openMenu === 'options' ? null : 'options')}
          >
            <Icon name="circle-check" size={13} />
            <span>{qualityLabel}</span>
            <Icon name="chevron-down" size={11} />
          </button>
          <Popover open={openMenu === 'options'} onClose={close} align="right">
            <div className="cz-pop-label">任务深度（建模质量策略）</div>
            <div className="muted" style={{ fontSize: 10, lineHeight: 1.5, padding: '0 10px 6px' }}>
              决定这一轮任务做多细：解题、写论文、找数据、验证的投入程度都随档位变化。简单问答不受影响。
            </div>
            {([
              ['fast', '快速', '先给出可用思路和初步结果，适合探索与头脑风暴'],
              ['balanced', '标准', '按常规深度完成建模、写作与数据工作'],
              ['strict', '深度', '按交付标准做：复算、敏感性分析、引用核对、数据核验与反复打磨'],
            ] as const).map(([value, label, hint]) => (
              <button key={value} className={`cz-pop-item${qualityMode === value ? ' selected' : ''}`} onClick={() => { void patchSettings({ modelingQualityMode: value }); close(); }}>
                <Icon name="circle-check" size={13} />
                <span className="col" style={{ gap: 1 }}><span>{label}</span><span className="muted" style={{ fontSize: 10 }}>{hint}</span></span>
                <span className="grow" />
                {qualityMode === value ? <Icon name="check" size={13} className="cz-pop-check" /> : null}
              </button>
            ))}
          </Popover>
        </div>

        {/* 发送 / 停止 */}
        {isRunning ? (
          <button
            className={`cz-send stop${isStopping ? ' is-stopping' : ''}`}
            onClick={onAbort}
            disabled={isStopping}
            title={isStopping ? t('正在停下') : tx('composer.composerPendingApprovalPanel.cancelTurnDescription')}
          >
            <Icon name="square" size={14} />
          </button>
        ) : (
          <button
            className="cz-send"
            disabled={!value.trim() && attachments.length === 0 && pastedTexts.length === 0}
            // 必须包一层：直接传 handleSend 会把 MouseEvent 当成 invert
            onClick={() => handleSend()}
            title={tx('chat.messageList.send')}
          >
            <Icon name="arrow-up" size={15} />
          </button>
        )}
      </div>

      {/* ⚠️ 这里项目契约**没有**任何「N 条消息 / 新建对话」行 ——
          输入卡片到「＋ 完全访问」一行就结束，下面是「试试这些数模真题案例」。
          当前实现早期多出来的这一行已删除（00-main P1-3 / 11-chat P1-1）。 */}

      {/* ── 比赛信息弹层 ── */}
      {setupOpen && (
        <div className="modal-backdrop" onClick={() => setSetupOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">
                {tx('composer.paperSetupDialog.title')}{project ? ` · ${project.name}` : ''}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => setSetupOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body col" style={{ gap: 12 }}>
              <label className="field-label">论文模板</label>
        {/* 模板与比赛属于项目设置，不随当前对话模式消失。 */}
          <div className="cz-slot">
            <button
              className="cz-btn"
              title={tx('composer.composerContextBar.templateTooltip')}
              onClick={() => setOpenMenu(openMenu === 'template' ? null : 'template')}
            >
              <Icon name="book-open" size={13} />
              <span className="truncate">
                {tplLoading
                  ? tx('composer.composerContextBar.templateLoading')
                  : (tplName(template) || tx('composer.composerContextBar.noTemplates'))}
              </span>
              <Icon name="chevron-down" size={11} />
            </button>
            <Popover open={openMenu === 'template'} onClose={close}>
              <div className="cz-pop-label">{tx('composer.composerContextBar.builtinTemplatesGroup')}</div>
              {templates.length === 0 ? (
                <div className="cz-pop-note">{tx('composer.composerContextBar.noTemplates')}</div>
              ) : (
                templates.map((t) => (
                  <button
                    key={t.id}
                    className={`cz-pop-item${t.id === templateId ? ' active' : ''}`}
                    disabled={paperConfigProjectId !== project?.id}
                    onClick={() => {
                      const ref: PaperTemplateRef = {
                        id: t.id,
                        name: makeLocalizedText(t.name, t.nameEn),
                        entryFile: t.entryFile,
                        source: 'builtin',
                        sourcePath: null,
                      };
                      setSrcTpl(ref);
                      void patchSettings({ paperTemplateId: t.id });
                      // 换模板 = 换成内置来源（清掉可能存在的自定义 sourcePath），
                      // 但**已填的比赛字段一并保留** —— 换模板不该让用户重填。
                      void savePaperConfig({
                        template: ref,
                        contestFields: contestFieldsForSave().filter(
                          (f) => t.fields.some((tf) => tf.id === f.id) || f.id.startsWith(CUSTOM_FIELD_PREFIX),
                        ),
                      });
                      close();
                    }}
                  >
                    <div className="col" style={{ minWidth: 0 }}>
                      <span>{tplName(t)}</span>
                      <span className="muted" style={{ fontSize: 10 }}>
                        {tplDesc(t) || t.language}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </Popover>
          </div>
              {effectiveTpl ? (
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                  {effectiveTpl.name}
                  {effectiveTpl.description ? ` · ${effectiveTpl.description}` : ''}
                  {effectiveTpl.source === 'custom' ? ` · ${t('自定义模板源')}` : ''}
                </div>
              ) : (
                <div className="studio-notice" role="status">
                  <span>
                    {tplLoading
                      ? t('正在读取比赛模板…')
                      : t('暂时没有读到内置模板，比赛信息入口仍可使用。')}
                  </span>
                  {!tplLoading ? (
                    <button className="btn btn-sm" onClick={() => void loadTemplates()}>
                      {tplLoadFailed ? t('重新检查') : t('读取模板')}
                    </button>
                  ) : null}
                </div>
              )}
              {!effectiveTpl || effectiveTpl.fields.length === 0 ? (
                <div className="muted" style={{ fontSize: 12 }}>
                  {effectiveTpl ? tx('composer.paperSetupDialog.noContestFields') : t('模板恢复后会显示对应的比赛字段。')}
                </div>
              ) : (
                effectiveTpl.fields.map((f) => (
                  <div key={f.id}>
                    <label className="field-label">
                      {f.label}
                      {f.required ? <span style={{ color: 'var(--danger)' }}> *</span> : null}
                    </label>
                    {/* ── 有 options 的字段是**下拉框** ──
                        项目契约的判据就是 `options.length > 0 ? <Select> : <Input>`
                        （长三角赛「赛道」、东三省/五一杯「参赛组别」这类）。
                        之前 `listPaperTemplates` 把 options 丢了，这几个比赛只能填文本框。 */}
                    {f.options?.length ? (
                      <select
                        className="select"
                        style={{ width: '100%' }}
                        value={paperFields[f.id] ?? ''}
                        onChange={(e) =>
                          setPaperFields((prev) => ({ ...prev, [f.id]: e.target.value }))
                        }
                      >
                        {/* 空首项：不替用户预选一个 —— 否则"没填"看起来也像填了，
                            而且用户没法再清空（存盘只收非空值，见 contestFieldsForSave） */}
                        <option value="" />
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {pickLocalizedText(o.label, settings?.locale ?? 'zh-CN')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="input"
                        placeholder={f.placeholder}
                        value={paperFields[f.id] ?? ''}
                        onChange={(e) =>
                          setPaperFields((prev) => ({ ...prev, [f.id]: e.target.value }))
                        }
                      />
                    )}
                  </div>
                ))
              )}

              <section className="paper-page-limit" aria-labelledby="paper-page-limit-title">
                <div className="paper-page-limit-head">
                  <div>
                    <div id="paper-page-limit-title" className="field-label">
                      {tx('composer.paperSetupDialog.pageLimitTitle')}
                    </div>
                    <div className="muted paper-page-limit-hint">
                      {tx('composer.paperSetupDialog.pageLimitHint')}
                    </div>
                  </div>
                  <input
                    className="input paper-page-limit-max"
                    type="number"
                    min={1}
                    max={999}
                    inputMode="numeric"
                    aria-label={tx('composer.paperSetupDialog.maxPages')}
                    placeholder={tx('composer.paperSetupDialog.maxPagesPlaceholder')}
                    value={pageLimitDraft.maxPages}
                    onChange={(e) =>
                      setPageLimitDraft((prev) => ({ ...prev, maxPages: e.target.value }))
                    }
                  />
                </div>
                <div className="paper-page-limit-grid">
                  <label>
                    <span className="field-label">{tx('composer.paperSetupDialog.countScope')}</span>
                    <select
                      className="select"
                      value={pageLimitDraft.scope}
                      onChange={(e) =>
                        setPageLimitDraft((prev) => ({
                          ...prev,
                          scope: e.target.value === 'total' ? 'total' : 'body',
                        }))
                      }
                    >
                      <option value="body">{tx('composer.paperSetupDialog.scopeBody')}</option>
                      <option value="total">{tx('composer.paperSetupDialog.scopeTotal')}</option>
                    </select>
                  </label>
                  {pageLimitDraft.scope === 'body' ? (
                    <>
                      <label>
                        <span className="field-label">{tx('composer.paperSetupDialog.startPage')}</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          inputMode="numeric"
                          placeholder={tx('composer.paperSetupDialog.autoDetect')}
                          value={pageLimitDraft.startPage}
                          onChange={(e) =>
                            setPageLimitDraft((prev) => ({ ...prev, startPage: e.target.value }))
                          }
                        />
                      </label>
                      <label>
                        <span className="field-label">{tx('composer.paperSetupDialog.endPage')}</span>
                        <input
                          className="input"
                          type="number"
                          min={1}
                          inputMode="numeric"
                          placeholder={tx('composer.paperSetupDialog.autoDetect')}
                          value={pageLimitDraft.endPage}
                          onChange={(e) =>
                            setPageLimitDraft((prev) => ({ ...prev, endPage: e.target.value }))
                          }
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </section>

              {/* ── 自定义字段 ──
                  项目契约 contestFields 是数组，所以「加字段」就是追加一项；
                  名字由用户填（如「组别」），因为模板元数据里本来就没有这个键。 */}
              {customFields.map((c) => (
                <div key={c.id} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                  <div className="grow">
                    <label className="field-label">{t('字段名称')}</label>
                    <input
                      className="input"
                      value={c.label}
                      placeholder={t('例如：组别')}
                      onChange={(e) =>
                        setCustomFields((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                  </div>
                  <div className="grow">
                    <label className="field-label">{t('字段值')}</label>
                    <input
                      className="input"
                      value={paperFields[c.id] ?? ''}
                      onChange={(e) => setPaperFields((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    />
                  </div>
                  <button
                    className="btn btn-sm btn-ghost"
                    title={t('删除这个字段')}
                    onClick={() => removeCustomField(c.id)}
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </div>
              ))}
              <div>
                <button className="btn btn-sm btn-ghost row" style={{ gap: 5 }} onClick={addCustomField}>
                  <Icon name="plus" size={13} />
                  {t('添加字段')}
                </button>
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-sm" onClick={() => setSetupOpen(false)}>
                {tx('common.cancel')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={paperConfigProjectId !== project?.id}
                onClick={() => {
                  // 只下发「比赛信息」。模板在输入区下拉 / 设置页里换，那两条路径各自显式下发；
                  // 这里手里的 template 是打开项目时的快照，回写会把期间的自定义模板源打回内置。
                  void savePaperConfig(
                    effectiveTpl
                      ? {
                          contestFields: contestFieldsForSave(),
                          pageLimit: pageLimitFromDraft(pageLimitDraft),
                        }
                      : { pageLimit: pageLimitFromDraft(pageLimitDraft) },
                  );
                  setSetupOpen(false);
                }}
              >
                {tx('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
