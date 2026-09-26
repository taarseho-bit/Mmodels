/**
 * studio 路由（gallery/competitions/papers…）的条状顶栏。
 *
 * 2026-09-26 布局终态：chat 路由**无顶栏行**——主内容顶到窗口顶，
 * 按钮组（对话/工作流/文件/更多）由 App 里的 `.chat-floating-bar` 悬浮在右上角
 * （编辑器视图则在 editorview-head 右侧复用 ChatQuickBar）。
 * 本组件只剩 studio 页面的项目名展示。
 */
import { useApp } from '../store/app';

export function TopBar(): JSX.Element {
  const project = useApp(s => s.currentProject);
  return (
    <header className="topbar">
      <div className="studio-top-context"><span>{project?.name ?? 'MModels'}</span></div>
    </header>
  );
}
