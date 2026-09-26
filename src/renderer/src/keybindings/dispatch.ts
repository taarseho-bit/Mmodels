/**
 * 快捷键**统一分发器**（本仓唯一的 `keydown` 监听）。
 *
 * ── 为什么必须有这个文件 ──
 * 在它之前，"设置 → 键盘快捷键"里那 14 条**全是假控件**：
 * 它们只存在于 `KeysSection.tsx` 的 `RULES` 表里，**全仓零 keydown 消费点**
 * ⇒ 用户辛辛苦苦录了一个自定义键位，按下去没有任何反应。
 * 而 `App.tsx` 里真正生效的两条（`new-chat` / `open-settings`）**根本不在那张表里**。
 *
 * ── 为什么做成"注册表 + 一个监听"，而不是每个组件各挂一个 ──
 * 本仓**已经有 11 处** `keydown` 监听（`App` / `ApprovalDialog` / `ArtifactPanes` /
 * `AskUserDialog` / `Composer`×2 / `ContextMenu`(捕获阶段) / `EnvironmentMenu` /
 * `GuidedTour` / `KeysSection`(捕获阶段) / `GalleryPage`）。
 * 再给 14 条命令各挂一个 = **"谁先 `preventDefault` 谁赢"** 的竞争，
 * 表现为**随机失灵**（同一个键有时有反应有时没有）。
 *
 *   所以：**只挂一个** `keydown`；命令的归属者调用 `registerCommand()` 登记处理函数。
 *   登记只在该组件**挂载期间**有效 —— 这一点不是实现细节，是**判据的一部分**：
 *   图库灯箱没打开时 `gallery.prev` 不在注册表里，按 ← 不会做任何事
 *   （否则用户在任何输入框里按方向键移动光标都会被吃掉）。
 *
 * ── 键位行为全部从项目契约取证（不是我按直觉定的）──
 * 证据：`.baseline/readable/index-OYc102qC.js`
 *   · 默认键位表 `Vk`（第 19020 行）：
 *       { "shortcuts.help":"mod+slash", "search.toggle":"mod+k", "sidebar.toggle":"mod+b",
 *         "composer.attach":"mod+u", "message.editSubmit":"mod+enter", "chat.find":"mod+f",
 *         "preview.openInEditor":"mod+o", "gallery.prev":"left", "gallery.next":"right" }
 *     —— 与 `RULES` 里 9 条 `defaultBinding` 字段一致。
 *   · 14 条展示表 `Xxe`（第 40194 行）：5 条**没有 `keys`**
 *     （`composer.send` / `composer.newline` / `composer.planMode` / `chat.findNext` /
 *      `prompt.pickOption`，只有 `display`）⇒ 它们**不可自定义**。
 *   · 注册方式 `N_`（第 44399 行，react-hotkeys-hook 的 `useHotkey`），三处调用点都传
 *       `{ enableOnFormTags: true, enableOnContentEditable: true, preventDefault: true }`
 *     （第 44460 / 45350 行）：
 *       - `enableOnFormTags: true` ⇒ **焦点在 input / textarea / select 里时，快捷键照常触发**；
 *       - `enableOnContentEditable: true` ⇒ contenteditable 同理；
 *       - `preventDefault: true` ⇒ **命中时**才 preventDefault（`M_e` 第 44348 行：
 *         `n === true && t.preventDefault()`），未命中什么都不做。
 *       ⚠️ 这条正是"**输入框里按快捷键仍要触发**"的硬证据 —— 别按直觉把它改成"输入框里一律忽略"。
 *   · 修饰键**必须精确匹配**：`N_` 没开 `ignoreModifiers` ⇒ `mod+b` 不会被 `Ctrl+Shift+B` 命中。
 *   · **不忽略 `e.repeat`**：`N_` 里 keydown 路径的 `H` 恒为 `false`，
 *     而"重复"那道守卫是 `H && l.current` ⇒ 长按会**重复触发**。
 *     这是项目契约行为（`gallery.prev` 长按连续翻页正需要它），本实现照做，不再自行加过滤。
 *   · 用户覆盖的合并口径 `r6`（第 40202 行）：有用户规则就用用户规则（**倒序取最后一条**），
 *     否则回落 `Vk[command]`；键位串先过 `Yw` 归一化（小写 / 去空白 / 别名展开）。
 *   · 平台判定 `jA`（第 45346 行）：`/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)`
 *     —— `mod` = Mac 上是 ⌘、其它平台是 Ctrl。
 *
 * ── ★ 与项目契约中的**有意**差异（逐条给出项目契约行号 + 理由，不是"没注意"）──
 * 匹配函数项目契约规定的是 `$xe`（第 40213-40219 行），逐行对照后有 4 处不同：
 *   D1. **只按修饰键的键位串**（如 `ctrl`）：项目契约 `if (o.length === 0) return true;`（第 40216 行）
 *       ⇒ 它会匹配**任意**带 Ctrl 的按键。本实现判为"没有主键" ⇒ 不匹配。
 *       理由：那会让一条脏配置把 Ctrl+C / Ctrl+V 也 `preventDefault` 掉，
 *       与判据②（别坏掉用户正常打字/复制粘贴）直接冲突。项目契约这条分支正常也走不到
 *       （`z6e` 录制时拒绝只按修饰键、`Vk` 里每条都有主键）⇒ 只有配置被手改坏时才可达。
 *   D2. **多个主键**（`mod+b+k`）：项目契约 `const u = o[0]`（第 40217 行）只取**第一个**，
 *       后面的静默丢掉 ⇒ `mod+b+k` 等价 `mod+b`。本实现判为脏数据 ⇒ 不匹配。
 *       理由：静默把用户写的键位"改名"，比拒绝它更容易造成"按我写的键却没反应"。
 *   D3. **`e.key` 兜底**：项目契约 `u === pU(t.code) || u === t.key.toLowerCase()`（第 40218 行）。
 *       本实现只用 `code`（布局无关）。理由：真实 keydown 的 `code` 恒存在；
 *       而 `key` 在中文输入法/组合输入下会出现 `Process`、`Unidentified` 这类噪声。
 *   D4. **Mac 键帽标签**：项目契约 `s6`（第 40237 行）在 Mac 上用 `Jxe`（⌘ / ⌃ / ⌥ / ⇧），
 *       本实现设置页一律用 Windows 侧标签（`ewe` = Ctrl / Win / Alt / Shift）。
 *       理由：本仓只产出 Windows 安装包（`release/win-unpacked`）。
 *       ⚠️ 要接 D4 只需加一张映射表 + 一个平台分支，属"要做但没做"，不是"做不到"。
 *
 * ── ★ 未接线的命令必须显式标注（不许假装接上）──
 * `RULES` 每条的 `unwired` 字段说明"为什么它现在按下没反应"，见该字段的取值说明。
 */
