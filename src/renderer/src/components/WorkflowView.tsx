import { memo, useEffect, useState } from 'react';
import type { WorkflowRun, WorkflowTool } from '@shared/workflow';
import { mergeWorkflowRuns, workflowArtifactPath } from '../lib/workflow';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { WorkflowCanvas } from './WorkflowCanvas';
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
  const skillCount = new Set(tools.flatMap(t => t.skill ? [t.skill] : [])).size;
  const fileCount = new Set(tools.flatMap(t => t.artifact ? [t.artifact] : [])).size;
  const detailAction = (tool: WorkflowTool) => privateView ? tool.label : tool.action ?? tool.label;
  const skills = [...new Set(node?.tools.flatMap(t => t.skill ? [t.skill] : []) ?? [])].map(id => {
    const calls = node!.tools.filter(t => t.skill === id);
    const status = calls.some(t => t.status === 'running') ? '进行中' : toolLabel[calls[calls.length - 1].status];
    return { id, label: calls[0].label, count: calls.length, status };
  });
  return <section className="workflow-view" aria-label="任务工作流">
    <div className="workflow-heading">
      <div><h2>任务工作流</h2></div>
      <button className="btn btn-ghost" aria-pressed={privateView} onClick={() => setPrivateView(v => !v)}>{privateView ? '演示保护已开' : '开启演示保护'}</button>
    </div>
    <p className="workflow-note">同一轮任务的实时记录。只呈现真实工作事件，不展示模型的内部思考。</p>
    {notice && <p role="status">{notice} <button className="btn btn-ghost" onClick={() => setRetry(v => v + 1)}>重新读取</button></p>}
    {!run ? <div className="workflow-empty"><Icon name="git-branch" size={32} /><h3>{loading ? '正在读取工作记录' : '从下一次任务开始，协作过程会出现在这里'}</h3>
      <p>旧对话没有完整的成员与技能关联记录，不会补造工作流。复杂任务按需协作，简单任务可由主助手独立完成。</p>
      <button className="btn btn-primary" onClick={onReturn}>回到对话，开始任务</button></div> : <>
      <div className="workflow-summary">
        <label>运行轮次 <select aria-label="工作流运行轮次" value={selectedRun} onChange={e => { setSelectedRun(e.target.value); setSelectedNode('main'); setDetailsOpen(false); }}>
          <option value="">跟随最新一轮</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · {runLabel[r.status]}</option>)}
        </select></label>
        <span className={`workflow-status is-${run.status}`}>{runLabel[run.status]}</span>
        <span>{run.nodes.length} 位成员</span><span>{skillCount} 种技能</span><span>{fileCount} 个文件变更</span>
      </div>
      {!run.collaborationEnabled && <p className="workflow-note">本轮没有启用内置协作组（可能关闭了协作，或选择了先规划）；仍记录实际发生的工作。</p>}
      <div className="workflow-layout is-flow-canvas">
        <WorkflowCanvas key={run.id} run={run} selectedId={detailsOpen ? node?.id ?? null : null} onSelect={id => { setSelectedNode(id); setDetailsOpen(true); }} />
        {node && detailsOpen && <aside className="workflow-detail" aria-label="成员工作详情" onKeyDown={e => { if (e.key === 'Escape') setDetailsOpen(false); }}>
          <button className="flow-detail-close" aria-label="关闭成员详情" onClick={() => setDetailsOpen(false)}><Icon name="x" size={15} /></button>
          <div className="workflow-detail-heading"><span>成员详情</span><h3>{node.name}</h3><p>{nodeLabel[node.status]}</p></div>
          <section className="flow-skill-section" aria-label="这个成员调用的技能">
            <h4><Icon name="sparkles" size={13} />调用过的技能 <span>{skills.length} 种</span></h4>
            {skills.length ? <ul>{skills.map(skill => <li key={skill.id}><div><strong>{skill.label}</strong><small>{skill.status}</small></div><code>{skill.id}</code><span>调用 {skill.count} 次</span></li>)}</ul> : <p>还没有记录到技能工具调用。阅读文件、计算等操作会显示在下面，不会冒充技能调用。</p>}
          </section>
          <h4 className="flow-records-title">全部工作记录</h4>
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
        </aside>}
      </div>
      {run.nodes.length === 1 && <p className="workflow-note">本轮目前由主助手处理，协作成员实际启动后会自动加入画布。</p>}
      <p className="workflow-note">“已返回”仅表示执行返回，不代表结果已经通过核验。技能统计只包含技能工具调用，入口指令单独记录。{privateView ? '演示保护隐藏操作摘要、路径及底层工具标识，保留技能名称便于讲解；打开文件预览后，请自行确认内容是否适合展示。' : '当前显示工作摘要和调用标识。'} 每个任务保留最近 20 轮记录。</p>
      {run.truncated && <p className="workflow-note">本轮事件较多，展示记录已达到上限（40 位成员、500 次工具调用），实际执行不受影响。</p>}
    </>}
  </section>;
});
