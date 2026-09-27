import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Repository } from './repository';
import { makeProject, type PaperInput } from '../../shared/competition-studio';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), 'mm-paper-library-test-')); roots.push(root); const r = new Repository(join(root, 'library')); const pdf = join(root, 'fixture.pdf'); writeFileSync(pdf, '%PDF-1.4\n% test storage only\n%%EOF'); return { r, root, pdf }; }
const row = (ticket: string): PaperInput => ({ ticket, title: '测试论文', competition: '测试竞赛', year: 2026, problem: 'A', award: '用户标注', source: '本地测试' });
describe('本地论文资料库', () => {
  it('导入期间仍可保存工作台，不被旧快照覆盖，并拒绝重复提交', async () => {
    const { r, pdf } = fixture(); const input = row(r.stage([pdf])[0].ticket);
    const pending = r.importPapers([input], true);
    await expect(r.importPapers([input], true)).rejects.toThrow('正在导入');
    const project = makeProject('live', '并发编辑'); project.rules = '导入期间的新规则';
    r.commit({ ...r.state, projects: [project] });
    await pending;
    expect(r.state.projects[0].rules).toBe('导入期间的新规则');
    expect(r.state.papers).toHaveLength(1);
  });
  it('拒绝异常元数据，不把任意 renderer 字段写入索引', async () => {
    const { r, pdf } = fixture(); const input = row(r.stage([pdf])[0].ticket);
    await expect(r.importPapers([{ ...input, award: null } as any], true)).rejects.toThrow('不完整');
    await r.importPapers([{ ...input, favorite: true } as any], true);
    expect(r.state.papers[0].favorite).toBe(false);
  });
  it('复制真实文件并持久化元数据，不移动或修改原文件', async () => { const { r, pdf } = fixture(); const original = readFileSync(pdf); const result = await r.importPapers([row(r.stage([pdf])[0].ticket)], true); expect(result.imported).toBe(1); expect(readFileSync(r.paperFile(r.state.papers[0].id))).toEqual(original); expect(readFileSync(pdf)).toEqual(original); expect(new Repository(r.root).state.papers[0].title).toBe('测试论文'); });
  it('按内容、竞赛、年份去重，而非仅按文件名', async () => { const { r, root, pdf } = fixture(); const other = join(root, 'another-name.pdf'); writeFileSync(other, readFileSync(pdf)); const result = await r.importPapers(r.stage([pdf, other]).map(f => row(f.ticket)), true); expect(result.imported).toBe(1); expect(result.duplicates).toBe(1); });
  it('相同文件可归入不同年份，并支持逐篇元数据', async () => { const { r, pdf } = fixture(); const result = await r.importPapers(r.stage([pdf, pdf]).map((f, i) => ({ ...row(f.ticket), year: 2025 + i, title: `论文${i}` })), true); expect(result.imported).toBe(2); expect(r.state.papers.map(p => p.year)).toEqual([2025, 2026]); });
  it('批量中途失败时回滚本批副本，不留下半份索引', async () => { const { r, root, pdf } = fixture(); const bad = join(root, 'not-pdf.pdf'); writeFileSync(bad, 'not pdf'); const rows = r.stage([pdf, bad]).map(f => row(f.ticket)); await expect(r.importPapers(rows, true)).rejects.toThrow('不是有效'); expect(r.state.papers).toHaveLength(0); expect(readdirSync(r.library())).toEqual([]); expect(readFileSync(pdf, 'utf8')).toContain('%PDF'); });
  it('不接受绕过文件选择器的任意路径或过期票据', async () => { const { r, pdf } = fixture(); await expect(r.importPapers([row(pdf)], true)).rejects.toThrow('已过期'); const ticket = r.stage([pdf])[0].ticket; r.stage([]); await expect(r.importPapers([row(ticket)], true)).rejects.toThrow('已过期'); });
  it('确认、年份和批次上限由主进程检查', async () => { const { r, pdf } = fixture(); const input = row(r.stage([pdf])[0].ticket); await expect(r.importPapers([input], false)).rejects.toThrow('确认'); await expect(r.importPapers([{ ...input, year: NaN }], true)).rejects.toThrow('年份'); expect(() => r.stage(Array(101).fill(pdf))).toThrow('100'); });
  it('损坏索引不会被静默重置', () => { const { r } = fixture(); writeFileSync(join(r.root, 'library.json'), 'broken'); expect(() => new Repository(r.root)).toThrow(); expect(readFileSync(join(r.root, 'library.json'), 'utf8')).toBe('broken'); });
  it('工作台按原有项目 id 隔离，不另起一套项目系统', () => { const { r } = fixture(); const a = makeProject('a', '项目甲'), b = makeProject('b', '项目乙'); a.rules = '甲规则'; b.rules = '乙规则'; r.commit({ ...r.state, projects: [a, b] }); const reopened = new Repository(r.root); expect(reopened.state.projects.find(p => p.id === 'a')?.rules).toBe('甲规则'); expect(reopened.state.projects.find(p => p.id === 'b')?.rules).toBe('乙规则'); expect(() => r.projectRoot('missing')).toThrow('找不到'); });
  it('项目比赛配置写入项目目录，重开时项目副本优先于旧全局索引', () => {
    const { r, root } = fixture();
    const projectRoot = join(root, 'projects');
    const a = makeProject('a', '项目甲');
    r.commit({ ...r.state, projects: [a] });
    const scoped = new Repository(r.root, id => join(projectRoot, id));
    scoped.saveProject({ ...a, rules: '项目目录里的最新规则' });
    expect(existsSync(join(projectRoot, 'a', '.mathmodel', 'competition.json'))).toBe(true);
    const legacy = { ...scoped.state, projects: [{ ...a, rules: '旧全局规则' }] };
    scoped.commit(legacy);
    const reopened = new Repository(r.root, id => join(projectRoot, id));
    expect(reopened.project('a')?.rules).toBe('项目目录里的最新规则');
    expect(reopened.state.projects.find(p => p.id === 'a')?.rules).toBe('项目目录里的最新规则');
  });
});
