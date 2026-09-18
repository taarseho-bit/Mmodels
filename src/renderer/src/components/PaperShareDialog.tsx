import { useEffect, useRef, useState } from 'react';
import { COMPETITIONS, type PaperInput } from '../../../shared/competition-studio';

export function PaperShareDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const dialog = useRef<HTMLElement>(null);
  const [rows, setRows] = useState<PaperInput[]>([]);
  const [competition, setCompetition] = useState(COMPETITIONS[0]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { if (open) { setRows([]); setMessage(''); setConfirmed(false); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) onClose(); }
      if (e.key !== 'Tab') return;
      const nodes = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') ?? [])];
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, busy, onClose]);
  if (!open) return null;
  const select = async () => {
    setBusy(true); setMessage('');
    try { const files = await window.mathmodel.competition.pickPapers(); if (files.length) setRows(files.map(f => ({ ticket: f.ticket, title: f.name.replace(/\.pdf$/i, ''), competition, year, problem: '', award: '', source: '' }))); }
    catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  const patch = (i: number, values: Partial<PaperInput>) => setRows(list => list.map((r, n) => n === i ? { ...r, ...values } : r));
  const submit = async () => {
    setBusy(true); setMessage('');
    try { const r = await window.mathmodel.competition.importPapers(rows, confirmed); setRows([]); setMessage(`已保存 ${r.imported} 篇，跳过 ${r.duplicates} 篇重复文件。原文件未改动。`); }
    catch (e) { setMessage(String(e)); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" onClick={() => !busy && onClose()}>
    <section ref={dialog} className="modal studio-import" role="dialog" aria-modal="true" aria-labelledby="paper-import-title" onClick={e => e.stopPropagation()}>
      <header><div><span className="studio-eyebrow">本地资料库</span><h2 id="paper-import-title">上传优秀论文</h2></div><button className="btn" disabled={busy} onClick={onClose} aria-label="关闭上传窗口">关闭</button></header>
      <p className="muted">选择一篇或多篇 PDF，只复制到电脑本地，不会发送到网络。奖项由你填写，不代表软件已验证获奖。</p>
      <div className="studio-form-row"><label>统一竞赛<input className="input" list="competition-options" value={competition} onChange={e => setCompetition(e.target.value)} /></label><label>统一年份<input className="input" type="number" min="1950" max="2100" value={year} onChange={e => setYear(Number(e.target.value))} /></label><button className="btn" disabled={busy || !rows.length} onClick={() => setRows(list => list.map(r => ({ ...r, competition, year })))}>应用到全部</button><button className="btn btn-primary" disabled={busy} onClick={() => void select()}>选择 PDF · 可多选</button></div>
      <datalist id="competition-options">{COMPETITIONS.map(c => <option key={c} value={c} />)}</datalist>
      <div className="studio-import-list">{rows.length ? rows.map((r, i) => <div className="studio-import-row" key={r.ticket}>
        <span className="studio-index">{String(i + 1).padStart(2, '0')}</span><div>
          <label>论文标题<input className="input" value={r.title} onChange={e => patch(i, { title: e.target.value })} /></label>
          <div className="studio-form-row"><label>竞赛<input className="input" list="competition-options" value={r.competition} onChange={e => patch(i, { competition: e.target.value })} /></label><label>年份<input className="input" type="number" value={r.year} onChange={e => patch(i, { year: Number(e.target.value) })} /></label><label>题号<input className="input" placeholder="例如 A" value={r.problem} onChange={e => patch(i, { problem: e.target.value })} /></label><label>奖项<input className="input" placeholder="可留空，待核验" value={r.award} onChange={e => patch(i, { award: e.target.value })} /></label></div>
          <label>来源备注 / 链接<input className="input" placeholder="方便以后核对来源" value={r.source} onChange={e => patch(i, { source: e.target.value })} /></label>
        </div><button className="btn btn-ghost" disabled={busy} onClick={() => setRows(list => list.filter((_, n) => n !== i))}>移出</button>
      </div>) : <div className="studio-empty">先选择文件，再逐篇确认竞赛、年份和来源。<small>每批最多 100 篇、合计 300 MB；单篇不超过 100 MB。</small></div>}</div>
      {message && <p className="studio-notice" role="status">{message}</p>}
      <footer><label className="studio-checkbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已确认这些文件可用于本地学习与研究</label><button className="btn btn-primary" disabled={busy || !confirmed || !rows.length || rows.some(r => !r.title.trim() || !r.competition.trim())} onClick={() => void submit()}>{busy ? '正在保存…' : `保存 ${rows.length || ''} 篇到本地`}</button></footer>
    </section>
  </div>;
}
