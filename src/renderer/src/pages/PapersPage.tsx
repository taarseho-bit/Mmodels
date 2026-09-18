/**
 * 数模广场 —— 复刻原版 `PapersPage`。
 *
 * 原版「全部论文」从 MathModel 服务端拉取公开论文并受每日阅读额度限制；
 * 本项目不含服务端，因此公开广场用**本地收录的论文元数据**渲染——
 * 字段结构、筛选维度、卡片排版与原版逐项对齐（数据取自原版首屏的 9 条），
 * 但点开阅读（服务端正文 / 额度拦截）不复刻。
 * 「我的投稿」为本机记录（localStorage），状态流转与文案与原版一致。
 *
 * 结构对齐点（见 `.workbuddy/ui-audit/diffs/part-pages.md` §02-square）：
 *   - 页头：`数模广场 / 仅接受 Agent 生成的论文` + 右上「分享论文」（原版是页面级按钮）
 *   - 两枚独立胶囊 tab：全部论文 / 我的投稿
 *   - 三行筛选：竞赛（全部 / 全国大学生数学建模竞赛 / 研究生数学建模竞赛）、
 *     年份（全部 / 2026 / 2025 / 2024 / 2011）、题号（全部 / A 题 / B 题 / C 题 / E 题）
 *   - 卡片：整页缩略图 + 标题（2 行截断）+ `竞赛 · 年份 · 题号` + `N 页` + 点赞数
 *
 * 「分享论文」只打开 `PaperShareDialog`（与顶栏同一个入口、同一套登记逻辑），
 * 不再直接往输入框塞指令。
 */
import { useEffect, useMemo, useState } from 'react';
import { PageShell, EmptyState } from '../components/PageShell';
import { PaperShareDialog } from '../components/PaperShareDialog';
import {
  loadPapers,
  savePapers,
  subscribePapers,
  type LocalPaper,
  type PaperStatus,
} from '../store/paper-submissions';
import { t, tx } from '../i18n';

type Tab = 'all' | 'mine';

/** 广场论文的竞赛维度（值是 i18n 中文原文，走 t() 取译文） */
type CompId = 'cumcm' | 'graduate';

const COMP_LABEL: Record<CompId, string> = {
  cumcm: '全国大学生数学建模竞赛',
  graduate: '研究生数学建模竞赛',
};

interface SquarePaper {
  id: string;
  title: string;
  comp: CompId;
  year: number;
  problemCode: string;
  pages: number;
  likes: number;
}

/** 原版广场首屏的 9 条论文元数据（逐字取自 02-square.txt） */
const PAPERS: SquarePaper[] = [
  {
    id: 'p01',
    title: '可靠性约束下的 NIPT 检测时点优化——男胎检测时点与女胎染色体异常的模型构建',
    comp: 'cumcm',
    year: 2025,
    problemCode: 'C',
    pages: 77,
    likes: 7,
  },
  {
    id: 'p02',
    title: '基于信息边界递进的微网购电—储能滚动优化模型',
    comp: 'cumcm',
    year: 2026,
    problemCode: 'C',
    pages: 77,
    likes: 3,
  },
  {
    id: 'p03',
    title: '基于全目标视锥与事件驱动优化的烟幕干扰弹协同投放策略',
    comp: 'cumcm',
    year: 2025,
    problemCode: 'A',
    pages: 53,
    likes: 3,
  },
  {
    id: 'p04',
    title: '基于多域特征融合与域对抗迁移学习的高速列车轴承智能故障诊断',
    comp: 'graduate',
    year: 2025,
    problemCode: 'E',
    pages: 31,
    likes: 3,
  },
  {
    id: 'p05',
    title: '基于红外干涉光谱的碳化硅外延层厚度测定模型',
    comp: 'cumcm',
    year: 2025,
    problemCode: 'B',
    pages: 36,
    likes: 2,
  },
  {
    id: 'p06',
    title: '基于Markov决策与稳健优化的产品质量控制与装配策略研究',
    comp: 'cumcm',
    year: 2024,
    problemCode: 'B',
    pages: 61,
    likes: 1,
  },
  {
    id: 'p07',
    title: '无人机烟幕干扰弹投放策略的几何遮蔽判据与多层次优化模型',
    comp: 'cumcm',
    year: 2025,
    problemCode: 'A',
    pages: 64,
    likes: 1,
  },
  {
    id: 'p08',
    title: '基于多元回归与风险优化的 NIPT 检测时点选择及胎儿异常判定模型',
    comp: 'cumcm',
    year: 2025,
    problemCode: 'C',
    pages: 24,
    likes: 0,
  },
  {
    id: 'p09',
    title: '交巡警服务平台的设置与调度',
    comp: 'cumcm',
    year: 2011,
    problemCode: 'B',
    pages: 25,
    likes: 0,
  },
];

