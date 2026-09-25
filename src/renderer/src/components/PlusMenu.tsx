/**
 * 输入区左下角「＋」的弹层菜单 —— 对齐原版 `data-tour="composer-plus"` 那个 Popover。
 *
 * ## 它修的是什么
 *
 * 改之前 `Composer.tsx` 的「＋」是 `onClick={() => setSidePanel('files')}`：
 * tooltip 文案与原版**逐字一致**（`composer.composerPlusMenu.triggerTooltip`
 * 「添加附件、技能及更多内容」），但行为完全不同 —— 原版点它弹出一个多行菜单，
 * 复刻点它直接把右栏推到「文件」面板。
 *
 * ## 原版依据（`out/renderer/assets/index-OYc102qC.js` 里那个组件）
 *
 * 根弹层 `side:"top" align:"start" min-w-60`，子元素按顺序是：
 *   `addFiles`(右侧 ⌘U) / `addToProject`▸ / 分隔 /
 *   `datasets`▸ / `gallery`▸ / 分隔 /
 *   `skills`▸ / `algorithms`▸ / `connectors`▸ / `plugins`▸ / 分隔 /
 *   `research`(开关) / `webSearch`(开关)
 * 三处分隔线对应下面的 `group` 换组；每行图标是从原版 chunk 的
 * `pt("<lucide 名>", …)` 里逐个读出来的（见 `PLUS_ICON` 的注释），不是"看着像"挑的。
 *
 * ## 弹层高度
 *
 * 原版根弹层的 class 是 `min-w-60`，而它用的那个内容组件（`Za`）自带的类是
 * `max-h-[var(--available-height,28rem)] … overflow-y-auto p-1`
 * ⇒ 高度上限 = **可用高度，兜底 28rem（448px）**，11 行（≈374px）**一屏全见、不滚**。
 * 本仓 `.cz-pop` 是 `max-height:320px`，且那个值还压在另外 5 个选择器上 ⇒ 不动它，
 * 由 `PLUS_POPOVER_MAX_HEIGHT` 走 `Popover` 的可选参数单独开一条腿。
 *
 * ⚠️ **一共 10 行，不是 BACKLOG §3-2 里写的 9 行**：`research` 与 `webSearch` 在原版里
 *    是两个**并列的开关行**（各自 `closeOnClick:!1`），不是「研究▸网页搜索」二级菜单。
 *    BACKLOG 那句枚举把它们并成「研究（网页搜索）」一项，于是数出 9 ——
 *    这里按原版落地成 10 行（两个键都用满），测试里两条口径都钉住了。
 *
 * ## ⚠️ 不要删掉末尾「打开面板 · 文件」那一行
 *
 * 原版「推到右栏」是**独立且并存**的入口（顶栏「打开面板」+ 面板内 tab）；
 * 而复刻在改之前，"点「＋」推开文件面板"是**唯一**一键到文件面板的路径。
 * 把「＋」改成弹层却不补这一行，等于把那条路径删掉 —— 用户会报
 * 「以前能点现在点不到了」（BACKLOG §3-2 的风险段）。所以最后一组补了一行，
 * 指向同一件事（`setSidePanel('files')`）。
 *
 * ## 哪些行是真动作、哪些只是展示（别把展示项当按钮）
 *
 * 原版这个菜单里 `addToProject` / `datasets` / `connectors` 三个子菜单的条目
 * **没有 `onClick`**（`q1e` / `Y1e` / `Z1e` 都只有图标 + 文字），点一下只是关掉菜单。
 * 本复刻逐条这样处理，**不替原版发明行为**：
 *   · 项目名、`noProjects`、`noSkillsEnabled`、已配连接器名 → 展示项
 *     （`noProjects`/`noSkillsEnabled` 原版就是 `disabled`，照做）
 *   · `research` / `webSearch` 两行 → 展示项（见下一节：原版自己就没有消费者）
 *   · 数据集文件名 → **接了真动作**：插入 `@{relPath}`。
 *     这条不是发明 —— 本仓 `DatabasePage.tsx:143` 点数据文件就是 `fillPrompt('@'+relPath)`，
 *     同一个数据、同一件事，菜单里没有理由不能点。
 *   · 图库前 5 个模板 → 插入模板提示词（本仓 `GalleryPage.tsx:273` / `SidePanel.tsx:62`
 *     的既有语义）
 *   · 技能 → 插入 `/{name}`：`SkillMeta.name` 就是 frontmatter 里的命令名
 *     （`resources/builtin-skills/mma-paper/SKILL.md` 的 `name: mma-paper`），
 *     而本仓"用某个技能"正是在输入框里打 `/命令`。
 *   · `manageX` / `openGallery` / `manageDatasets` → 跳页
 *     （原版 `to:"/extensions"?section=` / `/gallery` / `/database`）
 * 三条"插入"一律**替换**输入框内容，与本仓 `fillPrompt` 的既有语义一致
 * （`ChatPage.tsx:645` 就是 `setInput(pending)`）。
 *
 * ## 两个开关行：原版**自己**就是「只有状态、没有消费者」→ 复刻降级为**展示项**
 *
 * 取证出处（**可复现，逐字原文不贴进源码** —— 见 `src/main/source-comments.test.ts`
 * 那条注释纪律：贴进 `src/` 会污染 `grep -c` 的计数）：
 *
 *   `…\resources\app.asar` → `out/renderer/assets/index-OYc102qC.js`，偏移 1065843
 *   起、那个渲染「＋」菜单的组件。
 *
 * 在那个组件里读到的三件事：
 *
 *   ① 两行的开关状态是组件**自己的** `useState`（研究默认假、网页搜索默认真），
 *      两行的 `closeOnClick` 都是假 —— 与"点一下弹层不关"这条行为对得上；
 *   ② 点击处理器**只调一个纯取反的小函数**（参数进去、取反出来，无副作用），
 *      旁边没有第二个动作；
 *   ③ 这两个状态在整个组件（约 24 万字符的窗口）里**只有一处消费** ——
 *      它们自己的 ✓（两处 React Compiler 的依赖位），此外没人读。
 *
 * 也就是说 **原版把这两个开关拨了也不会改变任何东西**：没有持久化、没进任何请求体，
 * 主进程也**没有**对应字段 —— 全 asar 检索 `enableResearch` / `researchEnabled` /
 * `webSearchEnabled` / `enableWebSearch` / `researchMode` 全部 0 命中；主进程里唯一
 * 那处禁掉网页搜索工具的分支，判的是 provider 的 API 形态是不是"OpenAI 兼容的
 * chat-completions"（同一处还有个 `nativeWebSearch` 字段），**与菜单开关无关**。
 *
 * 按裁决「宁可少一个开关，也不要多一个骗人的开关」：**不发明语义、不接通**，
 * 把两行降级成**不可交互的展示项** —— `disabled` + 置灰 + 不响应悬停，保留
 * 原版默认勾选态（研究=未勾、网页搜索=勾）作为忠实镜像。将来若找到它们真正
 * 控制什么（最可能是 agent 工具集），再按证据接线；接线前**不许**把它改回能拨。
 *
 * ## 为什么这个组件**没有任何 hook**
 *
 * 本仓 vitest 是 `environment:'node'`（`vitest.config.ts:28`），`node_modules` 里
 * 没有 jsdom / happy-dom / @testing-library（已逐个核实）。为了让这个菜单**能被真断言**
 * 而不是只能读源码，这里刻意做了三件事：
 *   ① 所有状态（二级菜单展开、两个开关、数据、回调）**全部由父级传进来**；
 *   ② 组件只做「数据 → 元素树」的翻译，自己**不 portal、不订阅事件**；
 *   ③ `SubFlyout` 只在 `subOpen` 命中时渲染 → `renderToStaticMarkup(<PlusMenu …/>)`
 *      走的是"没展开"那条路，不会碰到 `createPortal`（它在 node 里必抛
 *      `Target container is not a DOM element`）。
 * 于是 `PlusMenu(props)` 可以直接当纯函数调用、能走到真实的事件处理器上。
 * ⚠️ **谁要给这个组件加 hook（`useState` 等），请连带改 `PlusMenu.test.tsx` 的
 *    「① 元素树」那一层** —— 那里写明了"加了 hook 这层就废了"。
 */