import { useApp } from '../store/app';

export type SectionId = 'global' | 'chat' | 'preview' | 'gallery';

/**
 * 「这条命令现在按下没反应」的**原因分类**。
 * 不加这个字段就会出现"表里有、按了没用、但没人知道为什么"的状态 —— 那正是这次要修的病灶。
 */
export type UnwiredReason =
  /** 目标功能在**本仓根本不存在**（不是接线问题，是先得把功能做出来） */
  | 'pending-feature'
  /** 目标功能存在，但归属的文件**没有被授权给我改**（需要归属者登记一行） */
  | 'other-owner'
  /** 功能在，但在本仓的界面布局下**语义需要产品决策**（不能靠猜） */
  | 'product-decision';

export interface KeyRule {
  /** 项目契约 command id */
  command: string;
  section: SectionId;
  /** 当前 i18n 键 */
  labelKey: string;
  /** 可录制覆盖的默认键位（项目契约 `Vk` 常量）；缺省表示这条不可自定义 */
  defaultBinding?: string;
  /** 不可自定义条目的固定键帽（项目契约 `display` 常量） */
  display?: string[];
  /** 现在按下没反应的原因；缺省 = 已接线 */
  unwired?: UnwiredReason;
  /** 为什么（写给后来人看的一句话） */
  unwiredNote?: string;
}

