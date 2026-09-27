/**
 * 更改面板 —— 当前实现应用约定 `DiffPanel`。
 *
 * 展示工作区相对上次提交的变更（左列文件、右侧统一差异）。
 * 文案取自 `dock.diffPanel.*`。
 *
 * 数据全部来自主进程 git 层（渲染层不跑 git）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { ChangedFile, ChangeStatus, FileDiff } from '@shared/types';
import { EmptyState } from './PageShell';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { useApp } from '../store/app';
import { tx, txPlural } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

const STATUS_LABEL_KEY: Record<ChangeStatus, string> = {
  added: 'dock.versionPanel.fileAdded',
  modified: 'dock.versionPanel.fileChanged',
  deleted: 'dock.versionPanel.fileDeleted',
  renamed: 'dock.versionPanel.fileChanged',
  untracked: 'dock.versionPanel.fileAdded',
};

const STATUS_COLOR: Record<ChangeStatus, string> = {
  added: 'var(--success)',
  untracked: 'var(--success)',
  modified: 'var(--warning)',
  renamed: 'var(--info)',
  deleted: 'var(--danger)',
};

const STATUS_BADGE: Record<ChangeStatus, string> = {
  added: 'A',
  untracked: 'U',
  modified: 'M',
  renamed: 'R',
  deleted: 'D',
};

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

export function DiffPanel(): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const running = useApp((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running');

  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const r = (await window.mathmodel.git.status()) as { isRepo: boolean; files: ChangedFile[] };
      setIsRepo(r.isRepo);
      setFiles(r.files);
      // 当前选中文件被删掉时，改选第一个
      setActive((prev) =>
        prev && r.files.some((f) => f.path === prev) ? prev : (r.files[0]?.path ?? null),
      );
    } catch (e) {
      setError(friendlyError(e, '更改记录没有读取成功，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 打开文件时拉差异
  useEffect(() => {
    if (!active) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setDiffLoading(true);
    void (async () => {
      try {
        const d = (await window.mathmodel.git.diff(active)) as FileDiff;
        if (!cancelled) setDiff(d);
      } catch (e) {
        if (!cancelled) setError(friendlyError(e, '文件差异没有读取成功，可以重试。'));
      } finally {
        if (!cancelled) setDiffLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Agent 动过文件后自动刷新
  useEffect(() => {
    if (running) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  if (!project) {
    return (
      <EmptyState
        icon={<Icon name="folder-open" size={22} />}
        title={tx('dock.explorerPanel.readDirFailed')}
      />
    );
  }

  if (loading && isRepo === null) {
    return (
      <div className="col" style={{ padding: 12, gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {tx('dock.diffPanel.loadingChanges')}
        </span>
        <Skeleton height={12} />
        <Skeleton height={12} width="80%" />
        <Skeleton height={12} width="60%" />
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

  if (isRepo === false) {
    return (
      <EmptyState
        icon={<Icon name="git-branch" size={22} />}
        title={tx('dock.diffPanel.notRepoTitle')}
        description={tx('dock.diffPanel.notRepoDescription')}
      />
    );
  }

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="circle-check" size={22} />}
        title={tx('dock.diffPanel.cleanTitle')}
        description={tx('dock.diffPanel.cleanDescription')}
        action={
          <button className="btn btn-sm" onClick={() => void refresh()}>
            {tx('common.refresh')}
          </button>
        }
      />
    );
  }

  return (
    <div className="col" style={{ height: '100%', minHeight: 0 }}>
      {/* ── 头部 ── */}
      <div className="row" style={{ padding: '6px 10px', gap: 6, flexShrink: 0 }}>
        <span className="grow" style={{ fontSize: 11, fontWeight: 600 }}>
          {txPlural('dock.diffPanel.changedFiles', files.length)}
        </span>
        <button className="btn btn-sm btn-ghost" onClick={() => void refresh()} title={tx('common.refresh')}>
          ⟳
        </button>
      </div>

      <div className="divider" style={{ margin: 0 }} />

      {/* ── 文件列表 ── */}
      <div style={{ maxHeight: '38%', overflowY: 'auto', flexShrink: 0 }}>
        {files.map((f) => (
          <button
            key={f.path}
            className={`file-row${active === f.path ? ' active' : ''}`}
            onClick={() => setActive(f.path)}
            title={f.path}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <span
              className="mono"
              title={tx(STATUS_LABEL_KEY[f.status])}
              style={{
                fontSize: 10,
                fontWeight: 700,
                width: 14,
                flexShrink: 0,
                color: STATUS_COLOR[f.status],
              }}
            >
              {STATUS_BADGE[f.status]}
            </span>
            <span className="file-row-name">
              <span className="muted">{dirname(f.path)}</span>
              {basename(f.path)}
            </span>
          </button>
        ))}
      </div>

      <div className="divider" style={{ margin: 0 }} />

      {/* ── 差异 ── */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {diffLoading && (
          <div className="muted" style={{ padding: 12, fontSize: 12 }}>
            {tx('dock.diffPanel.loadingChanges')}
          </div>
        )}

        {!diffLoading && diff && diff.lines.length === 0 && (
          <div className="muted" style={{ padding: 12, fontSize: 12, lineHeight: 1.7 }}>
            {tx('dock.diffPanel.noTextDiff')}
          </div>
        )}

        {!diffLoading && diff && diff.lines.length > 0 && (
          <div className="diff-body">
            {diff.lines.map((l, i) => (
              <div key={i} className={`diff-line diff-${l.kind}`}>
                <span className="diff-gutter">
                  {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
                </span>
                <span className="diff-text">{l.text || ' '}</span>
              </div>
            ))}
            {diff.truncated && (
              <div className="muted" style={{ padding: '6px 10px', fontSize: 11 }}>
                {tx('dock.diffPanel.diffTruncated')}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