import { Fragment } from 'react';
import type { ProjectMeta } from '@shared/types';
import { GALLERY, templatePrompt } from '@shared/gallery-data';
import { Icon } from './Icon';
import { SubFlyout } from './Popover';
import { tx } from '../i18n';
import { skillDisplayName } from '../lib/skill-display';

/**
 * 取 `composer.composerPlusMenu.<leaf>` 的文案。
 *
 * ⚠️ 不要改成"拼字符串"或"自己写中文"：这个命名空间的 20 个键**本身就是功能规格**
 *    （原版逐字），而 `tx()` 取不到键时会**原样返回键路径** ——
 *    拼错了界面上会直接显示 `composer.composerPlusMenu.xxx`，
 *    测试里有一条专门盯这个（断言任何一行的文案都不是以 `composer.` 开头的键路径）。
 */
function pm(leaf: string): string {
  return tx(`composer.composerPlusMenu.${leaf}`);
}

/**
 * 行图标 —— **从原版 chunk 里读出来的，不是挑的**。
 *
 * 原版每个图标都是 `,FI=pt("paperclip",…),Py=pt("folder",…),…` 这种形态，
 * `pt(name, node)` 的第一个字符串参数就是 lucide 名（第二个是路径数据）。
 * 逐个射出本仓 `Icon` 名字表（kebab-case）：
 *
 *   addFiles→`paperclip`(FI) · addToProject→`folder`(Py) · datasets→`database`(tw)
 *   gallery→`images`($0) · skills→`sparkles`(fc) · algorithms→`square-function`(BI)
 *   connectors→`plug`(Jk) · plugins→`blocks`(EI) · research→`telescope`(cce)
 *   webSearch→`globe`(Xk) · browseSkills→`plus`(A2) · 各 `manageX`→`briefcase`(jm)
 *   开关行的 ✓ → `check`(dc)
 *
 * ⚠️ `Icon` 缺名时**静默画一个空心圆**（`Icon.tsx:36` 的 `Fallback`，带
 *    `data-missing-icon`），所以测试必须断言渲染结果里**没有**这个标记 ——
 *    只断言"名字在我写的常量里"是橡皮图章。
 */
