/**
 * 任务进度面板 —— agent 干活时贴在**输入框正上方**的子任务清单。
 *
 * 用户点名要的原版行为：
 *   「在任何任务的时候，应该是会在对话框的上面，弹出一个任务的过程，比如我选择写论文，
 *     有七八个子任务，然后你完成子任务之后就打勾，这样我就知道你完成了多少任务了，
 *     原版本的也是这样做的」
 *
 * 数据来自 `store/tasks.ts` 对工具调用流的折叠（不自建一套任务状态、不额外持久化）。
 *
 * 文案全部走**原版已有的键** `composer.composerTaskListCard.*`
 * （zh.ts:800-807 / en.ts:786-792），中文可见、英文不硬编码。
 */
import { useState } from 'react';
import { t, tx } from '../i18n';
import { Icon } from './Icon';
import { progressOf, type TaskState, type TaskItem } from '../store/tasks';

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

export function TaskProgressPanel({ state }: { state: TaskState }): JSX.Element | null {
  const [open, setOpen] = useState(false);

  // 没有任务时不渲染任何东西 —— 不能常驻一条空面板占位
  if (state.list.length === 0) return null;

  const { completed, total, current } = progressOf(state);
  const summary = summaryOf(state, completed, total, current);
  const remaining = state.list.filter((item) => item.status !== 'completed');

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
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} />
      </button>

      {open && (
        <div className="task-panel-body" data-task-body="1">
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
        </div>
      )}
    </div>
  );
}
