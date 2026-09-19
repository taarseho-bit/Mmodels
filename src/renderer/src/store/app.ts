/**
 * 全局应用状态（zustand）。
 *
 * 分工原则：
 *  - **这个 store 只存「跨页面共享」的状态**：当前项目、会话列表、设置、技能
 *  - 页面内部的临时状态（比如输入框内容、展开折叠）用 useState
 *  - 流式消息不在这里 —— 它更新频率太高，放 store 会让整棵树重渲染。
 *    流式内容由 ChatPage 自己维护一个 ref + 局部 state。
 */
import { create } from 'zustand';
import type {
  AppSettings,
  ProjectMeta,
  ProviderConfig,
  SessionMeta,
  SkillMeta,
  TourId,
} from '@shared/types';

const api = () => window.mathmodel;

/** 右栏可作为标签打开的面板，顺序 = 原版 `dock.rightPanel.*`（文件/终端/浏览器/更改/项目版本/科研绘图/流程图） */
export const SIDE_PANEL_TABS = [
  'files',
  'terminal',
  'browser',
  'changes',
  'versions',
  'gallery',
  'diagrams',
] as const;

export type SidePanelTab = (typeof SIDE_PANEL_TABS)[number];

/** 已打开标签的持久化键（原版右栏支持 addTab / closeTab） */
const SIDE_PANEL_TABS_KEY = 'mm-sidepanel-tabs';

function loadSidePanelTabs(): SidePanelTab[] {
  try {
    const raw = localStorage.getItem(SIDE_PANEL_TABS_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // 按原版顺序归一化，顺便丢掉不认识的历史值
        const tabs = SIDE_PANEL_TABS.filter((k) => parsed.includes(k));
        if (tabs.length > 0) return [...tabs];
      }
    }
  } catch {
    // localStorage 不可用/内容损坏 → 回落到默认全开
  }
  return [...SIDE_PANEL_TABS];
}