export const PLUS_ICON = {
  addFiles: 'paperclip',
  addToProject: 'folder',
  datasets: 'database',
  gallery: 'images',
  skills: 'sparkles',
  algorithms: 'square-function',
  connectors: 'plug',
  plugins: 'blocks',
  research: 'telescope',
  webSearch: 'globe',
  manage: 'briefcase',
  browse: 'plus',
  check: 'check',
  /** 复刻新增那一行用的图标：与顶栏「打开面板」按钮同一枚（`TopBar.tsx:131`） */
  openFilesPanel: 'panel-right-close',
} as const;

/**
 * 「＋」弹层的高度上限（px）—— 走 `Popover` 的可选参数，**不动 `.cz-pop` 那个全局值**。
 *
 * 448 = 28rem，**不是拍的**：原版根弹层用的内容组件 `Za` 自带
 * `max-h-[var(--available-height,28rem)]`，28rem 就是它的兜底。
 * 11 行 + 4 条分隔线约 374px < 448px ⇒ 原版这 11 行一屏全见。
 * 传给 `Popover` 后它仍会与"上方/下方实际剩余空间"取 min（就是原版
 * `--available-height` 的行为），所以小窗口下依然不会溢出视口。
 *
 * ⚠️ 只给「＋」菜单用。另外 5 个选择器（项目/模式/模板/权限/模型）内容都不到 320px，
 *    给它们一并放大只会让空弹层看起来更大 —— 那是一次没必要的全局观感变更。
 */
export const PLUS_POPOVER_MAX_HEIGHT = 448;

/**
 * `research` / `webSearch` 两行的**默认勾选态** —— 原版是
 * `useState(!1)` / `useState(!0)`，这里原样镜像（见文件头「两个开关行」）。
 *
 * ⚠️ 这两个值**只用于渲染一个静态的 ✓**：这两行是 `static` 展示项，点不动、
 *    也不接任何状态。谁要把它们变回能拨的开关，请先拿出"它到底控制什么"的证据。
 */
export const PLUS_STATIC_SWITCH_DEFAULT = { research: false, webSearch: true } as const;

/** 有二级菜单的行（原版这几行都是 Radix `Sub`，触发器自带 chevron-right） */export type PlusSubmenuId =
  | 'project'
  | 'datasets'
  | 'gallery'
  | 'skills'
  | 'algorithms'
  | 'connectors'
  | 'plugins';

