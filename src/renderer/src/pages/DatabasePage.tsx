/**
 * 数据集页 —— 本地设计 `DatabasePage`。
 *
 * 项目契约定位（`shell.databasePage.*`）：
 *   「管理绘图数据文件」/「导入 CSV/Excel 数据文件，并在会话中通过 @ 引用为绘图数据源」
 *
 * 关键交互：
 *   - 左侧列表：项目里的数据文件（CSV/TSV/XLSX…）
 *   - 右侧预览：CSV/TSV 走 `DataFilePreview` 渲染真表格
 *   - 「在会话中引用」：把 `@data/xxx.csv` 填进输入框（项目契约中的 @ 引用机制）
 */
import { useCallback, useEffect, useState } from 'react';
import { PageShell, EmptyState } from '../components/PageShell';
import { DataFilePreview } from '../components/DataFilePreview';
import { Skeleton } from '../components/Skeleton';
import { Icon } from '../components/Icon';
import { useApp } from '../store/app';
import { tx } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

interface DatasetFile {
  relPath: string;
  name: string;
  dir: string;
  ext: string;
  size: number;
  mtimeMs: number;
}

/** 能渲染成表格的类型 */
const TABLE_EXT = new Set(['.csv', '.tsv']);
/** Excel 类：当前实现不解析 xlsx（项目契约用 xlsx 库），如实提示用系统程序打开 */
const EXCEL_EXT = new Set(['.xlsx', '.xls']);

