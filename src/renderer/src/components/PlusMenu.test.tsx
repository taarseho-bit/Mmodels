// ⚠️ 证伪边界（看这行就够了）：本文件**无法**验证真实渲染/真实点击/弹层定位与高度是否生效；交互与观感层面的验证依赖实机 e2e（node 环境无 jsdom，已在下面 ①/②/③ 逐层写明"能证明什么、不能证明什么"）。
/**
 * 输入区「＋」菜单（`PlusMenu.tsx`）—— 三层测试，逐层说清**能证明什么 / 不能证明什么**。
 *
 * ## 本仓的测试环境（决定了下面只能这么写）
 *
 * `vitest.config.ts:28` 是 `environment: 'node'`，`node_modules` 里**没有**
 * jsdom / happy-dom / linkedom / @testing-library/react（已逐个核实；
 * 全仓一共 38 个包）。补一个要动 `package.json`，超出本轮边界。
 * 所以这里**没有"渲染出 DOM 再点一下"**这种测试，一层都没有。
 *
 * ## 三层分别在测什么
 *
 * **① 元素树层（真调用处理器）** —— `PlusMenu(props)` 直接当纯函数调用，拿回元素树，
 *    按 `data-plus-row` / `data-plus-sub-item` 找到真实的 `<button>`，
 *    **真调它的 `onClick`**，再断言注入的回调被调了几次、`close` 有没有被调。
 *    这一层之所以可能，是因为 `PlusMenu` **没有任何 hook**（状态全在父级）。
 *    ⚠️ 谁给它加了 `useState`，这层会立刻炸 —— 那时请换真渲染器，别把断言删掉。
 *
 * **② 真总线 / 真 store 层（最有价值的一层）** —— 把 `onOpenGallery` / `onOpenFilesPanel`
 *    这些回调**绑到真实现上**（`lib/settings-nav.ts` 的 `openRoute`、`store/app.ts`
 *    的 `setSidePanel`），然后走遍每一行、每一个子项，断言：
 *      · 真的收到了 `mm:open-route` 事件，且 `{route, section}` 与预期逐条一致；
 *      · 真的只有「打开面板 · 文件」那一行会改 `useApp` 的 `sidePanel`。
 *    这两条**不是读源码**：`window` 在这层被换成一个最小 `EventTarget`，
 *    事件是真派发、真监听的，store 也是真的那个 zustand 实例。
 *
 * **③ 静态渲染层** —— `renderToStaticMarkup(<PlusMenu …/>)` 断言**渲染结果**：
 *    文案来自词典（不是键路径、没有未插值的 `{{}}`）、`⌘U` 角标在、
 *    **没有 `data-missing-icon`**（`Icon` 缺名时会静默画空心圆，见 `Icon.tsx:36`）。
 *    渲染时所有二级菜单都是收起状态 ⇒ `SubFlyout` 返回 null、**不会碰 `createPortal`**
 *    （它在 node 里必抛 `Target container is not a DOM element`，已实测）。
 *
 * **④ 结构断言层（读源码）** —— 只钉**接线**：`Composer.tsx` 里「＋」按钮的 `onClick`
 *    是开弹层而不是 `setSidePanel('files')`；`Popover.tsx` 的"点外部"处理器只关不发。
 *    和 `ChatPage.restore.test.ts` 同一个做法，另配**永久反向对照**：
 *    同一套检查器跑"故意改坏"的源码，必须被抓出来（只断言真源码通过 = 橡皮图章）。
 *
 * ## 这个文件**不能**证明什么（别高估）
 *
 * · 不能证明弹层**画在了正确的位置**（`Popover` 的 portal + fixed 定位没被测）；
 * · 不能证明鼠标真的能点中（命中区、z-index、被父级 `overflow:hidden` 裁掉都测不到）；
 * · **弹层高度那条通道只做到结构断言**：能证明「Composer 给这个 Popover 传了 448」
 *   与「`Popover` 真的把 `maxHeight` 接到了内联样式/上限计算上」，**不能**证明
 *   这 11 行真的不用滚（那要量真实 `scrollHeight`，node 里没有布局引擎）。
 * · 两个展示行（`research` / `webSearch`）只证明了「`disabled` 在元素树上为真 +
 *   直接调 `onClick` 什么都不发生」；**不能**证明置灰/不响应悬停的 CSS 真的生效。
 * · **判据④「点输入框关弹层且不误发送」只是结构断言**：真正的 `mousedown` → `onClose`
 *   这条链路要真 DOM 才能跑。结构层能证明的是"处理器体里只有 `onClose()`、
 *   没有任何发送类调用"，不能证明"事件确实送到了这个处理器"。
 * · `⌘U`（`composer.attach`）只证明了"命令注册的那一行在"，没证明按下去真能弹对话框。
 * 这些都要靠实机 e2e / 人工点击，本文件替代不了。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLUS_ICON,
  PLUS_GALLERY_LIMIT,
  PLUS_LIST_LIMIT,
  PLUS_POPOVER_MAX_HEIGHT,
  PLUS_STATIC_SWITCH_DEFAULT,
  PlusMenu,
  activatePlusRow,
  activatePlusSubItem,
  buildPlusRows,
  buildPlusSubItems,
  type PlusMenuDeps,
  type PlusMenuProps,
  type PlusSubmenuId,
} from './PlusMenu';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { onOpenRoute, openRoute, type OpenRouteDetail } from '../lib/settings-nav';
import { tx } from '../i18n';

// ── 环境准备 ────────────────────────────────────────────────────
//
// `lib/settings-nav.ts` 的跳转总线是 `window.dispatchEvent(new CustomEvent(...))`。
// node 里没有 window，所以换成一个最小的 EventTarget —— **只**给总线用，
// 不假装是 DOM（所以 Popover 那种要真 DOM 的组件依然测不了）。
//
// ⚠️ 必须在 import 之后才能设：`store/app.ts` 模块尾部有一句
//    `if (typeof window !== 'undefined') { document.documentElement… }`，
//    此时 window 还不存在 → 那段被跳过（这是它自己的守卫，不是我们绕过去的）。
//    如果哪天 store 把它改成不判 window，本文件会立刻在 import 阶段炸 —— 那是好事。
const bus = new EventTarget();
(globalThis as unknown as { window: EventTarget }).window = bus;

const noop = (): void => {};

// ── 测试数据 ────────────────────────────────────────────────────

function makeDeps(over: Partial<PlusMenuDeps> = {}): PlusMenuDeps {
  return {
    projects: [
      { id: 'p1', name: '甲项目', root: 'C:/p1', createdAt: 1, updatedAt: 2, lastOpenedAt: 3 },
      { id: 'p2', name: '乙项目', root: 'C:/p2', createdAt: 1, updatedAt: 2, lastOpenedAt: 1 },
    ],
    skills: [
      { dirName: 'mma-paper', name: 'mma-paper' },
      { dirName: 'data-search', name: 'data-search' },
    ],
    datasets: [
      { relPath: 'data/a.csv', name: 'a.csv' },
      { relPath: 'data/b.tsv', name: 'b.tsv' },
      { relPath: 'data/c.xlsx', name: 'c.xlsx' },
      // 第 4 个：用来证明列表真的**截到 3 条**（原版也只有 3 条）
      { relPath: 'data/d.csv', name: 'd.csv' },
    ],
    connectors: ['arXiv', 'Zotero'],
    onAddFiles: vi.fn(),
    onOpenFilesPanel: vi.fn(),
    onInsertSkill: vi.fn(),
    onInsertPrompt: vi.fn(),
    onInsertDataset: vi.fn(),
    onManageDatasets: vi.fn(),
    onOpenGallery: vi.fn(),
    onManage: vi.fn(),
    ...over,
  };
}

/** 与 `Composer.tsx` 里**同一条接线**的 deps：跳页走真总线、开面板走真 store */
function realDeps(): { deps: PlusMenuDeps; events: OpenRouteDetail[]; off: () => void } {
  const events: OpenRouteDetail[] = [];
  const off = onOpenRoute((d) => events.push(d));
  const deps = makeDeps({
    onOpenFilesPanel: () => useApp.getState().setSidePanel('files'),
    onManageDatasets: () => openRoute('datasets'),
    onOpenGallery: () => openRoute('gallery'),
    onManage: (section) => openRoute('extensions', undefined, section),
  });
  return { deps, events, off };
}