/**
 * 行的 id。
 * ⚠️ `openFilesPanel` 是**复刻新增**的（原版没有），来历见文件头「不要删掉」那段。
 */
export type PlusRowId =
  | 'addFiles'
  | 'addToProject'
  | 'datasets'
  | 'gallery'
  | 'skills'
  | 'algorithms'
  | 'connectors'
  | 'plugins'
  | 'research'
  | 'webSearch'
  | 'openFilesPanel';

export interface PlusRow {
  id: PlusRowId;
  /**
   * 同组不画线、换组画一条。原版三处分隔线正好落在 group 变化处，
   * 所以这一列既表达"顺序"也表达"分组"，不用再单独建一个分隔符条目。
   */
  group: number;
  /** 文案。**在 build 阶段就取好**（走 `tx`），组件里不再拼字 */
  label: string;
  icon: string;
  /** 右侧角标 —— 原版只有 `addFiles` 有（`⌘U`） */
  badge?: string;
  /** 有值 = 这一行是二级菜单的父行 */
  submenu?: PlusSubmenuId;
  /**
   * 静态展示项右侧的 ✓（原版 `research` / `webSearch` 那个勾）。
   * ⚠️ 现在只有 `static` 行会用到它 —— 它是一个**镜像原版默认态**的静态标记，
   *    不是"某个开关当前是开的"。
   */
  checked?: boolean;
  /**
   * **不可交互的展示项**：渲染成 `disabled`（置灰、不响应悬停、点不动）。
   *
   * 用在原版那两行「只有状态没有消费者」的开关上（见文件头引的取证）。
   * `activatePlusRow` 对这类行**直接返回**，所以就算有人绕过 `disabled`
   * 直接调 `onClick`，也不会关弹层、不会跑任何动作。
   */
  static?: boolean;
  /**
   * 点击后**不关**弹层。
   * 原版的取值很硬：展开子菜单的行不关、两个开关行 `closeOnClick:!1`，其余都关。
   */
  keepOpen: boolean;
  run: () => void;
}

export interface PlusSubItem {
  id: string;
  /** 换组时画分隔线（原版每个子菜单里那条 `bs`） */
  group: number;
  label: string;
  icon: string;
  /** 原版 `noProjects` / `noSkillsEnabled` 是 `disabled:!0`；这里同样渲染成不可点 */
  disabled?: boolean;
  run: () => void;
}

/** 数据集条目 —— 与 `DatabasePage.tsx` 的 `DatasetFile` 同形（只取这两列） */
export interface PlusDatasetEntry {
  relPath: string;
  name: string;
}

/** 技能条目 —— 目录名（当 key）+ frontmatter 名（= 斜杠命令名） */
export interface PlusSkillEntry {
  dirName: string;
  name: string;
}

/** `manageX` 能跳到的扩展页分区（数据集不在扩展页，单独一个回调） */
export type PlusManageSection = 'skills' | 'algorithms' | 'connectors' | 'plugins';

/** 原版图库子菜单只列**前 5 个**模板（`Az.slice(0,5)`） */
export const PLUS_GALLERY_LIMIT = 5;

/** 原版数据集/连接器子菜单各列 3 条（`W1e` / `H1e` 都是三条写死的样例名） */
export const PLUS_LIST_LIMIT = 3;

export interface PlusMenuDeps {
  /** 项目列表（原版从 `/api/projects` 拿，这里直接用 store 里的） */
  projects: ProjectMeta[];
  /** **已启用**的技能（原版传进来的就是筛过的） */
  skills: PlusSkillEntry[];
  /** 当前项目 data/ 下的数据文件（原版这里是三条写死的样例名） */
  datasets: PlusDatasetEntry[];
  /** 用户配好的连接器名（原版这里是三条写死的 `H1e`） */
  connectors: string[];
  /** 首行：弹系统「选择文件」对话框（⌘U 也是它） */
  onAddFiles: () => void;
  /** 复刻新增那一行：打开右栏「文件」面板 */
  onOpenFilesPanel: () => void;
  /** 点技能 → 把 `/{name}` 放进输入框 */
  onInsertSkill: (name: string) => void;
  /** 点图库模板 → 把模板提示词放进输入框 */
  onInsertPrompt: (prompt: string) => void;
  /** 点数据集文件 → 把 `@{relPath}` 放进输入框 */
  onInsertDataset: (relPath: string) => void;
  /** 管理数据集 → 数据页 */
  onManageDatasets: () => void;
  /** 打开图库 → 图库页 */
  onOpenGallery: () => void;
  /** 管理 技能/算法/连接器/插件 → 扩展页对应分区 */
  onManage: (section: PlusManageSection) => void;
}