function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function DatabasePage(): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const fillPrompt = useApp((s) => s.fillPrompt);

  const [files, setFiles] = useState<DatasetFile[]>([]);
  const [active, setActive] = useState<DatasetFile | null>(null);
  const [preview, setPreview] = useState<{ text: string; truncated?: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const r = (await window.mathmodel.dataset.list()) as { files: DatasetFile[] };
      setFiles(r.files);
      setActive((prev) =>
        prev && r.files.some((f) => f.relPath === prev.relPath)
          ? (r.files.find((f) => f.relPath === prev.relPath) ?? null)
          : null,
      );
    } catch (e) {
    setError(friendlyError(e, '数据目录没有读取成功，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 选中文件 → 拉预览（只对表格类拉）
  useEffect(() => {
    setPreview(null);
    if (!active || !TABLE_EXT.has(active.ext)) return;
    let cancelled = false;
    setPreviewLoading(true);
    void (async () => {
      try {
        const p = (await window.mathmodel.file.preview(active.relPath)) as {
          kind: string;
          text?: string;
          truncated?: boolean;
        };
        if (!cancelled && p.kind === 'text') {
          setPreview({ text: p.text ?? '', truncated: p.truncated });
        }
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, '数据预览没有读取成功，可以重试。'));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  const doImport = async (): Promise<void> => {
    setImporting(true);
    try {
      const r = (await window.mathmodel.dataset.importFiles()) as {
        imported: string[];
        skipped?: string[];
        canceled: boolean;
      };
      if (r.canceled) return;
      if (r.imported.length) {
        setToast(`已导入 ${r.imported.length} 个数据文件`);
        await refresh();
      }
      if (r.skipped?.length) setToast(r.skipped.join('；'));
    } catch (e) {
      setToast(friendlyError(e, '数据操作没有完成，可以重试。'));
    } finally {
      setImporting(false);
    }
  };

  const openExternal = (rel: string): void => {
    if (!project) return;
    void window.mathmodel.app.openPath(`${project.root}\\${rel.replace(/\//g, '\\')}`);
  };

  /** 项目契约中的 @ 引用：把路径塞进输入框交给 Agent */
  const reference = (f: DatasetFile): void => {
    fillPrompt(`@${f.relPath}`);
  };

  if (!project) {
    return <EmptyState icon={<Icon name="folder-open" size={22} />} title={tx('shell.databasePage.title')} />;
  }

  return (
    <PageShell
      title={tx('shell.databasePage.title')}
      description={tx('shell.databasePage.description')}
      action={
        <>
          <span className="muted" style={{ fontSize: 11 }}>
            {files.length ? `${files.length} 个数据文件` : ''}
          </span>
          <button className="btn btn-sm" onClick={() => void refresh()} title={tx('common.refresh')}>
            {tx('common.refresh')}
          </button>
          <button className="btn btn-sm btn-primary" disabled={importing} onClick={() => void doImport()}>
            {importing ? tx('common.loading') : tx('common.import')}
          </button>
        </>
      }
    >
      <div style={{ padding: 'var(--sp-4) var(--sp-5)', height: '100%' }}>
        {error ? (
          <div className="muted" style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        ) : null}

        {loading && files.length === 0 ? (
          <div className="col" style={{ gap: 10 }}>
            <Skeleton height={56} radius="lg" />
            <Skeleton height={56} radius="lg" />
            <Skeleton height={56} radius="lg" />
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            icon={<Icon name="database" size={22} />}
            title={tx('shell.databasePage.emptyTitle')}
            description={tx('shell.databasePage.emptyDescription')}
            action={
              <button className="btn btn-sm btn-primary" disabled={importing} onClick={() => void doImport()}>
                {tx('common.import')}
              </button>
            }
            fill={false}
          />
        ) : (
          <div className="ds-split">
            {/* ── 列表 ── */}
            <div className="ds-list">
              {files.map((f) => (
                <div
                  key={f.relPath}
                  className={`ds-row${active?.relPath === f.relPath ? ' active' : ''}`}
                  onClick={() => setActive(f)}
                  role="presentation"
                >
                  <span className="ds-icon">
                    <Icon name={f.ext === '.json' ? 'braces' : 'file-spreadsheet'} size={14} />
                  </span>
                  <div className="ds-main">
                    <div className="ds-name truncate" title={f.relPath}>
                      {f.name}
                    </div>
                    <div className="ds-meta truncate">
                      {f.dir || '（根目录）'} · {humanSize(f.size)} · {fmtTime(f.mtimeMs)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* ── 预览 ── */}
            <div className="ds-preview">
              {!active ? (
                <EmptyState
                  icon={<Icon name="chart-column" size={22} />}
                  title={tx('shell.databasePage.description')}
                  description="选择左侧文件查看数据"
                />
              ) : (
                <>
                  <div className="row" style={{ padding: '8px 12px', gap: 8, flexShrink: 0 }}>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }} title={active.relPath}>
                        {active.name}
                      </div>
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                        {active.relPath} · {humanSize(active.size)}
                      </div>
                    </div>
                    <button
                      className="btn btn-sm btn-primary"
                      title={`在会话中引用 @${active.relPath}`}
                      onClick={() => reference(active)}
                    >
                      在会话中引用
                    </button>
                    <button className="btn btn-sm" onClick={() => openExternal(active.relPath)}>
                      {tx('common.open')}
                    </button>
                  </div>

                  <div className="divider" style={{ margin: 0 }} />

                  <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {previewLoading ? (
                      <div className="muted" style={{ padding: 12, fontSize: 12 }}>
                        {tx('dock.dataPreview.loading')}
                      </div>
                    ) : TABLE_EXT.has(active.ext) && preview ? (
                      <DataFilePreview text={preview.text} truncatedSource={preview.truncated} />
                    ) : EXCEL_EXT.has(active.ext) ? (
                      <div
                        className="muted"
                        style={{ padding: 16, fontSize: 12, lineHeight: 1.8 }}
                      >
                        这是一个 Excel 工作簿。本页只内联预览 CSV / TSV；
                        请点「打开」用 Excel 或 WPS 查看。
                      </div>
                    ) : (
                      <div className="muted" style={{ padding: 16, fontSize: 12 }}>
                        {tx('dock.dataPreview.empty')}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {toast ? <div className="panel-toast">{toast}</div> : null}
    </PageShell>
  );
}