const ALL_SUBS: PlusSubmenuId[] = [
  'project',
  'datasets',
  'gallery',
  'skills',
  'algorithms',
  'connectors',
  'plugins',
];

// ── 元素树工具（拿不到 DOM，就在元素树上走）────────────────────

function props(over: Partial<PlusMenuProps> = {}): PlusMenuProps {
  return {
    ...makeDeps(),
    subOpen: null,
    onSubEnter: noop,
    onSubLeave: noop,
    onSubToggle: noop,
    onClose: noop,
    ...over,
  };
}

/** 深度优先收集所有元素 */
function collect(node: unknown, out: ReactElement<Record<string, unknown>>[] = []): typeof out {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return out;
  }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.props) {
    out.push(el);
    collect(el.props.children, out);
  }
  return out;
}

/** 按 `data-*` 找元素（找不到返回 undefined，由调用方断言） */
function findEl(
  node: unknown,
  attr: string,
  value: string,
): ReactElement<Record<string, unknown>> | undefined {
  return collect(node).find((el) => el.props[attr] === value);
}

/** 取一行并**真点它**（没有 DOM，就直接调它的 onClick —— 与 PastedTextChip 测试同一手法） */
function click(tree: unknown, attr: string, value: string): ReactElement<Record<string, unknown>> {
  const el = findEl(tree, attr, value);
  if (!el) throw new Error(`元素树里没有 ${attr}="${value}"`);
  (el.props.onClick as () => void)();
  return el;
}

// ── 源码工具（结构断言层）──────────────────────────────────────

const RAW = {
  composer: readFileSync(fileURLToPath(new URL('./Composer.tsx', import.meta.url)), 'utf8'),
  popover: readFileSync(fileURLToPath(new URL('./Popover.tsx', import.meta.url)), 'utf8'),
  plus: readFileSync(fileURLToPath(new URL('./PlusMenu.tsx', import.meta.url)), 'utf8'),
  css: readFileSync(fileURLToPath(new URL('../styles/pages.css', import.meta.url)), 'utf8'),
};

/** 去掉注释：注释里出现 `setSidePanel` 之类的"说明性文字"不算接线（同 ChatPage.restore.test） */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** 取锚点所在的**那一个 JSX 开始标签**（从 `<` 到配平的 `>`） */
function jsxOpenTag(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`锚点没找到：${anchor}`);
  const start = src.lastIndexOf('<', at);
  let depth = 0;
  let quote = '';
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = '';
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('JSX 开始标签没有配平的 >');
}

