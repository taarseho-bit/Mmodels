import type { AgentActivity } from '@shared/types';
import { Icon } from './Icon';
import { visibleAgentText } from '../lib/modeling-activity';
import { chineseAgentName } from '@shared/workflow';

function statusIcon(status: AgentActivity['status']): string {
  if (status === 'completed') return 'check';
  if (status === 'failed' || status === 'killed') return 'rotate-ccw';
  if (status === 'paused') return 'pause';
  return 'loader-circle';
}

export function AgentCollaboration({
  activities,
  active,
}: {
  activities: AgentActivity[];
  active: boolean;
}): JSX.Element | null {
  if (!active || activities.length === 0) return null;
  const running = activities.filter((activity) => activity.status === 'running' || activity.status === 'pending').length;

  return (
    <section className="agent-collab" aria-label="数学建模协作组">
      <div className="agent-collab-head">
        <span className="agent-collab-mark"><Icon name="brain" size={14} /></span>
        <strong>协作组</strong>
        <span>{running > 0 ? `${running} 位正在分头核对` : '正在汇总结果'}</span>
      </div>
      <div className="agent-collab-list">
        {activities.map((activity, index) => (
          <div key={activity.taskId} className={`agent-collab-item is-${activity.status}`}>
            <span className="agent-collab-icon">
              <Icon
                name={statusIcon(activity.status)}
                size={12}
                className={activity.status === 'running' || activity.status === 'pending' ? 'task-item-spin' : undefined}
              />
            </span>
            <span className="agent-collab-copy">
              <strong>{chineseAgentName(activity.agentType, activity.description)} · {index + 1}</strong>
              <span>{visibleAgentText(activity)}</span>
            </span>
            {activity.durationMs && activity.durationMs > 0 ? (
              <time>{Math.max(1, Math.round(activity.durationMs / 1000))} 秒</time>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
