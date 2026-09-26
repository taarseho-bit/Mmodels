/**
 * 本地论文归档 —— 归档入口与论文库共用的单一存储。
 *
 * 记录只保存在当前电脑，不上传到云端；状态用于区分待整理、已整理和已移除。
 *
 * 所有入口都走同一个归档弹窗，并在提交时调用本模块的 `registerSubmission()`，
 * 因此登记行为与字段结构保持一致。
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

/** 本地归档键名，保持版本升级时可迁移。 */
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
 * 归档弹窗先登记项目名、赛事和题号，随后允许用户补齐 PDF 元数据，
 * 让本地论文库立即有反馈。
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