/** 取某个 `const x = … => {` 的函数体（从第一个 `{` 到配平的 `}`） */
function arrowBody(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`锚点没找到：${anchor}`);
  const open = src.indexOf('{', at);
  if (open < 0) throw new Error(`锚点后面没有函数体：${anchor}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('函数体没有配平');
}

/**
 * 从 `renderToStaticMarkup` 出来的标记里切出**某一行**那个 `<button>` 块。
 * 用来做"✓ 没串到别的行上""那一行的文案就是它自己"这类断言。
 * ⚠️ 找不到就**抛错**（不返回空串）—— 否则"没找到"会静默变成恒过。
 */
function jsxOf(markup: string, rowId: string): string {
  const at = markup.indexOf(`data-plus-row="${rowId}"`);
  if (at < 0) throw new Error(`标记里没有 data-plus-row="${rowId}"`);
  const open = markup.lastIndexOf('<button', at);
  const close = markup.indexOf('</button>', at);
  if (open < 0 || close < 0) throw new Error(`data-plus-row="${rowId}" 的 button 没有配平`);
  return markup.slice(open, close);
}

/** 检查结果：null = 通过，字符串 = **为什么不合格**（反向对照要能看到原因） */
type CheckResult = string | null;
/**
 * 判据①的**接线**部分：「＋」按钮点下去必须是"开/关弹层"，且**不许**直接推右栏。
 *
 * 为什么这条不能靠行为测：那个 `onClick` 长在 `Composer.tsx` 的渲染里，
 * 而 `Composer` 有十几个 hook ⇒ node 环境里根本调不动它。
 */
function checkPlusButton(src: string): CheckResult {
  const tag = jsxOpenTag(stripComments(src), 'id="tour-plus"');
  if (!/onClick=\{\(\)\s*=>\s*setOpenMenu\(openMenu === 'plus'/.test(tag)) {
    return '「＋」按钮的 onClick 不是"开/关弹层"';
  }
  if (/setSidePanel/.test(tag)) {
    return '「＋」按钮又直接去动右栏了（= 改动前的旧行为，弹层永远出不来）';
  }
  return null;
}

/**
 * 风险段那一条：「点 ＋ 一键打开文件面板」这条**改动前就存在**的路径必须还在。
 *
 * 复刻改之前它是**唯一**能一键到文件面板的路径（顶栏「打开面板」是另一条，
 * 但那是"显隐切换"、不保证停在文件 tab），所以"改成弹层"必须**加一行**、不能替换。
 */
function checkFilesPanelPath(srcComposer: string, srcPlus: string): CheckResult {
  const c = stripComments(srcComposer);
  if (!/onOpenFilesPanel=\{\(\)\s*=>\s*setSidePanel\('files'\)\}/.test(c)) {
    return 'Composer 里已经没有通往右栏「文件」面板的接线了';
  }
  const p = stripComments(srcPlus);
  if (!/id:\s*'openFilesPanel'/.test(p)) return 'PlusMenu 里没有「打开面板 · 文件」那一行';
  if (!/run:\s*deps\.onOpenFilesPanel/.test(p)) return '那一行没有接到 onOpenFilesPanel';
  return null;
}

/**
 * 判据④的结构部分：`Popover` 的"点外部"处理器**只许关，不许发**。
 *
 * ⚠️ 这是全仓 5 个弹层（项目 / 模式 / 模板 / 权限 / 模型 / ＋）共用的那个处理器，
 *    在里面加任何发送动作都会**同时**改掉另外 5 个菜单的行为。
 */
function checkOutsideClickOnlyCloses(src: string): CheckResult {
  const s = stripComments(src);
  if (!s.includes("document.addEventListener('mousedown', onDoc)")) {
    return '「点外部关闭」没有挂 mousedown（那点输入框就关不掉弹层）';
  }
  const body = arrowBody(s, 'const onDoc =');
  if (!body.includes('onClose()')) return 'onDoc 里没有 onClose()';
  const banned = ['onSend', 'doSend', 'sendMessage', 'submitMessage', 'onSubmit', 'onKeyDown'];
  const hit = banned.find((b) => body.includes(b));
  if (hit) return `onDoc 里出现了 ${hit} —— 点一下输入框就会顺手发送/触发发送`;
  return null;
}

/** 「＋」菜单自己**不可能**发消息：它的依赖里根本没有发送类入口 */
function checkPlusMenuCannotSend(src: string): CheckResult {
  const s = stripComments(src);
  const banned = ['onSend', 'doSend', 'sendMessage', 'submitMessage', 'onSubmit'];
  const hit = banned.find((b) => s.includes(b));
  return hit ? `PlusMenu 里出现了 ${hit} —— 菜单不应该有发送入口` : null;
}

/** 判据①/CVR：`⌘U` 那条命令必须真登记（不是只有角标好看） */
function checkAttachRegistered(src: string): CheckResult {
  const s = stripComments(src);
  if (!s.includes("registerCommand('composer.attach'")) {
    return "Composer 里没有 registerCommand('composer.attach') —— ⌘U 按下没反应";
  }
  return null;
}

/**
 * 判据①的更紧一层：**整个输入区里只有一处**能动右栏，且它是弹层里那一行。
 *
 * 为什么值得单独钉：层③那批行为断言测的是"菜单"，测不到"按钮" ——
 * 如果后来有人往输入区里加第二个"顺手推右栏"的动作（比如某个 chip 点了就开面板），
 * 层③照样全绿，而用户的右栏会莫名其妙地跳。这条是那个口的闸。
 */
function checkOnlyOneFilesPanelBinding(src: string): CheckResult {
  const s = stripComments(src);
  const hits = [...s.matchAll(/setSidePanel\(/g)].length;
  if (hits !== 1) {
    return `Composer 里 setSidePanel( 出现了 ${hits} 次 —— 只允许「打开面板 · 文件」那一处`;
  }
  if (!/onOpenFilesPanel=\{\(\)\s*=>\s*setSidePanel\('files'\)\}/.test(s)) {
    return '那一处不是「打开面板 · 文件」绑的（那是谁在动右栏？）';
  }
  return null;
}

/** 改一处源码；改不动就直接抛 —— 否则"反向对照"会变成真空断言 */
function mutate(src: string, from: string, to: string): string {
  if (!src.includes(from)) throw new Error(`变异失败（待改的片段不在源码里）：${from}`);
  return src.replace(from, to);
}

/**
 * 裁决二的结构侧闸门：`research` / `webSearch` **不许**再变回"能拨的开关"。
 *
 * 为什么单独一条：这两行的语义在**原版里就不存在**（取证贴在 `PlusMenu.tsx` 文件头），
 * 只靠 `static: true` 一个字段容易被后人顺手删掉 —— 删掉之后所有元素树断言仍会
 * "因为行还在"而通过，用户却能拨一个什么都不干的开关。
 */
function checkNoFakeSwitch(srcPlus: string, srcComposer: string): CheckResult {
  const p = stripComments(srcPlus);
  const banned = ['onToggleResearch', 'onToggleWebSearch', 'deps.research', 'deps.webSearch'];
  const hit = banned.find((b) => p.includes(b));
  if (hit) return `PlusMenu 里又出现了 ${hit} —— 那两行被改回能拨的开关了（语义无证据）`;
  const n = [...p.matchAll(/\bstatic:\s*true\b/g)].length;
  if (n !== 2) return `\`static: true\` 出现了 ${n} 次 —— 应当恰好是 research / webSearch 两行`;
  const c = stripComments(srcComposer);
  const st = ['plusResearch', 'plusWebSearch', 'setPlusResearch', 'setPlusWebSearch'].find((b) =>
    c.includes(b),
  );
  if (st) return `Composer 里还留着 ${st} 的 state —— 展示项不该有状态`;
  return null;
}

/**
 * 裁决三的结构侧闸门：高度那条**专用通道**，以及"不动 `.cz-pop` 全局值"。
 *
 * ⚠️ 能证明的只是"接线在"：Composer 传了 448、`Popover` 把它接进上限计算与内联样式、
 *    设计系统那个 320 没被动。**不能**证明这 11 行真的不用滚（要真布局引擎）。
 */
function checkPlusPopoverHeight(
  srcComposer: string,
  srcPopover: string,
  srcCss: string,
): CheckResult {
  if (!stripComments(srcComposer).includes('maxHeight={PLUS_POPOVER_MAX_HEIGHT}')) {
    return '「＋」的 Popover 没有传 maxHeight —— 11 行又会被 320px 夹住滚起来';
  }
  const p = stripComments(srcPopover);
  if (!/\bmaxHeight\s*=\s*320\b/.test(p)) {
    return 'Popover 的 maxHeight 默认值不是 320 —— 那会连带改掉另外 5 个选择器的高度';
  }
  if (!p.includes('Math.min(maxHeight, avail)')) {
    return 'Popover 没有把 maxHeight 接进"可用空间"上限计算（原版是 min(可用高度, 28rem)）';
  }
  if (!/maxHeight:\s*pos \? pos\.maxH : maxHeight/.test(p)) {
    return 'Popover 没有把 maxHeight 接进内联样式（那参数就是死的）';
  }
  if (!/\.cz-pop\s*\{[^}]*max-height:\s*320px/.test(srcCss)) {
    return '设计系统的 .cz-pop 全局高度被改了 —— 那是另外 5 个菜单共用值';
  }
  return null;
}
const PLUS_LEAVES = [
  'addFiles',
  'addToProject',
  'algorithms',
  'browseSkills',
  'connectors',
  'datasets',
  'gallery',
  'manageAlgorithms',
  'manageConnectors',
  'manageDatasets',
  'managePlugins',
  'manageSkills',
  'noProjects',
  'noSkillsEnabled',
  'openGallery',
  'plugins',
  'research',
  'skills',
  'triggerTooltip',
  'webSearch',
] as const;

/** 行 id → i18n 叶子名（`openFilesPanel` 不在这个命名空间里，单独查） */
const ROW_LEAF: Record<string, string> = {
  addFiles: 'addFiles',
  addToProject: 'addToProject',
  datasets: 'datasets',
  gallery: 'gallery',
  skills: 'skills',
  algorithms: 'algorithms',
  connectors: 'connectors',
  plugins: 'plugins',
  research: 'research',
  webSearch: 'webSearch',
};

beforeEach(() => {
  useApp.setState({ sidePanel: null });
});

// ═══════════════════════════════════════════════════════════════
// ① 行表 / 文案
// ═══════════════════════════════════════════════════════════════

describe('① 行表与文案（文案本身就是规格，不许自己编）', () => {
  it('命名空间里 20 个键一个都没拼错，`triggerTooltip` 也在', () => {
    for (const leaf of PLUS_LEAVES) {
      const key = `composer.composerPlusMenu.${leaf}`;
      const v = tx(key);
      // `tx` 取不到键时**原样返回键路径** —— 所以这条就是在断言"键真的存在"
      expect(v, `${leaf} 取不到文案`).not.toBe(key);
      expect(v.length, leaf).toBeGreaterThan(0);
    }
  });

  it('★ 判据②：9 个入口齐全（原版实为 10 行 —— research / webSearch 是两条并列开关行）', () => {
    const rows = buildPlusRows(makeDeps());
    // 顺序 = 原版渲染顺序；`openFilesPanel` 是复刻新增的（见 PlusMenu.tsx 文件头）
    expect(rows.map((r) => r.id)).toEqual([
      'addFiles',
      'addToProject',
      'datasets',
      'gallery',
      'skills',
      'algorithms',
      'connectors',
      'plugins',
      'research',
      'webSearch',
      'openFilesPanel',
    ]);
    // BACKLOG §3-2 那句枚举里的 9 个入口逐个点名 —— 口径换成"9 项都在"，
    // 而不是"总行数 = 9"，因为原版真的是 10 行（`research` / `webSearch` 各占一行）
    const spec9 = [
      'addFiles',
      'addToProject',
      'datasets',
      'skills',
      'algorithms',
      'connectors',
      'plugins',
      'research',
      'gallery',
    ];
    for (const id of spec9) {
      expect(rows.map((r) => r.id), `少了 ${id}`).toContain(id);
    }
    // 有二级菜单的那 5 行（原版是 Radix Sub）必须真的带 submenu
    expect(rows.filter((r) => r.submenu).map((r) => r.id)).toEqual([
      'addToProject',
      'datasets',
      'gallery',
      'skills',
      'algorithms',
      'connectors',
      'plugins',
    ]);
  });

  it('★ 判据②：addFiles 行带 ⌘U 角标，且**只有**它有角标', () => {
    const rows = buildPlusRows(makeDeps());
    expect(rows.find((r) => r.id === 'addFiles')?.badge).toBe('⌘U');
    expect(rows.filter((r) => r.badge).map((r) => r.id)).toEqual(['addFiles']);
  });

  it('★ 每一行的文案都**逐字**来自词典（不是硬编码中文）', () => {
    const rows = buildPlusRows(makeDeps());
    for (const row of rows) {
      if (row.id === 'openFilesPanel') {
        // 复刻新增那一行：两个**既有**键拼起来，没有新造文案
        expect(row.label).toBe(
          `${tx('chat.chatPage.openPanel')} · ${tx('dock.rightPanel.files')}`,
        );
        continue;
      }
      const leaf = ROW_LEAF[row.id];
      expect(row.label, row.id).toBe(tx(`composer.composerPlusMenu.${leaf}`));
    }
  });

  it('★ 裁决二：`research` / `webSearch` 是**不可交互的展示项**，不是能拨的开关', () => {
    const rows = buildPlusRows(makeDeps());
    const research = rows.find((r) => r.id === 'research');
    const webSearch = rows.find((r) => r.id === 'webSearch');

    // ① 这两行必须被标成静态展示项 —— 没有这条，它们就还是"看着能拨"的假开关
    expect(research?.static, 'research 不是展示项（被改回能拨的开关了？）').toBe(true);
    expect(webSearch?.static, 'webSearch 不是展示项').toBe(true);
    // ② 数据层不许再挂状态回调：整个行表里只有这两行是 static，其余都是真动作
    expect(rows.filter((r) => r.static).map((r) => r.id)).toEqual(['research', 'webSearch']);
    // ③ 勾选态是**原版默认态**的镜像（`useState(!1)` / `useState(!0)`），与入参无关
    expect(research?.checked).toBe(false);
    expect(webSearch?.checked).toBe(true);
    expect(PLUS_STATIC_SWITCH_DEFAULT).toEqual({ research: false, webSearch: true });
  });

  it('★ 裁决二（元素树）：这两行带 `disabled`，而且直接调 onClick 也**什么都不发生**', () => {
    const onClose = vi.fn();
    const onSubToggle = vi.fn();
    const tree = PlusMenu(props({ onClose, onSubToggle }));

    for (const id of ['research', 'webSearch'] as const) {
      const el = findEl(tree, 'data-plus-row', id);
      // `disabled` 是真的落在元素树上（不是只在数据里标记一下）
      expect(el?.props.disabled, `${id} 没有 disabled`).toBe(true);
      // 绕过 disabled 直接调 onClick：不许关弹层、不许展开子菜单
      click(tree, 'data-plus-row', id);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubToggle).not.toHaveBeenCalled();
    // 纯函数那层也钉一遍（渲染层之外的第二个入口）
    for (const row of buildPlusRows(makeDeps()).filter((r) => r.static)) {
      activatePlusRow(row, { onClose, onSub: onSubToggle });
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(onSubToggle).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// ② 元素树层：真调 `onClick`
// ═══════════════════════════════════════════════════════════════

describe('② 元素树：真的点到那些按钮上', () => {
  it('点「添加文件或照片」→ 弹文件对话框的那个回调被调 1 次，并且弹层关掉', () => {
    const d = makeDeps();
    const onClose = vi.fn();
    const tree = PlusMenu(props({ ...d, onClose }));
    click(tree, 'data-plus-row', 'addFiles');
    expect(d.onAddFiles).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('★ 点展示行（research / webSearch）= 没反应：不关弹层、不跑任何动作', () => {
    const d = makeDeps();
    const onClose = vi.fn();
    const before = JSON.stringify(d);
    const tree = PlusMenu(props({ ...d, onClose }));
    click(tree, 'data-plus-row', 'research');
    click(tree, 'data-plus-row', 'webSearch');
    // 关了就没法连着看两行 —— 这条同时是"它们不再是开关"的旁证
    expect(onClose).not.toHaveBeenCalled();
    expect(JSON.stringify(d)).toBe(before);
  });

  it('点子菜单父行 → 只展开二级（调 onSubToggle），**不关**弹层、也不跑任何动作', () => {
    const d = makeDeps();
    const onClose = vi.fn();
    const onSubToggle = vi.fn();
    const tree = PlusMenu(props({ ...d, onClose, onSubToggle }));
    for (const id of ['addToProject', 'datasets', 'gallery', 'skills', 'algorithms', 'connectors', 'plugins']) {
      const row = click(tree, 'data-plus-row', id);
      expect(row.props.className, id).toContain('cz-pop-item');
    }
    expect(onSubToggle).toHaveBeenCalledTimes(7);
    expect(onClose).not.toHaveBeenCalled();
    // 父行自己没有副作用：7 次点击不许触发任何一个动作回调
    expect(d.onInsertSkill).not.toHaveBeenCalled();
    expect(d.onInsertPrompt).not.toHaveBeenCalled();
    expect(d.onAddFiles).not.toHaveBeenCalled();
  });

  it('★ 判据③（元素树）：点「打开图库」→ 回调跑一次 + 弹层关闭', () => {
    const d = makeDeps();
    const onClose = vi.fn();
    const tree = PlusMenu(props({ ...d, subOpen: 'gallery', onClose }));
    click(tree, 'data-plus-sub-item', 'openGallery');
    expect(d.onOpenGallery).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('图库子菜单：前 5 个模板 + 「打开图库」，点模板会把**模板提示词**交给输入框', () => {
    const d = makeDeps();
    const items = buildPlusSubItems('gallery', d);
    expect(items).toHaveLength(PLUS_GALLERY_LIMIT + 1);
    const first = items[0];
    activatePlusSubItem(first, { onClose: noop });
    expect(d.onInsertPrompt).toHaveBeenCalledTimes(1);
    const prompt = (d.onInsertPrompt as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // 真提示词（`templatePrompt` 的产品），不是标题糊一个
    expect(prompt.length).toBeGreaterThan(20);
    expect(prompt).not.toBe(first.label);
  });

  it('数据集子菜单：只列 3 条（多的截掉），点一条插入 `@相对路径`', () => {
    const d = makeDeps();
    const items = buildPlusSubItems('datasets', d);
    const named = items.filter((i) => i.id.startsWith('data/'));
    expect(named.map((i) => i.id)).toEqual(['data/a.csv', 'data/b.tsv', 'data/c.xlsx']);
    expect(named).toHaveLength(PLUS_LIST_LIMIT);
    activatePlusSubItem(named[0], { onClose: noop });
    // 与本仓 DatabasePage.tsx:143 同一个语义（那边就是 `fillPrompt('@'+relPath)`）
    expect(d.onInsertDataset).toHaveBeenCalledWith('data/a.csv');
  });

  it('技能子菜单：列出已启用技能 + 管理/浏览两行，点技能插入 `/{命令名}`', () => {
    const d = makeDeps();
    const items = buildPlusSubItems('skills', d);
    expect(items.map((i) => i.id)).toEqual([
      'mma-paper',
      'data-search',
      'manageSkills',
      'browseSkills',
    ]);
    activatePlusSubItem(items[0], { onClose: noop });
    expect(d.onInsertSkill).toHaveBeenCalledWith('mma-paper');
  });

  it('空态：没有项目 / 没有已启用技能时给的是**禁用**行，且点了什么都不发生', () => {
    const d = makeDeps({ projects: [], skills: [] });
    const noProjects = buildPlusSubItems('project', d);
    expect(noProjects.map((i) => i.id)).toEqual(['noProjects']);
    expect(noProjects[0].disabled).toBe(true);
    expect(noProjects[0].label).toBe(tx('composer.composerPlusMenu.noProjects'));

    const noSkills = buildPlusSubItems('skills', d);
    expect(noSkills[0].id).toBe('noSkillsEnabled');
    expect(noSkills[0].disabled).toBe(true);
    expect(noSkills[0].label).toBe(tx('composer.composerPlusMenu.noSkillsEnabled'));

    // 禁用行：点它**不许**关弹层（原版 Radix 的 disabled item 不触发 onSelect）
    const onClose = vi.fn();
    activatePlusSubItem(noProjects[0], { onClose });
    expect(onClose).not.toHaveBeenCalled();
    // 渲染层也要真的带上 disabled（不然看着是禁用的、其实点得动）
    const tree = PlusMenu(props({ ...d, subOpen: 'project' }));
    expect(findEl(tree, 'data-plus-sub-item', 'noProjects')?.props.disabled).toBe(true);
  });

  it('原版那三类"纯展示"条目不自作主张加动作（项目名 / 连接器名点了不做事）', () => {
    const d = makeDeps();
    const before = JSON.stringify(d);
    for (const sub of ['project', 'connectors'] as PlusSubmenuId[]) {
      for (const item of buildPlusSubItems(sub, d)) {
        // 展示项与"管理"项混在一起，这里只挑展示项（id 是业务键，不是 manageXxx）
        if (item.id.startsWith('manage')) continue;
        activatePlusSubItem(item, { onClose: noop });
      }
    }
    expect(JSON.stringify(d)).toBe(before);
  });
});

// ═══════════════════════════════════════════════════════════════
// ③ 真总线 / 真 store：走遍每一行每一子项
// ═══════════════════════════════════════════════════════════════

describe('③ 真总线 + 真 store（不是读源码）', () => {
  it('★ 判据①：走遍弹层里每一行每一个子项 —— 只有「打开面板 · 文件」会动右栏', () => {
    const { deps, off } = realDeps();
    const moved: string[] = [];
    const visit = (key: string, run: () => void): void => {
      useApp.setState({ sidePanel: null });
      run();
      if (useApp.getState().sidePanel !== null) moved.push(key);
    };

    for (const row of buildPlusRows(deps)) {
      visit(row.id, () => activatePlusRow(row, { onClose: noop, onSub: noop }));
      if (row.submenu) {
        for (const item of buildPlusSubItems(row.submenu, deps)) {
          visit(`${row.id}/${item.id}`, () => activatePlusSubItem(item, { onClose: noop }));
        }
      }
    }
    off();

    // 顺序无关：把意外项与缺失项都点出来，比"数组相等"更好读
    expect(moved).toEqual(['openFilesPanel']);
    // 而且它真的是"打开文件面板"（不是把右栏改成别的 tab）
    expect(useApp.getState().sidePanel).toBe('files');
  });

  it('★ 改动前那条路径没丢：`setSidePanel(\'files\')` 仍然可达（反向对照见④）', () => {
    const { deps, off } = realDeps();
    const row = buildPlusRows(deps).find((r) => r.id === 'openFilesPanel');
    expect(row, '「打开面板 · 文件」那一行不见了').toBeTruthy();
    expect(row?.label).toContain(tx('dock.rightPanel.files'));
    activatePlusRow(row!, { onClose: noop, onSub: noop });
    off();
    expect(useApp.getState().sidePanel).toBe('files');
  });

  it('★ 走遍所有子项：只有 6 个"管理/打开"项会派发跳页，且 route/section 逐条正确', () => {
    const { deps, events, off } = realDeps();
    for (const sub of ALL_SUBS) {
      for (const item of buildPlusSubItems(sub, deps)) {
        activatePlusSubItem(item, { onClose: noop });
      }
    }
    off();
    // 顺序 = ALL_SUBS 的顺序（datasets 在 gallery 前面，与原版行序一致）。
    // ⚠️ `extensions/skills` 出现**两次**：`manageSkills` 与 `browseSkills` 是两行，
    //    原版里它们都跳 `k("skills")`（同一分区，不因为文案不同就编一个假分区）。
    expect(events.map((e) => [e.route, e.section ?? null])).toEqual([
      ['datasets', null],
      ['gallery', null],
      ['extensions', 'skills'],
      ['extensions', 'skills'],
      ['extensions', 'algorithms'],
      ['extensions', 'connectors'],
      ['extensions', 'plugins'],
    ]);
  });

  it('反向对照：跳页项**同时**把弹层关掉（只跳不关会让弹层悬在新页面上）', () => {
    const { deps, off } = realDeps();
    const onClose = vi.fn();
    activatePlusSubItem(
      buildPlusSubItems('gallery', deps).find((i) => i.id === 'openGallery')!,
      { onClose },
    );
    off();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// ④ 静态渲染层
// ═══════════════════════════════════════════════════════════════

describe('④ 静态渲染（文案 / 图标 / 角标真的进了标记）', () => {
  /**
   * 静态渲染时 React 会对 `<SubFlyout>` 里的 `useLayoutEffect` 发一条
   * "does nothing on the server" 警告 —— 这里没有 SSR、也没有 hydration，
   * 那条警告对本仓**没有意义**（`renderToStaticMarkup` 只是 node 环境下的取证手段）。
   * 它一共刷 7 条，把真失败的输出淹了，所以这一段里临时按住，出栈时恢复。
   */
  const realError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]): void => {
      if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
      realError(...(args as []));
    };
  });
  afterAll(() => {
    console.error = realError;
  });

  /**
   * ⚠️ 懒渲染（`html()` 而不是 `const html = …`）：必须在 `beforeAll` **之后**才算，
   *    否则 React 的警告会在用例收集阶段就喷出来（那时 console.error 还没被按住）。
   */
  let htmlCache = '';
  const html = (): string => (htmlCache ||= renderToStaticMarkup(PlusMenu(props())));

  it('10 行 + 复刻新增那行的文案都在标记里', () => {
    for (const leaf of [
      'addFiles',
      'addToProject',
      'datasets',
      'gallery',
      'skills',
      'algorithms',
      'connectors',
      'plugins',
      'research',
      'webSearch',
    ]) {
      expect(html(), leaf).toContain(tx(`composer.composerPlusMenu.${leaf}`));
    }
    expect(html()).toContain(`${tx('chat.chatPage.openPanel')} · ${tx('dock.rightPanel.files')}`);
  });

  it('★ ⌘U 角标真的渲染在「添加文件或照片」那一行里', () => {
    const tree = PlusMenu(props());
    const row = findEl(tree, 'data-plus-row', 'addFiles');
    expect(row).toBeTruthy();
    const texts = collect(row).flatMap((el) =>
      typeof el.props.children === 'string' ? [el.props.children] : [],
    );
    expect(texts).toContain('⌘U');
    expect(html()).toContain('⌘U');
    // 别的行没有：整份标记里只该出现一次
    expect(html().split('⌘U').length - 1).toBe(1);
  });

  it('★ 一个图标名都没写错（`Icon` 缺名时会静默画空心圆，所以必须断言没走到兜底）', () => {
    expect(html()).not.toContain('data-missing-icon');
    // 正向：每个 row 的图标名都在本仓名字表里真的解析到了 path 数据
    const tree = PlusMenu(props());
    for (const row of buildPlusRows(makeDeps())) {
      const el = findEl(tree, 'data-plus-row', row.id);
      const icon = collect(el).find((e) => e.props.name === row.icon);
      expect(icon, `${row.id} 的图标 ${row.icon} 没渲染出来`).toBeTruthy();
    }
    // 顺带钉一下写死的名字：原版 chunk 里逐个读出来的那几个
    expect(PLUS_ICON.addFiles).toBe('paperclip');
    expect(PLUS_ICON.skills).toBe('sparkles');
    expect(PLUS_ICON.connectors).toBe('plug');
    expect(PLUS_ICON.plugins).toBe('blocks');
    expect(PLUS_ICON.research).toBe('telescope');
    expect(PLUS_ICON.webSearch).toBe('globe');
  });

  it('标记里不出现键路径、也不出现没插值的 `{{}}`', () => {
    expect(html()).not.toContain('composer.composerPlusMenu.');
    expect(html()).not.toContain('{{');
    expect(html()).not.toContain('[object Object]');
  });

  it('★ 子菜单条目的图标也一个都没写错（静态渲染只画了"收起"状态，子项得单独过一遍）', () => {
    const icons = new Set<string>([
      ...buildPlusRows(makeDeps()).map((r) => r.icon),
      ...ALL_SUBS.flatMap((sub) => buildPlusSubItems(sub, makeDeps()).map((i) => i.icon)),
      ...Object.values(PLUS_ICON),
      'chevron-right',
    ]);
    expect(icons.size).toBeGreaterThan(8);
    const markup = renderToStaticMarkup(
      <>
        {[...icons].map((n) => (
          <Icon name={n} key={n} />
        ))}
      </>,
    );
    expect(markup).not.toContain('data-missing-icon');
    // 反恒真：真画出了这么多 svg，不是"一个都没渲染所以都没缺"
    expect(markup.split('<svg').length - 1).toBe(icons.size);
    // 反橡皮图章：换一个不存在的名字，这个探测器必须**立刻变红**（否则上面那句是空断言）
    expect(renderToStaticMarkup(<Icon name="这个图标名不存在" />)).toContain('data-missing-icon');
  });

  it('分隔线跟着 `group` 换（原版 3 处 + 复刻新增那行前 1 处 = 4 条）', () => {
    const groups = buildPlusRows(makeDeps()).map((r) => r.group);
    const seps = groups.filter((g, i) => i > 0 && g !== groups[i - 1]).length;
    expect(seps).toBe(4);
    expect(html().split('cz-pop-sep').length - 1).toBe(4);
  });

  it('★ ✓ 只画在 `webSearch` 那一行上（原版默认开）—— 展示项的静态镜像', () => {
    const tree = PlusMenu(props());
    const checkedRows = ['research', 'webSearch'].filter((id) =>
      collect(findEl(tree, 'data-plus-row', id)).some((el) =>
        String(el.props.className ?? '').includes('cz-pop-check'),
      ),
    );
    expect(checkedRows).toEqual(['webSearch']);
    // 反恒真：整份标记里只该出现一个 cz-pop-check（不是"两个都没画所以只匹配到一个"）
    expect(html().split('cz-pop-check').length - 1).toBe(1);
    // 而且它旁边的文案真的是「网页搜索」，不是串到别的行去了
    const wsRow = jsxOf(html(), 'webSearch');
    expect(wsRow).toContain(tx('composer.composerPlusMenu.webSearch'));
    expect(wsRow).toContain('cz-pop-check');
  });
});

// ═══════════════════════════════════════════════════════════════
// ⑤ 结构断言层 + 永久反向对照（反橡皮图章）
// ═══════════════════════════════════════════════════════════════

describe('⑤ 接线结构断言：「＋」按钮 / 点外部关闭 / ⌘U', () => {
  it('★ 判据①：「＋」按钮的 onClick 是开弹层，**不是** setSidePanel', () => {
    expect(checkPlusButton(RAW.composer)).toBeNull();
    // 而且弹层真的绑在这个按钮的槽位里（不是渲染到别处去了）
    const slot = jsxOpenTag(stripComments(RAW.composer), 'id="tour-plus"');
    expect(slot).toContain("tx('composer.composerPlusMenu.triggerTooltip')");
    expect(stripComments(RAW.composer)).toContain('<PlusMenu');
    expect(stripComments(RAW.composer)).toContain('open={openMenu === \'plus\'}');
  });

  it('★ 风险段：「点 ＋ 一键打开文件面板」那条路径还在', () => {
    expect(checkFilesPanelPath(RAW.composer, RAW.plus)).toBeNull();
    // 更紧一层：整个输入区里**只有**这一处能动右栏
    expect(checkOnlyOneFilesPanelBinding(RAW.composer)).toBeNull();
  });

  it('★ 判据④：点外部关闭的处理器只关不发', () => {
    expect(checkOutsideClickOnlyCloses(RAW.popover)).toBeNull();
    expect(checkPlusMenuCannotSend(RAW.plus)).toBeNull();
  });

  it('★ ⌘U 真有登记：`composer.attach` 已接线（不再是 other-owner）', () => {
    expect(checkAttachRegistered(RAW.composer)).toBeNull();
  });

  it('★ 裁决二：两行开关没有被改回"能拨的形态"（结构侧闸门）', () => {
    expect(checkNoFakeSwitch(RAW.plus, RAW.composer)).toBeNull();
    // 反恒真：拿一份"假装这两行还能拨"的源码去跑，必须报错而不是通过
    const fake = mutate(
      RAW.plus,
      "      checked: PLUS_STATIC_SWITCH_DEFAULT.research,",
      "      checked: false,\n      run: deps.onToggleResearch,",
    );
    expect(checkNoFakeSwitch(fake, RAW.composer)).toMatch(/onToggleResearch/);
  });

  it('★ 裁决三：高度走的是「＋」菜单专用通道，设计系统的 .cz-pop 没被动', () => {
    expect(checkPlusPopoverHeight(RAW.composer, RAW.popover, RAW.css)).toBeNull();
    // 448 = 28rem —— 原版 `max-h-[var(--available-height,28rem)]` 的兜底，不是随手拍的
    expect(PLUS_POPOVER_MAX_HEIGHT).toBe(448);
    // 这条通道真的只给「＋」用：另外 5 个选择器一个都没传
    const s = stripComments(RAW.composer);
    expect(s.split('maxHeight={').length - 1).toBe(1);
    expect(s.split('PLUS_POPOVER_MAX_HEIGHT').length - 1).toBe(2); // import + 使用
  });

  /**
   * ★ 反向对照：同一套检查器跑**故意改坏**的源码，必须被抓出来。
   * 只断言"真源码通过"是橡皮图章 —— 检查器自己必须能红。
   * 其中 M1 就是本轮要求的那条反向对照（把 onClick 改回旧行为）。
   */
  it('★ 反向对照：每种"改回旧写法"都必须被检查器抓住（真跑，不是摆设）', () => {
    // M1 —— 本轮的核心反向对照：把「＋」改回"直接推右栏"
    const m1 = mutate(
      RAW.composer,
      "onClick={() => setOpenMenu(openMenu === 'plus' ? null : 'plus')}",
      "onClick={() => setSidePanel('files')}",
    );
    expect(checkPlusButton(m1)).toMatch(/又直接去动右栏|不是"开\/关弹层"/);

    // M2 —— 删掉 onClick（弹层永远出不来）
    const m2 = mutate(
      RAW.composer,
      "onClick={() => setOpenMenu(openMenu === 'plus' ? null : 'plus')}",
      '',
    );
    expect(checkPlusButton(m2)).not.toBeNull();

    // M3 —— 把「打开面板 · 文件」那一行删掉（风险段那个坑）
    const m3 = mutate(RAW.plus, "id: 'openFilesPanel',", "id: 'openFilesPanelX',");
    expect(checkFilesPanelPath(RAW.composer, m3)).not.toBeNull();

    // M4 —— 把 Composer 里通往文件面板的接线删掉
    const m4 = mutate(
      RAW.composer,
      "onOpenFilesPanel={() => setSidePanel('files')}",
      'onOpenFilesPanel={() => {}}',
    );
    expect(checkFilesPanelPath(m4, RAW.plus)).not.toBeNull();

    // M5 —— 点外部时顺手发送
    const m5 = mutate(RAW.popover, 'onClose();\n    };', 'onClose();\n      onSend();\n    };');
    expect(checkOutsideClickOnlyCloses(m5)).toMatch(/onSend/);

    // M6 —— 不再挂 mousedown（点输入框关不掉弹层）
    const m6 = mutate(RAW.popover, "document.addEventListener('mousedown', onDoc)", 'void onDoc');
    expect(checkOutsideClickOnlyCloses(m6)).toMatch(/mousedown/);

    // M7 —— 菜单里塞进发送入口
    const m7 = mutate(RAW.plus, 'onAddFiles: () => void;', 'onAddFiles: () => void;\n  onSend: () => void;');
    expect(checkPlusMenuCannotSend(m7)).toMatch(/onSend/);

    // M8 —— ⌘U 没有登记（角标好看但按下去没反应）
    const m8 = mutate(
      RAW.composer,
      "registerCommand('composer.attach', () => pickAttachments())",
      'void pickAttachments',
    );
    expect(checkAttachRegistered(m8)).not.toBeNull();

    // M9 —— 输入区里多出第二个"顺手推右栏"的动作
    const m9 = mutate(
      RAW.composer,
      "onOpenFilesPanel={() => setSidePanel('files')}",
      "onOpenFilesPanel={() => setSidePanel('files')}\n              onInsertPrompt={() => setSidePanel('terminal')}",
    );
    expect(checkOnlyOneFilesPanelBinding(m9)).toMatch(/出现了 2 次/);

    // M10 —— 把 `research` 那行改回"能拨的开关"（裁决二的核心反向对照）
    const m10 = mutate(
      RAW.plus,
      '      checked: PLUS_STATIC_SWITCH_DEFAULT.research,',
      '      checked: false,\n      run: deps.onToggleResearch,',
    );
    expect(checkNoFakeSwitch(m10, RAW.composer)).toMatch(/onToggleResearch/);

    // M10b —— 只是把 `static: true` 去掉（后人"顺手删一行"最可能的形态）
    const m10b = mutate(RAW.plus, '      static: true,\n      keepOpen: true,', '      keepOpen: true,');
    expect(checkNoFakeSwitch(m10b, RAW.composer)).toMatch(/出现了 1 次/);

    // M11 —— 把高度那条通道去掉（11 行又会被 320px 夹住）
    const m11 = mutate(
      RAW.composer,
      ' onClose={close} maxHeight={PLUS_POPOVER_MAX_HEIGHT}',
      ' onClose={close}',
    );
    expect(checkPlusPopoverHeight(m11, RAW.popover, RAW.css)).toMatch(/没有传 maxHeight/);

    // M12 —— 改设计系统那个全局值（另外 5 个菜单会被一起改掉）
    const m12 = mutate(RAW.css, '  max-height: 320px;', '  max-height: 448px;');
    expect(checkPlusPopoverHeight(RAW.composer, RAW.popover, m12)).toMatch(/全局高度被改了/);
  });

  it('检查器本身不许恒过：拿一份完全无关的源码去跑，必须报错而不是"通过"', () => {
    // 反恒真：`jsxOpenTag` 找不到锚点时**抛错**，而不是静默返回空串（那会变成恒过）
    expect(() => checkPlusButton('const a = 1;')).toThrow(/锚点没找到/);
    expect(() => checkOutsideClickOnlyCloses('const a = 1;')).not.toThrow();
    expect(checkOutsideClickOnlyCloses('const a = 1;')).not.toBeNull();
  });
});
