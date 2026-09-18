/**
 * 产物面板 —— 复刻原版 `ArtifactPanes`：**可编辑的产物查看器**。
 *
 * 原版这块不只是「看一眼」：
 *   - 文本产物可**直接编辑并保存**（⌘S / Ctrl+S）
 *   - 保存前检测**磁盘是否被外部改过**（Agent 或编辑器），冲突时让用户选
 *   - 二进制 / 过大 / 不存在的文件有明确的状态提示，不是空白
 *   - 图片、PDF、表格委托给专用预览组件
 *
 * 文案逐字取自 `dock.fileEditor.*`。
 *
 * ⚠️ 与原版的差异：原版面板内还有「协作中 · 实时同步」横幅，
 *    那是协作模块的能力，本复刻未实现协作，故不显示该横幅（不造假状态）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilePreview } from '@shared/types';
import { EmptyState } from './PageShell';
import { Skeleton } from './Skeleton';
import { DataFilePreview } from './DataFilePreview';
import { PdfFilePreview } from './PdfFilePreview';
import { Icon } from './Icon';
import { useApp } from '../store/app';
import { t, tx } from '../i18n';

/** 这些扩展名按表格渲染，而不是当纯文本 */
const TABLE_EXT = new Set(['csv', 'tsv']);
const extOf = (p: string): string => p.split('.').pop()?.toLowerCase() ?? '';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export interface ArtifactPanesProps {
  /** 要打开的产物（相对项目根路径） */
  relPath: string | null;
  /** 关闭当前产物 */
  onClose?: () => void;
}

