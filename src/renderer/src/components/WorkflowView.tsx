import { memo, useEffect, useState } from 'react';
import { workflowAgentDisplayName, type WorkflowRun, type WorkflowTool } from '@shared/workflow';
import { buildProjectWorkflow, mergeProjectWorkflowRuns, workflowArtifactPath } from '../lib/workflow';
import { useApp } from '../store/app';
import { Icon } from './Icon';
import { WorkflowCanvas } from './WorkflowCanvas';
import { ResizeHandle } from './ResizeHandle';
import '../styles/workflow.css';

const runLabel = { running: '正在工作', completed: '本轮已结束', stopped: '已停止', interrupted: '本轮未完整结束' };
const nodeLabel = { running: '正在工作', returned: '已返回', stopped: '已停止', unknown: '未收到结束确认' };
const toolLabel = { running: '进行中', completed: '已返回', unsuccessful: '本次未完成', stopped: '已停止', unknown: '未确认' };

export const WorkflowView = memo(function WorkflowView({ projectId, onReturn }: { projectId: string | null; onReturn: () => void }): JSX.Element {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [selectedNode, setSelectedNode] = useState('main');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [privateView, setPrivateView] = useState(true);
  const [presentation, setPresentation] = useState<'demo' | 'analysis'>('demo');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const project = useApp(s => s.currentProject);
  const openArtifact = useApp(s => s.openArtifact);
  useEffect(() => {
    setRuns([]); setSelectedNode('main'); setDetailsOpen(false); setNotice('');
    if (!projectId) { setLoading(false); return; }
    setLoading(true);
    let alive = true;
    const off = window.mathmodel.workflow.onChanged(run => {
      if (alive && (!run.projectId || run.projectId === projectId)) setRuns(old => mergeProjectWorkflowRuns(old, [run], projectId));
    });
    void window.mathmodel.workflow.listProject(projectId).then(rows => {
      if (alive) setRuns(old => mergeProjectWorkflowRuns(old, rows, projectId));
    }).catch(() => { if (alive) setNotice('暂时没有读到工作流记录，可以重新读取；对话不受影响。'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; off(); };
  }, [projectId, retry]);
  const run = buildProjectWorkflow(projectId ?? '', runs);
  const node = run?.nodes.find(n => n.id === selectedNode) ?? run?.nodes[0];
  const tools = run?.nodes.flatMap(n => n.tools) ?? [];
  const workingCount = run?.nodes.filter(n => n.status === 'running').length ?? 0;
  const finishedCount = (run?.nodes.length ?? 0) - workingCount;
  const skillCount = new Set(tools.flatMap(t => t.skill ? [t.skill] : [])).size;
  const fileCount = new Set(tools.flatMap(t => t.artifact ? [t.artifact] : [])).size;
  const activeNodeId = run?.nodes.find(item => item.status === 'running')?.id ?? run?.nodes.find(item => item.id === 'main')?.id ?? null;
  const detailAction = (tool: WorkflowTool) => privateView ? tool.label : tool.action ?? tool.label;
  const skillOverview = (() => {
    const bySkill = new Map<string, { label: string; calls: number; running: number; failed: number; members: Set<string>; nodeId: string }>();
    for (const owner of run?.nodes ?? []) {
      for (const tool of owner.tools) {
        if (!tool.skill) continue;
        const current = bySkill.get(tool.skill) ?? { label: tool.label.replace(/^(载入入口指令|参考技能) · /, ''), calls: 0, running: 0, failed: 0, members: new Set<string>(), nodeId: owner.id };
        current.calls += 1;
        if (tool.status === 'running') current.running += 1;
        if (tool.status === 'unsuccessful' || tool.status === 'stopped') current.failed += 1;
        current.members.add(owner.id);
        if (tool.status === 'running') current.nodeId = owner.id;
        bySkill.set(tool.skill, current);
      }
    }
    return [...bySkill.entries()].map(([id, value]) => ({
      id,
      label: value.label,
      calls: value.calls,
      members: value.members.size,
      nodeId: value.nodeId,
      status: value.running > 0 ? '进行中' : value.failed > 0 ? '需要复核' : '已完成',
    })).sort((a, b) => (a.status === '进行中' ? -1 : b.status === '进行中' ? 1 : b.calls - a.calls));
  })();
  const skills = [...new Set(node?.tools.flatMap(t => t.skill ? [t.skill] : []) ?? [])].map(id => {
    const calls = node!.tools.filter(t => t.skill === id);
    const status = calls.some(t => t.status === 'running') ? '进行中' : toolLabel[calls[calls.length - 1].status];
    const source = calls[0].skillSource === 'entry' ? '写作流程已加载' : calls[0].skillSource === 'read' ? '已阅读技能说明' : '已调用技能';
    return { id, label: calls[0].label.replace(/^(载入入口指令|参考技能) · /, ''), count: calls.length, status, source };
  });
  return <section className={`workflow-view is-${presentation}`} aria-label="任务工作流">
    <div className="workflow-heading">
      {/* 2026-09-26 用户钦定：演示/分析切换从右侧挪到「项目工作流」标题文字旁边 */}
      <div>
        <div className="workflow-heading-row">
          <h2>项目工作流</h2>
          <div className="workflow-view-switch" role="group" aria-label="工作流视图">
            <button className={`btn btn-ghost${presentation === 'demo' ? ' active' : ''}`} aria-pressed={presentation === 'demo'} onClick={() => { setPresentation('demo'); setPrivateView(true); }}>演示视图</button>
            <button className={`btn btn-ghost${presentation === 'analysis' ? ' active' : ''}`} aria-pressed={presentation === 'analysis'} onClick={() => { setPresentation('analysis'); setPrivateView(false); }}>分析视图</button>
          </div>
        </div>
        <p className="workflow-heading-subtitle">同一项目里的多个任务，会汇总在这张工作图中。</p>
      </div>
    </div>
    <p className="workflow-note">看看谁在做什么，用了哪些方法，交回了什么成果。</p>
    {notice && <p role="status">{notice} <button className="btn btn-ghost" onClick={() => setRetry(v => v + 1)}>重新读取</button></p>}
    {!run ? <div className="workflow-empty"><Icon name="git-branch" size={32} /><h3>{loading ? '正在读取工作记录' : '从下一次任务开始，协作过程会出现在这里'}</h3>
      <p>旧对话没有完整的成员与技能关联记录，不会补造工作流。复杂任务按需协作，简单任务可由主助手独立完成。</p>
      <button className="btn btn-primary" onClick={onReturn}>回到对话，开始任务</button></div> : <>
      <div className="workflow-summary">
        <span>{runs.length} 个项目任务</span>
        <span className={`workflow-status is-${run.status}`}>{runLabel[run.status]}</span>
        <span>{workingCount} 位正在工作</span><span>{finishedCount} 位已收起</span><span>{skillCount} 项技能与流程</span><span>{fileCount} 份文件成果</span>
      </div>
      {skillOverview.length > 0 && <section className="workflow-skill-overview" aria-label="本轮技能调用概览">
        <div className="workflow-skill-overview-head"><strong>本轮调用的技能</strong><span>点击查看负责成员和工作记录</span></div>
        <div className="workflow-skill-overview-list">
          {skillOverview.slice(0, 10).map(skill => <button key={skill.id} className={`workflow-skill-chip is-${skill.status === '进行中' ? 'running' : skill.status === '需要复核' ? 'review' : 'done'}`} onClick={() => { setSelectedNode(skill.nodeId); setDetailsOpen(true); }}>
            <span className="workflow-skill-chip-dot" />
            <strong>{skill.label}</strong>
            <small>{skill.status} · {skill.calls} 次 · {skill.members} 位成员</small>
          </button>)}
        </div>
        {skillOverview.length > 10 && <span className="workflow-skill-overview-more">还有 {skillOverview.length - 10} 项技能，点击成员后可查看全部</span>}
      </section>}
      {(() => {
        const stages = run.workflowStages?.length ? run.workflowStages : ['了解问题', '研究与计算', '核对结果', '整理交付'];
        const current = Math.min(Math.max(run.currentStage ?? 0, 0), stages.length - 1);
        return <section className="workflow-stage-rail" aria-label="任务推进阶段">
          <div className="workflow-stage-heading"><span>推进到哪一步</span><small>{run.status === 'stopped' ? '本轮已停止' : run.status === 'interrupted' ? '需要复核' : run.stageStatus === 'completed' ? '本轮已收口' : `当前：${stages[current]}`}</small></div>
          <ol>{stages.map((stage, index) => <li key={`${stage}-${index}`} className={index < current || (run.stageStatus === 'completed' && index === current) ? 'is-done' : index === current && run.stageStatus !== 'completed' ? 'is-current' : 'is-next'}>
            <span className="workflow-stage-dot">{index < current || (run.stageStatus === 'completed' && index === current) ? '✓' : index + 1}</span><span>{stage}</span>
          </li>)}</ol>
        </section>;
      })()}
      {!run.collaborationEnabled && <p className="workflow-note">本轮没有开启多智能体协作；仍会记录主助手实际完成的工作。</p>}
      <div className={`workflow-layout is-flow-canvas${node && detailsOpen ? ' with-details' : ''}`}>
        <WorkflowCanvas key={`${run.id}-${presentation}`} run={run} presentation={presentation} focusId={activeNodeId} selectedId={detailsOpen ? node?.id ?? null : null} onSelect={id => { setSelectedNode(id); setDetailsOpen(true); }} />
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
