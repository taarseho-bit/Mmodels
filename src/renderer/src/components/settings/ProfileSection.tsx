/**
 * 设置页 ① 个人资料（本地统计，对应原版账号页）
 *
 * 对齐原版 s00-profile：
 *   - 头部为**静态**头像 + 名字 + `@handle · org`，不直接内联输入框；
 *     名字/句柄的编辑收进右上角「编辑」按钮（原版同位置的入口）。
 *   - 「分享」属云端分享 → 按既定决策保留骨架并置灰。
 *   - 「活跃度洞察」7 个字段与「最常用插件」卡左右并排。
 */
import { useEffect, useMemo, useState } from 'react';
import type { UsageStats } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';
import { Section } from './shared';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ProfileSection(): JSX.Element {
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const providers = useApp((s) => s.providers);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void window.mathmodel.stats.get().then(setStats).catch(() => setStats(null));
  }, []);

  const name = settings?.profileName?.trim() || 'Xh';
  const handle = settings?.profileHandle?.trim() || 'xh';
  const initials = name.slice(0, 2).toUpperCase();

  // 活跃度热力图：把 300 天折成按周的列
  const heatCols = useMemo(() => {
    if (!stats) return [];
    const days = stats.heatmap;
    if (days.length === 0) return [];
    // 对齐到周：第一列从周一开始
    const cols: (typeof days)[] = [];
    let col: typeof days = [];
    const firstDow = (new Date(days[0].day).getDay() + 6) % 7; // 0=周一
    for (let i = 0; i < firstDow; i++) col.push({ day: '', tokens: 0, messages: 0 });
    for (const d of days) {
      col.push(d);
      if (col.length === 7) {
        cols.push(col);
        col = [];
      }
    }
    if (col.length) cols.push(col);
    return cols;
  }, [stats]);

  const maxTokens = useMemo(
    () => Math.max(1, ...(stats?.heatmap.map((d) => d.tokens) ?? [1])),
    [stats],
  );
  const recentActivity = useMemo(() => (stats?.heatmap ?? []).slice(-14), [stats]);
  const recentMax = Math.max(1, ...recentActivity.map((d) => d.tokens));

  /** 本周 vs 上周对比（最近 14 天对半分）—— 2026-09-25 可视化升级 */
  const weekly = useMemo(() => {
    if (!stats || stats.heatmap.length < 7) return null;
    const days = stats.heatmap.slice(-14);
    const thisWeek = days.slice(-7);
    const prevWeek = days.length === 14 ? days.slice(0, 7) : null;
    const sum = (arr: typeof days, key: 'tokens' | 'messages') =>
      arr.reduce((acc, d) => acc + d[key], 0);
    const t1 = sum(thisWeek, 'tokens');
    const t0 = prevWeek ? sum(prevWeek, 'tokens') : 0;
    const m1 = sum(thisWeek, 'messages');
    const m0 = prevWeek ? sum(prevWeek, 'messages') : 0;
    const delta = t0 > 0 ? Math.round(((t1 - t0) / t0) * 100) : t1 > 0 ? 100 : 0;
    return { t1, t0, m1, m0, delta, max: Math.max(1, t0, t1) };
  }, [stats]);

  const effortLabel =
    settings?.effort === 'low'
      ? tx('chat.modelPicker.effortLow')
      : settings?.effort === 'medium'
        ? tx('chat.modelPicker.effortMedium')
        : settings?.effort === 'high'
          ? tx('chat.modelPicker.effortHigh')
          : null;
  const topProvider = stats?.byProvider[0];
  const topProviderName = topProvider
    ? providers.find((p) => p.id === topProvider.providerId)?.name ?? topProvider.name
    : null;
  const topProject = stats?.byProject[0];

  /** 空值统一显示为原版的占位符 `—` */
  const dash = (v: string | null | undefined): string => (v && v.trim() ? v : '—');

  return (
    <div className="col" style={{ gap: 22 }}>
      {/* ── 资料卡 ── */}
      <div className="col" style={{ alignItems: 'center', gap: 6, paddingTop: 6, position: 'relative' }}>
        <div className="row" style={{ position: 'absolute', right: 0, top: 0, gap: 6 }}>
          <button className="btn btn-sm btn-ghost" disabled title={tx('settings.socialLinks.soon')}>
            {tx('common.share')}
          </button>
          <button className="btn btn-sm" onClick={() => setEditing((v) => !v)}>
            {tx('common.edit')}
          </button>
        </div>

        <div className="settings-avatar">{initials}</div>

        {editing ? (
          <div className="col" style={{ alignItems: 'center', gap: 6, marginTop: 2 }}>
            <input
              className="input"
              style={{ width: 200, textAlign: 'center', fontSize: 14, fontWeight: 600 }}
              value={settings?.profileName ?? ''}
              placeholder={t('显示名')}
              onChange={(e) => void patchSettings({ profileName: e.target.value })}
            />
            <div className="row" style={{ gap: 6, alignItems: 'center' }}>
              <span className="muted">@</span>
              <input
                className="input"
                style={{ width: 120, fontSize: 12 }}
                value={settings?.profileHandle ?? ''}
                placeholder="handle"
                onChange={(e) =>
                  void patchSettings({ profileHandle: e.target.value.replace(/\s/g, '') })
                }
              />
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setEditing(false)}>
              {tx('common.save')}
            </button>
          </div>
        ) : (
          <>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{name}</span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              @{handle} · MModels
            </span>
          </>
        )}
      </div>

      {/* ── 统计大数字 ── */}
      <div className="stat-grid">
        <div className="stat-card col">
          <span className="stat-num">{stats ? fmtTokens(stats.totalTokens) : '—'}</span>
          <span className="stat-label">{tx('profile.profileSettingsPanel.lifetimeTokens')}</span>
        </div>
        <div className="stat-card col">
          <span className="stat-num">{stats?.peakDay ? stats.peakDay.day.slice(5) : '—'}</span>
          <span className="stat-label">{tx('profile.profileSettingsPanel.peakDay')}</span>
        </div>
        <div className="stat-card col">
          <span className="stat-num">{stats ? String(stats.promptCount) : '—'}</span>
          <span className="stat-label">{tx('profile.profileSettingsPanel.totalPrompts')}</span>
        </div>
        <div className="stat-card col">
          <span className="stat-num">{stats ? t('{{n}} 天', { n: stats.currentStreak }) : '—'}</span>
          <span className="stat-label">{tx('profile.profileSettingsPanel.currentStreak')}</span>
        </div>
        <div className="stat-card col">
          <span className="stat-num">{stats ? t('{{n}} 天', { n: stats.longestStreak }) : '—'}</span>
          <span className="stat-label">{tx('profile.profileSettingsPanel.longestStreak')}</span>
        </div>
      </div>

      {/* ── 活跃度热力图 ── */}
      <Section title={tx('profile.profileSettingsPanel.activity')}>
        <div className="panel" style={{ padding: 14 }}>
          {heatCols.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('暂无数据 —— 开始第一次对话后这里会长出一片草原。')}
            </span>
          ) : (
            <div className="heat-scroll">
              <div style={{ width: 'max-content' }}>
                {/* 月份刻度（原版在热力图上方标 12月–9月） */}
                <div className="row" style={{ gap: 3, marginBottom: 5 }}>
                  {heatCols.map((col, ci) => {
                    const first = col.find((d) => d.day);
                    const prevFirst = ci > 0 ? heatCols[ci - 1].find((d) => d.day) : null;
                    const m = first ? Number(first.day.slice(5, 7)) : null;
                    const prevM = prevFirst ? Number(prevFirst.day.slice(5, 7)) : null;
                    const show = m !== null && (ci === 0 || m !== prevM);
                    return (
                      <span
                        key={ci}
                        className="muted"
                        style={{ width: 11, flex: 'none', fontSize: 9.5, whiteSpace: 'nowrap' }}
                      >
                        {show && m !== null ? t('{{m}} 月', { m }) : ''}
                      </span>
                    );
                  })}
                </div>
                <div className="heat-grid">
                  {heatCols.map((col, ci) => (
                    <div key={ci} className="heat-col">
                      {col.map((d, ri) => {
                        const level =
                          d.tokens <= 0 ? 0 : Math.min(4, Math.ceil((d.tokens / maxTokens) * 4));
                        return (
                          <span
                            key={ri}
                            className={`heat-cell heat-${level}`}
                            title={
                              d.day
                                ? t('{{day}} · {{tokens}} tokens · {{count}} 条', {
                                    day: d.day,
                                    tokens: fmtTokens(d.tokens),
                                    count: d.messages,
                                  })
                                : ''
                            }
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {recentActivity.length > 0 && (
            <div className="activity-summary" aria-label={t('最近14天活跃度')}>
              <div className="activity-summary-head"><strong>{t('最近14天')}</strong><span className="muted">{t('按对话量和用量显示')}</span></div>
              <div className="activity-bars">
                {recentActivity.map((d) => (
                  <span key={d.day} className="activity-bar-wrap" title={`${d.day} · ${fmtTokens(d.tokens)} tokens · ${d.messages} 条`}>
                    <i className="activity-bar" style={{ height: `${Math.max(8, (d.tokens / recentMax) * 100)}%` }} />
                    <small>{d.day.slice(8)}</small>
                  </span>
                ))}
              </div>
            </div>
          )}
          {weekly && (
            <div className="activity-summary" aria-label={t('本周与上周对比')}>
              <div className="activity-summary-head">
                <strong>{t('本周对比')}</strong>
                <span
                  className="muted"
                  style={{ color: weekly.delta >= 0 ? 'var(--success, #2e9e5b)' : 'var(--danger, #d64545)' }}
                >
                  {weekly.delta >= 0 ? '↑' : '↓'} {Math.abs(weekly.delta)}%
                </span>
              </div>
              <div className="col" style={{ gap: 8, marginTop: 8 }}>
                {([
                  [t('本周'), weekly.t1, weekly.m1],
                  [t('上周'), weekly.t0, weekly.m0],
                ] as const).map(([label, tokens, msgs]) => (
                  <div key={label} className="col" style={{ gap: 3 }}>
                    <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5 }}>
                      <span className="muted">{label}</span>
                      <span>{t('{{tokens}} · {{count}} 条', { tokens: fmtTokens(tokens), count: msgs })}</span>
                    </div>
                    <div className="bar-track" style={{ height: 8 }}>
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(2, (tokens / weekly.max) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>
      <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <div className="col grow" style={{ gap: 10, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {tx('profile.profileSettingsPanel.activityInsights')}
          </span>
          <div className="panel col" style={{ padding: 14, gap: 10, fontSize: 12.5 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{tx('profile.profileSettingsPanel.mostUsedProvider')}</span>
              <span>{dash(topProviderName)}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{tx('profile.profileSettingsPanel.mostUsedReasoning')}</span>
              <span>{dash(effortLabel)}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{tx('profile.profileSettingsPanel.mostActiveHour')}</span>
              <span>
                {stats?.peakHour != null
                  ? t('{{hour}}:00 前后', { hour: String(stats.peakHour).padStart(2, '0') })
                  : '—'}
              </span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{tx('profile.profileSettingsPanel.mostWorkedProject')}</span>
              <span>{dash(topProject?.name)}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">涉及的技能种类</span>
              <span>{stats && stats.skillsExplored > 0 ? String(stats.skillsExplored) : '—'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">模型主动调用技能</span>
              <span>{stats && stats.skillsUsed > 0 ? String(stats.skillsUsed) : '—'}</span>
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">已启用技能</span><span>{stats?.enabledSkillCount ?? '—'} / {stats?.skillCount ?? '—'}</span></div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">技能入口指令</span><span>{stats?.skillEntryCount ?? '—'}</span></div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">子智能体调用</span><span>{stats?.agentRuns ?? '—'}</span></div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted">连接器调用</span><span>{stats?.connectorRuns ?? '—'}</span></div>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{tx('profile.profileSettingsPanel.totalThreads')}</span>
              <span>{stats ? String(stats.sessionCount) : '—'}</span>
            </div>
          </div>
        </div>

        <div className="col grow" style={{ gap: 10, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            常用技能（入口与调用记录）
          </span>
          <div className="panel col" style={{ padding: 14, gap: 10, fontSize: 12.5 }}>
            {!stats || !stats.bySkill?.length ? (
              <span className="muted" style={{ fontSize: 12 }}>
                {tx('profile.profileSettingsPanel.noSkillsYet')}
              </span>
            ) : (
              stats.bySkill.slice(0, 20).map((p) => {
                const maxRuns = Math.max(1, ...stats.bySkill.map((x) => x.runs));
                return (
                  <div key={p.name} className="col" style={{ gap: 3 }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                      <span className="truncate">{p.name}</span>
                      <span className="muted" style={{ flexShrink: 0 }}>
                        {p.runs} 条记录
                      </span>
                    </div>
                    <div className="bar-track" style={{ height: 6 }}>
                      <div
                        className="bar-fill"
                        style={{ width: `${Math.max(3, (p.runs / maxRuns) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <span className="muted" style={{ fontSize: 11 }}>入口表示发起技能任务，调用表示模型加载技能；不等于任务已成功完成。子智能体与连接器单独统计。</span>
        </div>
      </div>

      {/* ── 模型使用情况 ── */}
      <Section title={tx('profile.profileSettingsPanel.modelUsage')}>
        <div className="panel col" style={{ padding: 14, gap: 10 }}>
          {!stats ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {t('正在加载…')}
            </span>
          ) : stats.byModel.length === 0 ? (
            <span className="muted" style={{ fontSize: 12 }}>
              {tx('profile.profileSettingsPanel.noModelActivity')}
            </span>
          ) : (
            stats.byModel.map((m) => {
              const max = Math.max(1, ...stats.byModel.map((x) => x.tokens));
              return (
                <div key={m.model} className="col" style={{ gap: 4 }}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                    <span className="mono truncate">{m.model}</span>
                    <span className="muted">
                      {t('{{tokens}} · {{count}} 个会话', { tokens: fmtTokens(m.tokens), count: m.sessions })}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(2, (m.tokens / max) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Section>
    </div>
  );
}
