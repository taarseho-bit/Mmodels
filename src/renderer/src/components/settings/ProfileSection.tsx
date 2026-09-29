/**
 * 使用统计
 *
 * 所有数字都来自本机 SQLite 聚合，不上传题目内容。页面把“用过多少”
 * 转成趋势、构成和排名，方便快速回答三个问题：最近是否在推进、主要用的
 * 是什么、下一步应该继续哪个项目。图形使用原生 SVG/CSS，避免引入大型依赖。
 */
import { useEffect, useMemo, useState } from 'react';
import type { UsageDay, UsageStats } from '@shared/types';
import { useApp } from '../../store/app';
import { tx, t } from '../../i18n';

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function pct(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function safeName(value: string | null | undefined): string {
  return value && value.trim() ? value.trim() : '—';
}

function dateLabel(day: string): string {
  return day ? `${day.slice(5, 7)}月${day.slice(8, 10)}日` : '';
}

type RingPart = { label: string; value: number; color: string };

function MiniRing({ parts, label, value }: { parts: RingPart[]; label: string; value: string }): JSX.Element {
  const total = Math.max(1, parts.reduce((sum, part) => sum + Math.max(0, part.value), 0));
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="usage-ring-wrap">
      <svg className="usage-ring" viewBox="0 0 108 108" role="img" aria-label={label}>
        <circle cx="54" cy="54" r={radius} fill="none" stroke="var(--border-weak)" strokeWidth="10" />
        {parts.map((part) => {
          const length = (Math.max(0, part.value) / total) * circumference;
          const node = (
            <circle key={part.label} cx="54" cy="54" r={radius} fill="none" stroke={part.color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform="rotate(-90 54 54)" />
          );
          offset += length;
          return node;
        })}
      </svg>
      <div className="usage-ring-center"><strong>{value}</strong><span>{label}</span></div>
    </div>
  );
}

function Sparkline({ days }: { days: UsageDay[] }): JSX.Element {
  const max = Math.max(1, ...days.map((day) => day.tokens));
  const points = days.map((day, index) => {
    const x = days.length <= 1 ? 4 : 4 + (index / (days.length - 1)) * 192;
    const y = 52 - (day.tokens / max) * 42;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = days[days.length - 1];
  return (
    <div className="usage-sparkline-wrap">
      <svg className="usage-sparkline" viewBox="0 0 200 58" preserveAspectRatio="none" role="img" aria-label="最近两周用量趋势">
        <path d="M4 52H196" stroke="var(--border-weak)" strokeWidth="1" />
        <polyline points={points} fill="none" stroke="var(--accent-solid, #4f7cff)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {last && <circle cx="196" cy={52 - (last.tokens / max) * 42} r="3.5" fill="var(--accent-solid, #4f7cff)" />}
      </svg>
      <div className="usage-sparkline-labels"><span>{days[0] ? dateLabel(days[0].day) : '—'}</span><span>{last ? dateLabel(last.day) : '—'}</span></div>
    </div>
  );
}

function RankBars({
  items,
  valueKey,
  empty,
  format = (value: number) => String(value),
}: {
  items: { name: string; runs?: number; tokens?: number; sessions?: number }[];
  valueKey: 'runs' | 'tokens';
  empty: string;
  format?: (value: number) => string;
}): JSX.Element {
  const visible = items.slice(0, 6);
  const max = Math.max(1, ...visible.map((item) => Number(item[valueKey] ?? 0)));
  if (!visible.length) return <span className="muted usage-empty">{empty}</span>;
  return (
    <div className="usage-rank-list">
      {visible.map((item, index) => {
        const value = Number(item[valueKey] ?? 0);
        return (
          <div className="usage-rank-item" key={`${item.name}-${index}`}>
            <div className="usage-rank-line"><span className="usage-rank-name"><i>{index + 1}</i>{item.name}</span><strong>{format(value)}</strong></div>
            <div className="usage-track"><span style={{ width: `${Math.max(value > 0 ? 5 : 0, (value / max) * 100)}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
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

  const name = settings?.profileName?.trim() || '建模小组';
  const handle = settings?.profileHandle?.trim() || 'model-team';
  const initials = name.slice(0, 2).toUpperCase();
  const dash = (value: string | null | undefined): string => safeName(value);

  const heatCols = useMemo(() => {
    if (!stats?.heatmap?.length) return [] as UsageDay[][];
    const cols: UsageDay[][] = [];
    let column: UsageDay[] = [];
    const firstDow = (new Date(`${stats.heatmap[0].day}T00:00:00`).getDay() + 6) % 7;
    for (let i = 0; i < firstDow; i += 1) column.push({ day: '', tokens: 0, messages: 0 });
    for (const day of stats.heatmap) {
      column.push(day);
      if (column.length === 7) { cols.push(column); column = []; }
    }
    if (column.length) cols.push(column);
    return cols;
  }, [stats]);

  const maxTokens = Math.max(1, ...(stats?.heatmap ?? []).map((day) => day.tokens));
  const recentActivity = useMemo(() => (stats?.heatmap ?? []).slice(-14), [stats]);
  const recentMax = Math.max(1, ...recentActivity.map((day) => day.tokens));
  const weekly = useMemo(() => {
    const days = (stats?.heatmap ?? []).slice(-14);
    if (days.length < 7) return null;
    const thisWeek = days.slice(-7);
    const previous = days.length >= 14 ? days.slice(-14, -7) : [];
    const sum = (list: UsageDay[], key: 'tokens' | 'messages') => list.reduce((total, day) => total + day[key], 0);
    const currentTokens = sum(thisWeek, 'tokens');
    const previousTokens = sum(previous, 'tokens');
    const currentMessages = sum(thisWeek, 'messages');
    const previousMessages = sum(previous, 'messages');
    const delta = previousTokens ? Math.round(((currentTokens - previousTokens) / previousTokens) * 100) : currentTokens ? 100 : 0;
    return { currentTokens, previousTokens, currentMessages, previousMessages, delta };
  }, [stats]);

  const weekday = useMemo(() => {
    const values = [0, 0, 0, 0, 0, 0, 0];
    for (const day of stats?.heatmap ?? []) {
      const index = (new Date(`${day.day}T00:00:00`).getDay() + 6) % 7;
      values[index] += day.messages;
    }
    return values;
  }, [stats]);
  const weekdayMax = Math.max(1, ...weekday);
  const effortLabel = settings?.effort === 'low'
    ? tx('chat.modelPicker.effortLow')
    : settings?.effort === 'medium'
      ? tx('chat.modelPicker.effortMedium')
      : settings?.effort === 'high'
        ? tx('chat.modelPicker.effortHigh')
        : '自动';
  const topProvider = stats?.byProvider?.[0];
  const topProviderName = topProvider ? providers.find((provider) => provider.id === topProvider.providerId)?.name ?? topProvider.name : null;
  const topProject = stats?.byProject?.[0];
  const modelTotal = (stats?.byModel ?? []).reduce((sum, item) => sum + item.tokens, 0);
  const projectTotal = (stats?.byProject ?? []).reduce((sum, item) => sum + item.tokens, 0);
  const capabilityParts: RingPart[] = [
    { label: '技能', value: stats?.skillsUsed ?? 0, color: '#4f7cff' },
    { label: '子智能体', value: stats?.agentRuns ?? 0, color: '#9b6cff' },
    { label: '连接器', value: stats?.connectorRuns ?? 0, color: '#18a889' },
    { label: '对话', value: stats?.promptCount ?? 0, color: '#e7a23c' },
  ];
  const capabilityTotal = capabilityParts.reduce((sum, part) => sum + part.value, 0);

  return (
    <div className="usage-dashboard col">
      <div className="usage-profile panel">
        <div className="usage-profile-main">
          <div className="settings-avatar">{initials}</div>
          {editing ? (
            <div className="usage-profile-edit col">
              <input className="input" value={settings?.profileName ?? ''} placeholder={t('显示名')} onChange={(event) => void patchSettings({ profileName: event.target.value })} />
              <div className="row usage-handle-input"><span className="muted">@</span><input className="input" value={settings?.profileHandle ?? ''} placeholder="handle" onChange={(event) => void patchSettings({ profileHandle: event.target.value.replace(/\s/g, '') })} /></div>
              <button className="btn btn-sm btn-primary" onClick={() => setEditing(false)}>{tx('common.save')}</button>
            </div>
          ) : (
            <div className="usage-profile-copy"><strong>{name}</strong><span>@{handle} · MModels</span><small>本机统计 · 数据只保存在当前电脑</small></div>
          )}
        </div>
        <div className="row usage-profile-actions"><button className="btn btn-sm btn-ghost" disabled title={tx('settings.socialLinks.soon')}>{tx('common.share')}</button><button className="btn btn-sm" onClick={() => setEditing((value) => !value)}>{tx('common.edit')}</button></div>
      </div>

      <div className="usage-kpi-grid">
        <div className="usage-kpi"><span className="usage-kpi-icon blue">↗</span><div><strong>{stats ? fmtTokens(stats.totalTokens) : '—'}</strong><span>累计用量</span></div><small>输入 + 输出</small></div>
        <div className="usage-kpi"><span className="usage-kpi-icon purple">◷</span><div><strong>{stats?.promptCount ?? '—'}</strong><span>发起对话</span></div><small>{stats?.activeDays ?? 0} 个活跃日</small></div>
        <div className="usage-kpi"><span className="usage-kpi-icon green">✓</span><div><strong>{stats ? `${stats.currentStreak} 天` : '—'}</strong><span>当前连续</span></div><small>最长 {stats?.longestStreak ?? 0} 天</small></div>
        <div className="usage-kpi"><span className="usage-kpi-icon orange">⌁</span><div><strong>{stats?.peakHour != null ? `${String(stats.peakHour).padStart(2, '0')}:00` : '—'}</strong><span>最常工作时段</span></div><small>最高活跃日 {stats?.peakDay ? dateLabel(stats.peakDay.day) : '—'}</small></div>
      </div>

      <div className="usage-overview-grid">
        <section className="usage-card usage-trend-card">
          <div className="usage-card-head"><div><strong>最近 14 天</strong><span>每天的消息量与用量走势</span></div>{weekly && <b className={weekly.delta >= 0 ? 'usage-positive' : 'usage-negative'}>{weekly.delta >= 0 ? '↑' : '↓'} {Math.abs(weekly.delta)}%</b>}</div>
          <div className="usage-trend-body"><div className="usage-big-number">{fmtTokens(recentActivity.reduce((sum, day) => sum + day.tokens, 0))}<small> tokens</small></div><Sparkline days={recentActivity} /></div>
          <div className="usage-day-bars">{recentActivity.map((day) => <div key={day.day} className="usage-day-bar" title={`${dateLabel(day.day)} · ${fmtTokens(day.tokens)} tokens · ${day.messages} 条`}><span style={{ height: `${Math.max(day.tokens > 0 ? 7 : 2, (day.tokens / recentMax) * 100)}%` }} /><small>{day.day.slice(8)}</small></div>)}</div>
          {weekly && <div className="usage-compare"><span>本周 {fmtTokens(weekly.currentTokens)} · {weekly.currentMessages} 条</span><span>上周 {fmtTokens(weekly.previousTokens)} · {weekly.previousMessages} 条</span></div>}
        </section>
        <section className="usage-card usage-capability-card">
          <div className="usage-card-head"><div><strong>工作方式</strong><span>你把哪些能力组合在一起</span></div></div>
          <div className="usage-capability-body"><MiniRing parts={capabilityParts} label="能力调用" value={String(capabilityTotal)} /><div className="usage-legend">{capabilityParts.map((part) => <div key={part.label}><i style={{ background: part.color }} /><span>{part.label}</span><strong>{part.value}<small>{capabilityTotal ? ` ${pct(part.value, capabilityTotal)}%` : ''}</small></strong></div>)}</div></div>
          <p className="usage-card-note">技能、子智能体和连接器均按本地记录统计；数字用于了解工作习惯，不代表结果质量。</p>
        </section>
      </div>

      <section className="usage-card usage-heat-card">
        <div className="usage-card-head"><div><strong>活跃日历</strong><span>颜色越深，代表当天处理的消息越多</span></div><span className="usage-caption">近 300 天 · {stats?.activeDays ?? 0} 天有记录</span></div>
        {heatCols.length === 0 ? <div className="usage-empty">{t('暂无数据 —— 开始第一次对话后这里会长出一片草原。')}</div> : <div className="usage-heat-layout"><div className="usage-week-labels"><span>一</span><span>三</span><span>五</span><span>日</span></div><div className="heat-scroll"><div className="usage-heat-grid">{heatCols.map((column, columnIndex) => <div className="heat-col" key={columnIndex}>{column.map((day, rowIndex) => { const level = day.tokens <= 0 ? 0 : Math.min(4, Math.ceil((day.tokens / maxTokens) * 4)); return <span key={rowIndex} className={`heat-cell heat-${level}`} title={day.day ? `${dateLabel(day.day)} · ${fmtTokens(day.tokens)} tokens · ${day.messages} 条` : ''} />; })}</div>)}</div></div></div>}
        <div className="usage-heat-footer"><span>少</span><i className="heat-cell heat-0" /><i className="heat-cell heat-1" /><i className="heat-cell heat-2" /><i className="heat-cell heat-3" /><i className="heat-cell heat-4" /><span>多</span></div>
      </section>

      <div className="usage-three-grid">
        <section className="usage-card"><div className="usage-card-head"><div><strong>常用模型</strong><span>按 token 用量</span></div><span className="usage-caption">{stats?.byModel?.length ?? 0} 个</span></div><RankBars items={(stats?.byModel ?? []).map((item) => ({ name: item.model, tokens: item.tokens, sessions: item.sessions }))} valueKey="tokens" empty="还没有模型使用记录" format={fmtTokens} /><div className="usage-total-line"><span>模型总用量</span><strong>{fmtTokens(modelTotal)}</strong></div></section>
        <section className="usage-card"><div className="usage-card-head"><div><strong>常用项目</strong><span>把时间花在哪里</span></div><span className="usage-caption">{stats?.byProject?.length ?? 0} 个</span></div><RankBars items={stats?.byProject ?? []} valueKey="tokens" empty="还没有项目使用记录" format={fmtTokens} /><div className="usage-total-line"><span>项目总用量</span><strong>{fmtTokens(projectTotal)}</strong></div></section>
        <section className="usage-card"><div className="usage-card-head"><div><strong>一周节奏</strong><span>按星期几查看消息量</span></div></div><div className="usage-week-bars">{weekday.map((value, index) => <div className="usage-week-bar" key={index} title={`${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][index]} · ${value} 条`}><span style={{ height: `${Math.max(value > 0 ? 8 : 2, (value / weekdayMax) * 100)}%` }} /><small>{['一', '二', '三', '四', '五', '六', '日'][index]}</small></div>)}</div><div className="usage-total-line"><span>最常工作的项目</span><strong className="truncate">{dash(topProject?.name)}</strong></div></section>
      </div>

      <div className="usage-two-grid">
        <section className="usage-card"><div className="usage-card-head"><div><strong>技能与协作</strong><span>模型真正调用过的能力</span></div><span className="usage-caption">{stats?.skillsUsed ?? 0} 次调用</span></div><RankBars items={(stats?.bySkill ?? []).map((item) => ({ name: item.name, runs: item.runs }))} valueKey="runs" empty="还没有技能调用记录" /></section>
        <section className="usage-card"><div className="usage-card-head"><div><strong>模型与供应商</strong><span>实际消耗的 token</span></div></div><RankBars items={(stats?.byProvider ?? []).map((item) => ({ name: item.name, tokens: item.tokens }))} valueKey="tokens" empty="还没有供应商使用记录" format={fmtTokens} /><div className="usage-total-line"><span>最常用供应商</span><strong>{dash(topProviderName)}</strong></div></section>
      </div>

      <section className="usage-card usage-detail-card"><div className="usage-card-head"><div><strong>统计摘要</strong><span>把复杂数字换成一句容易理解的话</span></div></div><div className="usage-detail-grid"><div><span>最常用思考强度</span><strong>{effortLabel}</strong></div><div><span>安装技能</span><strong>{stats ? `${stats.enabledSkillCount ?? 0} / ${stats.skillCount}` : '—'}</strong></div><div><span>子智能体调用</span><strong>{stats?.agentRuns ?? 0} 次</strong></div><div><span>连接器调用</span><strong>{stats?.connectorRuns ?? 0} 次</strong></div><div><span>会话总数</span><strong>{stats?.sessionCount ?? 0}</strong></div><div><span>平均每次对话</span><strong>{stats && stats.promptCount ? `${fmtTokens(stats.totalTokens / stats.promptCount)} tokens` : '—'}</strong></div></div><p className="usage-card-note">统计只读取本机的会话记录，不会上传题目、论文或文件内容。删除本地项目后，对应的统计也会随之减少。</p></section>
    </div>
  );
}