/**
 * 行表。**顺序 = 原版渲染顺序**，`group` 的变化处就是原版那三处分隔线。
 * 末尾 `group: 4` 那一行是复刻新增的（见文件头）。
 */
export function buildPlusRows(deps: PlusMenuDeps): PlusRow[] {
  /** 子菜单父行：只负责展开二级，弹层留着（副作用由 activatePlusRow 决定） */
  const sub = (
    id: PlusRowId,
    group: number,
    label: string,
    icon: string,
    submenu: PlusSubmenuId,
  ): PlusRow => ({
    id,
    group,
    label,
    icon,
    submenu,
    keepOpen: true,
    run: () => {
      /* 展开子菜单由 activatePlusRow 负责，这里没有副作用 */
    },
  });

  return [
    {
      id: 'addFiles',
      group: 0,
      label: pm('addFiles'),
      icon: PLUS_ICON.addFiles,
      badge: '⌘U',
      keepOpen: false,
      run: deps.onAddFiles,
    },
    sub('addToProject', 0, pm('addToProject'), PLUS_ICON.addToProject, 'project'),

    sub('datasets', 1, pm('datasets'), PLUS_ICON.datasets, 'datasets'),
    sub('gallery', 1, pm('gallery'), PLUS_ICON.gallery, 'gallery'),

    sub('skills', 2, pm('skills'), PLUS_ICON.skills, 'skills'),
    sub('algorithms', 2, pm('algorithms'), PLUS_ICON.algorithms, 'algorithms'),
    sub('connectors', 2, pm('connectors'), PLUS_ICON.connectors, 'connectors'),
    sub('plugins', 2, pm('plugins'), PLUS_ICON.plugins, 'plugins'),

    {
      id: 'research',
      group: 3,
      label: pm('research'),
      icon: PLUS_ICON.research,
      checked: PLUS_STATIC_SWITCH_DEFAULT.research,
      // 原版把状态拨了也不改变任何东西（取证见文件头）⇒ 降级成展示项，不许可拨
      static: true,
      keepOpen: true,
      run: () => {
        /* 展示项：原版这两个状态没有消费者，这里不发明语义 */
      },
    },
    {
      id: 'webSearch',
      group: 3,
      label: pm('webSearch'),
      icon: PLUS_ICON.webSearch,
      checked: PLUS_STATIC_SWITCH_DEFAULT.webSearch,
      static: true,
      keepOpen: true,
      run: () => {
        /* 同上 */
      },
    },

    // ★ 复刻新增：保住改动前「点 ＋ 一键打开文件面板」那条路径（文件头「不要删掉」）
    {
      id: 'openFilesPanel',
      group: 4,
      label: `${tx('chat.chatPage.openPanel')} · ${tx('dock.rightPanel.files')}`,
      icon: PLUS_ICON.openFilesPanel,
      keepOpen: false,
      run: deps.onOpenFilesPanel,
    },
  ];
}

