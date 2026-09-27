/**
 * 竞赛日历页 —— 本地设计 `CompetitionsPage`（应用约定最大的页面 chunk，218 KB）。
 *
 * 应用约定用 FullCalendar 做月历（zh-cn locale，周一为首列）+ 右侧栏
 * （近期赛事 / 全部赛事 + 筛选 + 赛事卡）。本项目不引该依赖，
 * 用自实现的月历网格 + 右栏达到同等信息呈现：
 *   - 周一起始（对齐 FullCalendar zh-cn 的 `week:{dow:1,doy:4}`）
 *   - 跨天事件渲染成横跨多列的圆角横条，标题 `简称 · MM.DD—MM.DD`
 *   - 月历右上角三色图例（报名截止 / 比赛进行 / 作品截止）
 *   - 右栏：近期赛事（默认 3 条，可展开）+ 全部赛事（年度 / 类型筛选 + 卡片）
 *
 * 所有文案一律走 `competitions.*` 命名空间（当前 i18n 资源）。
 * 数据来自 `@shared/competitions-data`（当前主进程内联的 114 条赛季数据）。
 */
import { useMemo, useState } from 'react';
import {
  COMPETITIONS,
  CATEGORY_KEY,
  EVENT_KIND_KEY,
  AUDIENCE_KEY,
  stageOf,
  type Competition,
  type CompetitionAudience,
  type CompetitionCategory,
  type CompetitionEvent,
} from '@shared/competitions-data';
import { PageShell } from '../components/PageShell';
import { t, tx } from '../i18n';

/** 收藏键名沿用应用约定 localStorage 约定 */
const FAV_KEY = 'mmodels:competition-favorites:v1';

function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveFavorites(ids: string[]): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify(ids));
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
}

// ─────────────────────────────────────────────────────────────
// 日期工具
// ─────────────────────────────────────────────────────────────

/** 把 ISO 时间串截成 YYYY-MM-DD（保留原时区语义，不做偏移换算） */
const dayOf = (iso: string): string => iso.slice(0, 10);

function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** 本地日期 → 连续天数序号（用 UTC 构造，避免夏令时导致跨天算错） */
const dayIdx = (d: Date): number =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

/** `2026-09-10` → `09.10` */
const mmdd = (s: string): string => `${s.slice(5, 7)}.${s.slice(8, 10)}`;
/** `2026-09-10` → `2026.09.10` */
const ymd = (s: string): string => `${s.slice(0, 4)}.${s.slice(5, 7)}.${s.slice(8, 10)}`;

function fmtDay(s: string): string {
  const [, m, d] = s.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

function fmtRange(start: string, end: string | null): string {
  if (!end) return `${fmtDay(start)} 起`;
  const sd = dayOf(start);
  const ed = dayOf(end);
  return sd === ed ? fmtDay(sd) : `${fmtDay(sd)} — ${fmtDay(ed)}`;
}

/** 赛事在列表里的日期行：优先「比赛」事件，否则第一条事件；无事件则回落到赛程状态 */
function rangeText(c: Competition): string {
  const ev = c.events.find((e) => e.kind === 'competition') ?? c.events[0];
  if (!ev) return `${c.year} · ${tx(`competitions.stages.${stageOf(c)}`)}`;
  const s = dayOf(ev.start);
  const e = ev.end ? dayOf(ev.end) : null;
  if (!e || e === s) return ymd(s);
  return `${ymd(s)} — ${mmdd(e)}`;
}

/** 近期赛事 / 月历横条上的事件短标签（应用约定：比赛 → 「开赛」，其余用事件类型名） */
function eventShortLabel(ev: CompetitionEvent): string {
  return ev.kind === 'competition'
    ? tx('competitions.start')
    : tx(`competitions.kinds.${EVENT_KIND_KEY[ev.kind]}`);
}

/**
 * 星期表头。应用约定此处用 FullCalendar 的 zh-cn locale
 * （该 locale 对象就在 CompetitionsPage chunk 内，`week:{dow:1,doy:4}` 写死周一为首列），
 * 这里直接采用其 `weekText` 值「周」并按周一开头排列。
 */
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

// ─────────────────────────────────────────────────────────────
// 迷你月历（2026-09-25 大改：不再画跨天横条 —— 每天最多三枚事件色点，
// 整体高度收进一屏；点日期在下方列出当日赛事，点赛事行开详情）
// ─────────────────────────────────────────────────────────────

interface MiniCell {
  date: Date;
  day: number;
  dim: boolean;
}

function monthGridCells(year: number, month: number): MiniCell[] {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 周一 = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: MiniCell[] = [];
  for (let i = 0; i < firstDow; i++) {
    const d = new Date(year, month, 1);
    d.setDate(d.getDate() - (firstDow - i));
    cells.push({ date: d, day: d.getDate(), dim: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: new Date(year, month, d), day: d, dim: false });
  }
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1].date;
    const d = new Date(last);
    d.setDate(d.getDate() + 1);
    cells.push({ date: d, day: d.getDate(), dim: true });
  }
  return cells;
}

