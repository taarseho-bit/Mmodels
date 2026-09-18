/**
 * 本机投稿记录 —— 「分享论文」与「我的投稿」共用的单一存储。
 *
 * 原版的投稿记录由服务端返回（`review_pending` → `published` / `rejected` / `removed`；
 * 文案见 `papers.status.*`）。本复刻排除云端，记录只落在 localStorage。
 *
 * 两条提交入口 —— 数模广场页头的「分享论文」、顶栏的「分享论文」——
 * 现在都走同一个 `PaperShareDialog`，并在提交时调用本模块的 `registerSubmission()`，
 * 因此两条路径的登记行为与字段结构完全一致。
 */
export type PaperStatus = 'review_pending' | 'published' | 'rejected' | 'removed';

export interface LocalPaper {
  id: string;
  title: string;
  competition: string;
  year: number;
  problemCode: string;
  status: PaperStatus;
  submittedAt: number;
  pages?: number;
  cost?: number;
  reviewNote?: string;
}

/** 键名沿用原版 localStorage 约定 */
const KEY = 'mmodels:papers:mine:v1';

/** 记录变更事件 —— 让已挂载的「我的投稿」在弹窗提交后即时刷新 */
const CHANGED = 'mmodels:papers-changed';

export function loadPapers(): LocalPaper[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v as LocalPaper[]) : [];
  } catch {
    return [];
  }
}

export function savePapers(list: LocalPaper[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式下不可用，忽略 */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED));
}

export function subscribePapers(fn: () => void): () => void {
  window.addEventListener(CHANGED, fn);
  return () => window.removeEventListener(CHANGED, fn);
}

/**
 * 登记一条新投稿（最新的排在最前）。
 *
 * ⚠️ 原版这里由 Agent 读出 PDF 标题、竞赛、题号后回填；
 * 本复刻在**提交弹窗**里先行登记「待审核」记录（用项目名占位），
 * 让「我的投稿」立刻有反馈，字段与原版一致。
 */
export function registerSubmission(input: {
  title: string;
  competition?: string;
  year?: number;
  problemCode?: string;
  pages?: number;
  cost?: number;
}): LocalPaper {
  const paper: LocalPaper = {
    id: `p_${Date.now().toString(36)}`,
    title: input.title,
    competition: input.competition ?? '',
    year: input.year ?? 0,
    problemCode: input.problemCode ?? '',
    status: 'review_pending',
    submittedAt: Date.now(),
    pages: input.pages,
    cost: input.cost,
  };
  savePapers([paper, ...loadPapers()]);
  return paper;
}