/** 某个二级菜单的条目。**只有当前展开的那一个才会被真正渲染**。 */
export function buildPlusSubItems(id: PlusSubmenuId, deps: PlusMenuDeps): PlusSubItem[] {
  /** 展示项：原版这几行没有 onClick，点一下只是关掉菜单 */
  const inert = (key: string, group: number, label: string, icon: string): PlusSubItem => ({
    id: key,
    group,
    label,
    icon,
    run: () => {
      /* 原版就是纯展示 */
    },
  });

  switch (id) {
    case 'project':
      // 原版 `q1e`：图标 + 项目名，没有 onClick；`noProjects` 是 disabled
      return deps.projects.length
        ? deps.projects.map((p) => inert(p.id, 0, p.name, PLUS_ICON.addToProject))
        : [
            {
              id: 'noProjects',
              group: 0,
              label: pm('noProjects'),
              icon: PLUS_ICON.addToProject,
              disabled: true,
              run: () => {},
            },
          ];

    case 'datasets': {
      // 原版这三行是纯展示；这里接上 DatabasePage 已有的「插入 @路径」语义
      const items = deps.datasets.slice(0, PLUS_LIST_LIMIT).map((f) => ({
        id: f.relPath,
        group: 0,
        label: f.name,
        icon: PLUS_ICON.datasets,
        run: () => deps.onInsertDataset(f.relPath),
      }));
      return [
        ...items,
        {
          id: 'manageDatasets',
          group: 1,
          label: pm('manageDatasets'),
          icon: PLUS_ICON.manage,
          run: deps.onManageDatasets,
        },
      ];
    }

    case 'gallery': {
      const items = GALLERY.slice(0, PLUS_GALLERY_LIMIT).map((t) => ({
        id: t.id,
        group: 0,
        label: t.title,
        icon: PLUS_ICON.gallery,
        run: () => deps.onInsertPrompt(templatePrompt(t)),
      }));
      return [
        ...items,
        { id: 'openGallery', group: 1, label: pm('openGallery'), icon: PLUS_ICON.manage, run: deps.onOpenGallery },
      ];
    }

    case 'skills': {
      const items = deps.skills.map((s) => ({
        id: s.dirName,
        group: 0,
        label: skillDisplayName(s.name),
        icon: PLUS_ICON.skills,
        run: () => deps.onInsertSkill(s.name),
      }));
      return [
        // 原版：一个技能都没有时先插一条**禁用**的 `noSkillsEnabled`（不是拿空列表糊过去）
        ...(items.length
          ? items
          : [
              {
                id: 'noSkillsEnabled',
                group: 0,
                label: pm('noSkillsEnabled'),
                icon: PLUS_ICON.skills,
                disabled: true,
                run: () => {},
              },
            ]),
        {
          id: 'manageSkills',
          group: 1,
          label: pm('manageSkills'),
          icon: PLUS_ICON.manage,
          run: () => deps.onManage('skills'),
        },
        // 原版 `browseSkills` 用的就是「＋」那枚图标（`A2`），不是复制粘贴错的
        {
          id: 'browseSkills',
          group: 1,
          label: pm('browseSkills'),
          icon: PLUS_ICON.browse,
          run: () => deps.onManage('skills'),
        },
      ];
    }

    case 'algorithms':
      return [
        {
          id: 'manageAlgorithms',
          group: 0,
          label: pm('manageAlgorithms'),
          icon: PLUS_ICON.manage,
          run: () => deps.onManage('algorithms'),
        },
      ];

    case 'connectors':
      // 原版 `Z1e`：三条写死的服务名，纯展示（这里换成用户真配了的 MCP 连接器）
      return [
        ...deps.connectors
          .slice(0, PLUS_LIST_LIMIT)
          .map((name) => inert(`conn-${name}`, 0, name, PLUS_ICON.connectors)),
        {
          id: 'manageConnectors',
          group: 1,
          label: pm('manageConnectors'),
          icon: PLUS_ICON.manage,
          run: () => deps.onManage('connectors'),
        },
      ];

    case 'plugins':
      return [
        {
          id: 'managePlugins',
          group: 0,
          label: pm('managePlugins'),
          icon: PLUS_ICON.manage,
          run: () => deps.onManage('plugins'),
        },
      ];
  }
}

/** 点一行的语义 —— **纯函数**，所以"点开关不关菜单"这条能被直接断言 */
export interface PlusActivateCtx {
  onClose: () => void;
  onSub: (id: PlusSubmenuId) => void;
}

export function activatePlusRow(row: PlusRow, ctx: PlusActivateCtx): void {
  // 展示项：原版那两行开关"只有状态没有消费者"（取证见文件头）—— 这里点不动，
  // 也**不关**弹层。放在最前面是为了：即便有人绕过按钮的 `disabled` 直接调 onClick，
  // 结果也是"什么都不发生"，而不是"关掉弹层"。
  if (row.static) return;
  // 子菜单父行：只展开二级，弹层留着（原版 Radix `Sub` 的 `data-popup-open` 行为）
  if (row.submenu) {
    ctx.onSub(row.submenu);
    return;
  }
  row.run();
  // 开关行 `closeOnClick:!1` —— 点一下必须能看着它变，关了就没法连着调两个开关
  if (!row.keepOpen) ctx.onClose();
}