function saveSidePanelTabs(tabs: SidePanelTab[]): void {
  try {
    localStorage.setItem(SIDE_PANEL_TABS_KEY, JSON.stringify(tabs));
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

/** 「编辑器视图」是一个模式而不是一次性动作，跨重启保持（原版语义） */
const EDITOR_VIEW_KEY = 'mm-editor-view';

function loadEditorView(): boolean {
  try {
    return localStorage.getItem(EDITOR_VIEW_KEY) === '1';
  } catch {
    return false;
  }
}

function saveEditorView(on: boolean): void {
  try {
    localStorage.setItem(EDITOR_VIEW_KEY, on ? '1' : '0');
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

// ─────────────────────────────────────────────────────────────
// 外观（设置页「外观」分区）
//
// 为什么放在 store 而不是组件里：外观必须在**任意页面**都生效，
// 挂在设置页组件上只有打开设置页时才生效。
// 状态落 localStorage（`mm-appearance`），与主题模式（`mm-theme`）同域。
// ─────────────────────────────────────────────────────────────

export type AppearanceMode = 'system' | 'light' | 'dark';
export type AppearanceDensity = 'compact' | 'comfortable' | 'spacious';

/** 单张主题卡（深色 / 浅色各一张）的可编辑令牌 —— 与原版控件清单一致 */
export interface ThemeVariant {
  /** 主题方案名（原版下拉里的 mathmodel） */
  preset: string;
  /** 强调色 */
  accent: string;
  /** 背景色 */
  background: string;
  /** 前景色 */
  foreground: string;
  /** 界面字体，空 = 系统默认 */
  uiFont: string;
  /** 代码字体 */
  codeFont: string;
  translucentSidebar: boolean;
  /** 对比度 0–100，0 = 不干预渲染 */
  contrast: number;
  /**
   * 用户是否动过这张卡。
   * 没动过时**不把令牌写进 CSS 变量** —— 卡里显示的是原版预设色值，
   * 直接套上去会把整套设计系统换皮（首屏就该是应用自己的配色）。
   */
  touched: boolean;
}

export interface AppearanceState {
  mode: AppearanceMode;
  dark: ThemeVariant;
  light: ThemeVariant;
  /** 使用系统界面字体（忽略主题自带的界面字体） */
  systemUiFont: boolean;
  density: AppearanceDensity;
  /** 基础字号（聊天正文 px） */
  baseFontSize: number;
  /** 终端字号（px） */
  terminalFontSize: number;
  /** 终端字体，空 = 默认等宽字体 */
  terminalFont: string;
}

export const APPEARANCE_DEFAULTS: AppearanceState = {
  mode: 'system',
  dark: {
    preset: 'mathmodel',
    accent: '#0A84FF',
    background: '#1C1C1E',
    foreground: '#F5F5F7',
    uiFont: '',
    codeFont: 'JetBrains Mono',
    translucentSidebar: true,
    contrast: 0,
    touched: false,
  },
  light: {
    preset: 'mathmodel',
    accent: '#007AFF',
    background: '#F2F2F7',
    foreground: '#1D1D1F',
    uiFont: '',
    codeFont: 'JetBrains Mono',
    translucentSidebar: true,
    contrast: 0,
    touched: false,
  },
  systemUiFont: false,
  density: 'comfortable',
  // 默认值与现有设计系统一致（正文 --fs-md=14、终端 11），
  // 这样「没改过」时写进去也是零视觉变化。
  baseFontSize: 14,
  terminalFontSize: 11,
  terminalFont: '',
};

const APPEARANCE_KEY = 'mm-appearance';

/** 默认界面字体栈（--font-sans 的原始值），自定义字体时拼在前面 */
const FALLBACK_SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', sans-serif";
const FALLBACK_MONO =
  "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace";

// ── 颜色工具（都是纯函数，便于单测）──────────────────────

function normHex(v: string): string | null {
  const s = (v || '').trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  }
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const h = normHex(hex);
  if (!h) return null;
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

/** 相对亮度（0–1），用于判断底色明暗与强调色上的文字色 */
function relLum(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 线性混色：w = b 的权重（0–1） */
function mix(a: string, b: string, w: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * w));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function loadAppearance(): AppearanceState {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return { ...APPEARANCE_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AppearanceState>;
    return {
      ...APPEARANCE_DEFAULTS,
      ...parsed,
      dark: { ...APPEARANCE_DEFAULTS.dark, ...(parsed.dark ?? {}) },
      light: { ...APPEARANCE_DEFAULTS.light, ...(parsed.light ?? {}) },
    };
  } catch {
    // localStorage 不可用 / 内容损坏 → 用默认值
    return { ...APPEARANCE_DEFAULTS };
  }
}

function saveAppearance(a: AppearanceState): void {
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    // 忽略写入失败（隐私模式等）
  }
}

let currentAppearance: AppearanceState = loadAppearance();

/** 当前外观状态快照 */
export function getAppearance(): AppearanceState {
  return currentAppearance;
}

/** 生效主题：固定浅/深时就是它本身，跟随系统时看系统偏好 */
export function effectiveTheme(a: AppearanceState = currentAppearance): 'light' | 'dark' {
  if (a.mode === 'light') return 'light';
  if (a.mode === 'dark') return 'dark';
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/** 外观要接管的 CSS 变量（重置时逐个清掉，避免残留） */
const OWNED_VARS = [
  '--bg-canvas',
  '--bg-panel',
  '--bg-sunken',
  '--bg-hover',
  '--bg-active',
  '--fg-primary',
  '--fg-secondary',
  '--fg-muted',
  '--accent',
  '--accent-hover',
  '--accent-weak',
  '--accent-fg',
  '--border-weak',
  '--border',
  '--border-strong',
  '--font-sans',
  '--font-mono',
  '--appearance-base-font',
  '--term-font-size',
  '--term-font-family',
] as const;

/**
 * 把外观状态写进 DOM。
 * 只写内联 CSS 变量 —— 内联样式优先级高于 `[data-theme]` 规则，
 * 所以换主题后重跑一次就能整体切换。
 */
export function applyAppearance(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const a = currentAppearance;
  const mode = (root.dataset.theme as 'light' | 'dark' | undefined) ?? effectiveTheme(a);
  const v = mode === 'dark' ? a.dark : a.light;
  const style = root.style;

  // ── 主题令牌（未编辑过就整块跳过，保留设计系统自带配色）──
  if (v.touched) {
    const bg = normHex(v.background);
    const fg = normHex(v.foreground);
    const ac = normHex(v.accent);
    const dark = bg ? relLum(bg) < 0.5 : mode === 'dark';

    if (bg) {
      style.setProperty('--bg-canvas', bg);
      style.setProperty('--bg-panel', mix(bg, '#FFFFFF', dark ? 0.06 : 0.5));
      style.setProperty('--bg-sunken', mix(bg, '#000000', dark ? 0.25 : 0.05));
      style.setProperty('--bg-hover', mix(bg, '#FFFFFF', dark ? 0.1 : 0.04));
      style.setProperty('--bg-active', mix(bg, '#FFFFFF', dark ? 0.14 : 0.07));
      style.setProperty('--border-weak', mix(bg, dark ? '#FFFFFF' : '#000000', dark ? 0.1 : 0.08));
      style.setProperty('--border', mix(bg, dark ? '#FFFFFF' : '#000000', dark ? 0.16 : 0.14));
      style.setProperty('--border-strong', mix(bg, dark ? '#FFFFFF' : '#000000', dark ? 0.28 : 0.26));
    }
    if (fg) {
      style.setProperty('--fg-primary', fg);
      style.setProperty('--fg-secondary', mix(fg, bg ?? fg, 0.35));
      style.setProperty('--fg-muted', mix(fg, bg ?? fg, 0.55));
    }
    if (ac) {
      style.setProperty('--accent', ac);
      style.setProperty('--accent-hover', mix(ac, relLum(ac) > 0.5 ? '#000000' : '#FFFFFF', 0.14));
      style.setProperty('--accent-weak', mix(bg ?? (mode === 'dark' ? '#1C1C1C' : '#F5F3EF'), ac, 0.16));
      style.setProperty('--accent-fg', relLum(ac) > 0.55 ? '#1A1A1A' : '#FFFFFF');
    }
    root.dataset.appearanceTranslucent = v.translucentSidebar ? '1' : '0';
    root.dataset.appearanceContrast = String(v.contrast);
  } else {
    for (const k of OWNED_VARS) {
      if (
        k === '--appearance-base-font' ||
        k === '--term-font-size' ||
        k === '--term-font-family' ||
        k === '--font-sans' ||
        k === '--font-mono'
      ) {
        continue; // 字体与间距是独立一组，不受主题卡 touched 影响
      }
      style.removeProperty(k);
    }
    delete root.dataset.appearanceTranslucent;
    delete root.dataset.appearanceContrast;
  }

  // ── 字体与间距 ──
  root.dataset.appearanceDensity = a.density;
  style.setProperty('--appearance-base-font', `${a.baseFontSize}px`);
  style.setProperty('--term-font-size', `${a.terminalFontSize}px`);
  const termFont = a.terminalFont.trim();
  style.setProperty('--term-font-family', termFont ? `'${termFont}', ${FALLBACK_MONO}` : FALLBACK_MONO);

  const uiFont = v.uiFont.trim();
  if (uiFont && !a.systemUiFont) style.setProperty('--font-sans', `'${uiFont}', ${FALLBACK_SANS}`);
  else style.removeProperty('--font-sans');

  const codeFont = v.codeFont.trim();
  if (codeFont && codeFont !== 'JetBrains Mono') {
    style.setProperty('--font-mono', `'${codeFont}', ${FALLBACK_MONO}`);
  } else {
    style.removeProperty('--font-mono');
  }
}

/** 应用 + 持久化（设置页每次改动都调它） */
export function setAppearance(next: AppearanceState): void {
  currentAppearance = next;
  saveAppearance(next);
  document.documentElement.dataset.theme = effectiveTheme(next);
  void window.mathmodel?.app?.setNativeTheme(next.mode);
  applyAppearance();
}

/** 恢复默认（分区标题右侧按钮） */
export function resetAppearance(): void {
  setAppearance({ ...APPEARANCE_DEFAULTS });
}

// 模块加载即生效：App 启动就会 import 本文件，外观不用等设置页挂载。
// 系统主题变化时（跟随系统）重算一次。
if (typeof window !== 'undefined') {
  document.documentElement.dataset.theme = effectiveTheme();
  applyAppearance();
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    document.documentElement.dataset.theme = effectiveTheme();
    applyAppearance();
  });
}

// ─────────────────────────────────────────────────────────────
// 追问行为（设置 → 对话 → 追问行为）
// ─────────────────────────────────────────────────────────────

/**
 * 追问行为的持久化键 —— 设置页「对话」分区与输入区共用同一个键。
 * 设置页写；Composer 只负责把「Ctrl/Cmd+Enter = 取反」这个意图传给 ChatPage，
 * 真正决定入队还是打断的是 ChatPage 里的 decideFollowUpAction()。
 */
export const FOLLOW_UP_KEY = 'mm-follow-up-behavior';

/** 「排队」= 当前回合跑完后按 FIFO 依次发；「调整当前任务」= 立刻中断当前回合改发这条 */
export type FollowUpBehavior = 'queue' | 'steer';

/**
 * 每次读都回 localStorage 取，而不是缓存在 store 里。
 * 设置页改完立即生效，省掉「设置页 → store」的同步订阅（改设置的人少、发消息的人多，
 * 读一次的代价远小于维护一条同步链）。
 */
export function readFollowUpBehavior(): FollowUpBehavior {
  try {
    return localStorage.getItem(FOLLOW_UP_KEY) === 'steer' ? 'steer' : 'queue';
  } catch {
    return 'queue';
  }
}

export function writeFollowUpBehavior(v: FollowUpBehavior): void {
  try {
    localStorage.setItem(FOLLOW_UP_KEY, v);
  } catch {
    /* 忽略写入失败 */
  }
}

/** 运行中发消息的处置方式：直接发 / 入队 / 打断当前回合 */
export type FollowUpAction = 'send' | 'queue' | 'steer';

/**
 * Ctrl/Cmd+Enter 的语义 —— **对设置里选的行为取反**。
 * 原版设置页的描述就是「Ctrl/Cmd+Enter 可为单条消息临时使用相反行为」：
 * 设置是「排队」时它打断，设置是「调整当前任务」时它排队。
 */
export function invertBehavior(behavior: FollowUpBehavior): FollowUpBehavior {
  return behavior === 'queue' ? 'steer' : 'queue';
}

/**
 * 「运行中又发了一条消息」该怎么处理 —— 纯决策，不碰任何状态。
 *
 * 抽出来是为了能单测：真正的执行（入队、abort、等回合结束补发）
 * 散在 ChatPage 里，涉及 IPC 与流式状态，很难断言；
 * 但「哪条分支」这件事必须能被穷举验证，否则设置就成摆设了。
 *
 * @param invert Ctrl/Cmd+Enter —— 本次改用设置里那个值的反面（不是恒定打断）
 */
export function decideFollowUpAction(opts: {
  isRunning: boolean;
  behavior: FollowUpBehavior;
  invert?: boolean;
}): FollowUpAction {
  if (!opts.isRunning) return 'send';
  const behavior = opts.invert ? invertBehavior(opts.behavior) : opts.behavior;
  return behavior === 'queue' ? 'queue' : 'steer';
}

/** 一条排队中的追问 */
export interface QueuedFollowUp {
  id: string;
  text: string;
  displayText?: string;
  /**
   * 这条是**为哪个会话**排的队 —— 必填，不是可选。
   *
   * 为什么必须记住归属（用户反馈的那一族问题）：
   *   用户在会话 A 运行中把追问排进队列，然后切到 B 去干别的。
   *   队列是**全局**的（输入区徽标要读它），如果出队时不看归属，
   *   就会把"给 A 写的那句"发到 B 去 —— 那是另一种"切几次之后和原来不一样"。
   *   所以入队时记住当时的 `activeSessionId`，出队只取**属于当前会话**的队首。
   *
   * 空串 `''` = 没有活动会话时的归属占位（只出现在直接打 store 的单测里）：
   * 这种条目不会被任何真实会话消化。
   */
  sessionId: string;
  /**
   * 发送失败时的原因。
   * 有值的条目**留在队列原位**（不静默丢弃，用户能看出是哪条失败），
   * 自动消化会在它这里停下，避免对同一条无限重试。
   */
  error?: string;
}

/** 归属键：没有活动会话时归一成 `''`，保证入队与出队两侧口径一致 */
function sessionKeyOf(sessionId: string | null): string {
  return sessionId ?? '';
}

/**
 * 队列里**属于这个会话**的条目（保持队列内的先后顺序）。
 *
 * 这是全会话归属过滤的**唯一实现** —— 出队（`takeFollowUp`）与输入区徽标
 * （`Composer` 的「已排队 N 条」）都调它，口径不可能漂。
 *
 * 为什么徽标也必须过滤（而不是显示全局总数）：
 *   在 B 会话里显示「已排队 3 条」、点开还管不了那 3 条（它们属于 A），
 *   是**用数字骗人**：用户看到 N 就会以为这 N 条会在这里发出去。
 */
export function followUpItemsFor(
  queue: QueuedFollowUp[],
  activeSessionId: string | null,
): QueuedFollowUp[] {
  const key = sessionKeyOf(activeSessionId);
  return queue.filter((q) => q.sessionId === key);
}

/**
 * 队列里**属于这个会话**的队首（没有则 null）。
 *
 * 出队（`takeFollowUp`）与渲染层的准入判定（`ChatPage` 的队列消化 effect）
 * 共用这一个口径 —— 两处各写一份 `find` 迟早会漂移。
 */
export function followUpHeadFor(
  queue: QueuedFollowUp[],
  activeSessionId: string | null,
): QueuedFollowUp | null {
  return followUpItemsFor(queue, activeSessionId)[0] ?? null;
}

/**
 * 记下「这个项目现在看的是哪个会话」（纯函数，返回新映射；无变化时返回原对象）。
 *
 * 只在**真的变了**的时候造新对象：这份映射挂在 store 上，`set` 出去的每个新对象
 * 都会让订阅它的组件重渲染一次，不该为了"写个相同的值"白抖一回。
 *
 * `sessionId === null`（该项目当前不选中任何会话）→ **删掉记录**，而不是留着旧 id：
 * 留着的话下次切回来会先"恢复"到一个已经不存在的会话，再被校验拦下 ——
 * 结果虽然还是空白，但中间态是错的（会真的去 get 一个不存在的会话）。
 */
function rememberSession(
  map: Record<string, string>,
  projectId: string | null | undefined,
  sessionId: string | null,
): Record<string, string> {
  if (!projectId) return map; // 没有当前项目 → 这条记忆无处可挂（也不该挂到别的项目上）

  if (sessionId === null) {
    if (!(projectId in map)) return map;
    const next = { ...map };
    delete next[projectId];
    return next;
  }

  if (map[projectId] === sessionId) return map;
  return { ...map, [projectId]: sessionId };
}

interface AppState {
  // ── 就绪状态 ──
  ready: boolean;
  bootError: string | null;

  // ── 项目 ──
  projects: ProjectMeta[];
  currentProject: ProjectMeta | null;

  // ── 会话 ──
  sessions: SessionMeta[];
  activeSessionId: string | null;
  /**
   * 「项目 → 上次看的是哪个会话」—— 切走项目再切回来要回到**原来那个**会话。
   *
   * 为什么必须有这份记忆：`openProject` 会先把 `activeSessionId` 置空
   * （切项目必须先离开旧会话，否则会短暂持有**另一个项目**的会话 id），
   * 而**没有任何东西会把它选回来** —— 于是「切到乙 → 切回甲」得到的是整屏空白。
   *
   * 内存态：本轮不落配置（会牵扯 settings schema）。
   * 应用重启后记忆为空 → 退化成"不选中"，与改动前一致（不发明新行为）。
   */
  lastSessionByProject: Record<string, string>;
  /** 点击“新任务”的次数；即使已经在空白页，再点一次也要清掉当前草稿。 */
  newChatRequest: number;

  // ── 配置 ──
  settings: AppSettings | null;
  providers: ProviderConfig[];
  skills: SkillMeta[];

  // ── 界面 ──
  theme: 'light' | 'dark';
  /** 右栏当前显示的面板（对齐原版 `dock.rightPanel.*`），null = 面板收起 */
  sidePanel: SidePanelTab | null;
  /** 右栏当前打开的标签。原版支持添加/关闭标签页，这里持久化到 localStorage */
  sidePanelTabs: SidePanelTab[];
  /**
   * 「编辑器视图」模式（原版 `chat.editorView.enter` / `exit`）。
   * 打开后主区左侧出现编辑器活动栏，并常驻编辑器面板；退出恢复普通对话视图。
   * 持久化到 localStorage —— 原版这是模式而非一次性动作。
   */
  editorView: boolean;
  taskView: 'chat' | 'workflow';
  setTaskView: (view: 'chat' | 'workflow') => void;
  /**
   * 待填入输入框的提示词。
   * 科研绘图模板页点「使用此模板」时写入，App 切回对话页，
   * ChatPage 挂载后取走（原版行为：绘图要求自动填入输入框）。
   */
  pendingPrompt: string | null;
  /**
   * 请求播放引导巡览的计数器（递增即触发一次）。
   * 用计数器而不是 boolean：连点两次也要能再次触发。
   */
  tourRequest: number;
  /**
   * 本次要播的是哪一段教程（设置页「新手教程」7 张卡各一个 id）。
   * null = 完整导览（原版「快速开始」那条 11 步）。
   */
  requestedTour: TourId | null;
  /**
   * 巡览被关掉的次数（每次关闭 +1）。
   * 教程卡用它判断「我这次开的这段真的被看完了」—— 而**不是**用 tourDone：
   * tourDone 只在完整导览结束时置位，短教程不该污染它。
   */
  tourFinished: number;

  /**
   * 回合运行中「排队」下来的追问（FIFO）。
   * 放 store 而不是 ChatPage 局部 state：输入区的「已排队 N 条」徽标也要读它，
   * 而 Composer 与 ChatPage 是兄弟组件。
   */
  followUpQueue: QueuedFollowUp[];

  // ── 动作 ──
  bootstrap: () => Promise<void>;
  setTheme: (t: 'light' | 'dark') => void;
  /** 切到某个面板（null = 收起右栏）；目标是标签时若尚未打开会自动加上该标签 */
  setSidePanel: (p: SidePanelTab | null) => void;
  /** 关闭一个标签：关的是当前项则激活相邻项，关掉最后一个则收起面板 */
  closeSidePanelTab: (tab: SidePanelTab) => void;
  /**
   * 进入 / 退出「编辑器视图」。
   * 进入时如果没有打开的右栏，自动挂上「文件」标签 —— 编辑器视图必须看得见编辑器面板。
   */
  setEditorView: (on: boolean) => void;
  /** 设置待填提示词（同时清空已消费标记） */
  fillPrompt: (text: string) => void;
  /** 取走待填提示词（取后即清） */
  consumePendingPrompt: () => string | null;
  /**
   * 请求播放引导巡览（设置页「新手教程」的卡片调用）。
   * @param tourId 不传 = 完整导览；传某张卡的 id = 只跑那段短教程
   */
  requestTour: (tourId?: TourId) => void;
  /** 巡览关闭时通知一次（教程卡据此结算完成态） */
  notifyTourFinished: () => void;

  /** 追问入队（归属记为**当下的** activeSessionId），返回新条目 id */
  enqueueFollowUp: (text: string, displayText?: string) => string;
  /**
   * 取走**属于当前会话**的队首并从队列移除（原子操作）。
   * 当前会话没有排队的条目 → 返回 null（什么都不做，队列原样）；
   * 该队首已标记 error 也返回 null —— 表示队列被这条卡住，不再自动往后发。
   */
  takeFollowUp: () => QueuedFollowUp | null;
  /**
   * 标记某条发送失败 —— 条目**必须留在队列里**（用户要能看出是哪条、并能重试）。
   *
   * 为什么收整条 `QueuedFollowUp` 而不是 id：
   *   真实调用顺序是 `takeFollowUp()`（先出队）→ `dispatch()` → 失败才来这里打标。
   *   那时条目已经不在队列里了，只给 id 的话 `map` 找不到它 →
   *   标记落空、条目凭空消失（徽标从「N 条」直接变空，用户以为发出去了）。
   *   拿到整条才能把它**补回队首**，让「失败停住队列」的语义真的生效。
   */
  markFollowUpError: (item: QueuedFollowUp, error: string) => void;
  /** 清掉某条的错误标记，让自动消化继续（输入区那条的「重试」） */
  retryFollowUp: (id: string) => void;
  /** 移除某条（用户手动清掉，或重试前先摘掉错误标记） */
  removeFollowUp: (id: string) => void;
  /** 清空队列 */
  clearFollowUps: () => void;
  /** 「文件」标签里内联打开的产物（相对项目根路径），null = 显示文件树 */
  activeArtifact: string | null;
  openArtifact: (relPath: string | null) => void;

  createProject: (name: string) => Promise<ProjectMeta | null>;
  openProject: (id: string) => Promise<void>;
  removeProject: (id: string, deleteMeta?: boolean) => Promise<void>;
  /** 改项目显示名（侧栏项目行的「重命名」）；不动磁盘目录 */
  renameProject: (id: string, name: string) => Promise<void>;
  refreshProjects: () => Promise<void>;

  refreshSessions: () => Promise<void>;
  createSession: (title?: string, shouldActivate?: () => boolean) => Promise<SessionMeta | null>;
  /** 进入当前项目的空白新任务；首条消息发送时才真正创建会话记录。 */
  beginNewChat: () => void;
  selectSession: (id: string | null) => void;
  removeSession: (id: string) => Promise<void>;

  refreshProviders: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshSkills: () => Promise<void>;
  toggleSkill: (dirName: string, enabled: boolean) => Promise<void>;
}

let projectOpenVersion = 0;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  bootError: null,

  projects: [],
  currentProject: null,

  sessions: [],
  activeSessionId: null,
  lastSessionByProject: {},
  newChatRequest: 0,

  settings: null,
  providers: [],
  skills: [],

  theme: 'light',
  // 默认隐藏右栏（原版如此，靠顶栏「打开面板」切换）
  sidePanel: null,
  sidePanelTabs: loadSidePanelTabs(),
  editorView: loadEditorView(),
  taskView: 'chat',
  setTaskView: taskView => set({ taskView }),
  pendingPrompt: null,
  tourRequest: 0,
  requestedTour: null,
  tourFinished: 0,
  followUpQueue: [],
  activeArtifact: null,

  // ─────────────────────────────────────────────────────────
  // 启动
  // ─────────────────────────────────────────────────────────

  bootstrap: async () => {
    try {
      const [settings, projects, providers, skills] = await Promise.all([
        api().settings.get(),
        api().project.list(),
        api().llm.listProviders(),
        api().skill.list(),
      ]);

      // 主题：跟随系统（Electron 的 nativeTheme 已经处理，这里只读一次）。
      // 外观页若固定了浅/深，effectiveTheme 会以它为准。
      const theme: 'light' | 'dark' = effectiveTheme();
      document.documentElement.dataset.theme = theme;
      applyAppearance();

      // 恢复最近项目。首次启动时 recentProjectId 可能还是空值，但主进程已经
      // 播种了默认 Workspace；此时必须主动认领它，否则所有依赖项目的功能
      // （会话、文件、终端、数据集）都会看起来“完全不能用”。
      let currentProject: ProjectMeta | null = null;
      if (settings.recentProjectId) {
        currentProject = projects.find((p) => p.id === settings.recentProjectId) ?? null;
      }

      if (!currentProject && projects.length > 0) {
        const defaultId = await api().project.defaultId();
        const preferred = projects.find((p) => p.id === defaultId) ?? projects[0];
        currentProject = (await api().project.open(preferred.id)) ?? preferred;
      }

      set({ settings, projects, providers, skills, currentProject, theme, ready: true });

      // 「编辑器视图」是持久化模式：上次退出时开着，这次启动也得看得见编辑器面板
      if (get().editorView && get().sidePanel === null) get().setSidePanel('files');

      if (currentProject) {
        await get().refreshSessions();
      }
    } catch (err) {
      set({
        ready: true,
        bootError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setTheme: (t) => {
    document.documentElement.dataset.theme = t;
    set({ theme: t });
    // 外观令牌是按主题分套的，换主题必须重跑一次
    applyAppearance();
  },

  setSidePanel: (p) => {
    if (p === null) {
      set({ sidePanel: null });
      return;
    }
    const tabs = get().sidePanelTabs;
    if (!tabs.includes(p)) {
      // 重新打开的标签按原版顺序归位，而不是一律追加到末尾
      const next = SIDE_PANEL_TABS.filter((k) => tabs.includes(k) || k === p);
      saveSidePanelTabs(next);
      set({ sidePanelTabs: next, sidePanel: p });
      return;
    }
    set({ sidePanel: p });
  },

  closeSidePanelTab: (tab) => {
    const tabs = get().sidePanelTabs;
    const idx = tabs.indexOf(tab);
    if (idx === -1) return;
    const rest = tabs.filter((x) => x !== tab);
    saveSidePanelTabs(rest);
    if (get().sidePanel !== tab) {
      set({ sidePanelTabs: rest });
      return;
    }
    // 关掉的是当前标签 → 激活右邻居，没有右邻居就用左邻居；全空了则收起面板
    const neighbor = rest[Math.min(idx, rest.length - 1)] ?? null;
    set({ sidePanelTabs: rest, sidePanel: neighbor });
  },

  setEditorView: (on) => {
    saveEditorView(on);
    if (!on) {
      set({ editorView: false });
      return;
    }
    // 编辑器视图必须看得见编辑器面板：没开右栏就挂上「文件」
    set({ editorView: true });
    if (get().sidePanel === null) get().setSidePanel('files');
  },

  fillPrompt: (text) => set({ pendingPrompt: text }),

  consumePendingPrompt: () => {
    const p = get().pendingPrompt;
    if (p !== null) set({ pendingPrompt: null });
    return p;
  },

  requestTour: (tourId) =>
    set({ tourRequest: get().tourRequest + 1, requestedTour: tourId ?? null }),

  notifyTourFinished: () => set({ tourFinished: get().tourFinished + 1 }),

  // ─────────────────────────────────────────────────────────
  // 追问队列
  // ─────────────────────────────────────────────────────────

  enqueueFollowUp: (text, displayText) => {
    // crypto.randomUUID 在 Electron 渲染层可用；退化路径保证 id 仍唯一
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // ⚠️ 归属在这里**定死**（入队那一刻的会话），之后切会话也不会改 ——
    //    否则"给 A 排的那句"会被发到 B 去。
    const sessionId = sessionKeyOf(get().activeSessionId);
    set({ followUpQueue: [...get().followUpQueue, { id, text, sessionId, ...(displayText !== undefined ? { displayText } : {}) }] });
    return id;
  },

  takeFollowUp: () => {
    const { followUpQueue, activeSessionId } = get();
    // ① 只认**属于当前会话**的队首：不是这个会话的条目一律不许被取走
    //    （取不到就什么都不做 —— 不发、也不从队列里删）
    const head = followUpHeadFor(followUpQueue, activeSessionId);
    if (!head) return null;
    // ② 本会话队首失败过就停在这里：不静默丢弃，也不对同一条无限重试
    if (head.error) return null;
    set({ followUpQueue: followUpQueue.filter((q) => q.id !== head.id) });
    return head;
  },

  markFollowUpError: (item, error) =>
    set((s) => {
      const q = s.followUpQueue;
      // 条目还在队列里（正常情况）→ 原地打标，顺序不变
      if (q.some((x) => x.id === item.id)) {
        return { followUpQueue: q.map((x) => (x.id === item.id ? { ...x, error } : x)) };
      }
      // 已经被 takeFollowUp 出队了（真实路径）→ 补回队首，别让这条消息凭空消失。
      // 幂等：上面 `some` 已经挡掉重复插入，同一条被 mark 多次也只更新 error。
      return { followUpQueue: [{ ...item, error }, ...q] };
    }),

  retryFollowUp: (id) =>
    set({
      followUpQueue: get().followUpQueue.map((q) =>
        // 只摘掉 error，条目本身留在原位（顺序不变）——**归属必须一起带上**，
        // 少了 sessionId 这条就会变成"没有会话"的孤儿，永远排不到
        q.id === id ? { id: q.id, text: q.text, sessionId: q.sessionId } : q,
      ),
    }),

  removeFollowUp: (id) => set({ followUpQueue: get().followUpQueue.filter((q) => q.id !== id) }),

  clearFollowUps: () => set({ followUpQueue: [] }),

  openArtifact: (relPath) => {
    // 原版右栏没有独立的「产物」标签：产物预览/编辑是「文件」标签里的内联视图。
    // 所以这里只记路径，并确保停在/切回「文件」标签 —— 否则标签条会出现「无高亮」的坏状态。
    set({ activeArtifact: relPath });
    get().setSidePanel('files');
  },

  // ─────────────────────────────────────────────────────────
  // 项目
  // ─────────────────────────────────────────────────────────

  refreshProjects: async () => {
    const projects = await api().project.list();
    set({ projects });
  },

  createProject: async (name) => {
    const requestVersion = ++projectOpenVersion;
    const meta = await api().project.create(name);
    if (!meta || requestVersion !== projectOpenVersion) return null;
    await get().refreshProjects();
    /**
     * 与 `openProject` 同一条规则：**换了项目就先离开旧会话**。
     * 这里原来漏了这一句，于是新建项目后 `activeSessionId` 还指着**上一个项目**的会话，
     * 而 `sessions` 已经换成新项目的（空）—— 对话页顶着新项目的标题显示旧项目的聊天记录。
     */
    set({ currentProject: meta, activeSessionId: null, activeArtifact: null, pendingPrompt: null });
    await get().refreshSessions();
    await get().refreshSettings();
    return meta;
  },

  openProject: async (id) => {
    const requestVersion = ++projectOpenVersion;
    const meta = await api().project.open(id);
    if (!meta || requestVersion !== projectOpenVersion) return;
    /**
     * ① **先离开旧会话**（保持原样，别删这一句）：此刻 `sessions` 还是上一个项目的，
     *    若不置空，切项目的瞬间界面会持有**另一个项目**的会话 id（更糟的中间态）。
     */
    set({
      currentProject: meta,
      activeSessionId: null,
      activeArtifact: null,
      pendingPrompt: null,
    });
    await get().refreshSettings();
    if (requestVersion !== projectOpenVersion || get().currentProject?.id !== meta.id) return;
    await get().refreshSessions();
    if (requestVersion !== projectOpenVersion || get().currentProject?.id !== meta.id) return;
    await get().refreshProjects();
    /**
     * ② **再**看要不要恢复「这个项目上次看的是哪个会话」。
     *    `refreshSessions()` 已经把 `sessions` 换成新项目的了，所以拿它校验：
     *    会话可能已被删除 —— 那就必须退化成"不选中"，绝不能把一个死 id 塞进去
     *    （否则 ChatPage 会去 get 一个不存在的会话）。
     *    映射里没记过（例如本次运行还没在这个项目里选过会话）同样保持不选中 ——
     *    **不自动选列表里的第一个**。
     */
    if (get().currentProject?.id !== meta.id) return; // 响应回来时用户又切走了 → 整份放弃
    const remembered = get().lastSessionByProject[meta.id];
    if (remembered && get().sessions.some((s) => s.id === remembered)) {
      set({ activeSessionId: remembered });
    }
  },

  removeProject: async (id, deleteMeta = false) => {
    const projects = await api().project.remove(id, deleteMeta);
    const wasCurrent = get().currentProject?.id === id;
    set({
      projects,
      currentProject: wasCurrent ? null : get().currentProject,
      sessions: wasCurrent ? [] : get().sessions,
      activeSessionId: wasCurrent ? null : get().activeSessionId,
    });
    await get().refreshSettings();
  },

  renameProject: async (id, name) => {
    const next = name.trim();
    if (!next) return;
    const meta = await api().project.rename(id, next);
    if (!meta) return;
    // 顺手刷新 `currentProject`：改的若是当前项目，侧栏标题要立刻跟着变
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? meta : p)),
      currentProject: s.currentProject?.id === id ? meta : s.currentProject,
    }));
  },

  // ─────────────────────────────────────────────────────────
  // 会话
  // ─────────────────────────────────────────────────────────

  refreshSessions: async () => {
    const proj = get().currentProject;
    if (!proj) {
      set({ sessions: [], activeSessionId: null });
      return;
    }
    const sessions = await api().session.list(proj.id);
    // A 项目的慢响应不能在用户已经切到 B 后覆盖 B 的任务列表。
    if (get().currentProject?.id !== proj.id) return;
    set({ sessions });
  },

  createSession: async (title, shouldActivate) => {
    const proj = get().currentProject;
    if (!proj) return null;
    const request = get().newChatRequest;
    const previous = get().activeSessionId;
    const meta = await api().session.create(proj.id, title);
    if (shouldActivate?.() === false || get().currentProject?.id !== proj.id || get().newChatRequest !== request || get().activeSessionId !== previous) return null;
    // 新建后自动选中它 —— 这也算"用户主动选中的入口"，一样要记进项目记忆
    set((s) => ({
      sessions: [meta, ...s.sessions.filter(item => item.id !== meta.id)],
      activeSessionId: meta.id,
      lastSessionByProject: rememberSession(s.lastSessionByProject, proj.id, meta.id),
    }));
    return meta;
  },

  beginNewChat: () =>
    set((s) => ({
      activeSessionId: null,
      newChatRequest: s.newChatRequest + 1,
      lastSessionByProject: rememberSession(
        s.lastSessionByProject,
        s.currentProject?.id,
        null,
      ),
    })),

  selectSession: (id) =>
    set((s) => ({
      activeSessionId: id,
      lastSessionByProject: rememberSession(s.lastSessionByProject, s.currentProject?.id, id),
    })),

  removeSession: async (id) => {
    await api().session.remove(id);
    const rest = get().sessions.filter((s) => s.id !== id);
    const wasActive = get().activeSessionId === id;
    const nextActive = wasActive ? (rest[0]?.id ?? null) : get().activeSessionId;
    set((s) => ({
      sessions: rest,
      activeSessionId: nextActive,
      /**
       * 删掉的正是"记忆里那个会话"时必须一起改（含落到 null 时删记录）：
       * 否则下次切回这个项目会去恢复一个已被删除的 id，恢复必然失败 → 白屏。
       * 删的是别的会话时 `nextActive` 没变，`rememberSession` 会原样返回。
       */
      lastSessionByProject: wasActive
        ? rememberSession(s.lastSessionByProject, s.currentProject?.id, nextActive)
        : s.lastSessionByProject,
    }));
  },

  // ─────────────────────────────────────────────────────────
  // 配置
  // ─────────────────────────────────────────────────────────

  refreshProviders: async () => {
    set({ providers: await api().llm.listProviders() });
  },

  refreshSettings: async () => {
    set({ settings: await api().settings.get() });
  },

  patchSettings: async (patch) => {
    set({ settings: await api().settings.set(patch) });
  },

  refreshSkills: async () => {
    set({ skills: await api().skill.list() });
  },

  toggleSkill: async (dirName, enabled) => {
    set({ skills: await api().skill.toggle(dirName, enabled) });
  },
}));

/** 便捷选择器：当前会话对象 */
export function useActiveSession(): SessionMeta | null {
  return useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null);
}