const FILTER_YEARS = [2026, 2025, 2024, 2011];
const FILTER_CODES = ['A', 'B', 'C', 'E'];

const STATUS_STYLE: Record<PaperStatus, string> = {
  review_pending: 'badge-warning',
  published: 'badge-success',
  rejected: 'badge-danger',
  removed: 'badge',
};

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────
// 图标（原版空态 / 卡片统计用线性 SVG，不用 emoji）
// ─────────────────────────────────────────────────────────────

function DocIcon({ size = 26 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  );
}

function HeartIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20s-7-4.6-7-9.3A4 4 0 0 1 12 8a4 4 0 0 1 7 2.7C19 15.4 12 20 12 20z" />
    </svg>
  );
}

function UploadIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7.5 8.5 4.5-4.5 4.5 4.5" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────

/** 广场论文卡：整页缩略图 + 标题 + `竞赛 · 年份 · 题号` + `N 页` + 点赞数 */
function PaperCard({ p }: { p: SquarePaper }): JSX.Element {
  return (
    <article className="sq-card">
      <div className="sq-thumb" aria-hidden="true">
        <div className="sq-thumb-title">{p.title}</div>
        <div className="sq-thumb-lines" />
      </div>
      <div className="sq-card-title">{p.title}</div>
      <div className="sq-card-meta">
        {t(COMP_LABEL[p.comp])} · {p.year} · {tx('papers.page.problem', { code: p.problemCode })}
      </div>
      <div className="sq-card-foot">
        <span className="sq-card-stat">{tx('papers.page.pages', { count: p.pages })}</span>
        <span className="sq-card-stat" title={tx('papers.detail.likes')}>
          <HeartIcon />
          {p.likes}
        </span>
      </div>
    </article>
  );
}