/** 项目契约条目表（顺序 = 项目契约分组内渲染顺序；`display`/`keys` 逐条对照 `Xxe` 与 `Vk`） */
export const RULES: KeyRule[] = [
  // ── 全局 ──
  {
    command: 'shortcuts.help',
    section: 'global',
    labelKey: 'shell.keymap.shortcuts.help',
    defaultBinding: 'mod+slash',
  },
  { command: 'search.toggle', section: 'global', labelKey: 'shell.keymap.search.toggle', defaultBinding: 'mod+k' },
  { command: 'sidebar.toggle', section: 'global', labelKey: 'shell.keymap.sidebar.toggle', defaultBinding: 'mod+b' },
  // ── 会话 ──
  //
  // ⚠️ 下面两条（`composer.send` / `composer.newline`）**已接线，但不经过分发器**：
  //    它们由 `Composer.tsx:913` 那个 `<textarea onKeyDown>` 自己处理（`Enter` 发送、
  //    `Shift+Enter` 落到 textarea 默认行为 = 换行），**与项目契约一致** ——
  //    项目契约 `Xxe` 里这两条也只有 `display`、**不可自定义**，走的也不是全局热键通道。
  //    所以它们没有 `unwired` 字段（= 按了有反应），只是"接线的人不是本分发器"。
  {
    command: 'composer.send',
    section: 'chat',
    labelKey: 'shell.keymap.composer.send',
    display: ['Enter'],
  },
  {
    command: 'composer.newline',
    section: 'chat',
    labelKey: 'shell.keymap.composer.newline',
    display: ['Shift', 'Enter'],
  },
  {
    command: 'composer.planMode',
    section: 'chat',
    labelKey: 'shell.keymap.composer.planMode',
    display: ['Shift', 'Tab'],
  },
  {
    command: 'composer.attach',
    section: 'chat',
    labelKey: 'shell.keymap.composer.attach',
    defaultBinding: 'mod+u',
    // ✅ 已接线（原为 `unwired: 'other-owner'`）：`Composer.tsx` 里
    //    `registerCommand('composer.attach', …)` → 弹系统「选择文件」对话框，
    //    把选中的文件挂成附件（与「＋」菜单首行「添加文件或照片」同一个动作）。
    //
    //    接线前它标 `other-owner` 的理由是「能力现成、入口不存在」：附件状态
    //    （`setAttachments`）与「选择文件」IPC（`src/main/ipc/file.ts:237`）都在，
    //    但 Composer 里**既没有按钮也没有代码路径**去调它 —— 附件入口只有拖入 / 粘贴，
    //    连 `addFromFiles` 提示语里那句"请用 ＋ 按钮从本机选择"都是假的。
  },
  {
    command: 'message.editSubmit',
    section: 'chat',
    labelKey: 'shell.keymap.message.editSubmit',
    defaultBinding: 'mod+enter',
    unwired: 'other-owner',
    unwiredNote:
      '归 `ChatPage.tsx`（边界外）；"正在编辑的那条消息"是它的局部状态，外部拿不到。' +
      '⚠️ 别和 Composer 里的 `Ctrl/Cmd+Enter` 搞混：那个是「本次追问取反」（`Composer.tsx:445`），' +
      '与本条的"提交正在编辑的消息"是两件事。',
  },
  {
    command: 'chat.find',
    section: 'chat',
    labelKey: 'shell.keymap.chat.find',
    defaultBinding: 'mod+f',
  },
  {
    command: 'chat.findNext',
    section: 'chat',
    labelKey: 'shell.keymap.chat.findNext',
    display: ['Enter'],
  },
  {
    command: 'prompt.pickOption',
    section: 'chat',
    labelKey: 'shell.keymap.prompt.pickOption',
    display: ['1', '…', '9'],
    unwired: 'product-decision',
    unwiredNote:
      '项目契约**一次只显示一个问题**（`f.questionIndex`），所以"按 3 = 选当前问题的第 3 项"没有歧义；' +
      '本仓的提问框**一次列出全部问题** ⇒ 数字键到底作用于哪个问题是产品决策，不能猜。见报告。' +
      '⚠️ 接线的人注意：项目契约给这条**单独**写了"输入框/contenteditable 里不触发"' +
      '（`D instanceof HTMLInputElement || D instanceof HTMLTextAreaElement || D.closest("[contenteditable]:not([contenteditable=false])")` 就 return），' +
      '**与全局的 enableOnFormTags:true 相反** —— 裸数字键要是照全局口径走，用户在输入框里打字会被吃掉。',
  },
  // ── 文件预览 ──
  {
    command: 'preview.openInEditor',
    section: 'preview',
    labelKey: 'shell.keymap.preview.openInEditor',
    defaultBinding: 'mod+o',
    unwired: 'pending-feature',
    unwiredNote:
      '项目契约能探测本机编辑器并按名字拉起；本仓只有"用系统默认程序打开**项目目录**"（`shell.openPath`），' +
      '**没有"打开当前这个文件"的 IPC** ⇒ 功能不存在（不是接线问题）。',
  },
  // ── 图库 ──
  { command: 'gallery.prev', section: 'gallery', labelKey: 'shell.keymap.gallery.prev', defaultBinding: 'left' },
  { command: 'gallery.next', section: 'gallery', labelKey: 'shell.keymap.gallery.next', defaultBinding: 'right' },
];

