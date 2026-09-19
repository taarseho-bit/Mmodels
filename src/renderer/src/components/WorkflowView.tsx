import { memo, useEffect, useState } from 'react';
import { workflowAgentDisplayName, type WorkflowRun, type WorkflowTool } from '@shared/workflow';
import { mergeWorkflowRuns, workflowArtifactPath } from '../lib/workflow';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { WorkflowCanvas } from './WorkflowCanvas';
import { ResizeHandle } from './ResizeHandle';
import '../styles/workflow.css';

const runLabel = { running: '正在工作', completed: '本轮已结束', stopped: '已停止', interrupted: '本轮未完整结束' };
const nodeLabel = { running: '正在工作', returned: '已返回', stopped: '已停止', unknown: '未收到结束确认' };
const toolLabel = { running: '进行中', completed: '已返回', unsuccessful: '本次未完成', stopped: '已停止', unknown: '未确认' };

export const WorkflowView = memo(function WorkflowView({ sessionId, onReturn }: { sessionId: string | null; onReturn: () => void }): JSX.Element {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedRun, setSelectedRun] = useState('');
  const [selectedNode, setSelectedNode] = useState('main');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [privateView, setPrivateView] = useState(true);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const project = useApp(s => s.currentProject);
  const openArtifact = useApp(s => s.openArtifact);
  useEffect(() => {
    setRuns([]); setSelectedRun(''); setSelectedNode('main'); setDetailsOpen(false); setNotice('');
    if (!sessionId) { setLoading(false); return; }
    setLoading(true);
    let alive = true;
    const off = window.mathmodel.workflow.onChanged(run => {
      if (alive && run.sessionId === sessionId) setRuns(old => mergeWorkflowRuns(old, [run], sessionId));
    });
    void window.mathmodel.workflow.list(sessionId).then(rows => {
      if (alive) setRuns(old => mergeWorkflowRuns(old, rows, sessionId));
    }).catch(() => { if (alive) setNotice('暂时没有读到工作流记录，可以重新读取；对话不受影响。'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; off(); };
  }, [sessionId, retry]);
  const run = runs.find(r => r.id === selectedRun) ?? runs[0];
  const node = run?.nodes.find(n => n.id === selectedNode) ?? run?.nodes[0];
  const tools = run?.nodes.flatMap(n => n.tools) ?? [];
  const workingCount = run?.nodes.filter(n => n.status === 'running').length ?? 0;
  const finishedCount = (run?.nodes.length ?? 0) - workingCount;
  const skillCount = new Set(tools.flatMap(t => t.skill ? [t.skill] : [])).size;
  const fileCount = new Set(tools.flatMap(t => t.artifact ? [t.artifact] : [])).size;
  const detailAction = (tool: WorkflowTool) => privateView ? tool.label : tool.action ?? tool.label;
  const skills = [...new Set(node?.tools.flatMap(t => t.skill ? [t.skill] : []) ?? [])].map(id => {
    const calls = node!.tools.filter(t => t.skill === id);
    const status = calls.some(t => t.status === 'running') ? '进行中' : toolLabel[calls[calls.length - 1].status];
    const source = calls[0].skillSource === 'entry' ? '写作流程已加载' : calls[0].skillSource === 'read' ? '已阅读技能说明' : '已调用技能';
    return { id, label: calls[0].label.replace(/^(载入入口指令|参考技能) · /, ''), count: calls.length, status, source };
  });
  return <section className="workflow-view" aria-label="任务工作流">
    <div className="workflow-heading">
      <div><h2>任务工作流</h2></div>
      <button className="btn btn-ghost" aria-pressed={privateView} onClick={() => setPrivateView(v => !v)}>{privateView ? '演示保护已开' : '开启演示保护'}</button>
    </div>
    <p className="workflow-note">看看谁在做什么，用了哪些方法，交回了什么成果。</p>
    {notice && <p role="status">{notice} <button className="btn btn-ghost" onClick={() => setRetry(v => v + 1)}>重新读取</button></p>}
    {!run ? <div className="workflow-empty"><Icon name="git-branch" size={32} /><h3>{loading ? '正在读取工作记录' : '从下一次任务开始，协作过程会出现在这里'}</h3>
      <p>旧对话没有完整的成员与技能关联记录，不会补造工作流。复杂任务按需协作，简单任务可由主助手独立完成。</p>
      <button className="btn btn-primary" onClick={onReturn}>回到对话，开始任务</button></div> : <>
      <div className="workflow-summary">
        <label>运行轮次 <select aria-label="工作流运行轮次" value={selectedRun} onChange={e => { setSelectedRun(e.target.value); setSelectedNode('main'); setDetailsOpen(false); }}>
          <option value="">跟随最新一轮</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {runLabel[r.status]}</option>)}
        </select></label>
        <span className={`workflow-status is-${run.status}`}>{runLabel[run.status]}</span>
        <span>{workingCount} 位正在工作</span><span>{finishedCount} 位已收起</span><span>{skillCount} 项技能与流程</span><span>{fileCount} 份文件成果</span>
      </div>
      {!run.collaborationEnabled && <p className="workflow-note">本轮没有开启多智能体协作；仍会记录主助手实际完成的工作。</p>}
      <div className={`workflow-layout is-flow-canvas${node && detailsOpen ? ' with-details' : ''}`}>
        <WorkflowCanvas key={run.id} run={run} selectedId={detailsOpen ? node?.id ?? null : null} onSelect={id => { setSelectedNode(id); setDetailsOpen(true); }} />
        {node && detailsOpen && <aside className="workflow-detail" aria-label="成员工作详情" onKeyDown={e => { if (e.key === 'Escape') setDetailsOpen(false); }}>
          <ResizeHandle storageKey="mm-workflow-detail-width-v2" label="调整成员详情宽度" edge="left" initial={280} min={220} max={340} fraction={.34} />
          <button className="flow-detail-close" aria-label="关闭成员详情" onClick={() => setDetailsOpen(false)}><Icon name="x" size={15} /></button>
          <div className="workflow-detail-heading"><span>成员详情</span><h3>{workflowAgentDisplayName(node)}</h3><p>{nodeLabel[node.status]}</p></div>
          <p className="workflow-assignment"><strong>负责内容</strong>{node.assignment ?? (node.id === 'main' ? '统筹本轮任务、核验成员结果并给出最终答复' : '本轮没有记录到明确分工')}</p>
          <section className="flow-skill-section" aria-label="这个成员调用的技能">
            <h4><Icon name="sparkles" size={13} />使用的方法 <span>{skills.length} 项</span></h4>
            {skills.length ? <ul>{skills.map(skill => <li key={skill.id}><div><strong>{skill.label}</strong><small>{skill.status}</small></div><span>{skill.source} · {skill.count} 次</span><details><summary>查看技能名称</summary><code>{skill.id}</code></details></li>)}</ul> : <p>暂未使用专门技能，可以展开下面的工作记录看看进展。</p>}
          </section>
          <details className="flow-records"><summary>展开工作记录</summary>
          {!node.tools.length && <p className="workflow-note">已记录到成员启动，尚无工具调用记录。未调用工具不代表没有处理任务。</p>}
          <ol className="workflow-tool-list">{[...node.tools].reverse().map(tool => {
            const relative = tool.artifact && project ? workflowArtifactPath(tool.artifact, project.root) : null;
            return <li key={tool.id}><div><span className={`workflow-tool-dot is-${tool.status}`} /><strong>{detailAction(tool)}</strong><small>{toolLabel[tool.status]}</small></div>
              <time>{new Date(tool.startedAt).toLocaleTimeString('zh-CN')}</time>
              {tool.skill && <span className="workflow-skill-label">技能 · {tool.label}</span>}
              {tool.artifact && <p>{privateView ? '已记录文件变更' : tool.artifact.split(/[\\/]/).pop()}{relative && <button className="btn btn-ghost" onClick={() => openArtifact(relative)}>查看文件</button>}</p>}
              {!privateView && <details><summary>调用标识</summary><code>{tool.skill ?? tool.name}</code>{tool.artifact && <p>{tool.artifact}</p>}</details>}
            </li>;
          })}</ol>
          </details>
        </aside>}
      </div>
      {run.nodes.length === 1 && <p className="workflow-note">本轮目前由主助手处理，协作成员实际启动后会自动加入画布。</p>}
      <details className="workflow-explainer"><summary>关于这张工作图</summary><p>从上到下表示真实的派发层级，同一层超过四位会自动换行，不再无限横向拉长。虚线表示成员确实参与了，但旧记录里没有可靠的上级信息，因此只挂在主助手下，不补造关系。已完成成员默认缩小、褪色；没有技能、操作和分工说明的结束记录会按上级合并成一个摘要，点“展开已结束”仍能查看原始成员。“已返回”只表示结果已经交回，仍需主助手核验。</p></details>
      {run.truncated && <p className="workflow-note">本轮事件较多，展示记录已达到上限（40 位成员、500 次工具调用），实际执行不受影响。</p>}
    </>}
  </section>;
});
