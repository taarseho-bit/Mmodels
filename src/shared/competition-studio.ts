export const COMPETITIONS = ['全国大学生数学建模竞赛', '美国大学生数学建模竞赛 MCM/ICM', '中国研究生数学建模竞赛', '其他竞赛 / 自主练习'];
export type Phase = '读题' | '求解' | '写作' | '核验' | '提交';
export interface Project {
  id: string; name: string; competition: string; year: number; problem: string; deadline: string;
  pageLimit: string; phase: Phase; rules: string; checklist: { id: string; text: string; done: boolean }[];
  alternatives: { id: string; name: string; score: string; risks: string }[];
  evidence: { id: string; claim: string; source: string; checked: boolean }[];
}
export interface Paper {
  id: string; title: string; competition: string; year: number; problem: string; award: string;
  source: string; notes: string; originalName: string; hash: string; bytes: number; added: number; favorite: boolean;
}
export interface StudioState {
  projects: Project[]; papers: Paper[];
}
export interface ImportRow { ticket: string; name: string; bytes: number }
export interface PaperInput { ticket: string; title: string; competition: string; year: number; problem: string; award: string; source: string }
export interface CompetitionLibraryApi {
  state(): Promise<StudioState>;
  saveProject(project: Project): Promise<StudioState>;
  ensureProject(id: string): Promise<StudioState>;
  pickPapers(): Promise<ImportRow[]>;
  importPapers(rows: PaperInput[], rightsConfirmed: boolean): Promise<{ state: StudioState; imported: number; duplicates: number }>;
  paperNote(id: string, notes: string, favorite: boolean): Promise<StudioState>;
  openPaper(id: string): Promise<void>;
  libraryFolder(): Promise<string>;
  revealLibrary(): Promise<void>;
  onState(fn: (s: StudioState) => void): () => void;
  revealProject(id: string): Promise<void>;
}
export const COMPETITION_IPC = {
  state: 'competition:state', saveProject: 'competition:save-project', ensureProject: 'competition:ensure-project',
  pickPapers: 'competition:pick-papers', importPapers: 'competition:import-papers', paperNote: 'competition:paper-note',
  openPaper: 'competition:open-paper', libraryFolder: 'competition:library-folder', revealLibrary: 'competition:reveal-library',
  revealProject: 'competition:reveal-project', changed: 'competition:changed',
} as const;
export function makeProject(id: string, name: string): Project {
  return { id, name, competition: COMPETITIONS[0], year: new Date().getFullYear(), problem: '', deadline: '', pageLimit: '', phase: '读题', rules: '',
    checklist: ['确认比赛最新规则与 AI 使用要求', '每个问题都有可复算的结果', '核对单位、约束与误差', '检查引用来源及数据授权', '检查匿名信息、页数与提交文件'].map((text, i) => ({ id: String(i), text, done: false })), alternatives: [], evidence: [] };
}
