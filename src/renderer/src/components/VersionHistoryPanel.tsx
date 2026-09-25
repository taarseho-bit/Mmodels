/**
 * 项目版本面板 —— 复刻原版 `VersionHistoryPanel`。
 *
 * 原版把版本存在**本机**（`localOnly`：「仅保存在这台设备」），
 * 用 git commit 承载。这里沿用同一模型。
 *
 * ⚠️ 恢复前先自动备份当前状态 —— 原版明确承诺
 *    「恢复前会先保存当前状态，聊天记录不会删除」（`restoreDialogSafety`）。
 *    这正是主进程 `restoreVersion()` 里 `restore-backup` 那一步。
 */
import { useCallback, useEffect, useState } from 'react';
import type { VersionRecord, VersionKind } from '@shared/types';
import { EmptyState } from './PageShell';
import { Icon } from './Icon';
import { Skeleton } from './Skeleton';
import { useApp } from '../store/app';
import { t, tx, txPlural } from '../i18n';
import { friendlyError } from '../lib/friendly-error';

const KIND_KEY: Record<VersionKind, string> = {
  manual: 'dock.versionPanel.kinds.manual',
  auto: 'dock.versionPanel.kinds.auto',
  restore: 'dock.versionPanel.kinds.restore',
  'restore-backup': 'dock.versionPanel.kinds.restore-backup',
};

