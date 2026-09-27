/**
 * 应用最上方的细上下文栏。
 *
 * 这里只保留一行项目/任务路径；对话页的视图切换、文件面板和更多操作由调用方
 * 放在同一行右侧。它不是一个覆盖内容的浮动卡片，正文从这条细线下面开始。
 */
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useApp } from '../store/app';

export function TopBar({ actions }: { actions?: ReactNode }): JSX.Element {
  const project = useApp(s => s.currentProject);
  const sessions = useApp(s => s.sessions);
  const activeSessionId = useApp(s => s.activeSessionId);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  return (
    <header className="topbar topbar-compact">
      <div className="topbar-context studio-top-context">
        <div className="topbar-context-path" aria-label="当前项目与任务">
          <span title={project?.name ?? 'MModels'}>{project?.name ?? 'MModels'}</span>
          <Icon name="chevron-right" size={11} />
          <strong title={activeSession?.title ?? '新任务'}>{activeSession?.title || '新任务'}</strong>
        </div>
      </div>
      {actions ? <div className="topbar-actions topbar-chat-actions">{actions}</div> : null}
    </header>
  );
}
