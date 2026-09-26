/**
 * 流程图面板 —— 当前实现项目契约 `DiagramsPanel`。
 *
 * 项目契约这块是**基于文件系统**的：扫描项目里的 `.drawio` 源文件，
 * 与同名导出图（PNG/PDF）配对，比较 mtime 判断「源文件比导出图新」，
 * 显示为「待导出」。点「导出并更新论文图」把一段指令填进输入框，
 * 交给 Agent 用 `paper-diagram` 技能重新导出。
 *
 * ⚠️ 缩略图**懒加载**：论文导出图动辄几百 KB，一屏 60 张全量转 base64
 *    会瞬间吃掉几十 MB。这里用 IntersectionObserver 只加载真正可见的行。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState } from './PageShell';
import { Skeleton } from './Skeleton';
import { Icon } from './Icon';
import { useApp } from '../store/app';
import { t, tx } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

interface DiagramEntry {
  relPath: string;
  name: string;
  dir: string;
  sourceMtime: number;
  pngRelPath: string | null;
  pdfRelPath: string | null;
  stale: boolean;
  size: number;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** 懒加载缩略图：进入视口才去读文件 */
function Thumb({
  relPath,
  alt,
  onOpen,
}: {
  relPath: string | null;
  alt: string;
  onOpen?: () => void;
}): JSX.Element {
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !relPath) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = (await window.mathmodel.file.preview(relPath)) as {
          kind: string;
          dataUrl?: string;
        };
        if (!cancelled && p.kind === 'image' && p.dataUrl) setSrc(p.dataUrl);
      } catch {
        /* 读不到就不显示图，不影响列表 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, relPath]);

  return (
    <button
      ref={ref}
      className="dg-thumb"
      onClick={onOpen}
      title={alt}
      style={{ cursor: onOpen ? 'zoom-in' : 'default' }}
    >
      {src ? (
        <img src={src} alt={alt} />
      ) : relPath ? (
        <Skeleton height="100%" radius="md" />
      ) : (
        <span className="dg-thumb-empty">
          <Icon name="image" size={16} />
        </span>
      )}
    </button>
  );
}

export function DiagramsPanel(): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const running = useApp(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running',
  );
  const fillPrompt = useApp((s) => s.fillPrompt);

  const [items, setItems] = useState<DiagramEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DiagramEntry | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const r = (await window.mathmodel.diagram.list()) as {
        diagrams: DiagramEntry[];
        total: number;
        truncated: boolean;
      };
      setItems(r.diagrams);
      setTotal(r.total);
      setTruncated(r.truncated);
      // 详情页跟着刷新（源文件可能刚被 Agent 改过）
      setDetail((prev) => (prev ? (r.diagrams.find((d) => d.relPath === prev.relPath) ?? null) : null));
    } catch (e) {
      setError(friendlyError(e, '图表列表没有读取成功，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Agent 干完活后重扫（可能刚画出新流程图 / 刚导出）
  useEffect(() => {
    if (running) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const openExternal = (rel: string): void => {
    if (!project) return;
    void window.mathmodel.app.openPath(`${project.root}\\${rel.replace(/\//g, '\\')}`);
  };

  /** 把项目契约的导出指令填进输入框，交给 Agent 执行 */
  const askExport = (d: DiagramEntry): void => {
    fillPrompt(tx('dock.diagramsPanel.exportPrompt', { path: d.relPath }));
  };

  if (!project)
    return <EmptyState icon={<Icon name="folder-open" size={22} />} title={tx('extensions.extensionsPage.title')} />;

  if (loading && items.length === 0 && !error) {
    return (
      <div className="col" style={{ padding: 12, gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {tx('dock.diagramsPanel.scanning')}
        </span>
        <Skeleton height={56} radius="lg" />
        <Skeleton height={56} radius="lg" />
        <Skeleton height={56} radius="lg" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Icon name="circle-alert" size={22} />}
        title={tx('dock.versionPanel.loadFailedTitle')}
        description={error}
        action={
          <button className="btn btn-sm" onClick={() => void refresh()}>
            {tx('common.retry')}
          </button>
        }
      />
    );
  }

  // ── 详情视图 ──
  if (detail) {
    return (
      <div className="col" style={{ height: '100%', minHeight: 0 }}>
        <div className="row" style={{ padding: '6px 10px', gap: 6, flexShrink: 0 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setDetail(null)}>
            ‹ {tx('dock.diagramsPanel.backToList')}
          </button>
          <span className="grow truncate" style={{ fontSize: 11, fontWeight: 600 }} title={detail.relPath}>
            {detail.name}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={() => void refresh()} title={tx('common.refresh')}>
            ⟳
          </button>
        </div>

        <div className="divider" style={{ margin: 0 }} />

        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 10 }}>
          <Thumb relPath={detail.pngRelPath} alt={detail.name} />

          <div className="col" style={{ gap: 4, marginTop: 10, fontSize: 11, lineHeight: 1.7 }}>
            <div className="muted truncate" title={detail.relPath}>
              {detail.relPath}
            </div>
            <div className="muted">
              {fmtTime(detail.sourceMtime)} · {humanSize(detail.size)}
            </div>
            {detail.stale ? (
              <div className="dg-stale-hint">
                <Icon
                  name="triangle-alert"
                  size={11}
                  style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 4 }}
                />
                {tx('dock.diagramsPanel.staleHint')}
              </div>
            ) : null}
          </div>

          <div className="col" style={{ gap: 6, marginTop: 12 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={running}
              title={running ? tx('dock.diagramsPanel.exportBusy') : tx('dock.diagramsPanel.exportFigure')}
              onClick={() => askExport(detail)}
            >
              {running ? tx('dock.diagramsPanel.exportBusy') : tx('dock.diagramsPanel.exportFigure')}
            </button>
            <button
              className="btn btn-sm"
              disabled={!detail.pngRelPath}
              onClick={() => detail.pngRelPath && openExternal(detail.pngRelPath)}
            >
              {tx('dock.diagramsPanel.openExport')}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => openExternal(detail.relPath)}>
              {tx('common.open')} .drawio
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 空态 ──
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="images" size={22} />}
        title={tx('dock.diagramsPanel.emptyTitle')}
        description={tx('dock.diagramsPanel.emptyDescription')}
        action={
          <button className="btn btn-sm" onClick={() => void refresh()}>
            {tx('common.refresh')}
          </button>
        }
      />
    );
  }

  // ── 列表视图 ──
  return (
    <div className="col" style={{ height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 10px', gap: 6, flexShrink: 0 }}>
        <span className="grow" style={{ fontSize: 11, fontWeight: 600 }}>
          {tx('dock.diagramsPanel.count', { count: total })}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => void refresh()} title={tx('common.refresh')}>
          ⟳
        </button>
      </div>

      <div className="divider" style={{ margin: 0 }} />

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {items.map((d) => (
          <div key={d.relPath} className="dg-row">
            <Thumb relPath={d.pngRelPath} alt={d.name} onOpen={() => setDetail(d)} />
            <div className="dg-main" onClick={() => setDetail(d)} role="presentation">
              <div className="dg-name truncate" title={d.relPath}>
                {d.name}
                {d.stale ? <span className="dg-badge">{tx('dock.diagramsPanel.stale')}</span> : null}
              </div>
              <div className="dg-meta truncate">
                {d.dir || t('（根目录）')} · {fmtTime(d.sourceMtime)}
              </div>
            </div>
          </div>
        ))}

        {truncated ? (
          <div className="muted" style={{ padding: '8px 10px', fontSize: 10.5, lineHeight: 1.6 }}>
            {tx('dock.diagramsPanel.truncated')}
          </div>
        ) : null}
      </div>
    </div>
  );
}
