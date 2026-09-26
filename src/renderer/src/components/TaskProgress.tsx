/**
 * 任务进度面板 —— agent 干活时贴在**输入框正上方**的子任务清单。
 *
 * 用户点名要的项目契约行为：
 *   「在任何任务的时候，应该是会在对话框的上面，弹出一个任务的过程，比如我选择写论文，
 *     有七八个子任务，然后你完成子任务之后就打勾，这样我就知道你完成了多少任务了，
 *     项目契约本的也是这样做的」
 *
 * 数据来自 `store/tasks.ts` 对工具调用流的折叠（不自建一套任务状态、不额外持久化）。
 *
 * 文案全部走**项目契约已有的键** `composer.composerTaskListCard.*`
 * （zh.ts:800-807 / en.ts:786-792），中文可见、英文不硬编码。
 */
import { useState } from 'react';
import { t, tx } from '../i18n';
import { Icon } from './Icon';
import { progressOf, type TaskState, type TaskItem } from '../store/tasks';
import type { AgentActivity } from '@shared/types';

/** 单条状态图标：完成打勾 / 进行中转圈 / 待办空心圆 */
function StatusIcon({ status }: { status: TaskItem['status'] }): JSX.Element {
  if (status === 'completed') return <Icon name="check" size={12} />;
  if (status === 'in_progress') {
    return <Icon name="loader-circle" size={12} className="task-item-spin" />;
  }
  return <Icon name="circle" size={12} />;
}

/** 收起态右侧那句摘要：优先「正在做的那条」，其次「全部完成」，最后「下一条待办」 */
function summaryOf(state: TaskState, completed: number, total: number, current: TaskItem | null): string {
  if (current) return current.activeForm ?? current.subject;
  if (total > 0 && completed === total) return t('全部任务已完成');
  const next = state.list.find((x) => x.status === 'pending');
  return next?.subject ?? '';
}

/** 相对时间：`刚刚` / `N 分钟前` / `N 小时前`（A4 陈旧度提示用，不引入额外依赖） */
function relativeAge(from: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - from) / 1000));
  if (seconds < 60) return t('刚刚');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('{{count}} 分钟前', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('{{count}} 小时前', { count: hours });
  return t('{{count}} 天前', { count: Math.floor(hours / 24) });
}

export function TaskProgressPanel({ state, agents, lastActivityAt }: {
  state: TaskState;
  /** 本轮实际启动过的协作成员（stream.agents）—— 有正在工作的成员时在面板里同步可见（A2） */
  agents?: AgentActivity[];
  /** 最近一次任务工具活动时刻 —— 距今越久说明清单越可能滞后（A4） */
  lastActivityAt?: number;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);

  // 没有任务且没有协作活动时不渲染任何东西 —— 不能常驻一条空面板占位
  if (state.list.length === 0) return null;

  const { completed, total, current } = progressOf(state);
  const summary = summaryOf(state, completed, total, current);
  const remaining = state.list.filter((item) => item.status !== 'completed');
  const runningAgents = (agents ?? []).filter((a) => a.status === 'running');
  const now = Date.now();
  // 滞后提示阈值：2 分钟内不算滞后，不打扰；超过才亮提示。
  const stale =
    remaining.length > 0 &&
    typeof lastActivityAt === 'number' &&
    now - lastActivityAt > 2 * 60 * 1000;

  return (
    <div className="task-panel" data-task-panel="1">
      <button
        type="button"
        className="task-panel-head"
        onClick={() => setOpen((v) => !v)}
        title={
          open
            ? tx('composer.composerTaskListCard.collapse')
            : tx('composer.composerTaskListCard.expand')
        }
        aria-expanded={open}
      >
        <Icon name="list-checks" size={13} />
        <span className="task-panel-title">{tx('composer.composerTaskListCard.tasksLabel')}</span>
        <span
          className="task-panel-progress"
          title={tx('composer.composerTaskListCard.progressTitle')}
          data-task-count={`${completed}/${total}`}
          data-task-completed={completed}
          data-task-total={total}
        >
          {tx('composer.composerTaskListCard.progress', { completed, total })}
        </span>
        <span className="task-panel-summary">{summary}</span>
        {runningAgents.length > 0 && (
          <span className="task-panel-agents" data-task-agents={runningAgents.length}>
            <Icon name="loader-circle" size={12} className="task-item-spin" />
            {t('{{count}} 位成员协作中', { count: runningAgents.length })}
          </span>
        )}
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />
      </button>

      {open && (
        <div className="task-panel-body" data-task-body="1">
          {runningAgents.length > 0 && (
            <div className="task-panel-collab" data-task-collab="1">
              {runningAgents.slice(0, 2).map((a) => (
                <div key={a.taskId} className="task-collab-row">
                  <Icon name="loader-circle" size={12} className="task-item-spin" />
                  <span>{a.description || a.agentType}</span>
                  {a.summary && <small>{a.summary}</small>}
                </div>
              ))}
              {runningAgents.length > 2 && (
                <div className="task-collab-row">
                  <small>{t('还有 {{count}} 位成员在工作中', { count: runningAgents.length - 2 })}</small>
                </div>
              )}
            </div>
          )}
          {remaining.map((item) => (
            <div
              key={item.key}
              className={`task-item is-${item.status}`}
              data-task-status={item.status}
              data-task-key={item.key}
            >
              <span className="task-item-icon">
                <StatusIcon status={item.status} />
              </span>
              <span className="task-item-text">
                {item.status === 'in_progress' ? item.activeForm ?? item.subject : item.subject}
              </span>
            </div>
          ))}
          {completed > 0 ? (
            <div className="task-panel-completed">
              <Icon name="check" size={12} />
              <span>{t('已收起 {{count}} 个完成项', { count: completed })}</span>
            </div>
          ) : null}
          {stale && typeof lastActivityAt === 'number' ? (
            <div className="task-panel-stale" data-task-stale="1">
              <Icon name="clock" size={12} />
              <span>
                {t('任务状态最后更新于 {{age}}，可能落后于实际进度', { age: relativeAge(lastActivityAt, now) })}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
