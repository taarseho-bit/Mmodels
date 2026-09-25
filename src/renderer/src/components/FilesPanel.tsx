/**
 * 文件面板 —— 「文件」标签的完整内容（对齐原版 `dock.filesPanel.*` + `dock.fileViewer.*`）。
 *
 * 原版这个标签不是"一棵树"就完了，它是**面包屑 + 筛选 + 文件树 + 文件查看器**四件套：
 *   · 面包屑      —— 当前打开文件在项目里的位置（根是 `/`）
 *   · 筛选文件…   —— 过滤文件树（`explorerPanel.filterPlaceholder` / `noMatchingFiles`）
 *   · 文件树      —— 可隐藏（`filesPanel.hideFileTree` / `showFileTree`）
 *   · 查看器      —— `查看源码 ↔ 预览`（`viewSource` / `viewRendered`）、`编译 PDF`
 *                    （`compilePdf` / `compileFile` / `compilingPdf` / `compileBusy` / `compilePrompt`），
 *                    没选文件时是空态「打开文件 / 从工作区目录树中选择文件」
 *                    （`fileViewer.emptyTitle` / `emptyDescription`）
 *
 * 打开文件的行为：**在本标签内联打开**（原版右栏没有独立的「产物」标签）。
 * 源码态复用 `ArtifactPanes`（可编辑 + 保存 + 冲突检测），预览态用 `Markdown`
 * 渲染 .md——这正是原版「查看源码 ↔ 预览」这对开关的含义。
 *
 * Props 供「编辑器视图」复用（默认值 = 现有行为，不改变任何默认表现）。
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { FileNode } from '@shared/types';
import { useApp } from '../store/app';
import { t, tx } from '../i18n';
import { EmptyState } from './PageShell';
import { ArtifactPanes } from './ArtifactPanes';
import { Markdown } from './Markdown';
import { Icon } from './Icon';
import { ResizeHandle } from './ResizeHandle';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { friendlyError } from '../lib/friendly-error';

export interface FilesPanelProps {
  /** 接管"打开文件"（编辑器视图可改为在自己的编辑区打开）；默认走 store 的 `openArtifact` */
  onOpenFile?: (relPath: string) => void;
  /** 只渲染面包屑 + 筛选 + 文件树（编辑器视图自带查看器时用） */
  treeOnly?: boolean;
  /** 初始是否显示文件树（默认显示） */
  defaultTreeVisible?: boolean;
  className?: string;
}

/** 这些后缀按 Markdown 渲染，「预览」态才有意义 */
const MD_EXT = /\.(md|markdown|mdx)$/i;
/** 这些后缀可以「编译 PDF」（其余交给 agent 判断，此处只做按钮显隐） */
const TEX_EXT = /\.(tex|latex)$/i;

function extOf(p: string): string {
  return p.split('.').pop()?.toLowerCase() ?? '';
}

/** 扩展名 → 图标名（图标名须存在于 `components/icons/lucide-data.ts`） */
function iconFor(node: FileNode): string {
  if (node.isDirectory) return 'folder';
  const ext = extOf(node.name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'file-image';
  if (ext === 'pdf') return 'book-open';
  if (['tex', 'typ'].includes(ext)) return 'sigma';
  if (['py', 'r', 'm', 'jl'].includes(ext)) return 'terminal';
  if (['md', 'txt'].includes(ext)) return 'file-text';
  if (['csv', 'xlsx', 'xls', 'tsv'].includes(ext)) return 'file-spreadsheet';
  if (['json', 'yml', 'yaml', 'toml'].includes(ext)) return 'braces';
  if (['js', 'ts', 'tsx', 'jsx'].includes(ext)) return 'file-code-corner';
  if (['docx', 'doc'].includes(ext)) return 'scroll-text';
  return 'file';
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 按关键字过滤文件树：命中目录名就整棵保留，命中文件就保留它的父链 */
function filterTree(nodes: FileNode[], kw: string): FileNode[] {
  const q = kw.trim().toLowerCase();
  if (!q) return nodes;
  const walk = (list: FileNode[]): FileNode[] => {
    const out: FileNode[] = [];
    for (const n of list) {
      if (n.isDirectory) {
        const kids = walk(n.children ?? []);
        if (kids.length > 0 || n.name.toLowerCase().includes(q)) {
          out.push({ ...n, children: kids.length > 0 ? kids : (n.children ?? []) });
        }
      } else if (n.name.toLowerCase().includes(q) || n.relPath.toLowerCase().includes(q)) {
        out.push(n);
      }
    }
    return out;
  };
  return walk(nodes);
}

/** 过滤态下把所有目录都展开，否则命中的深层文件看不见 */
function dirPaths(nodes: FileNode[], into: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.isDirectory) {
      into.add(n.relPath);
      dirPaths(n.children ?? [], into);
    }
  }
  return into;
}