/**
 * **本仓自带、当前没有**的两条命令（`App.tsx` 里原本硬编码在监听器里）。
 *
 * 为什么不并进 `RULES`：`RULES` 是"项目契约「键盘快捷键」页那 14 行"的逐字当前实现
 * （对照 `Xxe` / `Vk` 核过）。把这两条混进去会让那张表与项目契约不再一一对应。
 *
 * 为什么不直接删掉：它们**现在真的能用**（Ctrl+N 新会话 / Ctrl+, 打开设置），
 * 删掉是功能倒退。所以走同一套匹配逻辑，只是不进设置页的列表。
 *
 * ⚠️ 默认值保持 `'Ctrl + N'` / `'Ctrl + ,'` 的**字面**写法：这是这两个键**历史以来的配置值格式**，
 *    旧用户的 `settings.keybindings` 里存的就是这个形状。`normalizeBinding` 会把它们归一成
 *    `ctrl+n` / `ctrl+comma`，在 Windows 上与命中路径（`mod`→Ctrl）一致 ⇒ 行为不变。
 */
export const APP_COMMANDS: Array<{ command: string; defaultBinding: string }> = [
  { command: 'new-chat', defaultBinding: 'Ctrl + N' },
  { command: 'open-settings', defaultBinding: 'Ctrl + ,' },
];

// ───────────────────────── 键位串的归一化 ─────────────────────────

/**
 * 项目契约键位别名表（Windows 侧标签）。
 * ⚠️ `mod` / `meta` / `ctrl` 是**三个不同的 token**：
 *   `mod` = 平台主修饰键（Mac 上是 ⌘、其它是 Ctrl）、`meta` = ⌘/Win 键、`ctrl` = 字面 Ctrl。
 *   在 Windows 上 `mod` 和 `ctrl` 都会被 Ctrl 满足，在 Mac 上不会。
 */
const KEY_ALIAS: Record<string, string> = {
  '/': 'slash',
  ',': 'comma',
  '.': 'period',
  ';': 'semicolon',
  "'": 'quote',
  '[': 'bracketleft',
  ']': 'bracketright',
  '\\': 'backslash',
  '-': 'minus',
  '=': 'equal',
  '`': 'backquote',
  return: 'enter',
  esc: 'escape',
  cmd: 'meta',
  command: 'meta',
  control: 'ctrl',
  option: 'alt',
  arrowleft: 'left',
  arrowright: 'right',
  arrowup: 'up',
  arrowdown: 'down',
};

const KEY_LABEL: Record<string, string> = {
  mod: 'Ctrl',
  meta: 'Win',
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  enter: 'Enter',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
};

const KEY_CHAR: Record<string, string> = {
  slash: '/',
  comma: ',',
  period: '.',
  semicolon: ';',
  quote: "'",
  bracketleft: '[',
  bracketright: ']',
  backslash: '\\',
  minus: '-',
  equal: '=',
  backquote: '`',
};

const MOD_NAMES = new Set(['mod', 'ctrl', 'alt', 'shift', 'meta']);
/** 允许"裸键"（不带修饰键）的键：功能键与方向键 —— 字母/数字裸键会把正常打字吃掉 */
const BARE_KEYS = /^(f\d{1,2}|left|right|up|down)$/;

/** 键位串 → 规范化（别名展开） */
export function normalizeBinding(binding: string): string {
  return binding
    .toLowerCase()
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => KEY_ALIAS[s] ?? s)
    .join('+');
}

/** 键位串 → 键帽文本数组 */
export function keycapParts(binding: string): string[] {
  return normalizeBinding(binding)
    .split('+')
    .map((k) => KEY_LABEL[k] ?? KEY_CHAR[k] ?? k.toUpperCase());
}