function MineRow({
  p,
  onWithdraw,
}: {
  p: LocalPaper;
  onWithdraw: () => void;
}): JSX.Element {
  return (
    <div className="paper-row">
      <div className="paper-main">
        <div className="paper-title">{p.title}</div>
        <div className="paper-meta">
          <span>{p.competition}</span>
          {p.year ? <span>{p.year}</span> : null}
          {p.problemCode ? (
            <span>{tx('papers.page.problem', { code: p.problemCode })}</span>
          ) : null}
          <span>{fmtDate(p.submittedAt)}</span>
          {p.pages ? <span>{tx('papers.page.pages', { count: p.pages })}</span> : null}
          {typeof p.cost === 'number' ? <span>¥{p.cost}</span> : null}
        </div>
        {p.reviewNote ? (
          <div className="paper-abstract" style={{ color: 'var(--warning)' }}>
            {tx('papers.page.reviewNote', { note: p.reviewNote })}
          </div>
        ) : null}
      </div>
      <div className="comp-side">
        <span className={`badge ${STATUS_STYLE[p.status] ?? 'badge'}`}>
          {tx(`papers.status.${p.status}`)}
        </span>
        {p.status === 'review_pending' || p.status === 'rejected' ? (
          <button className="btn btn-sm btn-ghost" onClick={onWithdraw}>
            {tx('papers.page.withdraw')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function PapersPage(): JSX.Element {
  const [tab, setTab] = useState<Tab>('all');
  const [mine, setMine] = useState<LocalPaper[]>(() => loadPapers());
  const [comp, setComp] = useState<CompId | 'all'>('all');
  const [year, setYear] = useState<number | 'all'>('all');
  const [code, setCode] = useState<string>('all');
  const [shareOpen, setShareOpen] = useState(false);

  /**
   * 投稿记录的唯一写入方是 `PaperShareDialog`（页头与顶栏共用它），
   * 所以这里订阅存储变更 —— 弹窗提交后本页立刻能看到新记录，
   * 不必等重新进入页面。
   */
  useEffect(() => subscribePapers(() => setMine(loadPapers())), []);

  const papers = useMemo(
    () =>
      PAPERS.filter(
        (p) =>
          (comp === 'all' || p.comp === comp) &&
          (year === 'all' || p.year === year) &&
          (code === 'all' || p.problemCode === code),
      ),
    [comp, year, code],
  );

  const withdraw = (id: string): void => {
    setMine((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, status: 'removed' as PaperStatus } : p));
      savePapers(next);
      return next;
    });
  };

  const chip = (active: boolean, label: string, onClick: () => void): JSX.Element => (
    <button
      key={`${label}:${String(active)}`}
      type="button"
      className={`sq-chip${active ? ' active' : ''}`}
      onClick={onClick}
    >
      {label}
    </button>
  );

  return (
    <PageShell
      title={tx('papers.page.title')}
      description={tx('papers.page.description')}
      action={
        <button
          type="button"
          className="btn btn-sm"
          title={tx('papers.share.tooltip')}
          onClick={() => setShareOpen(true)}
        >
          <UploadIcon />
          {tx('papers.share.form.title')}
        </button>
      }
    >
      <div className="sq-page">
        {/* ── 标签页（原版是两枚独立胶囊） ── */}
        <div className="sq-tabs">
          {chip(tab === 'all', tx('papers.page.tabs.all'), () => setTab('all'))}
          {chip(tab === 'mine', tx('papers.page.tabs.mine'), () => setTab('mine'))}
        </div>

        {tab === 'all' ? (
          <>
            {/* ── 三行筛选：竞赛 / 年份 / 题号 ── */}
            <div className="sq-filters">
              <div className="sq-filter-row">
                <span className="sq-filter-label">{tx('papers.page.filters.competition')}</span>
                {chip(comp === 'all', tx('papers.page.filters.all'), () => setComp('all'))}
                {(Object.keys(COMP_LABEL) as CompId[]).map((c) =>
                  chip(comp === c, t(COMP_LABEL[c]), () => setComp(c)),
                )}
              </div>

              <div className="sq-filter-row">
                <span className="sq-filter-label">{tx('papers.page.filters.year')}</span>
                {chip(year === 'all', tx('papers.page.filters.all'), () => setYear('all'))}
                {FILTER_YEARS.map((y) => chip(year === y, String(y), () => setYear(y)))}
              </div>

              <div className="sq-filter-row">
                <span className="sq-filter-label">{tx('papers.page.filters.problem')}</span>
                {chip(code === 'all', tx('papers.page.filters.all'), () => setCode('all'))}
                {FILTER_CODES.map((c) =>
                  chip(code === c, tx('papers.page.problem', { code: c }), () => setCode(c)),
                )}
              </div>
            </div>

            {papers.length === 0 ? (
              <EmptyState
                icon={<DocIcon />}
                title={tx('papers.page.empty')}
                description={tx('papers.page.emptyDescription')}
                fill={false}
              />
            ) : (
              <div className="sq-grid">
                {papers.map((p) => (
                  <PaperCard key={p.id} p={p} />
                ))}
              </div>
            )}
          </>
        ) : mine.length === 0 ? (
          <EmptyState
            icon={<DocIcon />}
            title={tx('papers.page.mineEmpty')}
            description={tx('papers.page.mineEmptyDescription')}
            fill={false}
          />
        ) : (
          <div className="paper-list">
            {mine.map((p) => (
              <MineRow key={p.id} p={p} onWithdraw={() => withdraw(p.id)} />
            ))}
          </div>
        )}
      </div>

      {/* 与顶栏「分享论文」同一个入口 —— 保证两处行为一致 */}
      <PaperShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
    </PageShell>
  );
}
