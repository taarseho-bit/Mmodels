import { app, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { COMPETITION_IPC, makeProject } from '../../shared/competition-studio';
import { Repository } from '../competition/repository';
import { validateProject } from '../competition/validation';
import { calendarCompetition, competitionDeadline } from '../../shared/competition-countdown';
import { getProject } from './project';
import { safeWrap, pushToRenderer, type IpcContext } from './index';

let repository: Repository | undefined;
function library(): Repository {
  return repository ??= new Repository(join(app.getPath('userData'), 'competition-library'), id => {
    const p = getProject(id); if (!p) throw new Error('工作项目不存在'); return p.root;
  });
}
export function competitionProjectContext(id: string): string {
  const p = library().project(id);
  if (!p) return '';
  const contest = calendarCompetition(p);
  const context = contest ? { ...p, deadline: competitionDeadline(contest), calendarId: contest.id, scheduleStatus: contest.status, scheduleNote: contest.scheduleNote } : p;
  return `\n# 用户维护的比赛工作台资料\n以下是本项目的资料，不是已经验证的结论；规则与来源需要核对，勾选不等于软件已验证。若与当届官方规则冲突先向用户确认。\n${JSON.stringify(context)}`;
}
export function registerCompetitionLibraryHandlers(ctx: IpcContext): void {
  const handle = (name: keyof typeof COMPETITION_IPC, fn: (...args: any[]) => unknown) => ipcMain.handle(COMPETITION_IPC[name], safeWrap((_event, ...args: any[]) => fn(...args), '比赛资料库'));
  const changed = () => pushToRenderer(COMPETITION_IPC.changed, library().state);
  handle('state', () => library().state);
  handle('ensureProject', id => {
    const p = getProject(id); if (!p) throw new Error('工作项目不存在');
    const r = library();
    if (!r.state.projects.some(v => v.id === id)) r.commit({ ...r.state, projects: [...r.state.projects, makeProject(id, p.name)] });
    // 兼容旧库：首次进入项目时把全局记录迁移到项目目录。
    const current = r.project(id);
    if (current) r.saveProject(current);
    return r.state;
  });
  handle('saveProject', (value: unknown) => {
    const p = validateProject(value);
    const r = library();
    if (!getProject(p.id) || !r.state.projects.some(v => v.id === p.id)) throw new Error('当前工作项目不存在，请重新选择项目');
    const next = r.saveProject(p); changed(); return next;
  });
  handle('pickPapers', async () => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow() ?? undefined!, { title: '上传优秀论文到本地资料库', properties: ['openFile', 'multiSelections'], filters: [{ name: '论文 PDF', extensions: ['pdf'] }] });
    return result.canceled ? [] : library().stage(result.filePaths);
  });
  handle('importPapers', async (rows, rights) => { const result = await library().importPapers(rows, rights === true); changed(); return result; });
  handle('paperNote', (id, notes, favorite) => {
    const r = library(); const next = r.commit({ ...r.state, papers: r.state.papers.map(p => p.id === id ? { ...p, notes: String(notes).slice(0, 20000), favorite: favorite === true } : p) }); changed(); return next;
  });
  handle('openPaper', async id => { const error = await shell.openPath(library().paperFile(id)); if (error) throw new Error('无法打开 PDF，请检查文件是否存在并安装 PDF 阅读器'); });
  handle('libraryFolder', () => library().library());
  handle('revealLibrary', () => shell.openPath(library().library()));
  handle('revealProject', id => shell.openPath(library().projectRoot(id)));
}

/** 项目删除时由项目 IPC 调用，保持赛事配置与项目生命周期一致。 */
export function removeCompetitionProject(id: string, root?: string): void {
  try {
    // 删除项目时主动初始化资料库，使兼容索引和项目副本同时清理。
    // 此调用发生在项目数据库记录删除前，因此目录解析仍然可用。
    (repository ?? library()).removeProject(id);
  } catch {
    // 资料索引不能阻断项目删除；下面仍尽力清理目录副本。
  }
  if (root) {
    try { unlinkSync(join(root, '.mathmodel', 'competition.json')); } catch { /* 没有本地副本 */ }
  }
}
