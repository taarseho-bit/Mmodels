import { useEffect, useState } from 'react';
import type { Project, Phase } from '../../../shared/competition-studio';
import { COMPETITIONS } from '../../../shared/competitions-data';
import { calendarCompetition, competitionDeadline, countdownFor } from '../../../shared/competition-countdown';
import { useApp } from '../store/app';
import { openRoute } from '../lib/settings-nav';
import { friendlyError } from '../lib/friendly-error';

const drafts = new Map<string, Project>();
const contests = [...COMPETITIONS].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name, 'zh-CN'));
export function WorkbenchPage(): JSX.Element {
  const project = useApp(s => s.currentProject);
  const [draft, setDraft] = useState<Project | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let live = true; setDraft(project ? drafts.get(project.id) ?? null : null); setMessage('');
    if (project) void window.mathmodel.competition.ensureProject(project.id).then(s => {
      if (live) setDraft(drafts.get(project.id) ?? s.projects.find(p => p.id === project.id) ?? null);
    }).catch(e => live && setMessage(friendlyError(e, '比赛信息暂时没有读取成功，可以重新打开。')));
    return () => { live = false; };
  }, [project?.id]);
  if (!draft) return <div className="studio-page"><p>{message || '正在打开比赛工作台…'}</p></div>;
  const contest = calendarCompetition(draft), countdown = countdownFor(contest, now);
  const checkedCount = draft.checklist.filter(item => item.done).length;
  const checkPercent = draft.checklist.length ? Math.round(checkedCount / draft.checklist.length * 100) : 0;
  const deliveryChecks = [
    { label: '比赛信息', detail: contest ? `${contest.shortName || contest.name} · ${contest.year}` : '还没有选择比赛', ok: Boolean(contest) },
    { label: '页数要求', detail: draft.pageLimit ? `上限 ${draft.pageLimit}` : '还没有设置页数上限', ok: Boolean(draft.pageLimit.trim()) },
    { label: '方案与依据', detail: `${draft.alternatives.length} 个方案 · ${draft.evidence.length} 条依据`, ok: draft.alternatives.length > 0 && draft.evidence.length > 0 },
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
  const ask = async (prompt: string, mode: 'paper' | 'chat' = 'paper') => {
    if (!await save() || useApp.getState().currentProject?.id !== draft.id) return;
    await useApp.getState().patchSettings({ composerMode: mode });
    if (useApp.getState().currentProject?.id !== draft.id) return;
    useApp.getState().beginNewChat(); useApp.getState().fillPrompt(prompt); openRoute('chat');
  };
  return <div className="studio-page studio-workbench">
    <header className="studio-page-heading"><div><h1>比赛工作台</h1><p>{project?.name}</p></div>
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
      <header><div><span className="studio-eyebrow">提交前先看一眼</span><h2>论文交付检查</h2></div><button className="btn btn-primary" disabled={busy} onClick={() => void ask('请运行一次论文交付检查：读取当前项目的比赛信息、论文 PDF、图表和表格，核对正文页数、表格是否裁切、图片是否缺失、引用与章节结构是否完整，并区分已确认、需要修改和需要人工确认的项目。请使用 competition-audit、table-layout-audit 和 paper-page-fit 等匹配技能；不要把我的勾选视为验证结果。', 'chat')}>立即检查</button></header>
      <div className="studio-delivery-grid">{deliveryChecks.map(item => <div className={`studio-delivery-item${item.ok ? ' is-ok' : ''}`} key={item.label}><span className="studio-delivery-dot">{item.ok ? '✓' : '!'}</span><div><strong>{item.label}</strong><small>{item.detail}</small></div><em>{item.ok ? '已具备' : '待补充'}</em></div>)}</div>
      <p className="studio-delivery-note">这里显示的是项目资料是否准备齐全，不代替助手对 PDF、表格和比赛规则的实际核对。</p>
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