/** 相对时间（原版用 i18next 的复数键，这里给等价中文） */
function relative(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return tx('dock.versionPanel.justNow');
  const min = Math.floor(d / 60_000);
  if (min < 60) return txPlural('automation.format.minutesAgo', min);
  const h = Math.floor(min / 60);
  if (h < 24) return txPlural('automation.format.hoursAgo', h);
  const day = Math.floor(h / 24);
  if (day < 30) return txPlural('automation.format.daysAgo', day);
  const dt = new Date(ms);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function fmtFull(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function VersionHistoryPanel(): JSX.Element {
  const project = useApp((s) => s.currentProject);
  const running = useApp(
    (s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status === 'running',
  );

  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [available, setAvailable] = useState(true);
  const [isRepo, setIsRepo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 保存版本弹层
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saving, setSaving] = useState(false);
  // 恢复确认弹层
  const [restoreTarget, setRestoreTarget] = useState<VersionRecord | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    setError(null);
    try {
      const r = (await window.mathmodel.git.versions()) as {
        available: boolean;
        isRepo: boolean;
        versions: VersionRecord[];
      };
      setAvailable(r.available);
      setIsRepo(r.isRepo);
      setVersions(r.versions);
    } catch (e) {
      setError(friendlyError(e, '版本记录没有读取成功，可以重试。'));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Agent 干完活后刷新（版本可能已被自动保存）
  useEffect(() => {
    if (running) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const doSave = async (): Promise<void> => {
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const r = (await window.mathmodel.git.saveVersion(name, 'manual')) as {
        committed: boolean;
        reason?: string;
      };
      setSaveOpen(false);
      setSaveName('');
      if (r.committed) {
        setToast(tx('dock.versionPanel.saveSuccess'));
        await refresh();
      } else if (r.reason === 'clean') {
        setToast(tx('dock.versionPanel.savedCurrentState'));
      } else {
        setToast(r.reason ?? tx('common.failed'));
      }
    } catch (e) {
      setToast(friendlyError(e, '版本操作没有完成，可以重试。'));
    } finally {
      setSaving(false);
    }
  };

  const doRestore = async (): Promise<void> => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const r = (await window.mathmodel.git.restore(restoreTarget.sha)) as {
        ok: boolean;
        reason?: string;
      };
      if (r.ok) {
        setToast(tx('dock.versionPanel.restoreSuccess', { title: restoreTarget.name }));
      } else {
        setToast(
          r.reason === 'version-not-found'
            ? tx('dock.versionPanel.errors.versionNotFound')
            : (r.reason ?? tx('common.failed')),
        );
      }
      setRestoreTarget(null);
      await refresh();
    } catch (e) {
      setToast(friendlyError(e, '版本恢复没有完成，当前内容没有被删除。'));
    } finally {
      setRestoring(false);
    }
  };

  if (!project) {
    return (
      <EmptyState
        icon={<Icon name="folder-open" size={22} />}
        title={tx('dock.explorerPanel.readDirFailed')}
      />
    );
  }

  if (loading && versions.length === 0 && !error) {
    return (
      <div className="col" style={{ padding: 12, gap: 10 }}>
        <span className="muted" style={{ fontSize: 12 }}>
          {tx('dock.versionPanel.loading')}
        </span>
        <Skeleton height={40} radius="lg" />
        <Skeleton height={40} radius="lg" />
        <Skeleton height={40} radius="lg" />
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

  if (!available) {
    return (
      <EmptyState
        icon={<Icon name="git-branch" size={22} />}
        title={tx('dock.diffPanel.notRepoTitle')}
        description={t('未检测到 Git。项目版本需要 Git 才能使用。')}
      />
    );
  }

  return (
    <div className="col" style={{ height: '100%', minHeight: 0, position: 'relative' }}>
      {/* ── 头部 ── */}
      <div className="row" style={{ padding: '8px 10px', gap: 6, flexShrink: 0 }}>
        <div className="col grow" style={{ minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600 }}>
            {tx('dock.versionPanel.localHistory')}
          </span>
          <span className="muted" style={{ fontSize: 10 }}>
            {tx('dock.versionPanel.localOnly')}
          </span>
        </div>
        <button
          className="btn btn-sm btn-primary"
          disabled={running || !isRepo}
          title={running ? tx('dock.versionPanel.busyHint') : tx('dock.versionPanel.saveVersion')}
          onClick={() => setSaveOpen(true)}
        >
          {tx('dock.versionPanel.saveCurrentState')}
        </button>
      </div>

      <div className="divider" style={{ margin: 0 }} />

      {running ? (
        <div
          className="muted"
          style={{ padding: '6px 10px', fontSize: 11, lineHeight: 1.6, flexShrink: 0 }}
        >
          {tx('dock.versionPanel.busyHint')}
        </div>
      ) : null}

      {/* ── 版本列表 ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {versions.length === 0 ? (
          <EmptyState
            icon={<Icon name="clock" size={22} />}
            title={tx('dock.versionPanel.localHistory')}
            description={tx('dock.versionPanel.saveDialogDescription')}
            fill={false}
          />
        ) : (
          versions.map((v, i) => (
            <div key={v.sha} className="ver-row">
              <div className="ver-rail">
                <span className={`ver-dot${i === 0 ? ' latest' : ''}`} />
              </div>
              <div className="ver-main">
                <div className="ver-name truncate" title={v.name}>
                  {v.name}
                </div>
                <div className="ver-meta">
                  <span className="badge">{tx(KIND_KEY[v.kind])}</span>
                  <span title={fmtFull(v.at)}>{relative(v.at)}</span>
                  <span className="mono" style={{ opacity: 0.6 }}>
                    {v.sha.slice(0, 7)}
                  </span>
                </div>
                <div className="ver-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={running || i === 0}
                    title={
                      i === 0 ? tx('dock.versionPanel.savedCurrentState') : tx('dock.versionPanel.restoreThisVersion')
                    }
                    onClick={() => setRestoreTarget(v)}
                  >
                    {tx('dock.versionPanel.restoreThisVersion')}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── 保存弹层 ── */}
      {saveOpen && (
        <div className="modal-backdrop" onClick={() => setSaveOpen(false)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">{tx('dock.versionPanel.saveDialogTitle')}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setSaveOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7, marginBottom: 10 }}>
                {tx('dock.versionPanel.saveDialogDescription')}
              </div>
              <label className="field-label">{tx('dock.versionPanel.versionName')}</label>
              <input
                className="input"
                autoFocus
                value={saveName}
                placeholder={tx('dock.versionPanel.versionNamePlaceholder')}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void doSave();
                }}
              />
            </div>
            <div className="modal-foot">
              <button className="btn btn-sm" onClick={() => setSaveOpen(false)}>
                {tx('common.cancel')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={!saveName.trim() || saving}
                onClick={() => void doSave()}
              >
                {saving ? tx('dock.explorerPanel.saving') : tx('dock.versionPanel.saveVersion')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 恢复确认弹层 ── */}
      {restoreTarget && (
        <div className="modal-backdrop" onClick={() => setRestoreTarget(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span className="modal-title">{tx('dock.versionPanel.restoreDialogTitle')}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => setRestoreTarget(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body col" style={{ gap: 8 }}>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                {tx('dock.versionPanel.restoreDialogTarget', { title: restoreTarget.name })}
              </div>
              <div className="muted" style={{ fontSize: 12, lineHeight: 1.7 }}>
                {tx('dock.versionPanel.restoreDialogSafety')}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn btn-sm" onClick={() => setRestoreTarget(null)}>
                {tx('common.cancel')}
              </button>
              <button
                className="btn btn-sm btn-primary"
                disabled={restoring}
                onClick={() => void doRestore()}
              >
                {restoring ? tx('dock.explorerPanel.saving') : tx('dock.versionPanel.confirmRestore')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 轻提示 ── */}
      {toast && <div className="panel-toast">{toast}</div>}
    </div>
  );
}
