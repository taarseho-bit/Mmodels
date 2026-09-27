/**
 * 页壳与空态 —— 按语义对应应用约定 `PageShell` chunk（`PageShell-ClBCklFx.js`）。
 *
 * 应用约定结构（tailwind）：
 *   PageShell: <div flex h-full flex-col>
 *                <header titlebar-drag flex h-9 shrink-0 items-center justify-between px-5>
 *                  <div flex items-baseline gap-2.5>
 *                    <span text-[13px] font-medium text-fg/80>{title}</span>
 *                    <span text-xs text-muted-fg/70>{description}</span>
 *                  </div>
 *                  <div titlebar-no-drag>{action}</div>
 *                </header>
 *                <div fade-in flex-1 overflow-y-auto>{children}</div>
 *              </div>
 *   EmptyState: 图标（size-14 rounded-2xl border bg-card）
 *               + 标题（text-[15px] font-medium）
 *               + 描述（max-w-72 text-center text-[13px] leading-6）
 *               + action
 *
 * 本项目不用 tailwind，改用等价 CSS 类（`.shell` / `.shell-head` …）。
 */
import type { ReactNode } from 'react';

export interface PageShellProps {
  title: string;
  /** 标题右侧的小字说明 */
  description?: ReactNode;
  /** 右对齐的操作区 */
  action?: ReactNode;
  children: ReactNode;
}

export function PageShell({ title, description, action, children }: PageShellProps): JSX.Element {
  return (
    <div className="shell">
      <header className="shell-head">
        <div className="shell-head-text">
          <span className="shell-title">{title}</span>
          {description ? <span className="shell-desc">{description}</span> : null}
        </div>
        {action ? <div className="shell-action">{action}</div> : null}
      </header>
      <div className="shell-body">{children}</div>
    </div>
  );
}

export interface EmptyStateProps {
  /** 图标：可以是 emoji 字符串或 React 节点 */
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** 是否撑满剩余高度（默认 true） */
  fill?: boolean;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  fill = true,
}: EmptyStateProps): JSX.Element {
  return (
    <div className={`empty-state${fill ? ' fill' : ''}`}>
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <div className="empty-state-title">{title}</div>
      {description ? <div className="empty-state-desc">{description}</div> : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
