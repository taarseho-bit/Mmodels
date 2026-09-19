import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { workflowAgentDisplayName, type WorkflowRun } from '@shared/workflow';
import { layoutWorkflow, FLOW_ROOT } from '../lib/workflow-layout';
import { Icon } from './Icon';
import { WorkflowAvatar } from './WorkflowAvatar';
import { ResizeHandle } from './ResizeHandle';

const stateLabels = { running: '工作中', returned: '已交回', stopped: '已停止', unknown: '待确认' };
export function WorkflowCanvas({ run, selectedId, onSelect }: { run: WorkflowRun; selectedId: string | null; onSelect: (id: string) => void }): JSX.Element {
  const [compact, setCompact] = useState(false);
  const [follow, setFollow] = useState(true);
  const [view, setView] = useState({ x: 20, y: 20, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; originX: number; originY: number } | null>(null);
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const layout = useMemo(() => layoutWorkflow(run, compact), [run, compact]);
  const running = run.nodes.filter(n => n.status === 'running').length;
  const returned = run.nodes.filter(n => n.status === 'returned').length;
  const fit = () => {
    const rect = viewport.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return;
    const scale = Math.min(1, Math.max(.72, Math.min((rect.width - 40) / layout.width, (rect.height - 32) / layout.height)));
    setView({ scale, x: Math.max(16, (rect.width - layout.width * scale) / 2), y: Math.max(16, (rect.height - layout.height * scale) / 2) });
  };
  useEffect(() => {
    if (!follow || !viewport.current) return;
    const observer = new ResizeObserver(fit); observer.observe(viewport.current); fit();
    return () => observer.disconnect();
  }, [layout.width, layout.height, follow]);
  const zoom = (factor: number, x?: number, y?: number) => {
    const rect = viewport.current?.getBoundingClientRect(); if (!rect) return;
    const cx = x ?? rect.width / 2, cy = y ?? rect.height / 2;
    setFollow(false);
    setView(old => { const scale = Math.min(2, Math.max(.35, old.scale * factor));
      return { scale, x: cx - (cx - old.x) * scale / old.scale, y: cy - (cy - old.y) * scale / old.scale }; });
  };
  useEffect(() => {
    const el = viewport.current; if (!el) return;
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoom(Math.exp(-Math.max(-180, Math.min(180, e.deltaY * (e.deltaMode === 1 ? 16 : 1))) * .002), e.clientX - rect.left, e.clientY - rect.top);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  return <div className="flow-canvas-shell">
    <ResizeHandle storageKey="mm-workflow-canvas-height" label="调整工作流画布高度" edge="bottom" initial={460} min={280} max={900} fraction={.85} viewport optional />
    <div className="flow-toolbar">
      <div className="flow-live"><span className={running && run.status === 'running' ? 'is-live' : ''} />{running && run.status === 'running' ? `${running} 位正在工作` : '工作记录'}<small>{returned} 位已交回</small></div>
      <div className="flow-toolbar-actions">
        <button aria-pressed={compact} onClick={() => setCompact(v => !v)}>{compact ? '展开已结束' : '收起已结束'}</button>
        <button aria-pressed={follow} onClick={() => setFollow(v => !v)}>跟随展开</button>
        <button title="缩小画布" aria-label="缩小画布" onClick={() => zoom(1 / 1.2)}><Icon name="minus" size={14} /></button>
        <span className="flow-zoom-level">{Math.round(view.scale * 100)}%</span>
        <button title="放大画布" aria-label="放大画布" onClick={() => zoom(1.2)}><Icon name="plus" size={14} /></button>
        <button title="适应画布" aria-label="适应画布" onClick={() => { setFollow(true); fit(); }}>适应</button>
      </div>
    </div>
    <div className="flow-viewport" ref={viewport} tabIndex={0} aria-label="可拖动缩放的工作流画布"
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        const delta = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] }[e.key];
        if (delta) { e.preventDefault(); setFollow(false); setView(v => ({ ...v, x: v.x + delta[0], y: v.y + delta[1] })); }
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoom(1.2); }
        if (e.key === '-') { e.preventDefault(); zoom(1 / 1.2); }
        if (e.key === '0') { e.preventDefault(); setFollow(true); fit(); }
      }}
      onPointerDown={e => {
        if (e.button !== 0 || (e.target as Element).closest('button')) return;
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); setFollow(false);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, originX: view.x, originY: view.y };
        e.currentTarget.classList.add('is-panning');
      }}
      onPointerMove={e => { const p = drag.current; if (!p || p.id !== e.pointerId) return;
        setView(old => ({ ...old, x: p.originX + e.clientX - p.x, y: p.originY + e.clientY - p.y })); }}
      onPointerUp={e => { drag.current = null; e.currentTarget.classList.remove('is-panning'); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={e => { drag.current = null; e.currentTarget.classList.remove('is-panning'); }}>
      <div className={`flow-world${view.scale < .6 ? ' is-overview' : ''}`} style={{ width: layout.width, height: layout.height, left: view.x / view.scale, top: view.y / view.scale, zoom: view.scale }}>
        <svg className="flow-connections" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>{layout.edges.map((edge, i) => <marker key={edge.id} id={`${prefix}-arrow-${i}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9 Z" fill={edge.color} /></marker>)}</defs>
          {layout.edges.map((edge, i) => <g key={edge.id} className={`flow-edge is-${edge.kind}${edge.active ? ' is-active' : ''}`} style={{ '--flow-color': edge.color } as CSSProperties} data-source={edge.source} data-target={edge.target}>
            <path className="flow-edge-base" d={edge.path} markerEnd={`url(#${prefix}-arrow-${i})`} />
            {edge.active && <path className="flow-edge-motion" d={edge.path} />}
            <text x={edge.labelX} y={edge.labelY} textAnchor="middle">{edge.label}</text>
          </g>)}
        </svg>
        {layout.nodes.map(position => {
          const n = position.node;
          const style = { left: position.x, top: position.y, width: position.width, height: position.height, '--flow-color': position.color } as CSSProperties;
          if (position.id === FLOW_ROOT) return <div key={position.id} className="flow-origin" style={style}><Icon name="git-branch" size={19} /><strong>本轮任务</strong><span>{run.status === 'running' ? '正在展开' : run.status === 'stopped' ? '已停止' : '执行记录'}</span></div>;
          if (!n) return null;
          const finished = n.status !== 'running', folded = compact && finished;
          const active = [...n.tools].reverse().find(t => t.status === 'running');
          const skills = [...new Map(n.tools.filter(t => t.skill).map(t => [t.skill, t.label])).values()];
          const displayName = workflowAgentDisplayName(n);
          return <button key={n.id} className={`workflow-node flow-agent is-${n.status}${selectedId === n.id ? ' is-selected' : ''}${folded ? ' is-folded' : ''}`}
            style={style} title={`${displayName} · ${stateLabels[n.status]}${skills.length ? ` · ${skills.join('、')}` : ''}`} aria-pressed={selectedId === n.id} aria-label={`${displayName}，${stateLabels[n.status]}`} onClick={() => onSelect(n.id)}>
            <span className="flow-agent-port is-in" /><span className="flow-agent-port is-out" />
            <div className="flow-agent-heading"><WorkflowAvatar role={n.agentType} working={n.status === 'running' && run.status === 'running'} returned={n.status === 'returned'} /><strong className="flow-agent-name" title={displayName}>{displayName}</strong>
              <span className="flow-agent-state"><Icon name={n.status === 'returned' ? 'check' : n.status === 'stopped' ? 'square' : n.status === 'unknown' ? 'circle-help' : 'loader-circle'} size={12} />{stateLabels[n.status]}</span></div>
            {!folded && <><p className="flow-agent-speech" title={active?.label}>{active ? (active.skill ? `我在使用「${active.label}」` : `正在${active.label}`) : n.status === 'returned' ? '这部分已交回，点我看看' : n.status === 'stopped' ? '已经停下，记录还在' : finished ? '记录已保留，等待确认' : '我还在处理这一部分'}</p>
              <div className="flow-agent-skills">{skills.length ? skills.slice(-2).map(skill => <span key={skill}><Icon name="sparkles" size={10} />{skill}</span>) : <span className="is-quiet">{finished ? '本阶段未记录到技能调用' : '等待技能调用'}</span>}{skills.length > 2 && <small>+{skills.length - 2}</small>}</div></>}
            <div className="flow-agent-foot"><span>{n.tools.length} 次调用</span><span>{skills.length} 种技能</span>{n.tools.some(t => t.artifact) && <span><Icon name="file" size={10} />有文件</span>}</div>
            {n.status === 'running' && run.status === 'running' && <span className="flow-agent-working" />}
          </button>;
        })}
      </div>
      <span className="flow-navigation-hint">滚轮缩放 · 拖动空白处移动 · 点击成员查看工作</span>
    </div>
    <div className="flow-legend"><span><i className="is-solid" />分工关系</span><span><i className="is-dashed" />参与成员</span><span>流动连线表示正在工作</span></div>
  </div>;
}
