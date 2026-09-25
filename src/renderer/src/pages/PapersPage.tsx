import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { Paper } from '../../../shared/competition-studio';
import { PaperShareDialog } from '../components/PaperShareDialog';
import { friendlyError } from '../lib/friendly-error';

export function PapersPage(): JSX.Element {
  const [papers, setPapers] = useState<Paper[]>([]), [folder, setFolder] = useState('');
  const [search, setSearch] = useState(''), [comp, setComp] = useState(''), [year, setYear] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [favorites, setFavorites] = useState(false), [upload, setUpload] = useState(false), [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null), [note, setNote] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { let live = true;
    void Promise.all([window.mathmodel.competition.state(), window.mathmodel.competition.libraryFolder()]).then(([s, f]) => { if (live) { setPapers(s.papers); setFolder(f); } }).catch(e => live && setError(friendlyError(e, '论文资料库暂时没有打开成功，可以重试。')));
    const off = window.mathmodel.competition.onState(s => { if (live) setPapers(s.papers); });
    return () => { live = false; off(); };
  }, []);
  const visible = useMemo(() => papers.filter(p => (!comp || p.competition === comp) && (!year || String(p.year) === year) && (!favorites || p.favorite) && `${p.title} ${p.problem} ${p.award} ${p.notes}`.toLowerCase().includes(deferredSearch.toLowerCase())).sort((a, b) => b.added - a.added), [papers, comp, year, favorites, deferredSearch]);
  const run = async (fn: () => Promise<unknown>) => { setError(''); setBusy(true); try { await fn(); } catch (e) { setError(friendlyError(e, '这一步没有完成，资料已保留，可以重试。')); } finally { setBusy(false); } };
  return <div className="studio-page">
    <header className="studio-page-heading"><div><span className="studio-eyebrow">本地资料库</span><h1>优秀获奖论文</h1><p>你的本地阅读与方法收藏库。按竞赛、年份整理，随时回看。</p></div><button className="btn btn-primary" onClick={() => setUpload(true)}>＋ 上传优秀论文</button></header>
    <div className="studio-stat-strip"><div><strong>{papers.length}</strong><span>本地论文</span></div><div><strong>{new Set(papers.map(p => p.competition)).size}</strong><span>竞赛分类</span></div><div><strong>{papers.filter(p => p.favorite).length}</strong><span>重点收藏</span></div><button className="btn" title={folder} onClick={() => void run(() => window.mathmodel.competition.revealLibrary())}>打开存储目录 ↗</button></div>
    <div className="studio-filter"><input className="input grow" aria-label="搜索论文" placeholder="搜索标题、题号、奖项或阅读笔记" value={search} onChange={e => setSearch(e.target.value)} /><select className="input" aria-label="筛选竞赛" value={comp} onChange={e => setComp(e.target.value)}><option value="">所有竞赛</option>{[...new Set(papers.map(p => p.competition))].map(c => <option key={c}>{c}</option>)}</select><select className="input" aria-label="筛选年份" value={year} onChange={e => setYear(e.target.value)}><option value="">所有年份</option>{[...new Set(papers.map(p => p.year))].sort((a, b) => b - a).map(y => <option key={y}>{y}</option>)}</select><button className={`btn ${favorites ? 'btn-primary' : ''}`} onClick={() => setFavorites(!favorites)}>{favorites ? '★ 仅看收藏' : '☆ 收藏'}</button></div>
    {error && <p role="alert" className="studio-notice">{error}</p>}
    {!visible.length && <div className="studio-empty"><div className="studio-empty-mark">文</div><h2>{papers.length ? '还没有匹配的论文' : '尚未添加论文'}</h2><p>单篇或批量导入 PDF，按竞赛与年份整理。文件和笔记仅保存在本机。</p><button className="btn" onClick={() => setUpload(true)}>单篇或批量上传</button></div>}
    <div className="studio-paper-list">{visible.map((p, i) => <article key={p.id} className="studio-paper">
      <div className="studio-paper-spine"><span>{p.year}</span><strong>{p.problem || '文'}</strong><small>PDF</small></div><div className="studio-paper-main"><div className="studio-eyebrow">{p.competition} · {p.award || '奖项待标注'}</div><h2>{p.title}</h2><p className="muted">{p.source ? `来源：${p.source}` : '未填写来源'} · {(p.bytes / 1048576).toFixed(1)} MB</p>{editing === p.id ? <div><textarea className="input" aria-label="阅读笔记" rows={3} value={note} onChange={e => setNote(e.target.value)} /><button className="btn" disabled={busy} onClick={() => void run(async () => { await window.mathmodel.competition.paperNote(p.id, note, p.favorite); setEditing(null); })}>保存笔记</button><button className="btn btn-ghost" onClick={() => setEditing(null)}>取消</button></div> : p.notes && <p className="studio-paper-note">{p.notes}</p>}</div>
      <div className="studio-paper-actions"><span className="studio-index">{String(i + 1).padStart(2, '0')}</span><button className="btn btn-primary" onClick={() => void run(() => window.mathmodel.competition.openPaper(p.id))}>阅读论文 ↗</button><button className="btn" disabled={busy} onClick={() => void run(() => window.mathmodel.competition.paperNote(p.id, p.notes, !p.favorite))}>{p.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button className="btn btn-ghost" onClick={() => { setEditing(p.id); setNote(p.notes); }}>阅读笔记</button></div>
    </article>)}</div><div className="studio-local-path">本地目录：{folder || '正在读取…'}</div><PaperShareDialog open={upload} onClose={() => setUpload(false)} />
  </div>;
}
