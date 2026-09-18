import { useEffect, useState } from 'react';
import { useApp } from '../store/app';

export function LocalPluginsPanel(): JSX.Element {
  const { settings, refreshSettings, activeSessionId } = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [runtime, setRuntime] = useState<Awaited<ReturnType<typeof window.mathmodel.skill.runtime>>>(null);
  const [query, setQuery] = useState('');
  const refresh = async () => { setRuntime(await window.mathmodel.skill.runtime(activeSessionId ?? undefined)); };
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, [activeSessionId]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await refreshSettings(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const plugins = settings?.localPlugins ?? [];
  return <div className="ext-single col" style={{ padding: 24, gap: 16, overflow: 'auto' }}>
    <div className="row" style={{ gap: 12 }}><h3 className="grow">本地插件与实际可用能力</h3>
      <button className="btn" disabled={busy} onClick={() => void run(() => window.mathmodel.skill.addPlugin())}>添加本地插件</button>
      <button className="btn" disabled={busy} onClick={() => void run(refresh)}>重新检查</button></div>
    <p className="muted">仅启用你信任的插件。插件可能包含工具、脚本与钩子。修改会在下一轮对话生效；移除只解除关联，不删除原文件。</p>
    {error && <p role="alert">{error}</p>}
    <input className="input" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索插件路径或技能名称" />
    {!plugins.length && <p className="muted">尚未添加额外插件。内置技能与项目中的 .claude/skills 会分别加载，不需要在这里重复添加。</p>}
    {plugins.filter(p => p.path.toLowerCase().includes(query.toLowerCase())).map(p => <div className="panel row" key={p.path} style={{ padding: 12, gap: 12 }}>
      <span className="grow" style={{ overflowWrap: 'anywhere' }}>{p.path}</span>
      <label><input type="checkbox" checked={p.enabled} disabled={busy} onChange={e => void run(() => window.mathmodel.settings.set({ localPlugins: plugins.map(v => v.path === p.path ? { ...v, enabled: e.target.checked } : v) }))} />启用</label>
      <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => window.mathmodel.settings.set({ localPlugins: plugins.filter(v => v.path !== p.path) }))}>移除关联</button>
    </div>)}
    <h3>最近一次实际加载结果</h3>
    {!runtime ? <p className="muted">这条对话尚未启动过，暂无实际加载记录。启用数量不等于本轮已成功加载数量。</p> : <>
      <p className="muted">模型：{runtime.model} · {new Date(runtime.checkedAt).toLocaleString('zh-CN')} · {runtime.skills.length} 项技能与命令 · {runtime.tools.length} 个工具</p>
      <div className="panel" style={{ padding: 12, whiteSpace: 'pre-wrap' }}>{runtime.skills.filter(n => n.toLowerCase().includes(query.toLowerCase())).join('\n') || '暂无匹配技能'}</div>
      {runtime.mcpServers.map(m => <div key={m.name}>{m.name}：{m.status === 'connected' ? '已连接' : m.status === 'failed' ? '未连接，请检查配置' : m.status === 'pending' ? '正在连接' : '需要检查连接状态'}</div>)}
    </>}
  </div>;
}