/** KeyboardEvent.code → 规范化键名（项目契约 `Xf` / `pU`：去掉 key/digit/numpad 前缀再查别名） */
export function normalizeCode(code: string): string {
  const k = code.toLowerCase().replace(/^(key|digit|numpad)/, '');
  return KEY_ALIAS[k] ?? k;
}

/**
 * 平台判定（项目契约 `jA` 第 45346 行原样）：
 * `/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)`。
 * ⚠️ 必须做 `typeof navigator` 守卫：本文件会被 node 环境（vitest）import，
 *    那里没有 `navigator`，不加守卫会直接 `ReferenceError`（而不是"退化成非 Mac"）。
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const n = navigator as { platform?: string; userAgent?: string };
  return /Mac|iPhone|iPad|iPod/i.test(n.platform || n.userAgent || '');
}

// ───────────────────────── 事件 → 键位串 ─────────────────────────

/** 分发器只需要事件的这几个字段（**故意不依赖 DOM 类型** —— node 里也能直接测） */
export interface KeyEventLike {
  /** `KeyboardEvent.code`。空/缺失 = 不匹配任何命令（项目契约同样是 `j.code !== undefined` 才处理） */
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** 事件的规范化键名；`code` 缺失时返回 null */
export function eventKeyToken(e: KeyEventLike): string | null {
  const code = e.code;
  if (typeof code !== 'string' || code === '') return null;
  const t = normalizeCode(code);
  return t === '' ? null : t;
}

/**
 * 这个事件**实际按下**的修饰键集合（只有 `alt` / `shift` / `meta` / `ctrl` 四个真值）。
 *
 * ⚠️ **故意不在这里合成 `mod`**：`mod` 是"平台主修饰键"的**别名**，不是第四个物理键。
 * 如果这里塞一个 `mod` 进去，Ctrl+B 在 Windows 上会得到 `{ctrl, mod}` 两个元素，
 * 而键位串 `mod+b` 只有 `{mod}` 一个元素 ⇒ 计数不相等 ⇒ **Ctrl+B 永远匹配不上**。
 * 展开只做一次，方向是"键位串里的 `mod` → 实际修饰键"（见 `expandMod`）。
 */
export function activeMods(e: KeyEventLike): Set<string> {
  const s = new Set<string>();
  if (e.altKey) s.add('alt');
  if (e.shiftKey) s.add('shift');
  if (e.metaKey) s.add('meta');
  if (e.ctrlKey) s.add('ctrl');
  return s;
}

/**
 * 把键位串里的修饰键 token 展开成本平台的**实际**修饰键。
 * `mod` → Mac 上是 `meta`（⌘）、其它平台是 `ctrl`；其余 token 原样。
 */
export function expandMod(tokens: Iterable<string>, mac: boolean): Set<string> {
  const out = new Set<string>();
  for (const t of tokens) out.add(t === 'mod' ? (mac ? 'meta' : 'ctrl') : t);
  return out;
}

/** 按下组合键 → 键位串；只按修饰键/无意义的键返回 null（项目契约 `z6e`） */
export function captureBinding(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null;
  const mac = isMacPlatform();
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('mod');
  if (mac ? e.ctrlKey : e.metaKey) mods.push(mac ? 'ctrl' : 'meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  const key = normalizeCode(e.code);
  if (!key || MOD_NAMES.has(key)) return null;
  if (mods.length === 0 && !BARE_KEYS.test(key)) return null;
  return [...mods, key].join('+');
}

/** 录制过程中的实时键帽预览（项目契约 `j6e`） */
export function previewParts(e: KeyboardEvent): string[] {
  const mac = isMacPlatform();
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push('mod');
  if (mac ? e.ctrlKey : e.metaKey) mods.push(mac ? 'ctrl' : 'meta');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  return [...mods.flatMap((m) => keycapParts(m)), ...keycapParts(normalizeCode(e.code))];
}

// ───────────────────────── 匹配 ─────────────────────────

/**
 * 单个事件是否命中某个键位串。
 *
 * 规则（逐条按项目契约 `$xe`，第 40213-40219 行）：
 *  1. 键名必须相等（比较 `code` 归一化后的 token，**布局无关**）；
 *  2. 修饰键必须**精确相等** —— 项目契约规定的是
 *     `t.metaKey !== s || t.ctrlKey !== l || t.altKey !== i.has('alt') || t.shiftKey !== i.has('shift')`
 *     四个布尔**逐一比对**，等价于"集合相等"；多按一个 Shift 就不算命中；
 *  3. `mod` 按平台展开成 ⌘ / Ctrl（项目契约 `s = meta || (mod && mac)`、`l = ctrl || (mod && !mac)`）；
 *  4. 空键位串 ⇒ 永不命中（项目契约对 `''` 也走不到"只按修饰键"那条分支，因为 token 是 `['']`）。
 *  ⚠️ 另外两处**有意**差异（只按修饰键 / 多个主键）见文件头 D1 / D2。
 */
export function matchesBinding(e: KeyEventLike, binding: string | null, mac?: boolean): boolean {
  if (!binding) return false;
  const toks = normalizeBinding(binding).split('+').filter(Boolean);
  const key = toks.filter((t) => !MOD_NAMES.has(t));
  // D1 / D2：没有主键（只按修饰键）或多个主键（脏数据）一律不算命中 —— 理由见文件头
  if (key.length !== 1) return false;
  const et = eventKeyToken(e);
  if (!et || et !== key[0]) return false;
  // `mod` 按平台展开成实际修饰键后再比 —— 这**不违反**"精确匹配"：
  // 展开只消除"别名"这一层，多按/少按修饰键仍然会因为集合不相等而落空。
  const want = expandMod(toks.filter((t) => MOD_NAMES.has(t)), mac ?? isMacPlatform());
  const act = activeMods(e);
  if (want.size !== act.size) return false;
  for (const m of want) if (!act.has(m)) return false;
  return true;
}

/**
 * 某个命令当前生效的键位串。
 *
 * 合并口径按项目契约 `r6(command, rules)`：**用户值优先**，没有用户值才回落默认。
 * 额外比项目契约多了一条（有证据、且本仓 UI 产生不了）：用户显式写成**空串** = **解绑** ——
 * 项目契约 `Yw('')` 得到空串，空串匹配不到任何键，等价于"这个命令没有快捷键"。
 * `undefined`（键不存在）= 没配过 ⇒ 用默认。两者不能混为一谈。
 */
export function effectiveBinding(
  command: string,
  overrides: Record<string, string> | undefined,
  fallback?: string,
): string | null {
  const v = overrides?.[command];
  if (typeof v === 'string') return v.trim() === '' ? null : v;
  return fallback ?? null;
}

/**
 * 候选表：`active` 里的命令 → 它的生效键位（保持传入顺序，**第一条命中者获胜**）。
 *
 * ⚠️ 这里**不需要平台参数**：`mod` 只在"匹配事件"那一步才展开成 ⌘/Ctrl，
 *    键位串本身在候选表里保持原样（`mod+b` 就是 `mod+b`，不因平台改写成 `ctrl+b`）。
 */
export function candidateBindings(
  active: Iterable<string>,
  overrides: Record<string, string> | undefined,
): Array<{ command: string; binding: string }> {
  const defaults = new Map<string, string>();
  for (const r of RULES) if (r.defaultBinding) defaults.set(r.command, r.defaultBinding);
  for (const c of APP_COMMANDS) defaults.set(c.command, c.defaultBinding);
  const out: Array<{ command: string; binding: string }> = [];
  for (const cmd of active) {
    const b = effectiveBinding(cmd, overrides, defaults.get(cmd));
    if (b) out.push({ command: cmd, binding: b });
  }
  return out;
}

/** 事件命中哪个命令（没命中返回 null；**恰好返回一条**） */
export function matchCommand(
  e: KeyEventLike,
  candidates: Array<{ command: string; binding: string }>,
  mac?: boolean,
): string | null {
  for (const c of candidates) {
    if (matchesBinding(e, c.binding, mac)) return c.command;
  }
  return null;
}

/**
 * 分发优先级：**`RULES` 在前、`APP_COMMANDS` 在后**。
 * 理由：用户在设置页显式改过的键位应该压过那条**界面上看不见**的历史默认值
 * （例如把某条命令改绑到 Ctrl+N，不该被 `new-chat` 悄悄吃掉）。
 *
 * 表内撞键的裁决：**谁在 `RULES` 里靠前谁生效**（`search.toggle` 在 `sidebar.toggle` 之前）。
 * 这是用户自己造出来的冲突（两条命令录了同一个键），任何确定性口径都可以接受，
 * 但必须是**可预测且写在测试里**的 —— 所以 `dispatch.test.ts` 里把顺序硬钉住了：
 * 谁调整 `RULES` 的排列，就会看到那条用例变红，从而知道"撞键时谁生效"被改了。
 */
export function dispatchOrder(active: Iterable<string>): string[] {
  const set = new Set(active);
  const out: string[] = [];
  for (const r of RULES) if (set.has(r.command)) out.push(r.command);
  for (const c of APP_COMMANDS) if (set.has(c.command)) out.push(c.command);
  for (const cmd of set) if (!out.includes(cmd)) out.push(cmd); // 未登记在表里的（理论上没有）
  return out;
}

// ───────────────────────── 注册表 + 唯一的监听 ─────────────────────────

export type CommandHandler = (e: KeyEventLike) => void;

const handlers = new Map<string, CommandHandler>();

/**
 * 登记某个命令的处理函数。**返回注销函数**（组件卸载时必须调）。
 *
 * ⚠️ 没被登记的命令**完全不参与匹配** —— 所以"未命中"天然就是"什么都不做"：
 *    不 preventDefault、不 preventDefault 之后的任何副作用。
 */
export function registerCommand(command: string, handler: CommandHandler): () => void {
  handlers.set(command, handler);
  return () => {
    // 只在"还是我登记的那个"时才删：避免 A 卸载时把 B 刚登记的顶掉
    if (handlers.get(command) === handler) handlers.delete(command);
  };
}

/** 当前登记了处理函数的命令（按分发顺序）。诊断/测试用。 */
export function registeredCommands(): string[] {
  return dispatchOrder(handlers.keys());
}

/** `installKeybindings` 的最小依赖面（`window` 与 `document` 都满足它） */
export interface KeyTarget {
  addEventListener(type: string, cb: (ev: Event) => void): void;
  removeEventListener(type: string, cb: (ev: Event) => void): void;
}

export interface InstallOptions {
  /** 默认 `window`；测试传假目标，从而**不需要 jsdom** */
  target?: KeyTarget;
  /** 取用户覆盖；默认读设置 */
  getOverrides?: () => Record<string, string> | undefined;
  /** 取"当前活跃的命令"；默认 = 注册表 */
  getActive?: () => Iterable<string>;
  /** 强制平台（测试用；默认按 `navigator` 判） */
  mac?: boolean;
}

/**
 * 挂上**唯一**的那个 `keydown` 监听。返回卸载函数。
 *
 * 判据（与报告里的四条一一对应）：
 *  1. 命中 ⇒ 处理函数**恰好被调 1 次**（`matchCommand` 只返回一条，循环里第一个命中就返回）；
 *  2. 未命中 ⇒ **不调用 `preventDefault`**（先 `return`，一个字节都不动）；
 *  3. 输入框里打普通字母 ⇒ 命中不到任何命令（没有任何键位是裸字母），所以不会吃掉打字；
 *  4. 命中 ⇒ `preventDefault`（项目契约 `preventDefault: true`），且**在调处理函数之前**（项目契约 `M_e` 也是先 prevent）。
 */
export function installKeybindings(opts: InstallOptions = {}): () => void {
  const target = opts.target ?? (window as unknown as KeyTarget);
  const getOverrides =
    opts.getOverrides ?? ((): Record<string, string> | undefined => useApp.getState().settings?.keybindings);
  const getActive = opts.getActive ?? ((): Iterable<string> => handlers.keys());

  const onKey = (ev: Event): void => {
    const e = ev as unknown as KeyEventLike;
    const cmd = matchCommand(
      e,
      candidateBindings(dispatchOrder(getActive()), getOverrides()),
      opts.mac,
    );
    if (!cmd) return; // ★ 未命中：不 preventDefault、不回调
    const h = handlers.get(cmd);
    if (!h) return; // 只为 getActive 传了别的集合时才可能走到；注册表里没有就不动
    ev.preventDefault();
    h(e);
  };

  // ⚠️ 这里**不用捕获阶段**：项目契约中的监听挂在 `document` 上、默认冒泡阶段；
  //    用捕获会把 `ContextMenu` / `KeysSection`（这两处用捕获）的 Esc 处理抢在前面，
  //    于是"打开右键菜单时按 Esc"这类行为会变。保持默认阶段 = 与原来一致。
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