export function ArtifactPanes({ relPath, onClose }: ArtifactPanesProps): JSX.Element {
  const project = useApp((s) => s.currentProject);

  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 音视频加载/解码失败 —— 文件被移动或编码不受支持（对应原版两条文案） */
  const [mediaFailed, setMediaFailed] = useState(false);

  /** 编辑缓冲（与磁盘内容分离，才能做冲突检测） */
  const [draft, setDraft] = useState('');
  const dirty = preview?.kind === 'text' && draft !== (preview.text ?? '');

  const [saveState, setSaveState] = useState<SaveState>('idle');
  /** 磁盘上被外部改过 */
  const [diskChanged, setDiskChanged] = useState(false);
  /** 冲突弹层 */
  const [conflict, setConflict] = useState(false);

  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(
    async (path: string): Promise<void> => {
      setLoading(true);
      setError(null);
      setNotFound(false);
      setDiskChanged(false);
      setConflict(false);
      setMediaFailed(false);
      try {
        const p = (await window.mathmodel.file.preview(path)) as FilePreview;
        setPreview(p);
        setDraft(p.kind === 'text' ? (p.text ?? '') : '');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        // 主进程对不存在的文件会抛「找不到」一类的错 —— 单独给友好态
        if (/不存在|ENOENT|not found/i.test(msg)) setNotFound(true);
        else setError(msg);
        setPreview(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!relPath) {
      setPreview(null);
      setDraft('');
      return;
    }
    void load(relPath);
  }, [relPath, load]);

  const openExternal = useCallback(
    (path: string): void => {
      if (!project) return;
      void window.mathmodel.app.openPath(`${project.root}\\${path.replace(/\//g, '\\')}`);
    },
    [project],
  );

  /**
   * 检查磁盘是否被改过。
   * 用预览时拿到的 mtime 与当前 mtime 比对 —— 只在保存前查，
   * 不做定时轮询（轮询会在大项目里反复读盘）。
   */
  const checkDiskChanged = useCallback(async (): Promise<boolean> => {
    if (!relPath || !preview?.mtimeMs) return false;
    try {
      const now = (await window.mathmodel.file.preview(relPath)) as FilePreview;
      return typeof now.mtimeMs === 'number' && now.mtimeMs !== preview.mtimeMs;
    } catch {
      return false;
    }
  }, [relPath, preview]);

  const doSave = useCallback(
    async (force = false): Promise<void> => {
      if (!relPath || preview?.kind !== 'text') return;

      // 不可编辑（截断过的文本不覆盖原文件，避免把大半内容写回去）
      if (preview.truncated) return;

      if (!force) {
        const changed = await checkDiskChanged();
        if (changed) {
          setDiskChanged(true);
          setConflict(true);
          return;
        }
      }

      setSaveState('saving');
      try {
        await window.mathmodel.file.write(relPath, draft);
        setSaveState('saved');
        setConflict(false);
        setDiskChanged(false);
        // 重新读一次，让基线 mtime 与内容跟上磁盘
        const p = (await window.mathmodel.file.preview(relPath)) as FilePreview;
        setPreview(p);
        setTimeout(() => setSaveState('idle'), 1600);
      } catch {
        setSaveState('failed');
      }
    },
    [relPath, preview, draft, checkDiskChanged],
  );

  /** ⌘S / Ctrl+S 保存 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty) void doSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, doSave]);

  const readOnly = preview?.kind === 'text' && preview.truncated === true;
  const isTable = preview?.kind === 'text' && TABLE_EXT.has(extOf(preview.relPath));

  // ── 空态：没选产物 ──
  if (!relPath) {
    return (
      <EmptyState
        icon={<Icon name="box" size={22} />}
        title={t('产物面板')}
        description={t('在左侧文件树里点一个产物即可查看；文本产物可以直接编辑并保存。')}
      />
    );
  }

  if (loading && !preview) {
    return (
      <div className="col" style={{ padding: 12, gap: 8 }}>
        <Skeleton height={24} radius="md" />
        <Skeleton height={12} />
        <Skeleton height={12} width="88%" />
        <Skeleton height={12} width="72%" />
      </div>
    );
  }

  if (notFound) {
    return (
      <EmptyState
        icon={<Icon name="file-x-corner" size={22} />}
        title={t('产物不存在')}
        description={tx('dock.dataPreview.fileNotFound')}
        action={
          <button className="btn btn-sm" onClick={() => void load(relPath)}>
            {tx('common.retry')}
          </button>
        }
      />
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={<Icon name="circle-alert" size={22} />}
        title={tx('dock.versionPanel.loadFailedTitle')}
        description={error}
        action={
          <button className="btn btn-sm" onClick={() => void load(relPath)}>
            {tx('common.retry')}
          </button>
        }
      />
    );
  }

  if (!preview) {
    return <EmptyState icon={<Icon name="box" size={22} />} title={t('产物面板')} />;
  }

  return (
    <div className="ap">
      {/* ── 头部：路径 + 状态 + 操作 ── */}
      <div className="ap-head">
        <Icon name="file-code-corner" size={13} />
        <span className="ap-path truncate" title={preview.relPath}>
          {preview.relPath}
        </span>

        {dirty ? (
          <span className="ap-dot unsaved" title={tx('dock.fileEditor.unsaved')} />
        ) : saveState === 'saved' ? (
          <span className="muted" style={{ fontSize: 10.5 }}>
            {tx('dock.fileEditor.saved')}
          </span>
        ) : null}

        {readOnly ? <span className="ap-badge">{tx('dock.fileEditor.readOnly')}</span> : null}

        <div className="grow" />

        {preview.kind === 'text' && !readOnly && !isTable ? (
          <button
            className="btn btn-sm"
            disabled={!dirty || saveState === 'saving'}
            title={tx('dock.fileEditor.saveShortcut')}
            onClick={() => void doSave()}
          >
            {saveState === 'saving' ? tx('common.loading') : tx('dock.fileEditor.save')}
          </button>
        ) : null}

        <button
          className="btn btn-sm btn-ghost"
          title={tx('dock.fileEditor.openReferencedFile')}
          onClick={() => openExternal(preview.relPath)}
        >
          <Icon name="external-link" size={13} />
        </button>

        {onClose ? (
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            <Icon name="x" size={13} />
          </button>
        ) : null}
      </div>

      {saveState === 'failed' ? (
        <div className="ap-note danger">{tx('dock.fileEditor.saveFailed')}</div>
      ) : null}

      {/* ── 主体 ── */}
      <div className="ap-body">
        {preview.kind === 'text' && isTable ? (
          <DataFilePreview text={preview.text ?? ''} truncatedSource={preview.truncated} />
        ) : preview.kind === 'text' ? (
          <textarea
            ref={taRef}
            className="ap-editor"
            value={draft}
            readOnly={readOnly}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              if (saveState !== 'idle') setSaveState('idle');
            }}
          />
        ) : preview.kind === 'image' && preview.dataUrl ? (
          <div className="ap-center">
            <img src={preview.dataUrl} alt={preview.relPath} style={{ maxWidth: '100%' }} />
          </div>
        ) : preview.kind === 'pdf' && preview.dataUrl ? (
          <PdfFilePreview
            dataUrl={preview.dataUrl}
            relPath={preview.relPath}
            onOpenExternal={() => openExternal(preview.relPath)}
          />
        ) : preview.kind === 'audio' ? (
          mediaFailed || !preview.mediaUrl ? (
            <EmptyState
              icon={<Icon name="volume-x" size={22} />}
              title={tx('dock.fileViewer.audioPlaybackFailed')}
              action={
                <button className="btn btn-sm" onClick={() => openExternal(preview.relPath)}>
                  {tx('common.open')}
                </button>
              }
            />
          ) : (
            <div className="ap-center">
              {/* src 走 mm-media:// 流式协议，不内联 base64（大文件不进内存） */}
              <audio
                className="ap-media"
                src={preview.mediaUrl}
                controls
                preload="metadata"
                onError={() => setMediaFailed(true)}
              />
            </div>
          )
        ) : preview.kind === 'video' ? (
          mediaFailed || !preview.mediaUrl ? (
            <EmptyState
              icon={<Icon name="clapperboard" size={22} />}
              title={tx('dock.fileViewer.videoPlaybackFailed')}
              action={
                <button className="btn btn-sm" onClick={() => openExternal(preview.relPath)}>
                  {tx('common.open')}
                </button>
              }
            />
          ) : (
            <div className="ap-center">
              <video
                className="ap-media"
                src={preview.mediaUrl}
                controls
                preload="metadata"
                onError={() => setMediaFailed(true)}
              />
            </div>
          )
        ) : preview.kind === 'too-large' ? (
          <EmptyState
            icon={<Icon name="hard-drive" size={22} />}
            title={t('文件过大')}
            description={tx('dock.dataPreview.fileTooLarge')}
            action={
              <button className="btn btn-sm" onClick={() => openExternal(preview.relPath)}>
                {tx('common.open')}
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<Icon name="image-off" size={22} />}
            title={t('无法内联预览')}
            description={tx('dock.fileEditor.overwriteUnavailable')}
            action={
              <button className="btn btn-sm" onClick={() => openExternal(preview.relPath)}>
                {tx('common.open')}
              </button>
            }
          />
        )}
      </div>

      {/* ── 冲突弹层 ── */}
      {conflict && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">{tx('dock.fileEditor.unsaved')}</span>
            </div>
            <div className="modal-body">
              <div style={{ fontSize: 12.5, lineHeight: 1.8 }}>
                {tx('dock.fileEditor.conflictBody')}
              </div>
              {diskChanged ? (
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.7 }}>
                  {tx('dock.fileEditor.diskChangedBody')}
                </div>
              ) : null}
            </div>
            <div className="modal-foot">
              <button
                className="btn btn-sm"
                onClick={() => {
                  // 放弃修改：回到磁盘版本
                  setDraft(preview.text ?? '');
                  setConflict(false);
                  void load(preview.relPath);
                }}
              >
                {tx('dock.fileEditor.discard')}
              </button>
              <button className="btn btn-sm" onClick={() => setConflict(false)}>
                {tx('dock.fileEditor.keepEditing')}
              </button>
              <button className="btn btn-sm btn-primary" onClick={() => void doSave(true)}>
                {tx('dock.fileEditor.overwriteSave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 供外部（文件树等）判断某文件是否适合在产物面板里编辑 */
export function isEditableArtifact(p: FilePreview | null): boolean {
  return p?.kind === 'text' && p.truncated !== true;
}

/**
 * 从文件树里挑出「产物」：排除配置文件与依赖目录。
 * 原版产物面板只关心 agent 真正产出的东西。
 */
export function pickArtifacts(
  tree: Array<{ name: string; relPath: string; isDirectory: boolean; children?: unknown[] }>,
): Array<{ name: string; relPath: string }> {
  const SKIP_DIR = /^(node_modules|\.git|\.mathmodel|\.mmodels|__pycache__|\.venv|venv)$/;
  const out: Array<{ name: string; relPath: string }> = [];

  const walk = (nodes: typeof tree): void => {
    for (const n of nodes) {
      if (n.isDirectory) {
        if (SKIP_DIR.test(n.name) || n.name.startsWith('.')) continue;
        if (Array.isArray(n.children)) {
          walk(n.children as typeof tree);
        }
        continue;
      }
      out.push({ name: n.name, relPath: n.relPath });
    }
  };
  walk(tree);
  return out;
}

/** 按扩展名归类，便于分组展示 */
export function artifactKind(relPath: string): string {
  const e = extOf(relPath);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(e)) return '图像';
  if (['csv', 'tsv', 'xlsx', 'xls'].includes(e)) return '数据';
  if (['tex', 'typ', 'docx', 'md', 'pdf'].includes(e)) return '文档';
  if (['py', 'r', 'm', 'jl', 'js', 'ts', 'cpp', 'java'].includes(e)) return '代码';
  if (['drawio'].includes(e)) return '流程图';
  return '其它';
}
