import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync, renameSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type StudioState, type PaperInput, type ImportRow, type Paper, type Project } from '../../shared/competition-studio';
import { validateProject } from './validation';

const FILE_LIMIT = 100 * 1024 * 1024;
const BATCH_LIMIT = 300 * 1024 * 1024;

/** Local PDF copies and per-existing-project competition notes. Never moves source files. */
export class Repository {
  state: StudioState;
  private tickets = new Map<string, string>();
  private importing = false;
  constructor(readonly root: string, private workspace?: (id: string) => string) {
    mkdirSync(root, { recursive: true });
    const file = join(root, 'library.json');
    this.state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
      projects: [], papers: [],
    };
    for (const key of ['projects', 'papers']) {
      if (!Array.isArray((this.state as any)[key])) throw new Error('本地资料索引不完整，请保留文件并从备份恢复，不能直接覆盖');
    }
    // 历史格式把比赛配置只写在全局 library.json；现在以项目目录中的
    // `.mathmodel/competition.json` 为可迁移的权威副本。启动时自动把历史记录
    // 补到项目目录，并优先读取项目目录里用户已经修改过的版本。
    this.hydrateProjectFiles();
    this.commit(this.state);
  }
  commit(next: StudioState): StudioState {
    const file = join(this.root, 'library.json'), temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(next, null, 2), { flag: 'wx' });
    try { renameSync(temp, file); } catch (e) { unlinkSync(temp); throw e; }
    this.state = next;
    return next;
  }
  library(): string { const p = join(this.root, '优秀获奖论文'); mkdirSync(p, { recursive: true }); return p; }
  projectRoot(id: string): string {
    if (!this.state.projects.some(p => p.id === id)) throw new Error('找不到这个比赛项目');
    const dir = this.workspace ? this.workspace(id) : join(this.root, 'projects', id); mkdirSync(dir, { recursive: true }); return dir;
  }

  private projectFile(id: string): string {
    return join(this.projectRoot(id), '.mathmodel', 'competition.json');
  }

  private readProjectFile(id: string): Project | null {
    try {
      const file = this.projectFile(id);
      if (!existsSync(file)) return null;
      if (statSync(file).size > 300_000) return null;
      const value = validateProject(JSON.parse(readFileSync(file, 'utf8')));
      return value.id === id ? value : null;
    } catch {
      // 项目配置损坏时保留旧索引，避免打开项目直接失败；下一次保存会修复文件。
      return null;
    }
  }

  private writeProjectFile(project: Project): void {
    const file = this.projectFile(project.id);
    mkdirSync(join(file, '..'), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(project, null, 2), { flag: 'wx' });
    try { renameSync(temp, file); } catch (error) { try { unlinkSync(temp); } catch { /* 保留原文件 */ } throw error; }
  }

  private hydrateProjectFiles(): void {
    if (!this.workspace) return;
    let changed = false;
    for (const legacy of this.state.projects) {
      try {
        const local = this.readProjectFile(legacy.id);
        if (local) {
          if (JSON.stringify(local) !== JSON.stringify(legacy)) {
            this.state = { ...this.state, projects: this.state.projects.map(p => p.id === local.id ? local : p) };
            changed = true;
          }
        } else {
          this.writeProjectFile(legacy);
        }
      } catch {
        // 单个项目目录不可用不阻断资料库初始化；打开该项目时再给出可操作提示。
      }
    }
    if (changed) this.commit(this.state);
  }

  /** 读取项目级比赛配置；没有本地副本时兼容旧 library.json。 */
  project(id: string): Project | null {
    const local = this.readProjectFile(id);
    if (local) return local;
    return this.state.projects.find(p => p.id === id) ?? null;
  }

  /** 保存项目级比赛配置，同时更新兼容索引，供迁移期间读取。 */
  saveProject(project: Project): StudioState {
    this.writeProjectFile(project);
    return this.commit({ ...this.state, projects: this.state.projects.map(p => p.id === project.id ? project : p) });
  }

  /** 删除项目时同步移除项目级比赛配置；不会触碰用户的论文资料库。 */
  removeProject(id: string): void {
    try { unlinkSync(this.projectFile(id)); } catch { /* 文件不存在或项目目录已被移除 */ }
    this.commit({ ...this.state, projects: this.state.projects.filter(p => p.id !== id) });
  }
  stage(files: string[]): ImportRow[] {
    if (files.length > 100) throw new Error('一次最多导入 100 篇，请分批操作');
    this.tickets.clear();
    const pending = new Map<string, string>();
    let total = 0;
    const rows = files.map(file => {
      const size = statSync(file).size;
      if (!file.toLowerCase().endsWith('.pdf') || size > FILE_LIMIT) throw new Error('请选择每篇不超过 100 MB 的 PDF');
      total += size;
      if (total > BATCH_LIMIT) { this.tickets.clear(); throw new Error('单批文件合计不能超过 300 MB，请分批导入'); }
      const ticket = randomUUID(); pending.set(ticket, file);
      return { ticket, name: basename(file), bytes: size };
    });
    this.tickets = pending;
    return rows;
  }
  async importPapers(rows: PaperInput[], confirmed: boolean) {
    if (this.importing) throw new Error('正在导入论文，请等本批完成后再试');
    if (!confirmed) throw new Error('请先确认论文来源与使用权限');
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw new Error('请选择 1 至 100 篇论文');
    const papers: Paper[] = [], created: string[] = [];
    const tickets = new Map(this.tickets);
    let duplicates = 0, total = 0;
    this.importing = true;
    try {
      for (const row of rows) {
        if (!row || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 300 || typeof row.competition !== 'string' || !row.competition.trim() || row.competition.length > 200 || !Number.isInteger(row.year) || row.year < 1950 || row.year > 2100) throw new Error('请填写论文标题、竞赛和有效年份');
        if (['problem', 'award', 'source'].some(key => typeof row[key as keyof PaperInput] !== 'string' || String(row[key as keyof PaperInput]).length > 2000)) throw new Error('论文题号、奖项或来源内容不完整或过长');
        const source = tickets.get(row.ticket);
        if (!source) throw new Error('文件选择已过期，请重新选择');
        const id = randomUUID(), file = join(this.library(), `${id}.pdf`);
        const output = await open(file, 'wx'); created.push(file);
        const digest = createHash('sha256'); let bytes = 0, header = Buffer.alloc(0);
        // Stream in small chunks: no whole-PDF buffer, synchronous hash pass, or blocking copy.
        await pipeline(createReadStream(source), new Transform({ transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length; total += chunk.length;
          if (bytes > FILE_LIMIT || total > BATCH_LIMIT) { done(new Error('单篇限 100 MB，单批合计限 300 MB，请分批导入')); return; }
          if (header.length < 1024) header = Buffer.concat([header, chunk.subarray(0, 1024 - header.length)]);
          digest.update(chunk); done(null, chunk);
        } }), output.createWriteStream());
        if (!header.includes(Buffer.from('%PDF-'))) throw new Error(`${basename(source)} 不是有效的 PDF 文件`);
        const hash = digest.digest('hex'), competition = row.competition.trim();
        if ([...this.state.papers, ...papers].some(p => p.hash === hash && p.competition === competition && p.year === row.year)) { await unlink(file); created.pop(); duplicates++; continue; }
        papers.push({ title: row.title.trim(), competition, year: row.year, problem: row.problem, award: row.award, source: row.source, id, originalName: basename(source), hash, bytes, added: Date.now(), favorite: false, notes: '' });
      }
      // Rebase on current state: edits to notes/workbench while streaming must survive.
      this.commit({ ...this.state, papers: [...this.state.papers, ...papers] });
      for (const row of rows) this.tickets.delete(row.ticket);
      return { state: this.state, imported: created.length, duplicates };
    } catch (e) {
      // Only files freshly created by this failed import are rolled back; originals are untouched.
      await Promise.all(created.map(file => unlink(file).catch(() => undefined)));
      throw e;
    } finally {
      this.importing = false;
    }
  }
  paperFile(id: string): string {
    if (!this.state.papers.some(p => p.id === id)) throw new Error('论文不存在');
    return join(this.library(), `${id}.pdf`);
  }
}