/** 点子菜单条目的语义：执行 + 关掉整个弹层（原版子菜单项点完就收） */
export function activatePlusSubItem(item: PlusSubItem, ctx: { onClose: () => void }): void {
  if (item.disabled) return;
  item.run();
  ctx.onClose();
}

export interface PlusMenuProps extends PlusMenuDeps {
  /**
   * 当前展开的二级菜单。
   * **由父级持有**（展开要配"悬停延时关闭"的定时器，那是 hook 的事）——
   * 这个组件因此保持零 hook，见文件头。
   */
  subOpen: PlusSubmenuId | null;
  onSubEnter: (id: PlusSubmenuId) => void;
  onSubLeave: () => void;
  onSubToggle: (id: PlusSubmenuId) => void;
  onClose: () => void;
}

/**
 * 「＋」弹层的**内容**（不含弹层本身 —— 定位/portal/点外部关闭由 `Composer` 里那个
 * `Popover` 负责，与另外四个选择器共用同一套）。
 */
export function PlusMenu(props: PlusMenuProps): JSX.Element {
  const { subOpen, onSubEnter, onSubLeave, onSubToggle, onClose } = props;
  const rows = buildPlusRows(props);

  /**
   * 二级菜单的条目。
   *
   * ⚠️ 刻意写成**局部箭头函数**而不是拆成 `<SubItems/>` 子组件：拆出去以后这些
   *    `<button>` 就不在 `PlusMenu(props)` 返回的元素树里了（子组件只是个"待调用"的
   *    元素），测试就没法直接拿到 `onClick` 真调一次 —— 只能退回"断言数据里有"，
   *    那又变成橡皮图章。
   */
  const subItems = (id: PlusSubmenuId): JSX.Element[] => {
    const items = buildPlusSubItems(id, props);
    return items.map((item, i) => (
      <Fragment key={item.id}>
        {/* 换组画分隔线（数据决定，不靠 index 猜） */}
        {i > 0 && item.group !== items[i - 1].group ? <div className="cz-pop-sep" /> : null}
        <button
          type="button"
          className="cz-pop-item"
          data-plus-sub-item={item.id}
          disabled={item.disabled}
          onClick={() => activatePlusSubItem(item, { onClose })}
        >
          <Icon name={item.icon} size={15} />
          <span className="grow truncate">{item.label}</span>
        </button>
      </Fragment>
    ));
  };

  return (
    <div data-plus-menu="">
      {rows.map((row, i) => {
        // 换组画分隔线：`group` 是数据，不是靠 index 猜的
        const sep = i > 0 && row.group !== rows[i - 1].group;
        const head = (
          <button
            type="button"
            className={`cz-pop-item${row.submenu && subOpen === row.submenu ? ' open' : ''}`}
            data-plus-row={row.id}
            disabled={row.static === true}
            onClick={() => activatePlusRow(row, { onClose, onSub: onSubToggle })}
          >
            <Icon name={row.icon} size={15} />
            <span className="grow">{row.label}</span>
            {row.badge ? <span className="cz-pop-badge">{row.badge}</span> : null}
            {row.checked ? <Icon name={PLUS_ICON.check} size={15} className="cz-pop-check" /> : null}
            {row.submenu ? <Icon name="chevron-right" size={12} /> : null}
          </button>
        );

        return (
          <Fragment key={row.id}>
            {sep ? <div className="cz-pop-sep" /> : null}
            {row.submenu ? (
              <div
                className="cz-sub-wrap"
                onMouseEnter={() => onSubEnter(row.submenu as PlusSubmenuId)}
                onMouseLeave={onSubLeave}
              >
                {head}
                <SubFlyout
                  open={subOpen === row.submenu}
                  onClose={onSubLeave}
                  onEnter={() => onSubEnter(row.submenu as PlusSubmenuId)}
                  onLeave={onSubLeave}
                  extraClass="plus-sub"
                >
                  {subItems(row.submenu)}
                </SubFlyout>
              </div>
            ) : (
              head
            )}
          </Fragment>
        );
      })}
    </div>
  );
}
