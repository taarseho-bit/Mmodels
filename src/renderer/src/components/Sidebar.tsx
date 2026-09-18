/**
 * 左侧栏 —— 复刻原版的**竖排导航栏 + 项目 + 会话**三合一结构。
 *
 * ⚠️ 这是对比原版实机截图后的**结构性修正**：
 *    之前做成了「顶栏横向 tab」，而原版是**左侧竖排列表**：
 *      搜索 / 新建会话 / 科研绘图 / 数模广场 / 竞赛日历 / 自动化 / 扩展 / 打开工作区
 *      ── 项目（+ 新建）
 *      ── 会话
 *
 * 文案逐字取自 `shell.sidebar.*` 与 `shell.searchPalette.searchLabel`。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import type { ProjectMeta, SessionMeta } from '@shared/types';
import type { Route } from '../App';
import { t, tx } from '../i18n';
import { exportFileName } from '../lib/export-name';
import { makeZip } from '../lib/zip';
import { registerCommand } from '../keybindings/dispatch';

interface Props {
  route: Route;
  setRoute: (r: Route) => void;
}

interface RailItemProps {
  icon: string;
  label: string;
  active?: boolean;
  title?: string;
  onClick: () => void;
  id?: string;
  /** 路由标识：引导巡览与冒烟测试靠它定位导航项 */
  route?: string;
}

function RailItem({ icon, label, active, title, onClick, id, route }: RailItemProps): JSX.Element {
  return (
    <button
      id={id}
      data-route={route}
      className={`rail-item${active ? ' active' : ''}`}
      onClick={onClick}
      title={title ?? label}
    >
      <Icon name={icon} size={15} />
      <span className="rail-label truncate">{label}</span>
    </button>
  );
}

