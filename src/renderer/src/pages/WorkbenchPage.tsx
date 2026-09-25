import { useEffect, useState } from 'react';
import type { DeliveryAudit, Project, Phase } from '../../../shared/competition-studio';
import type { FileNode } from '@shared/types';
import type { WorkflowRun } from '@shared/workflow';
import { COMPETITIONS } from '../../../shared/competitions-data';
import { calendarCompetition, competitionDeadline, countdownFor } from '../../../shared/competition-countdown';
import { useApp } from '../store/app';
import { openRoute } from '../lib/settings-nav';
import { friendlyError } from '../lib/friendly-error';

const drafts = new Map<string, Project>();
const contests = [...COMPETITIONS].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, 'zh-CN'));
type DeliveryFileStats = { pdf: number; source: number; figure: number; table: number; pdfPaths: string[] };
type WorkflowQualitySummary = {
  runStatus: WorkflowRun['status'];
  updatedAt: number;
  skills: Array<{ id: string; label: string; status: '进行中' | '已完成' | '需要复核'; calls: number }>;
};
function flattenFiles(nodes: FileNode[], out: FileNode[] = []): FileNode[] {
  for (const node of nodes) { out.push(node); if (node.children) flattenFiles(node.children, out); }
  return out;
}
function scanDeliveryFiles(nodes: FileNode[]): DeliveryFileStats {
  const stats: DeliveryFileStats = { pdf: 0, source: 0, figure: 0, table: 0, pdfPaths: [] };
  for (const node of flattenFiles(nodes)) {
    if (node.isDirectory) continue;
    const ext = node.name.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'pdf') { stats.pdf += 1; if (node.relPath) stats.pdfPaths.push(node.relPath); }
    else if (['tex', 'typ', 'docx', 'md'].includes(ext)) stats.source += 1;
    else if (['png', 'jpg', 'jpeg', 'svg', 'drawio'].includes(ext)) stats.figure += 1;
    else if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext)) stats.table += 1;
  }
  return stats;
}
export function WorkbenchPage(): JSX.Element {
  const project = useApp(s => s.currentProject);
  // 所有 hook 必须在条件渲染之前执行；项目资料异步加载时也不能改变 hook 顺序。
  const qualityMode = useApp(s => s.settings?.modelingQualityMode ?? 'balanced');
  const [draft, setDraft] = useState<Project | null>(null);
  const [fileStats, setFileStats] = useState<DeliveryFileStats | null>(null);
  const [pdfInfo, setPdfInfo] = useState<{ relPath: string; pages: number | null; size: number } | null>(null);
  const [fileScanNonce, setFileScanNonce] = useState(0);
  const [fileScannedAt, setFileScannedAt] = useState<number | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<WorkflowQualitySummary | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let live = true; setDraft(project ? drafts.get(project.id) ?? null : null); setMessage('');
    if (project) void window.mathmodel.competition.ensureProject(project.id).then(s => {
      if (live) setDraft(drafts.get(project.id) ?? s.projects.find(p => p.id === project.id) ?? null);
    }).catch(e => live && setMessage(friendlyError(e, '比赛信息暂时没有读取成功，可以重新打开。')));
    return () => { live = false; };
  }, [project?.id]);
  useEffect(() => {
    let live = true;
    setFileStats(null); setPdfInfo(null);
    setFileScannedAt(null);
    if (!project) return () => { live = false; };
    void window.mathmodel.file.tree().then(async nodes => {
      if (!live) return;
      const stats = scanDeliveryFiles(nodes);
      setFileStats(stats); setFileScannedAt(Date.now());
      const firstPdf = stats.pdfPaths[0];
      if (firstPdf) {
        try { const info = await window.mathmodel.file.pdfInfo(firstPdf); if (live) setPdfInfo(info); } catch { if (live) setPdfInfo({ relPath: firstPdf, pages: null, size: 0 }); }
      }
    }).catch(() => { if (live) { setFileStats({ pdf: 0, source: 0, figure: 0, table: 0, pdfPaths: [] }); setFileScannedAt(Date.now()); } });
    return () => { live = false; };
  }, [project?.id, fileScanNonce]);
  useEffect(() => {
    let live = true;
    setWorkflowSummary(null);
    if (!project) return () => { live = false; };
    void window.mathmodel.workflow.listProject(project.id).then(rows => {
      if (!live || !Array.isArray(rows) || rows.length === 0) return;
      const latest = [...rows].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const bySkill = new Map<string, { label: string; calls: number; running: number; failed: number }>();
      for (const node of latest.nodes) for (const tool of node.tools) {
        if (!tool.skill) continue;
        const current = bySkill.get(tool.skill) ?? { label: tool.label.replace(/^(载入入口指令|参考技能) · /, ''), calls: 0, running: 0, failed: 0 };
        current.calls += 1;
        if (tool.status === 'running') current.running += 1;
        if (tool.status === 'unsuccessful' || tool.status === 'stopped') current.failed += 1;
        bySkill.set(tool.skill, current);
      }
      setWorkflowSummary({
        runStatus: latest.status,
        updatedAt: latest.updatedAt,
        skills: [...bySkill.entries()].map(([id, value]) => ({
          id,
          label: value.label,
          calls: value.calls,
          status: value.running > 0 ? '进行中' as const : value.failed > 0 ? '需要复核' as const : '已完成' as const,
        })).sort((a, b) => (a.status === '进行中' ? -1 : b.status === '进行中' ? 1 : b.calls - a.calls)),
      });
    }).catch(() => { if (live) setWorkflowSummary(null); });
    return () => { live = false; };
  }, [project?.id]);
  if (!draft) return <div className="studio-page"><p>{message || '正在打开比赛工作台…'}</p></div>;
  const contest = calendarCompetition(draft), countdown = countdownFor(contest, now);
  const checkedCount = draft.checklist.filter(item => item.done).length;
  const checkPercent = draft.checklist.length ? Math.round(checkedCount / draft.checklist.length * 100) : 0;
  const checkedEvidence = draft.evidence.filter(item => item.checked).length;
  const workflowSkillCount = workflowSummary?.skills.length ?? 0;
  const workflowSkillReviewCount = workflowSummary?.skills.filter(item => item.status === '需要复核').length ?? 0;
  const pageLimitNumber = Number((draft.pageLimit.match(/\d+/) ?? [])[0] ?? 0);
  const pageCheck = pdfInfo?.pages && pageLimitNumber > 0
    ? (pdfInfo.pages <= pageLimitNumber ? '通过' : '超出')
    : pdfInfo?.pages ? '已读取' : '待读取';
  const deliveryChecks = [
    { label: '比赛信息', detail: contest ? `${contest.shortName || contest.name} · ${contest.year}` : '还没有选择比赛', ok: Boolean(contest) },
    { label: '页数要求', detail: pdfInfo?.pages ? `${pdfInfo.pages} 页${pageLimitNumber ? ` · 上限 ${pageLimitNumber} 页` : ''}${pageCheck === '超出' ? ' · 需要压缩' : ''}` : draft.pageLimit ? `上限 ${draft.pageLimit} · 正在读取 PDF 页数` : '还没有设置页数上限', ok: pdfInfo?.pages && pageLimitNumber > 0 ? pageCheck !== '超出' : draft.pageLimit.trim() ? null : false },
    { label: '论文文件', detail: fileStats ? `${fileStats.pdf} 个 PDF · ${fileStats.source} 个源文件${pdfInfo?.pages ? ` · 主文档 ${pdfInfo.pages} 页` : ''}` : '正在读取项目文件', ok: fileStats ? fileStats.pdf > 0 : null },
    { label: '图表与数据', detail: fileStats ? `${fileStats.figure} 个图表 · ${fileStats.table} 个数据文件` : '正在读取项目文件', ok: fileStats ? fileStats.figure > 0 || fileStats.table > 0 : null },
    { label: '模型方案', detail: draft.alternatives.length ? `${draft.alternatives.length} 个候选方案已记录` : '还没有记录模型方案对比', ok: draft.alternatives.length > 0 },
    { label: '结论依据', detail: draft.evidence.length ? `${checkedEvidence}/${draft.evidence.length} 条依据已核对` : '还没有记录结论依据', ok: draft.evidence.length > 0 && checkedEvidence === draft.evidence.length },
    { label: '复现材料', detail: fileStats ? `${fileStats.source} 个源文件 · ${fileStats.table} 个数据文件` : '正在读取项目文件', ok: fileStats ? fileStats.source > 0 && fileStats.table > 0 : null },
    { label: '技能执行', detail: workflowSummary ? `${workflowSkillCount} 项技能 · ${workflowSkillReviewCount ? `${workflowSkillReviewCount} 项需要复核` : '暂无失败记录'}` : '等待真实工作流记录', ok: workflowSummary ? workflowSkillCount > 0 && workflowSkillReviewCount === 0 : null },
    { label: '提交清单', detail: `${checkedCount}/${draft.checklist.length} 项已核对`, ok: checkPercent === 100 },
  ];
  const patch = (value: Partial<Project>) => {
    const next = { ...draft, ...value }; drafts.set(draft.id, next); setDraft(next); setMessage('有修改待保存'); return next;
  };
  const save = async (value = draft) => {
    setBusy(true);
    const selected = calendarCompetition(value);
    const next = selected ? { ...value, calendarId: selected.id, competition: selected.name, year: selected.year, deadline: competitionDeadline(selected) } : value;
    try {
      await window.mathmodel.competition.saveProject(next);
      if (drafts.get(value.id) === value) drafts.delete(value.id);
      if (useApp.getState().currentProject?.id === value.id) setMessage(drafts.has(value.id) ? '还有修改待保存' : '已保存');
      return true;
    } catch (e) { if (useApp.getState().currentProject?.id === value.id) setMessage(friendlyError(e, '比赛信息没有保存成功，内容已保留。')); return false; }
    finally { setBusy(false); }
  };
  const ask = async (prompt: string, mode: 'paper' | 'chat' = 'paper', value = draft) => {
    if (!await save(value) || useApp.getState().currentProject?.id !== draft.id) return;
    await useApp.getState().patchSettings({ composerMode: mode });
    if (useApp.getState().currentProject?.id !== draft.id) return;
    useApp.getState().beginNewChat(); useApp.getState().fillPrompt(prompt); openRoute('chat');
  };
  const runDeliveryAudit = async (): Promise<void> => {
    setBusy(true);
    try {
      const stats = fileStats ?? scanDeliveryFiles(await window.mathmodel.file.tree());
      setFileStats(stats); setFileScannedAt(Date.now());
      let currentPdfInfo = pdfInfo;
      if (!currentPdfInfo && stats.pdfPaths[0]) {
        try {
          currentPdfInfo = await window.mathmodel.file.pdfInfo(stats.pdfPaths[0]);
          setPdfInfo(currentPdfInfo);
        } catch {
          currentPdfInfo = { relPath: stats.pdfPaths[0], pages: null, size: 0 };
          setPdfInfo(currentPdfInfo);
        }
      }
      const items: DeliveryAudit['items'] = [
        { id: 'contest', label: '比赛信息', status: contest ? '通过' : '待补充', detail: contest ? `${contest.shortName || contest.name} · ${contest.year}` : '还没有选择比赛' },
        { id: 'paper', label: '论文文件', status: stats.pdf > 0 ? '通过' : '待补充', detail: stats.pdf > 0 ? `找到 ${stats.pdf} 个 PDF${currentPdfInfo?.pages ? `，主文档 ${currentPdfInfo.pages} 页` : ''}` : '项目中没有找到 PDF' },
        { id: 'page-count', label: 'PDF 页数', status: currentPdfInfo?.pages && pageLimitNumber ? (currentPdfInfo.pages <= pageLimitNumber ? '通过' : '需深度核验') : '待补充', detail: currentPdfInfo?.pages ? `${currentPdfInfo.pages} 页${pageLimitNumber ? ` · 上限 ${pageLimitNumber} 页` : ' · 尚未设置上限'}` : '还没有读到 PDF 页数' },
        { id: 'page-limit', label: '页数要求', status: draft.pageLimit.trim() ? '通过' : '待补充', detail: draft.pageLimit.trim() ? `上限 ${draft.pageLimit}` : '还没有设置页数上限' },
        { id: 'materials', label: '图表与数据', status: stats.figure > 0 || stats.table > 0 ? '通过' : '待补充', detail: `${stats.figure} 个图表 · ${stats.table} 个数据文件` },
        { id: 'model-plan', label: '模型方案', status: draft.alternatives.length > 0 ? '通过' : '待补充', detail: draft.alternatives.length > 0 ? `已记录 ${draft.alternatives.length} 个候选方案` : '还没有记录模型方案对比' },
        { id: 'evidence', label: '结论依据', status: draft.evidence.length > 0 && checkedEvidence === draft.evidence.length ? '通过' : '待补充', detail: draft.evidence.length > 0 ? `${checkedEvidence}/${draft.evidence.length} 条依据已核对` : '还没有记录结论依据' },
        { id: 'reproducibility', label: '复现材料', status: stats.source > 0 && stats.table > 0 ? '通过' : '待补充', detail: `${stats.source} 个源文件 · ${stats.table} 个数据文件` },
        { id: 'skills', label: '技能执行', status: workflowSummary && workflowSkillCount > 0 && workflowSkillReviewCount === 0 ? '通过' : workflowSummary ? '需深度核验' : '待补充', detail: workflowSummary ? `${workflowSkillCount} 项技能${workflowSkillReviewCount ? `，${workflowSkillReviewCount} 项需要复核` : '，调用状态正常'}` : '还没有完整的工作流技能记录' },
        { id: 'checklist', label: '提交清单', status: checkPercent === 100 ? '通过' : '待补充', detail: `${checkedCount}/${draft.checklist.length} 项已核对` },
        { id: 'deep-review', label: 'PDF 深度核验', status: '需深度核验', detail: '需要助手实际读取 PDF、表格和图表后确认' },
      ];
      const ready = items.filter(item => item.status === '待补充').length === 0;
      const audit: DeliveryAudit = { checkedAt: new Date().toISOString(), status: ready ? '准备较好' : '仍需处理', items, note: '这是项目级预检查；PDF 页数、表格裁切、公式和引用仍需助手深度核验。' };
      const next = { ...draft, deliveryAudit: audit };
      setDraft(next); drafts.set(next.id, next); setMessage('预检查结果已保存，正在让助手继续核对 PDF…');
      await ask('请继续完成论文交付深度核验：读取当前项目的论文 PDF、图表和表格，检查正文页数、表格是否裁切、图片是否缺失、引用与章节结构是否完整。请使用 competition-audit、table-layout-audit 和 paper-page-fit 等匹配技能；把已确认、需要修改和需要人工确认的项目分开说明，不把项目预检查结果当成最终结论。', 'chat', next);
    } catch (e) {
      setMessage(friendlyError(e, '交付预检查没有完成，内容已保留，可以重试。'));
    } finally { setBusy(false); }
  };
  return <div className="studio-page studio-workbench">
    <header className="studio-page-heading"><div><h1>比赛工作台</h1><p>{project?.name} · {qualityMode === 'strict' ? '严格交付' : qualityMode === 'fast' ? '快速探索' : '标准检查'}</p></div>
      <button className="btn btn-primary" disabled={busy} onClick={() => void ask('请读取当前项目题目、数据与比赛资料，核对条件后开始建模写作。')}>开始建模</button></header>
    <section className="studio-mission studio-simple-countdown">
      <div><label htmlFor="workbench-contest">选择竞赛</label>
        <select id="workbench-contest" className="input" aria-label="选择竞赛" value={contest?.id ?? ''} disabled={busy}
          onChange={e => {
            const c = contests.find(item => item.id === e.target.value); if (!c) return;
            const next = patch({ calendarId: c.id, competition: c.name, year: c.year, deadline: competitionDeadline(c) });
            void save(next);
          }}>
          <option value="" disabled>从竞赛日历选择</option>
          {[...new Set(contests.map(c => c.year))].map(year => <optgroup label={`${year} 年`} key={year}>
            {contests.filter(c => c.year === year).map(c => <option key={c.id} value={c.id}>{c.shortName || c.name}{c.status === 'estimated' ? ' · 预计赛程' : c.status === 'tba' ? ' · 待公布' : ''}</option>)}
          </optgroup>)}
        </select>
        <p className="muted">时间来自竞赛日历，选择后自动保存。</p>
        <button className="btn btn-ghost" onClick={() => openRoute('competitions')}>查看赛程</button>
      </div>
      <div className="studio-countdown" aria-live="polite"><span>{countdown.label}</span><strong>{countdown.text}</strong><small>预留核对与上传时间</small></div>
    </section>
    <section className="studio-readiness" aria-label="项目准备度">
      <div><span className="studio-eyebrow">项目准备度</span><strong>{checkPercent}%</strong><small>{checkedCount}/{draft.checklist.length} 项已核对</small></div>
      <div className="studio-readiness-bar"><i style={{ width: `${checkPercent}%` }} /></div>
      <div className="studio-readiness-meta"><span>当前阶段：{draft.phase}</span><span>{draft.pageLimit ? `页数上限：${draft.pageLimit}` : '尚未设置页数上限'}</span><span>{draft.evidence.length} 条结论依据 · {draft.alternatives.length} 个候选方案</span></div>
    </section>
    <section className="studio-delivery-panel" aria-label="论文交付检查">
      <header><div><span className="studio-eyebrow">提交前先看一眼</span><h2>论文交付检查</h2><p className="studio-delivery-last">{draft.deliveryAudit ? `上次预检查：${new Date(draft.deliveryAudit.checkedAt).toLocaleString('zh-CN')} · ${draft.deliveryAudit.status}` : '还没有保存过项目级预检查'}</p></div><div className="studio-delivery-actions"><button className="btn btn-ghost" onClick={() => setFileScanNonce(value => value + 1)}>重新读取</button><button className="btn btn-primary" disabled={busy} onClick={() => void runDeliveryAudit()}>预检查并深度核验</button></div></header>
      <div className="studio-delivery-grid">{deliveryChecks.map(item => <div className={`studio-delivery-item${item.ok === true ? ' is-ok' : item.ok === null ? ' is-pending' : ''}`} key={item.label}><span className="studio-delivery-dot">{item.ok === true ? '✓' : item.ok === null ? '…' : '!'}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><em>{item.ok === true ? '已具备' : item.ok === null ? '读取中' : '待补充'}</em></div>)}</div>
      {workflowSummary && <div className="studio-workflow-skills"><div><strong>最近一次工作流的技能记录</strong><small>{new Date(workflowSummary.updatedAt).toLocaleString('zh-CN')} · {workflowSummary.runStatus === 'completed' ? '本轮已结束' : workflowSummary.runStatus === 'running' ? '仍在工作' : '本轮未完整结束'}</small></div><div className="studio-workflow-skill-list">{workflowSummary.skills.length ? workflowSummary.skills.slice(0, 8).map(skill => <span className={`studio-workflow-skill is-${skill.status === '已完成' ? 'ok' : skill.status === '进行中' ? 'running' : 'review'}`} key={skill.id}><i />{skill.label} · {skill.status}</span>) : <span className="muted">这轮没有记录到专门技能调用。</span>}</div></div>}
      <p className="studio-delivery-note">这里显示的是项目资料是否准备齐全，不代替助手对 PDF、表格和比赛规则的实际核对。{fileScannedAt ? ` 文件目录最近读取于 ${new Date(fileScannedAt).toLocaleTimeString('zh-CN')}` : ''}</p>
      {draft.deliveryAudit && <div className="studio-audit-history"><strong>最近一次预检查</strong>{draft.deliveryAudit.items.filter(item => item.status !== '通过').map(item => <span key={item.id} className={item.status === '需深度核验' ? 'is-review' : 'is-pending'}>{item.label}：{item.detail}</span>)}{draft.deliveryAudit.items.every(item => item.status === '通过') && <span className="is-ok">项目资料已基本齐全，等待 PDF 深度核验。</span>}</div>}
    </section>
    {message && <p className="studio-notice" role="status">{message}</p>}
    <details className="studio-workbench-more"><summary>更多比赛资料与提交检查</summary>
      <div className="studio-two-column">
        <section className="studio-card"><h2>比赛资料</h2><div className="studio-form-row">
          <label>题号<input className="input" value={draft.problem} onChange={e => patch({ problem: e.target.value })} /></label>
          <label>当前阶段<select className="input" value={draft.phase} onChange={e => patch({ phase: e.target.value as Phase })}>{['读题', '求解', '写作', '核验', '提交'].map(p => <option key={p}>{p}</option>)}</select></label>
        </div><label>页数要求<input className="input" value={draft.pageLimit} onChange={e => patch({ pageLimit: e.target.value })} /></label>
          <label>比赛要求<textarea className="input" rows={3} placeholder="规则链接、匿名要求或其他注意事项" value={draft.rules} onChange={e => patch({ rules: e.target.value })} /></label>
          <button className="btn" disabled={busy} onClick={() => void save()}>保存资料</button>
        </section>
        <section className="studio-card"><h2>提交前检查</h2>{draft.checklist.map(c => <label className="studio-checkline" key={c.id}><input type="checkbox" checked={c.done} onChange={e => patch({ checklist: draft.checklist.map(v => v.id === c.id ? { ...v, done: e.target.checked } : v) })} /><span>{c.text}</span></label>)}
          <button className="btn" disabled={busy} onClick={() => void ask('请运行一次论文交付检查：读取当前项目的比赛信息、论文 PDF、图表和表格，核对正文页数、表格是否裁切、图片是否缺失、引用与章节结构是否完整，并区分已确认、需要修改和需要人工确认的项目。请使用 competition-audit、table-layout-audit 和 paper-page-fit 等匹配技能；不要把我的勾选视为验证结果。', 'chat')}>运行论文交付检查</button></section>
      </div>
      <section className="studio-card"><header><h2>方案对比</h2><button className="btn" onClick={() => patch({ alternatives: [...draft.alternatives, { id: crypto.randomUUID(), name: '', score: '', risks: '' }] })}>添加方案</button></header>
        {draft.alternatives.map(a => <div className="studio-form-row" key={a.id}>{(['name', 'score', 'risks'] as const).map((field, i) => <label key={field}>{['方案', '结果', '注意事项'][i]}<input className="input" value={a[field]} onChange={e => patch({ alternatives: draft.alternatives.map(v => v.id === a.id ? { ...v, [field]: e.target.value } : v) })} /></label>)}<button className="btn btn-ghost" onClick={() => patch({ alternatives: draft.alternatives.filter(v => v.id !== a.id) })}>移除</button></div>)}
      </section>
      <section className="studio-card"><header><h2>结论依据</h2><button className="btn" onClick={() => patch({ evidence: [...draft.evidence, { id: crypto.randomUUID(), claim: '', source: '', checked: false }] })}>添加依据</button></header>
        {draft.evidence.map(a => <div className="studio-form-row" key={a.id}><label>结论<input className="input" value={a.claim} onChange={e => patch({ evidence: draft.evidence.map(v => v.id === a.id ? { ...v, claim: e.target.value } : v) })} /></label><label>依据<input className="input" value={a.source} onChange={e => patch({ evidence: draft.evidence.map(v => v.id === a.id ? { ...v, source: e.target.value } : v) })} /></label><label><input type="checkbox" checked={a.checked} onChange={e => patch({ evidence: draft.evidence.map(v => v.id === a.id ? { ...v, checked: e.target.checked } : v) })} />已人工核对</label><button className="btn btn-ghost" onClick={() => patch({ evidence: draft.evidence.filter(v => v.id !== a.id) })}>移除</button></div>)}
      </section>
      <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>保存修改</button>
      <button className="btn btn-ghost" onClick={() => void window.mathmodel.competition.revealProject(draft.id).catch(e => setMessage(friendlyError(e, '项目文件夹暂时无法打开。')))}>打开项目文件夹</button>
    </details>
  </div>;
}