interface TreeRowProps {
  node: FileNode;
  depth: number;
  expanded: Set<string>;
  toggle: (relPath: string) => void;
  selected: string | null;
  onSelect: (node: FileNode) => void;
  onOpenExternal: (node: FileNode) => void;
  onReveal: (node: FileNode) => void;
  /** 右键：把命中的行与视口坐标交给面板（菜单项由面板统一组装） */
  onContext: (e: ReactMouseEvent, node: FileNode) => void;
}

function TreeRow({
  node,
  depth,
  expanded,
  toggle,
  selected,
  onSelect,
  onOpenExternal,
  onReveal,
  onContext,
}: TreeRowProps): JSX.Element {
  const isOpen = expanded.has(node.relPath);
  const isSelected = selected === node.relPath;

  return (
    <>
      <div
        className={`file-row${isSelected ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (node.isDirectory ? toggle(node.relPath) : onSelect(node))}
        onDoubleClick={() => !node.isDirectory && onOpenExternal(node)}
        onContextMenu={(e) => onContext(e, node)}
        title={node.relPath}
      >
        <span className="file-row-icon">
          {node.isDirectory ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className="file-row-icon">
          <Icon name={iconFor(node)} size={13} />
        </span>
        <span className="file-row-name">{node.name}</span>
        {!node.isDirectory && (
          <span className="muted" style={{ fontSize: 10 }}>
            {humanSize(node.size)}
          </span>
        )}

        {/*
          hover 才出现的两个入口 —— 文件与目录都给这两个，语义不混用：
            · 打开            → openPath（文件交给系统默认程序；目录直接在资源管理器里打开）
            · 在文件夹中显示   → showItemInFolder（在父目录里把它选中）
          双击事件是单独派发的，click 上的 stopPropagation 拦不住，这里要再拦一道。
        */}
        <span className="file-row-actions" onDoubleClick={(e) => e.stopPropagation()}>
          <button
            className="file-row-x"
            title={tx('common.open')}
            aria-label={tx('common.open')}
            onClick={(e) => {
              e.stopPropagation();
              onOpenExternal(node);
            }}
          >
            <Icon name="external-link" size={12} />
          </button>
          <button
            className="file-row-x"
            title={tx('dock.explorerPanel.revealInFolder')}
            aria-label={tx('dock.explorerPanel.revealInFolder')}
            onClick={(e) => {
              e.stopPropagation();
              onReveal(node);
            }}
          >
            <Icon name="folder-open" size={12} />
          </button>
        </span>
      </div>

      {node.isDirectory &&
        isOpen &&
        node.children?.map((c) => (
          <TreeRow
            key={c.relPath}
            node={c}
            depth={depth + 1}
            expanded={expanded}
            toggle={toggle}
            selected={selected}
            onSelect={onSelect}
            onOpenExternal={onOpenExternal}
            onReveal={onReveal}
            onContext={onContext}
          />
        ))}
    </>
  );
}

export function FilesPanel({
  onOpenFile,
  treeOnly = false,
  defaultTreeVisible = true,
  className,
}: FilesPanelProps = {}): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const openArtifact = useApp((s) => s.openArtifact);
  const activeArtifact = useApp((s) => s.activeArtifact);
  const fillPrompt = useApp((s) => s.fillPrompt);
  /** 原版「Agent 正在工作，结束后即可编译」——沿用右栏其他面板判断 agent 忙的方式 */
  const running = useApp(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running',
  );

  const [tree, setTree] = useState<FileNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 筛选关键字（对应原版「筛选文件…」） */
  const [q, setQ] = useState('');
  /** 文件树是否显示（对应原版 隐藏/显示文件树）；`treeOnly` 时恒显示 */
  const [treeVisible, setTreeVisible] = useState(defaultTreeVisible);
  /** 查看器形态：预览（渲染后的 Markdown） / 源码（可编辑文本） */
  const [rendered, setRendered] = useState(true);

  /** 预览态自己要读一次文本（源码态由 ArtifactPanes 自己读） */
  const [mdText, setMdText] = useState('');
  const [mdTruncated, setMdTruncated] = useState(false);
  const [mdLoading, setMdLoading] = useState(false);
  const [mdError, setMdError] = useState<string | null>(null);

  /**
   * 右键上下文菜单的目标。
   *   · `kind: 'file'`   —— 命中的是文件（删除确认用 `deleteFileTitle` / `deleteFileBody`）
   *   · `kind: 'folder'` —— 命中的是目录（用 `deleteFolderTitle` / `deleteFolderBody`）
   * **文件与目录用两套文案键**：目录的正文要额外说清"及其全部内容"，否则用户不知道会连带删掉什么。
   */
  const [ctxNode, setCtxNode] = useState<
    { kind: 'file' | 'folder'; x: number; y: number; node: FileNode } | null
  >(null);
  /** 删除的二次确认目标（null = 关闭）。**删除不可撤销，必须二次确认** */
  const [delTarget, setDelTarget] = useState<FileNode | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  /** 重命名的目标与草稿值 */
  const [renTarget, setRenTarget] = useState<FileNode | null>(null);
  const [renDraft, setRenDraft] = useState('');
  const [renBusy, setRenBusy] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState(false);

  const copyText = useCallback((text: string): void => {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }, []);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      setTree(await window.mathmodel.file.tree());
    } catch (e) {
      setError(friendlyError(e, '文件读取没有完成，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const relPath = activeArtifact;
  const isMd = relPath ? MD_EXT.test(relPath) : false;
  const isTex = relPath ? TEX_EXT.test(relPath) : false;
  const showRendered = isMd && rendered;

  // 换文件后回到默认态：.md 先给「预览」，其余直接「源码」
  useEffect(() => {
    setRendered(true);
  }, [relPath]);

  useEffect(() => {
    if (!relPath || !showRendered || treeOnly) return;
    let cancelled = false;
    setMdLoading(true);
    setMdError(null);
    void window.mathmodel.file
      .preview(relPath)
      .then((p) => {
        if (cancelled) return;
        if (p.kind === 'text') {
          setMdText(p.text ?? '');
          setMdTruncated(p.truncated === true);
        } else {
          setMdText('');
          setMdTruncated(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setMdError(friendlyError(e, '预览没有生成成功，可以重试。'));
      })
      .finally(() => {
        if (!cancelled) setMdLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [relPath, showRendered, treeOnly]);

  const toggle = (p: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const openFile = useCallback(
    (node: FileNode): void => {
      setSelected(node.relPath);
      // 本标签内联打开（编辑器视图可接管这个动作）
      if (onOpenFile) onOpenFile(node.relPath);
      else openArtifact(node.relPath);
    },
    [onOpenFile, openArtifact],
  );

  /** 项目根 + POSIX 相对路径 → 本机绝对路径（原版在 Windows 上就是这种拼接方式） */
  const absOf = (p: string): string =>
    project ? `${project.root}\\${p.replace(/\//g, '\\')}` : p;

  /** 打开：文件交给系统默认程序；目录直接在资源管理器里打开 */
  const onOpenExternal = (node: FileNode): void => {
    if (!project) return;
    void window.mathmodel.app.openPath(absOf(node.relPath));
  };

  /** 在文件夹中显示：在父目录里把这个文件/目录选中（与「打开」是两件事，不混用） */
  const onReveal = (node: FileNode): void => {
    if (!project) return;
    void window.mathmodel.app.showItemInFolder(absOf(node.relPath));
  };

  /**
   * 右键：记住命中的行与坐标。
   * `node.isDirectory` 决定菜单的两套文案键（见 `ctxNode.kind`）——
   * **不在渲染时现算**，否则菜单开着的时候树刷新会让文案跳变。
   */
  const onContext = useCallback((e: ReactMouseEvent, node: FileNode): void => {
    e.preventDefault();
    e.stopPropagation();
    setCtxNode({
      kind: node.isDirectory ? 'folder' : 'file',
      x: e.clientX,
      y: e.clientY,
      node,
    });
  }, []);

  /** 删除（确认之后才走这里）—— `file:delete` 通道，逐条失败都给用户看，不静默 */
  const doDelete = useCallback(async (): Promise<void> => {
    const target = delTarget;
    if (!target) return;
    setDelBusy(true);
    try {
      const ok = await window.mathmodel.file.remove(target.relPath);
      if (!ok) {
        setError(tx('dock.explorerPanel.deleteFailed'));
        return;
      }
      // 删掉的正好是查看器里打开的那份 → 回到空态，别留一个指向不存在文件的标题
      if (activeArtifact === target.relPath) openArtifact(null);
      setDelTarget(null);
      await refresh();
    } catch (e) {
      setError(friendlyError(e, '文件保存没有完成，内容已保留。'));
    } finally {
      setDelBusy(false);
    }
  }, [delTarget, activeArtifact, openArtifact, refresh]);

  /** 重命名（同一父目录内改名）—— `file:rename` 通道 */
  const doRename = useCallback(async (): Promise<void> => {
    const target = renTarget;
    if (!target) return;
    const next = renDraft.trim();
    // 空名字 / 没改 —— 直接关，不报错（用户按 Esc 或原样确认都算取消）
    if (!next || next === target.name) {
      setRenTarget(null);
      return;
    }
    // 纯改名：换掉最后一段，父目录不动（不引入"移动到别处"这个语义）
    const slash = target.relPath.lastIndexOf('/');
    const parent = slash >= 0 ? target.relPath.slice(0, slash) : '';
    const to = parent ? `${parent}/${next}` : next;
    setRenBusy(true);
    try {
      const ok = await window.mathmodel.file.rename(target.relPath, to);
      if (!ok) {
        setError(tx('dock.explorerPanel.renameFailed'));
        return;
      }
      // 查看器正开着它 → 跟着换到新路径，否则会读一个旧名字
      if (activeArtifact === target.relPath) openArtifact(to);
      setRenTarget(null);
      await refresh();
    } catch (e) {
        setError(friendlyError(e, '文件操作没有完成，可以重试。'));
    } finally {
      setRenBusy(false);
    }
  }, [renTarget, renDraft, activeArtifact, openArtifact, refresh]);

  const doDuplicate = useCallback(async (node: FileNode): Promise<void> => {
    setDuplicateBusy(true);
    try {
      const result = await window.mathmodel.file.duplicate(node.relPath);
      if (result) {
        setError(null);
        setNotice(tx('dock.explorerPanel.duplicatedAs', { name: result.name }));
        await refresh();
      }
    } catch (e) {
      setError(friendlyError(e, 'PDF 编译没有完成，可以重试。'));
    } finally {
      setDuplicateBusy(false);
    }
  }, [refresh]);

  /**
   * 菜单项 —— 文件与目录**同一套项**，差别只在删除确认的两套文案键（见 `ctxNode.kind`）。
   * 顺序照原版：`copyPath / copyName / revealInFolder / ─ / rename / ─ / delete`。
   * 创建副本走主进程 `fs.cpSync`，保留二进制内容并对目录递归复制。
   */
  const ctxItems: ContextMenuItem[] = ctxNode
    ? [
        {
          label: tx('dock.explorerPanel.copyPath'),
          icon: 'clipboard-list',
          onSelect: () => copyText(absOf(ctxNode.node.relPath)),
        },
        {
          label: tx('dock.explorerPanel.copyName'),
          icon: 'copy',
          onSelect: () => copyText(ctxNode.node.name),
        },
        {
          label: tx('dock.explorerPanel.revealInFolder'),
          icon: 'folder-open',
          onSelect: () => onReveal(ctxNode.node),
        },
        {
          label: tx('dock.explorerPanel.duplicate'),
          icon: 'copy-plus',
          disabled: duplicateBusy,
          onSelect: () => void doDuplicate(ctxNode.node),
        },
        {
          label: tx('dock.explorerPanel.rename'),
          icon: 'pencil',
          divider: true,
          onSelect: () => {
            setRenTarget(ctxNode.node);
            setRenDraft(ctxNode.node.name);
          },
        },
        {
          label: tx('dock.explorerPanel.delete'),
          icon: 'trash-2',
          danger: true,
          divider: true,
          onSelect: () => setDelTarget(ctxNode.node),
        },
      ]
    : [];

  const filtered = useMemo(() => filterTree(tree, q), [tree, q]);
  const filtering = q.trim().length > 0;
  const effectiveExpanded = useMemo(
    () => (filtering ? dirPaths(filtered) : expanded),
    [filtering, filtered, expanded],
  );

  /** 面包屑：根 `/` + 路径各段 */
  const crumbs = relPath ? relPath.split('/').filter(Boolean) : [];
  const fileName = crumbs.length ? crumbs[crumbs.length - 1] : '';

  const compile = (): void => {
    if (!relPath) return;
    // 原版「编译 PDF」= 把编译指令交给 agent（`filesPanel.compilePrompt`）
    fillPrompt(tx('dock.filesPanel.compilePrompt', { path: relPath }));
  };

  return (
    <div className={`fp${className ? ` ${className}` : ''}`}>
      {/* ── 面包屑 ── */}
      <div className="fp-crumbs" title={relPath ?? '/'}>
        <span className="fp-crumb-root">/</span>
        {crumbs.map((seg, i) => (
          <span key={`${seg}-${i}`} className="fp-crumb">
            {seg}
            {i < crumbs.length - 1 ? <span className="fp-crumb-sep">/</span> : null}
          </span>
        ))}
      </div>

      {/* ── 工具栏：筛选 + 刷新 + 隐藏/显示文件树 ── */}
      <div className="fp-tools">
        <input
          className="input fp-filter"
          placeholder={tx('dock.explorerPanel.filterPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="btn btn-sm btn-ghost"
          title={tx('common.refresh')}
          aria-label={tx('common.refresh')}
          onClick={() => void refresh()}
        >
          <Icon name="refresh-cw" size={13} />
        </button>
        {!treeOnly && (
          <button
            className="btn btn-sm btn-ghost"
            title={
              treeVisible ? tx('dock.filesPanel.hideFileTree') : tx('dock.filesPanel.showFileTree')
            }
            aria-label={
              treeVisible ? tx('dock.filesPanel.hideFileTree') : tx('dock.filesPanel.showFileTree')
            }
            onClick={() => setTreeVisible((v) => !v)}
          >
            <Icon name={treeVisible ? 'panel-left-close' : 'panel-left'} size={13} />
          </button>
        )}
      </div>

      {/* ── 文件树 ── */}
      {(treeVisible || treeOnly) && (
        <div className={`fp-tree-region${treeOnly ? ' tree-only' : ''}`}>
        {!treeOnly && <ResizeHandle storageKey="mm-file-tree-height" label="调整文件列表高度" edge="bottom" initial={200} min={72} max={600} fraction={.65} optional />}
        <div className="fp-tree">
          {error && <div className="fp-note danger">{error}</div>}
          {notice && <div className="fp-note success">{notice}</div>}

          {loading && tree.length === 0 && <div className="fp-note">{t('读取中…')}</div>}

          {!loading && tree.length === 0 && !error && (
            <div className="fp-note">
              {t('项目目录还是空的。')}
              <br />
              {t('和 agent 聊一次，产物就会出现。')}
            </div>
          )}

          {tree.length > 0 && filtered.length === 0 && (
            <div className="fp-note">{tx('dock.explorerPanel.noMatchingFiles')}</div>
          )}

          {filtered.map((n) => (
            <TreeRow
              key={n.relPath}
              node={n}
              depth={0}
              expanded={effectiveExpanded}
              toggle={toggle}
              selected={selected}
              onSelect={openFile}
              onOpenExternal={onOpenExternal}
              onReveal={onReveal}
              onContext={onContext}
            />
          ))}
        </div>
        </div>
      )}

      {/* ── 查看区（编辑器视图自带查看器时整块不渲染）── */}
      {!treeOnly && (
        <div className="fp-viewer">
          {relPath ? (
            <>
              <div className="fp-filebar">
                <Icon name="file-code-corner" size={13} />
                <span className="fp-filename truncate" title={relPath}>
                  {fileName}
                </span>

                {isMd && (
                  <div className="fp-seg">
                    <button
                      className={showRendered ? 'active' : ''}
                      onClick={() => setRendered(true)}
                    >
                      {tx('dock.filesPanel.viewRendered')}
                    </button>
                    <button
                      className={!showRendered ? 'active' : ''}
                      onClick={() => setRendered(false)}
                    >
                      {tx('dock.filesPanel.viewSource')}
                    </button>
                  </div>
                )}

                <div className="grow" />

                {/* 详情区产物入口：打开（系统默认程序）/ 在文件夹中显示 */}
                <button
                  className="btn btn-sm btn-ghost"
                  title={tx('common.open')}
                  aria-label={tx('common.open')}
                  onClick={() => void window.mathmodel.app.openPath(absOf(relPath))}
                >
                  <Icon name="external-link" size={13} />
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  title={tx('dock.explorerPanel.revealInFolder')}
                  aria-label={tx('dock.explorerPanel.revealInFolder')}
                  onClick={() => void window.mathmodel.app.showItemInFolder(absOf(relPath))}
                >
                  <Icon name="folder-open" size={13} />
                </button>

                {isTex && (
                  <button
                    className="btn btn-sm"
                    disabled={running}
                    title={
                      running
                        ? tx('dock.filesPanel.compileBusy')
                        : tx('dock.filesPanel.compileFile', { name: fileName })
                    }
                    onClick={compile}
                  >
                    {running ? tx('dock.filesPanel.compilingPdf') : tx('dock.filesPanel.compilePdf')}
                  </button>
                )}

                <button
                  className="btn btn-sm btn-ghost"
                  title={tx('common.close')}
                  onClick={() => openArtifact(null)}
                >
                  <Icon name="x" size={13} />
                </button>
              </div>

              <div className="fp-body">
                {showRendered ? (
                  mdError ? (
                    <EmptyState
                      icon={<Icon name="file-x-corner" size={22} />}
                      title={tx('dock.fileViewer.fileReadFailed')}
                      description={mdError}
                      action={
                        <button className="btn btn-sm" onClick={() => setRendered(false)}>
                          {tx('dock.filesPanel.viewSource')}
                        </button>
                      }
                    />
                  ) : mdLoading ? (
                    <div className="fp-note">{tx('dock.fileViewer.readingFile')}</div>
                  ) : (
                    <div className="fp-md">
                      {mdTruncated ? (
                        <div className="fp-note">{tx('dock.fileViewer.truncated')}</div>
                      ) : null}
                      <Markdown source={mdText} />
                    </div>
                  )
                ) : (
                  // 源码态：可编辑 + 保存 + 冲突检测（原版 `dock.fileEditor.*`）
                  <ArtifactPanes relPath={relPath} />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<Icon name="file-text" size={22} />}
              title={tx('dock.fileViewer.emptyTitle')}
              description={tx('dock.fileViewer.emptyDescription')}
            />
          )}
        </div>
      )}

      {/*
        ── 文件树的右键菜单 ──
        `data-ctx` 用**新取值** `ctx-filetree`：既有的 `ctx-project` / `ctx-session` /
        `menu-sessions-more` 一个都不改（验收有判据钉着它们）。
      */}
      {ctxNode && (
        <ContextMenu
          x={ctxNode.x}
          y={ctxNode.y}
          testId="ctx-filetree"
          ariaLabel={ctxNode.node.relPath}
          items={ctxItems}
          onClose={() => setCtxNode(null)}
        />
      )}

      {/*
        ── 删除的二次确认 ──
        **文件与目录用两套文案键**（`deleteFileTitle|Body` / `deleteFolderTitle|Body`）；
        确认按钮用 `common.delete`、取消用 `common.cancel`（与原版逐字一致）。
      */}
      <ConfirmDialog
        open={delTarget !== null}
        title={
          delTarget?.isDirectory
            ? tx('dock.explorerPanel.deleteFolderTitle')
            : tx('dock.explorerPanel.deleteFileTitle')
        }
        description={
          delTarget
            ? delTarget.isDirectory
              ? tx('dock.explorerPanel.deleteFolderBody', { name: delTarget.name })
              : tx('dock.explorerPanel.deleteFileBody', { name: delTarget.name })
            : undefined
        }
        confirmLabel={tx('common.delete')}
        cancelLabel={tx('common.cancel')}
        busy={delBusy}
        busyLabel={tx('dock.explorerPanel.deleting')}
        onConfirm={() => void doDelete()}
        onCancel={() => setDelTarget(null)}
      />

      {/* ── 重命名（同一父目录内改名）── */}
      {renTarget && (
        <div className="modal-backdrop" role="presentation" onClick={() => setRenTarget(null)}>
          <div
            className="modal confirm-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <span className="modal-title">{tx('dock.explorerPanel.renameTitle')}</span>
            </div>
            <div className="modal-body col" style={{ gap: 10 }}>
              <p className="confirm-dialog-desc">
                {renTarget.isDirectory
                  ? tx('dock.explorerPanel.renameFolderLabel', { name: renTarget.name })
                  : tx('dock.explorerPanel.renameFileLabel', { name: renTarget.name })}
              </p>
              <input
                className="input"
                autoFocus
                value={renDraft}
                onChange={(e) => setRenDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doRename();
                  if (e.key === 'Escape') setRenTarget(null);
                }}
              />
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-sm btn-ghost"
                disabled={renBusy}
                onClick={() => setRenTarget(null)}
              >
                {tx('common.cancel')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={renBusy}
                onClick={() => void doRename()}
              >
                {renBusy ? tx('dock.explorerPanel.saving') : tx('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