export function Sidebar({ route, setRoute }: Props): JSX.Element {
  const projects = useApp((s) => s.projects);
  const settings = useApp((s) => s.settings);
  const current = useApp((s) => s.currentProject);
  const sessions = useApp((s) => s.sessions);
  const activeSessionId = useApp((s) => s.activeSessionId);
  const createProject = useApp((s) => s.createProject);
  const openProject = useApp((s) => s.openProject);
  const removeProject = useApp((s) => s.removeProject);
  const renameProject = useApp((s) => s.renameProject);
  const beginNewChat = useApp((s) => s.beginNewChat);
  const selectSession = useApp((s) => s.selectSession);
  const removeSession = useApp((s) => s.removeSession);
  const refreshSessions = useApp((s) => s.refreshSessions);

  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  /** 正在内联重命名的项目 id（对齐原版：项目行 hover 出「重命名 / 删除」两个图标） */
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  /** 侧栏级提示（原版用 toast 提示"会话已导出 / 已导入 / 导出失败"） */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string): void => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  /**
   * 右键上下文菜单的当前目标。`x` / `y` 是打开时的**视口坐标**（配合 fixed 定位）。
   * 用户点名要求：项目行与会话行右键都要能「打开文件夹目录」。
   */
  const [ctxMenu, setCtxMenu] = useState<
    | { kind: 'project'; x: number; y: number; project: ProjectMeta }
    | { kind: 'session'; x: number; y: number; session: SessionMeta }
    | { kind: 'sessions-more'; x: number; y: number }
    | null
  >(null);
  /** 侧栏收起状态（原版顶部第一个图标按钮 = 收起/展开侧栏），本地持久化 */
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('mm-sidebar-collapsed') === '1');
  useEffect(() => {
    localStorage.setItem('mm-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  /**
   * 把顶栏那**两个图标按钮**接到统一分发器上（`keybindings/dispatch.ts`）。
   *
   * 为什么由本组件登记：这两个开关的状态是**本组件的局部 state**
   * （`collapsed` / `searchOpen`），外面拿不到；而分发器是"谁拥有谁登记"。
   *
   * ⚠️ `search.toggle` 里**必须先展开侧栏**：
   *    CSS `layout.css:1143-1148` 有 `.sidebar.collapsed .rail-search { display: none }`，
   *    收起状态下把 `searchOpen` 置 true 是**看不见任何变化**的 —— 那正是本次要修的
   *    "有开关、按了没反应"这一类。所以 `mod+k` 的语义是"**打开搜索**"（必要时连侧栏一起展开），
   *    已经在开着的时候才关掉。这是与"只取反 `searchOpen`"的唯一分歧，写在这里免得被改回去。
   */
  useEffect(() => {
    const offSidebar = registerCommand('sidebar.toggle', () => setCollapsed((v) => !v));
    const offSearch = registerCommand('search.toggle', () =>
      setSearchOpen((v) => {
        if (v) return false;
        setCollapsed(false); // 收起态下搜索框是 display:none，不展开就等于没反应
        return true;
      }),
    );
    return () => {
      offSidebar();
      offSearch();
    };
  }, []);
  /** 当前项目有数据文件时才显示「数据集」导航项（对齐原版行为） */
  const [hasDatasets, setHasDatasets] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!current) {
      setHasDatasets(false);
      return;
    }
    void (async () => {
      try {
        const r = (await window.mathmodel.dataset.list()) as { files: unknown[] };
        if (!cancelled) setHasDatasets(r.files.length > 0);
      } catch {
        if (!cancelled) setHasDatasets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [current, sessions.length]);

  const handleNewChat = (): void => {
    beginNewChat();
    if (route !== 'chat') setRoute('chat');
  };

  const handleNewProject = async (): Promise<void> => {
    const created = await createProject('');
    if (created && route !== 'chat') setRoute('chat');
  };

  /**
   * 「这一次重命名已经处理过了」的闸。
   *
   * 输入框被卸载时 Chromium 会补发一次 blur —— 不加这道闸，
   * 按 Esc 取消会被随后的 blur 当成「失焦提交」，照样把名字改掉。
   */
  const renameDoneRef = useRef(false);

  const beginRename = (id: string, name: string): void => {
    renameDoneRef.current = false;
    setRenameText(name);
    setRenameFor(id);
  };

  /**
   * 结束重命名。`commit = false` 表示取消（Esc）。
   * 空名或没改动视作取消 —— 原版没有独立的确认键，回车/失焦即生效。
   */
  const finishRename = (id: string, original: string, commit: boolean): void => {
    if (renameDoneRef.current) return;
    renameDoneRef.current = true;
    const next = renameText.trim();
    setRenameFor(null);
    if (!commit || !next || next === original) return;
    void renameProject(id, next);
  };

  // ─────────────────────────────────────────────────────────
  // 右键菜单（用户点名要的新能力）
  // ─────────────────────────────────────────────────────────

  /** 复制到剪贴板 —— 失败静默（与 ErrorBoundary 的处理一致，不打断用户） */
  const copyText = useCallback((text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }, []);

  /** 用系统默认程序打开目录 —— 主进程 `shell.openPath`（复用已有 IPC，未新增通道） */
  const openFolder = useCallback((root?: string): void => {
    if (root) void window.mathmodel.app.openPath(root);
  }, []);

  /** 在父目录里选中它 —— 主进程 `shell.showItemInFolder` */
  const revealFolder = useCallback((root?: string): void => {
    if (root) void window.mathmodel.app.showItemInFolder(root);
  }, []);

  /** 会话所属项目的根目录（会话本身没有独立目录，归属当前项目） */
  const sessionRootOf = useCallback(
    (projectId: string): string | undefined => projects.find((p) => p.id === projectId)?.root,
    [projects],
  );

  /**
   * 导出会话 JSON —— 对应原版「导出数据（.json）」。
   *
   * 两截分工照抄原版（这两个通道**复刻早就有了**，未新增任何通道）：
   *   1. `http.request('/api/sessions/:id/export')` —— 主进程只产 JSON，**不弹框**
   *   2. `file.saveText(默认文件名, JSON.stringify(payload, null, 2))` —— 弹保存框落盘
   *
   * 为什么不在主进程弹框：那样"用户点了取消"和"导出真的失败"就分不开了。
   * 分成两截后，`saveText` 返回 `null` = 用户取消（**不提示**），抛错才算失败。
   *
   * ⚠️ 缩进 2 空格 —— 原版是 `JSON.stringify(n, null, 2)`（与打包 ZIP 里那份一致）。
   */
  const exportSession = useCallback(
    async (session: SessionMeta): Promise<void> => {
      try {
        const payload = await window.mathmodel.http.request(`/api/sessions/${session.id}/export`);
        const saved = await window.mathmodel.file.saveText(
          exportFileName(session.title ?? '', 'json'),
          JSON.stringify(payload, null, 2),
        );
        if (saved) showToast(tx('shell.sidebar.chatExported'));
      } catch {
        showToast(tx('shell.sidebar.exportFailed'));
      }
    },
    [showToast],
  );

  const loadExport = useCallback(async (session: SessionMeta): Promise<any> => {
    return window.mathmodel.http.request(`/api/sessions/${session.id}/export`);
  }, []);

  const buildShareHtml = useCallback((payload: any, title: string): string => {
    const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
    const messages = Array.isArray(payload?.messages) ? payload.messages : [];
    const body = messages.map((m: any) => {
      const text = Array.isArray(m.parts)
        ? m.parts.map((p: any) => p.type === 'text' ? p.text : p.type === 'thinking' ? `思考：${p.text}` : p.type === 'tool-use' ? `工具：${p.toolUse?.name ?? ''}` : '').filter(Boolean).join('\n')
        : '';
      return `<article class="message ${m.role === 'user' ? 'user' : 'assistant'}"><div class="role">${m.role === 'user' ? '我' : '助手'}</div><div class="content">${escape(text).replace(/\n/g, '<br>')}</div></article>`;
    }).join('');
    return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:15px/1.7 system-ui,sans-serif;max-width:860px;margin:40px auto;padding:0 24px;color:#252525;background:#fafafa}.message{padding:16px 18px;margin:14px 0;border:1px solid #ddd;border-radius:8px;background:white}.message.user{border-left:4px solid #6285c7}.message.assistant{border-left:4px solid #5e7c69}.role{font-weight:700;margin-bottom:5px;color:#666}.content{word-break:break-word}h1{font-size:24px}</style><h1>${escape(title)}</h1>${body}`;
  }, []);

  const shareSession = useCallback(async (session: SessionMeta, image: boolean): Promise<void> => {
    try {
      const html = buildShareHtml(await loadExport(session), session.title);
      if (image) {
        const saved = await window.mathmodel.file.saveShareImage({ defaultName: exportFileName(session.title, 'png'), html });
        if (saved) showToast(tx('shell.sidebar.shareImageSaved'));
      } else {
        const saved = await window.mathmodel.file.saveText(exportFileName(session.title, 'html'), html);
        if (saved) showToast(tx('shell.sidebar.sharePageSaved'));
      }
    } catch { showToast(tx('chat.useChat.sharePageFailed')); }
  }, [buildShareHtml, loadExport, showToast]);

  const exportBundle = useCallback(async (session: SessionMeta): Promise<void> => {
    try {
      const payload = await loadExport(session);
      const zip = makeZip([
        { name: 'session.json', content: JSON.stringify(payload, null, 2) },
        { name: 'README.txt', content: `MModels 会话资源包\n标题：${session.title}\n\n此包由本地生成。` },
      ]);
      // 分块编码，避免大段会话数据展开成函数参数时触发浏览器调用栈限制。
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < zip.length; i += chunkSize) {
        binary += String.fromCharCode(...zip.subarray(i, Math.min(i + chunkSize, zip.length)));
      }
      binary = btoa(binary);
      const saved = await window.mathmodel.file.saveBinary(exportFileName(session.title, 'zip'), binary);
      if (saved) showToast(tx('shell.sidebar.bundleExported', { assets: 1 }));
    } catch { showToast(tx('shell.sidebar.exportFailed')); }
  }, [loadExport, showToast]);

  /**
   * 导入会话 —— 对应原版「导入会话…」（侧栏级菜单项 `shell.sidebar.importChat`）。
   *
   * 链路照抄原版的两截分工（**两个已有通道**，未新增）：
   *   1. `file.openText()` 弹「打开」对话框，拿 `{path, content}`
   *   2. `http.request('/api/sessions/import', {method:'POST', body})` 落库（**永远新建**）
   *
   * ⚠️ 三种失败必须分开提示，别一律"导入失败"：
   *   - **用户取消**（返回 null）→ 什么都不做，**不提示**
   *   - **JSON 解析失败** → `chat.useChat.invalidImportFile`（"不是有效的会话导出文件"）
   *   - **服务端校验/落库失败** → `shell.sidebar.importFailed`
   *
   * 冲突：原版**永不冲突**（`cs` 里没有 session.id，一律新 uuid，标题也不去重），
   * 所以这里**不需要**任何"覆盖 / 跳过"的询问。
   */
  const importSession = useCallback(async (): Promise<void> => {
    const file = await window.mathmodel.file.openText();
    if (!file) return; // 用户取消

    let payload: unknown;
    try {
      payload = JSON.parse(file.content) as unknown;
    } catch {
      showToast(tx('chat.useChat.invalidImportFile'));
      return;
    }

    try {
      const res = (await window.mathmodel.http.request('/api/sessions/import', {
        method: 'POST',
        body: payload,
      })) as { session?: { id?: string }; importedMessages?: number; degradedParts?: number };
      const imported = res.session?.id;
      if (imported) {
        await refreshSessions();
        selectSession(imported);
        setRoute('chat');
      }
      /**
       * ⚠️ 这里**只**用现成的原版键，不拼任何中文后缀。
       *
       * 「降级」不是"丢内容"：装不下的 part 被转成了文本，**文字全在会话里**，
       * 用户往下翻就能看见。所以"绝不静默丢内容"这条判据**不靠 toast 承担**，
       * 它由"降级后的文本确实落在 blocks 里"承担（`import.test.ts` 有断言）。
       *
       * 降级段数仍从接口回传（`degradedParts`），这里写进控制台方便排查 ——
       * 界面文案不硬编码中文（i18n 纪律）。原版有 count 后缀的先例
       * （`shell.sidebar.bundleExported: '… · {{assets}} 个素材'`），
       * 将来要显示的话按那个模式加一条键即可，不必改这里。
       */
      if ((res.degradedParts ?? 0) > 0) {
        console.warn(`[import] 有 ${res.degradedParts} 段 part 被降级成文本`);
      }
      showToast(tx('shell.sidebar.chatImported'));
    } catch {
      showToast(tx('shell.sidebar.importFailed'));
    }
  }, [refreshSessions, selectSession, setRoute, showToast]);

  /** 「会话」区标题右侧的「更多…」菜单（原版：导入会话… 是侧栏级入口，不在会话行菜单里） */
  const openSessionsMore = useCallback((e: React.MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setCtxMenu({ kind: 'sessions-more', x: r.left, y: r.bottom + 4 });
  }, []);

  const sessionsMoreItems: ContextMenuItem[] =
    ctxMenu?.kind === 'sessions-more'
      ? [
          {
            label: tx('shell.sidebar.importChat'),
            icon: 'file-up',
            onSelect: () => void importSession(),
          },
        ]
      : [];

  const projectMenuItems: ContextMenuItem[] =
    ctxMenu?.kind === 'project'
      ? [
          {
            label: t('打开文件夹目录'),
            icon: 'folder-open',
            onSelect: () => openFolder(ctxMenu.project.root),
          },
          {
            label: tx('dock.explorerPanel.revealInFolder'),
            icon: 'folder',
            onSelect: () => revealFolder(ctxMenu.project.root),
          },
          {
            label: tx('dock.explorerPanel.copyPath'),
            icon: 'copy',
            onSelect: () => copyText(ctxMenu.project.root),
          },
          {
            label: tx('shell.sidebar.rename'),
            icon: 'pencil',
            divider: true,
            onSelect: () => beginRename(ctxMenu.project.id, ctxMenu.project.name),
          },
          {
            label: tx('shell.sidebar.deleteProject'),
            icon: 'trash-2',
            danger: true,
            onSelect: () => void removeProject(ctxMenu.project.id, true),
          },
        ]
      : [];

  const sessionMenuItems: ContextMenuItem[] =
    ctxMenu?.kind === 'session'
      ? (() => {
          const root = sessionRootOf(ctxMenu.session.projectId);
          return [
            {
              label: t('打开会话所在文件夹'),
              icon: 'folder-open',
              disabled: !root,
              onSelect: () => openFolder(root),
            },
            {
              label: tx('dock.explorerPanel.revealInFolder'),
              icon: 'folder',
              disabled: !root,
              onSelect: () => revealFolder(root),
            },
            {
              label: t('复制会话标题'),
              icon: 'copy',
              divider: true,
              onSelect: () => copyText(ctxMenu.session.title),
            },
            {
              label: t('复制会话 ID'),
              icon: 'clipboard-list',
              onSelect: () => copyText(ctxMenu.session.id),
            },
            {
              // 原版文案：`shell.sidebar.exportDataJson`（词典里已有，调用点为 0）
              label: tx('shell.sidebar.exportDataJson'),
              icon: 'download',
              divider: true,
              onSelect: () => void exportSession(ctxMenu.session),
            },
            {
              label: tx('shell.sidebar.exportBundleZip'),
              icon: 'package',
              onSelect: () => void exportBundle(ctxMenu.session),
            },
            {
              label: tx('shell.sidebar.shareImagePng'),
              icon: 'image',
              onSelect: () => void shareSession(ctxMenu.session, true),
            },
            {
              label: tx('shell.sidebar.sharePageHtml'),
              icon: 'file-code-2',
              onSelect: () => void shareSession(ctxMenu.session, false),
            },
            {
              label: t('删除会话'),
              icon: 'trash-2',
              danger: true,
              onSelect: () => void removeSession(ctxMenu.session.id),
            },
          ] satisfies ContextMenuItem[];
        })()
      : [];

  const navigation: Array<{ icon: string; label: string; route?: Route; onClick?: () => void; id?: string }> = [
    { icon: 'chart-column', label: tx('shell.sidebar.gallery'), route: 'gallery' },
    { icon: 'file-text', label: tx('shell.sidebar.papers'), route: 'papers' },
    { icon: 'calendar-days', label: tx('shell.sidebar.competitions'), route: 'competitions' },
    ...(hasDatasets ? [{ icon: 'database', label: tx('shell.sidebar.datasets'), route: 'datasets' as Route }] : []),
    { icon: 'plug', label: tx('shell.sidebar.automation'), route: 'automation' },
    { icon: 'blocks', label: tx('shell.sidebar.extensions'), route: 'extensions' },
  ];

  // 会话过滤（搜索框）
  const visibleSessions = useMemo(() => {
    const kw = q.trim().toLowerCase();
    if (!kw) return sessions;
    return sessions.filter((s) => (s.title ?? '').toLowerCase().includes(kw));
  }, [sessions, q]);

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      {/* ── 顶部图标行（原版：收起侧栏 + 搜索，两个图标在导航项上方）── */}
      <div className="rail-top">
        <button
          className="rail-icon-btn"
          // ⚠️ 原版实机取证（install asar @63027810）：
          //    title = o(r ? "shell.titleBarControls.expandSidebar" : "shell.titleBarControls.collapseSidebar")
          //    这里没有 `shell.sidebar.*` 这套键 —— 早期写成 `shell.sidebar.collapseSidebar`
          //    取不到值，tx() 会把键路径原样渲染到 tooltip 上（静默失败，已被 i18n 护栏测试抓到）。
          //    顺带对齐原版：收起/展开两种状态用不同文案。
          title={tx(
            collapsed ? 'shell.titleBarControls.expandSidebar' : 'shell.titleBarControls.collapseSidebar',
          )}
          onClick={() => setCollapsed((v) => !v)}
        >
          <Icon name="panel-left" size={15} />
        </button>
        <button
          className="rail-icon-btn"
          title={tx('shell.searchPalette.searchLabel')}
          onClick={() => setSearchOpen((v) => !v)}
        >
          <Icon name="search" size={15} />
        </button>
      </div>

      <div className="rail-create-strip" aria-label="当前项目中的任务">
        <button
          id="tour-new-thread"
          type="button"
          disabled={!current}
          onClick={handleNewChat}
          title={current ? `在“${current.name}”中开始新任务` : '请先选择一个项目'}
        >
          <Icon name="message-square-plus" size={14} />
          <span>新任务</span>
        </button>
      </div>

      {/* ── 导航 ── */}
      <nav className="rail-nav">
        {navigation.map((n) =>
          n.route ? (
            <RailItem
              key={n.label}
              icon={n.icon}
              label={n.label}
              active={route === n.route}
              id={n.id}
              route={n.route}
              onClick={() => setRoute(n.route as Route)}
            />
          ) : (
            <RailItem key={n.label} icon={n.icon} label={n.label} id={n.id} onClick={n.onClick!} />
          ),
        )}
      </nav>

      {/* ── 搜索框（点「搜索」展开）── */}
      {searchOpen && (
        <div className="rail-search">
          <input
            className="input"
            autoFocus
            style={{ height: 26, fontSize: 12 }}
            placeholder={tx('shell.searchPalette.placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setQ('');
                setSearchOpen(false);
              }
            }}
          />
        </div>
      )}

      {/* ── 项目 ── */}
      <div className="rail-sec">
        <div className="rail-sec-head">
          <span>工作项目</span>
          <button
            className="rail-sec-btn"
            title="新建或打开项目目录"
            onClick={() => void handleNewProject()}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>

        {/* 引导巡览的「一道题建一个项目」步骤指向这里 */}
        <div id="tour-projects">
          {projects.length === 0 && !current ? (
            <div className="rail-empty">{tx('shell.sidebar.noProjectsYet')}</div>
          ) : (
            <button
              className={`rail-item${projectSwitcherOpen ? ' open' : ''}`}
              onClick={() => setProjectSwitcherOpen((v) => !v)}
              title={current?.root}
              onContextMenu={(e) => {
                if (!current) return;
                e.preventDefault();
                setCtxMenu({ kind: 'project', x: e.clientX, y: e.clientY, project: current });
              }}
            >
              <Icon name="folder-open" size={14} />
              <span className="rail-label truncate">{current?.name ?? tx('shell.sidebar.projects')}</span>
              <Icon name={projectSwitcherOpen ? 'chevron-down' : 'chevron-right'} size={12} style={{ opacity: 0.5 }} />
            </button>
          )}

          {projectSwitcherOpen && (
            <div className="rail-sub">
              {projects.map((p) => (
                <div key={p.id} className="rail-sub-row">
                  {renameFor === p.id ? (
                    <input
                      className="input rail-rename"
                      autoFocus
                      value={renameText}
                      aria-label={tx('shell.sidebar.rename')}
                      placeholder={tx('shell.sidebar.rename')}
                      onChange={(e) => setRenameText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') finishRename(p.id, p.name, true);
                        else if (e.key === 'Escape') finishRename(p.id, p.name, false);
                      }}
                      onBlur={() => finishRename(p.id, p.name, true)}
                    />
                  ) : (
                    <button
                      className={`rail-item sm${p.id === current?.id ? ' active' : ''}`}
                      onClick={() => {
                        void openProject(p.id);
                        setProjectSwitcherOpen(false);
                      }}
                      title={p.root}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({ kind: 'project', x: e.clientX, y: e.clientY, project: p });
                      }}
                    >
                      <Icon name="folder-open" size={13} />
                      <span className="rail-label truncate">{p.name}</span>
                    </button>
                  )}

                  {/*
                    hover 时才出现的两个图标按钮。
                    注意：原版实机右键项目行取证是 `menus: []`（无浮层），这里的右键菜单
                    是按用户诉求补的增强入口，两边都指向同一组动作（beginRename / removeProject）。
                  */}
                  {renameFor !== p.id && (
                    <div className="rail-row-actions">
                      <button
                        className="rail-item-x"
                        title={tx('shell.sidebar.rename')}
                        aria-label={tx('shell.sidebar.rename')}
                        onClick={(e) => {
                          e.stopPropagation();
                          beginRename(p.id, p.name);
                        }}
                      >
                        <Icon name="pencil" size={13} />
                      </button>
                      <button
                        className="rail-item-x"
                        title={tx('shell.sidebar.deleteProject')}
                        aria-label={tx('shell.sidebar.deleteProject')}
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeProject(p.id, true);
                        }}
                      >
                        <Icon name="trash-2" size={13} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── 会话 ── */}
      <div className="rail-sec grow">
        <div className="rail-sec-head">
          <span>项目任务</span>
          <span className="muted" style={{ fontSize: 10 }}>
            {sessions.length || ''}
          </span>
          {/* 原版：会话区标题右侧的「更多…」菜单，里面是**侧栏级**入口（导入会话…） */}
          <button
            className="rail-sec-btn"
            title={tx('shell.sidebar.more')}
            aria-label={tx('shell.sidebar.more')}
            data-menu="sessions-more"
            onClick={openSessionsMore}
          >
            <Icon name="ellipsis" size={13} />
          </button>
        </div>
        <div className="rail-list">
          {visibleSessions.length === 0 ? (
            // 原版这里没有空态文案（截图确认），只有搜索无结果时给提示
            q ? <div className="rail-empty">{tx('shell.searchPalette.noResults')}</div> : null
          ) : (
            visibleSessions.map((s) => (
              <div key={s.id} className="rail-sub-row">
                <button
                  className={`rail-item sm${s.id === activeSessionId && route === 'chat' ? ' active' : ''}`}
                  onClick={() => {
                    selectSession(s.id);
                    if (route !== 'chat') setRoute('chat');
                  }}
                  title={s.title}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ kind: 'session', x: e.clientX, y: e.clientY, session: s });
                  }}
                >
                  <span className={`rail-dot${s.status === 'running' ? ' running' : ''}`} />
                  <span className="rail-label truncate">{s.title || tx('integrations.taskCompletion.untitledChat')}</span>
                </button>
                <button
                  className="rail-item-x"
                  title={tx('common.delete')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeSession(s.id);
                  }}
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── 底部：账号区（原版：头像 + 名称 + 徽章行）+ 设置齿轮 ── */}
      <div className="rail-foot rail-account">
        <button
          className="rail-account-chip"
          title={tx('shell.sidebar.settings')}
          onClick={() => setRoute('settings')}
        >
          <span className="rail-avatar" aria-hidden>
            {(settings?.profileName ?? 'M').trim().slice(0, 1).toUpperCase()}
          </span>
          <span className="rail-account-text">
            <span className="rail-account-name truncate">{settings?.profileName ?? 'MModels'}</span>
            <span className="rail-account-sub">
              <Icon name="shield-check" size={11} />
              <span className="truncate">{t('永久 VIP · 本地版')}</span>
            </span>
          </span>
        </button>
        <button
          className="rail-icon-btn"
          title={tx('shell.sidebar.settings')}
          onClick={() => setRoute('settings')}
        >
          <Icon name="settings" size={15} />
        </button>
      </div>

      {/* ── 上下文菜单（项目行 / 会话行）与「更多…」菜单（会话区标题）── */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          testId={
            ctxMenu.kind === 'project'
              ? 'ctx-project'
              : ctxMenu.kind === 'session'
                ? 'ctx-session'
                : 'menu-sessions-more'
          }
          ariaLabel={
            ctxMenu.kind === 'project'
              ? ctxMenu.project.name
              : ctxMenu.kind === 'session'
                ? ctxMenu.session.title || tx('integrations.taskCompletion.untitledChat')
                : tx('shell.sidebar.more')
          }
          items={
            ctxMenu.kind === 'project'
              ? projectMenuItems
              : ctxMenu.kind === 'session'
                ? sessionMenuItems
                : sessionsMoreItems
          }
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* ── 侧栏提示（导出/导入结果）──
          用 fixed 定位：`.panel-toast` 是 absolute，侧栏没有定位祖先，直接用会被裁到看不见 */}
      {toast && (
        <div
          className="panel-toast"
          style={{ position: 'fixed', left: 12, bottom: 12, right: 'auto', zIndex: 60 }}
          role="status"
          data-toast="sidebar"
        >
          {toast}
        </div>
      )}
    </aside>
  );
}