/** 当月有事件的日子 → 事件列表（日期序号从 1 起） */
function eventsByDay(
  year: number,
  month: number,
  items: Array<{ ev: CompetitionEvent; comp: Competition }>,
): Map<number, Array<{ ev: CompetitionEvent; comp: Competition }>> {
  const startIdx = dayIdx(new Date(year, month, 1));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const endIdx = startIdx + daysInMonth - 1;
  const map = new Map<number, Array<{ ev: CompetitionEvent; comp: Competition }>>();
  for (const it of items) {
    const a = Math.max(dayIdx(parseDay(dayOf(it.ev.start))), startIdx);
    const b = Math.min(dayIdx(parseDay(dayOf(it.ev.end ?? it.ev.start))), endIdx);
    for (let idx = a; idx <= b; idx++) {
      const day = idx - startIdx + 1;
      const arr = map.get(day) ?? [];
      arr.push(it);
      map.set(day, arr);
    }
  }
  return map;
}

function MiniMonth({
  year,
  month,
  items,
  pickedDay,
  onPickDay,
  onOpen,
}: {
  year: number;
  month: number;
  items: Array<{ ev: CompetitionEvent; comp: Competition }>;
  pickedDay: number | null;
  onPickDay: (day: number | null) => void;
  onOpen: (c: Competition) => void;
}): JSX.Element {
  const cells = useMemo(() => monthGridCells(year, month), [year, month]);
  const byDay = useMemo(() => eventsByDay(year, month, items), [year, month, items]);
  const todayIdx = dayIdx(new Date());

  return (
    <div className="cal-mini">
      <div className="cal-mini-head" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="cal-mini-grid">
        {cells.map((c, i) => {
          const evs = byDay.get(c.day) ?? [];
          const idx = dayIdx(c.date);
          const inMonth = !c.dim;
          const isToday = idx === todayIdx;
          const isPicked = pickedDay === c.day && inMonth;
          return (
            <button
              key={i}
              type="button"
              className={`cal-mini-cell${c.dim ? ' dim' : ''}${isToday ? ' today' : ''}${
                isPicked ? ' picked' : ''
              }${evs.length ? ' has-events' : ''}`}
              disabled={c.dim && evs.length === 0}
              onClick={() => {
                if (c.dim) return;
                onPickDay(pickedDay === c.day ? null : c.day);
              }}
              title={
                evs.length
                  ? evs.map((x) => `${x.comp.shortName || x.comp.name} · ${eventShortLabel(x.ev)}`).join('\n')
                  : undefined
              }
            >
              <span className="cal-mini-day">{c.day}</span>
              <span className="cal-mini-dots" aria-hidden="true">
                {[...new Set(evs.map((x) => x.ev.kind))].slice(0, 3).map((k) => (
                  <i key={k} className={`cal-mini-dot kind-${k}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {/* 点日期后列出当日赛事（小屏信息不丢） */}
      {pickedDay !== null ? (
        <div className="cal-mini-daylist">
          <div className="cal-mini-daylist-head">
            <span>
              {t('{{month}}月{{day}}日', { month: month + 1, day: pickedDay })} ·{' '}
              {(byDay.get(pickedDay) ?? []).length} 项
            </span>
            <button type="button" className="cmp-clear" onClick={() => onPickDay(null)}>
              {tx('competitions.reset')}
            </button>
          </div>
          {(byDay.get(pickedDay) ?? []).map((x) => (
            <button
              key={`${x.comp.id}:${x.ev.kind}:${x.ev.start}`}
              type="button"
              className="cal-mini-dayitem"
              onClick={() => onOpen(x.comp)}
            >
              <span className={`cmp-recent-kind kind-${x.ev.kind}`}>{eventShortLabel(x.ev)}</span>
              <span className="truncate">{x.comp.shortName || x.comp.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 右栏「近期赛事」的一条：`09.19 / 周六 | 华为杯 ●报名截止 | ☆` */
function RecentRow({
  comp,
  ev,
  fav,
  onToggleFav,
  onOpen,
}: {
  comp: Competition;
  ev: CompetitionEvent;
  fav: boolean;
  onToggleFav: () => void;
  onOpen: () => void;
}): JSX.Element {
  const d = parseDay(dayOf(ev.start));
  return (
    <div className="cmp-recent-row">
      <button type="button" className="cmp-recent-main" onClick={onOpen}>
        <span className="cmp-recent-date">
          <span className="cmp-recent-md">{mmdd(dayOf(ev.start))}</span>
          <span className="cmp-recent-dow">周{WEEKDAYS[(d.getDay() + 6) % 7]}</span>
        </span>
        <span className="cmp-recent-text">
          <span className="cmp-recent-name">{comp.shortName || comp.name}</span>
          <span className={`cmp-recent-kind kind-${ev.kind}`}>{eventShortLabel(ev)}</span>
        </span>
      </button>
      <button
        type="button"
        className="cmp-star"
        onClick={onToggleFav}
        title={fav ? tx('competitions.unfavorite') : tx('competitions.favorite')}
      >
        {fav ? '★' : '☆'}
      </button>
    </div>
  );
}

/** 右栏「全部赛事」卡：名称 + ☆ / 日期区间 / [状态] + 参赛对象 */
function CatalogCard({
  c,
  fav,
  onToggleFav,
  onOpen,
}: {
  c: Competition;
  fav: boolean;
  onToggleFav: () => void;
  onOpen: () => void;
}): JSX.Element {
  const stage = stageOf(c);
  const showStage = stage === 'upcoming' || stage === 'ongoing' || stage === 'ended';
  return (
    <div className="cmp-card">
      <div className="cmp-card-head">
        <button type="button" className="cmp-card-name" onClick={onOpen}>
          {c.shortName || c.name}
        </button>
        <button
          type="button"
          className="cmp-star"
          onClick={onToggleFav}
          title={fav ? tx('competitions.unfavorite') : tx('competitions.favorite')}
        >
          {fav ? '★' : '☆'}
        </button>
      </div>
      <div className="cmp-card-range">{rangeText(c)}</div>
      <div className="cmp-card-foot">
        {showStage ? <span className="badge">{tx(`competitions.stages.${stage}`)}</span> : null}
        <span className="cmp-card-aud">
          {c.audiences.map((a) => tx(`competitions.audiences.${AUDIENCE_KEY[a]}`)).join(' / ')}
        </span>
      </div>
    </div>
  );
}

function DetailPanel({
  c,
  fav,
  onToggleFav,
  onClose,
}: {
  c: Competition;
  fav: boolean;
  onToggleFav: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <div className="panel" style={{ padding: 'var(--sp-4)' }}>
      <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{c.name}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            {tx(`competitions.categories.${CATEGORY_KEY[c.category]}`)} ·{' '}
            {tx(`competitions.stages.${stageOf(c)}`)}
          </div>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={onToggleFav}>
          {fav ? `★ ${tx('competitions.unfavorite')}` : `☆ ${tx('competitions.favorite')}`}
        </button>
        <button className="btn btn-sm" onClick={onClose}>
          {tx('papers.detail.close')}
        </button>
      </div>

      <div
        className="col"
        style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', fontSize: 12, lineHeight: 1.75 }}
      >
        <div>
          <span className="muted">{tx('competitions.organizer')}：</span>
          {c.organizer || '—'}
        </div>
        <div>
          <span className="muted">{tx('competitions.eligibility')}：</span>
          {c.eligibility || '—'}
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          <span className="muted">{tx('competitions.allAudiences')}：</span>
          {c.audiences.map((a) => (
            <span key={a} className="badge">
              {tx(`competitions.audiences.${AUDIENCE_KEY[a]}`)}
            </span>
          ))}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>
          {tx('competitions.timezone', { zone: c.timeZone })}
        </div>
        {c.scheduleNote ? (
          <div>
            <span className="muted">{tx('competitions.schedule')}：</span>
            {c.scheduleNote}
          </div>
        ) : null}
        {c.description ? <div style={{ color: 'var(--fg-secondary)' }}>{c.description}</div> : null}
      </div>

      {c.events.length ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
            {tx('competitions.details')}
          </div>
          {c.events.map((ev, i) => (
            <div
              key={i}
              className="row"
              style={{ gap: 'var(--sp-2)', fontSize: 12, padding: '3px 0' }}
            >
              <span className="badge">{tx(`competitions.kinds.${EVENT_KIND_KEY[ev.kind]}`)}</span>
              <span>{fmtRange(ev.start, ev.end)}</span>
            </div>
          ))}
        </div>
      ) : null}

      {c.sources.length ? (
        <div style={{ marginTop: 'var(--sp-3)' }}>
          <div className="muted" style={{ fontSize: 11, fontWeight: 500, marginBottom: 6 }}>
            {tx('competitions.sources')}
          </div>
          <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            {c.sources.map((s, i) => (
              <a
                key={i}
                className="btn btn-sm btn-ghost"
                href={s.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {s.title}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      <div className="row" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)', flexWrap: 'wrap' }}>
        {c.websiteUrl ? (
          <a className="btn btn-sm" href={c.websiteUrl} target="_blank" rel="noreferrer noopener">
            {tx('competitions.website')}
          </a>
        ) : null}
        {c.registrationUrl ? (
          <a
            className="btn btn-sm"
            href={c.registrationUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {tx('competitions.register')}
          </a>
        ) : null}
      </div>

      {c.verifiedAt ? (
        <div className="muted" style={{ fontSize: 11, marginTop: 10 }}>
          {tx('competitions.verified', { date: c.verifiedAt })}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 主页面
// ─────────────────────────────────────────────────────────────

/** 页头「所有对象」下拉的取值（应用约定 `competitions.allAudiences`） */
const AUDIENCES: CompetitionAudience[] = [
  'undergraduate',
  'vocational',
  'graduate',
  'teacher',
  'school',
  'other',
];

/** 页头「所有状态」下拉：应用约定按展示阶段筛（即将开始 / 比赛中 / 已结束 …） */
const STAGES = [
  'upcoming',
  'ongoing',
  'ended',
  'estimated',
  'tba',
  'paused',
  'historical',
] as const;
type StageFilter = (typeof STAGES)[number] | 'all';

/** 月历图例（应用约定三色点，顺序与 FullCalendar 事件类一致） */
const LEGEND: CompetitionEvent['kind'][] = ['registration', 'competition', 'submission'];

export function CompetitionsPage(): JSX.Element {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [cat, setCat] = useState<CompetitionCategory | 'all'>('all');
  const [year, setYear] = useState<number | 'all'>('all');
  const [aud, setAud] = useState<CompetitionAudience | 'all'>('all');
  const [stg, setStg] = useState<StageFilter>('all');
  const [favOnly, setFavOnly] = useState(false);
  const [q, setQ] = useState('');
  const [recentOpen, setRecentOpen] = useState(false);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [open, setOpen] = useState<Competition | null>(null);
  /** 迷你月历选中的日子（null = 看整月） */
  const [pickedDay, setPickedDay] = useState<number | null>(null);

  const toggleFav = (id: string): void => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      saveFavorites(next);
      return next;
    });
  };

  const years = useMemo(
    () => [...new Set(COMPETITIONS.map((c) => c.year))].sort((a, b) => b - a),
    [],
  );

  /** 页头筛选（收藏 / 对象 / 状态 / 关键词） */
  const base = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return COMPETITIONS.filter((c) => {
      if (favOnly && !favorites.includes(c.id)) return false;
      if (aud !== 'all' && !c.audiences.includes(aud)) return false;
      if (stg !== 'all' && stageOf(c) !== stg) return false;
      if (kw) {
        const hay = `${c.name} ${c.shortName} ${c.organizer} ${c.description}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [aud, favOnly, favorites, q, stg]);

  /** 右栏筛选（年度 / 类型） */
  const listItems = useMemo(
    () =>
      base.filter(
        (c) => (cat === 'all' || c.category === cat) && (year === 'all' || c.year === year),
      ),
    [base, cat, year],
  );

  /** 月历只画「已公布赛程」（应用约定行为），并保证跨天横条优先占道 */
  const monthItems = useMemo(() => {
    const raw: Array<{ ev: CompetitionEvent; comp: Competition }> = [];
    for (const c of listItems) {
      if (c.status !== 'scheduled') continue;
      for (const ev of c.events) raw.push({ ev, comp: c });
    }
    return raw.sort((a, b) => {
      const as = dayIdx(parseDay(dayOf(a.ev.start)));
      const bs = dayIdx(parseDay(dayOf(b.ev.start)));
      if (as !== bs) return as - bs;
      const al = dayIdx(parseDay(dayOf(a.ev.end ?? a.ev.start))) - as;
      const bl = dayIdx(parseDay(dayOf(b.ev.end ?? b.ev.start))) - bs;
      return bl - al;
    });
  }, [listItems]);

  /** 本月无已公布赛程时，退回显示预计赛程（应用约定「本月预计赛事」） */
  const estimatedThisMonth = useMemo(() => {
    const ym = `${cursor.y}-${String(cursor.m + 1).padStart(2, '0')}`;
    return listItems.filter(
      (c) => c.status === 'estimated' && (c.estimatedMonths ?? []).includes(ym),
    );
  }, [listItems, cursor]);

  /** 近期赛事：按事件开始时间升序取接下来 N 场（应用约定默认 3 条，展开后更多） */
  const recent = useMemo(() => {
    const nowMs = Date.now();
    const out: Array<{ ev: CompetitionEvent; comp: Competition }> = [];
    for (const c of listItems) {
      for (const ev of c.events) {
        const endMs = Date.parse(ev.end ?? ev.start);
        if (Number.isNaN(endMs) || endMs < nowMs) continue;
        out.push({ ev, comp: c });
      }
    }
    return out.sort((a, b) => Date.parse(a.ev.start) - Date.parse(b.ev.start));
  }, [listItems]);

  const recentShown = recentOpen ? recent.slice(0, 10) : recent.slice(0, 3);

  const move = (delta: number): void => {
    setPickedDay(null);
    setCursor((p) => {
      const d = new Date(p.y, p.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };

  const headerSelect = (value: string, onChange: (v: string) => void, options: JSX.Element[]): JSX.Element => (
    <select
      className="input cmp-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options}
    </select>
  );

  return (
    <PageShell
      title={tx('competitions.title')}
      description={tx('competitions.subtitle')}
      action={
        <>
          <div className="cmp-search">
            <svg className="cmp-search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 10.5 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              className="input"
              placeholder={tx('competitions.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {headerSelect(
            aud,
            (v) => setAud(v as CompetitionAudience | 'all'),
            [
              <option key="all" value="all">
                {tx('competitions.allAudiences')}
              </option>,
              ...AUDIENCES.map((a) => (
                <option key={a} value={a}>
                  {tx(`competitions.audiences.${AUDIENCE_KEY[a]}`)}
                </option>
              )),
            ],
          )}

          {headerSelect(
            stg,
            (v) => setStg(v as StageFilter),
            [
              <option key="all" value="all">
                {tx('competitions.allStatuses')}
              </option>,
              ...STAGES.map((s) => (
                <option key={s} value={s}>
                  {tx(`competitions.stages.${s}`)}
                </option>
              )),
            ],
          )}

          <button
            type="button"
            className={`btn btn-sm${favOnly ? ' btn-primary' : ' btn-ghost'}`}
            onClick={() => setFavOnly((v) => !v)}
            title={tx('competitions.favorites')}
          >
            {favOnly ? '★' : '☆'} {tx('competitions.favorites')}
          </button>
        </>
      }
    >
      <div className="cmp-page">
        <div className="cmp-layout">
          {/* ── 左：月历 ── */}
          <div className="cmp-main">
            {open ? (
              <DetailPanel
                c={open}
                fav={favorites.includes(open.id)}
                onToggleFav={() => toggleFav(open.id)}
                onClose={() => setOpen(null)}
              />
            ) : null}

            <div className="cmp-monthbar">
              <button
                type="button"
                className="cmp-nav"
                onClick={() => move(-1)}
                title={tx('competitions.previous')}
              >
                ‹
              </button>
              <span className="cmp-month">
                {t('{{year}}年{{month}}月', { year: cursor.y, month: cursor.m + 1 })}
              </span>
              <button
                type="button"
                className="cmp-nav"
                onClick={() => move(1)}
                title={tx('competitions.next')}
              >
                ›
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setPickedDay(null);
                  setCursor({ y: now.getFullYear(), m: now.getMonth() });
                }}
              >
                {tx('competitions.today')}
              </button>
            </div>

            <div className="cmp-legend">
              {LEGEND.map((k) => (
                <span key={k} className="cmp-legend-item">
                  <span className={`cmp-legend-dot kind-${k}`} aria-hidden="true" />
                  {tx(`competitions.kinds.${EVENT_KIND_KEY[k]}`)}
                </span>
              ))}
            </div>

            {monthItems.length === 0 && estimatedThisMonth.length === 0 ? (
              <div className="panel" style={{ padding: 'var(--sp-4)' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {tx('competitions.estimatedTitle')}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
                  {tx('competitions.estimatedHint')}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  {tx('competitions.noEvents')}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
                  {tx('competitions.estimatedDetail')}
                </div>
              </div>
            ) : null}

            {monthItems.length === 0 && estimatedThisMonth.length > 0 ? (
              <div className="panel" style={{ padding: 'var(--sp-4)' }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>
                  {tx('competitions.estimatedTitle')}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.7 }}>
                  {tx('competitions.estimatedHint')}
                </div>
                <div className="cal-list" style={{ marginTop: 10 }}>
                  {estimatedThisMonth.map((c) => (
                    <div key={c.id} className="row" style={{ gap: 8, fontSize: 12 }}>
                      <span className="badge">{tx('competitions.stages.estimated')}</span>
                      <span>{c.name}</span>
                      <span className="muted">
                        {tx('competitions.estimatedWindow', {
                          months: (c.estimatedMonths ?? []).join(' / '),
                        })}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.7 }}>
                  {tx('competitions.estimatedDetail')}
                </div>
              </div>
            ) : null}

            <MiniMonth
              year={cursor.y}
              month={cursor.m}
              items={monthItems}
              pickedDay={pickedDay}
              onPickDay={setPickedDay}
              onOpen={setOpen}
            />
          </div>

          {/* ── 右：近期赛事 + 全部赛事 ── */}
          <aside className="cmp-side">
            <section className="cmp-block">
              <div className="cmp-block-head">
                <span className="cmp-block-title">{tx('competitions.upcoming')}</span>
                {recent.length > 3 ? (
                  <button
                    type="button"
                    className="cmp-nav cmp-nav-sm"
                    onClick={() => setRecentOpen((v) => !v)}
                    title={recentOpen ? t('收起') : t('展开')}
                  >
                    {recentOpen ? '‹' : '›'}
                  </button>
                ) : null}
              </div>
              {recentShown.length === 0 ? (
                <div className="cmp-side-empty">{tx('competitions.emptyUpcoming')}</div>
              ) : (
                recentShown.map((x) => (
                  <RecentRow
                    key={`${x.comp.id}:${x.ev.kind}:${x.ev.start}`}
                    comp={x.comp}
                    ev={x.ev}
                    fav={favorites.includes(x.comp.id)}
                    onToggleFav={() => toggleFav(x.comp.id)}
                    onOpen={() => setOpen(x.comp)}
                  />
                ))
              )}
            </section>

            <section className="cmp-block">
              <div className="cmp-block-head">
                <span className="cmp-block-title">{tx('competitions.catalog')}</span>
                <span className="cmp-block-count">
                  {tx('competitions.count', { count: listItems.length })}
                </span>
              </div>

              <div className="cmp-filters">
                {headerSelect(
                  String(year),
                  (v) => setYear(v === 'all' ? 'all' : Number(v)),
                  [
                    <option key="all" value="all">
                      {tx('competitions.allYears')}
                    </option>,
                    ...years.map((y) => (
                      <option key={y} value={y}>
                        {String(y)}
                      </option>
                    )),
                  ],
                )}

                {headerSelect(
                  cat,
                  (v) => setCat(v as CompetitionCategory | 'all'),
                  [
                    <option key="all" value="all">
                      {tx('competitions.allCategories')}
                    </option>,
                    ...(Object.keys(CATEGORY_KEY) as CompetitionCategory[]).map((k) => (
                      <option key={k} value={k}>
                        {tx(`competitions.categories.${CATEGORY_KEY[k]}`)}
                      </option>
                    )),
                  ],
                )}

                <button
                  type="button"
                  className="cmp-clear"
                  onClick={() => {
                    setYear('all');
                    setCat('all');
                  }}
                >
                  {tx('competitions.reset')}
                </button>
              </div>

              {listItems.length === 0 ? (
                <div className="cmp-side-empty">{tx('competitions.empty')}</div>
              ) : (
                <div className="cmp-cards">
                  {listItems.map((c) => (
                    <CatalogCard
                      key={c.id}
                      c={c}
                      fav={favorites.includes(c.id)}
                      onToggleFav={() => toggleFav(c.id)}
                      onOpen={() => setOpen(c)}
                    />
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
