/**
 * 顶栏 —— 与原件实机一致：**只有右侧五个动作按钮**，没有品牌块、没有模型 badge、
 * 没有额外的引导/主题图标（原版实机截图 1266×804 已确认）。
 *
 * 右侧按钮文案逐字取自：
 *   局域网协作 `dock.collabPanel.startTitle`
 *   分享论文   `papers.share.sessionTitle`
 *   编辑器视图 `chat.editorView.enter`
 *   环境       `chat.chatPage.environment`
 *   打开面板   `chat.chatPage.openPanel`
 *
 * 「打开面板」是**纯显隐切换**（原版语义：保留上次选中的 tab，不抢上下文）。
 * 主题切换在「设置 → 外观」里。
 *
 * 「环境」点开的是**锚点浮层**（`EnvironmentMenu`，原版实机截图
 * `original/06-environment.png`），不是整页跳设置页；设置入口是浮层里的 ⚙。
 * 「编辑器视图」是**模式开关**（原版 `chat.editorView.enter` / `exit`），
 * 激活时按钮呈激活态。
 */
import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { tx } from '../i18n';
import { EnvironmentMenu } from './EnvironmentMenu';
import { useApp } from '../store/app';

interface Props {
  /**
   * 是否显示右侧五个动作（与原版实机一致：**只在对话/Composer 上下文出现**，
   * 科研绘图 / 数模广场 / 竞赛日历 / 自动化等页面上原版没有这组入口）。
   */
  showActions: boolean;
  /** 切换右侧面板显隐（原版 `chatPage.openPanel` 语义） */
  onTogglePanel: () => void;
  /** 打开「项目版本」（环境浮层里的条目；编辑器视图下落在第二栏） */
  onOpenVersions: () => void;
  /** 打开环境相关设置（环境浮层右上角的 ⚙） */
  onOpenEnvironment: () => void;
  /** 打开「分享论文」浮层（原版是浮层菜单，不是路由） */
  onOpenShare: () => void;
  /** 打开「局域网协作」面板（原版为局域网协作，非云端） */
  onOpenCollab: () => void;
  /** 当前是否处于「编辑器视图」模式 */
  editorView: boolean;
  /** 进入 / 退出「编辑器视图」 */
  onToggleEditorView: () => void;
  /** 当前项目是否可用（没有项目时外部编辑器入口置灰） */
  hasProject: boolean;
  /** 用外部程序打开当前项目目录 */
  onOpenProjectIn: (target: 'editor' | 'systemDefault') => void;
  /** 在系统文件管理器中显示当前项目目录 */
  onRevealInFolder: () => void;
}

export function TopBar({
  showActions,
  onTogglePanel,
  onOpenVersions,
  onOpenEnvironment,
  onOpenShare,
  onOpenCollab,
  editorView,
  onToggleEditorView,
  hasProject,
  onOpenProjectIn,
  onRevealInFolder,
}: Props): JSX.Element {
  /** 环境浮层是顶栏本地的 UI 状态（不跨页面共享） */
  const [envOpen, setEnvOpen] = useState(false);
  const project = useApp((state) => state.currentProject);
  const sessions = useApp((state) => state.sessions);
  const activeSessionId = useApp((state) => state.activeSessionId);
  const beginNewChat = useApp((state) => state.beginNewChat);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const [sessionRunning, setSessionRunning] = useState(activeSession?.status === 'running');
  useEffect(() => {
    setSessionRunning(activeSession?.status === 'running');
  }, [activeSessionId, activeSession?.status]);
  useEffect(() => window.mathmodel.session.onStream((sessionId, event) => {
    if (sessionId !== activeSessionId) return;
    if (event.type === 'session-start') setSessionRunning(true);
    if (event.type === 'session-end') setSessionRunning(false);
  }), [activeSessionId]);

  return (
    <header className="topbar">
      {showActions ? (
        <div className="topbar-context topbar-no-drag" aria-label="当前项目和任务">
          <div className="topbar-context-mark" aria-hidden><Icon name="square-function" size={15} /></div>
          <div className="topbar-context-copy">
            <div className="topbar-context-path">
              <span className="truncate">{project?.name ?? '未选择项目'}</span>
              <Icon name="chevron-right" size={12} />
              <strong className="truncate">{activeSession?.title || '新任务'}</strong>
            </div>
            <div className="topbar-context-status">
              <span className={`topbar-status-dot${sessionRunning ? ' running' : ''}`} />
              {sessionRunning ? '正在处理' : '可以继续提问'}
            </div>
          </div>
          <button
            type="button"
            className="topbar-new-chat"
            title="在当前项目中开始新任务"
            disabled={!project}
            onClick={beginNewChat}
          >
            <Icon name="message-square-plus" size={14} />
            <span>新任务</span>
          </button>
        </div>
      ) : null}
      <div className="grow" />

      {/* ── 右侧动作（仅对话上下文；与原版实机顺序一致）── */}
      {showActions && (
      <div className="topbar-actions topbar-no-drag">
        {/* 局域网协作 */}
        <button className="topbar-action" title={tx('dock.collabPanel.startTitle')} onClick={onOpenCollab}>
          <Icon name="users" size={14} />
          <span>{tx('dock.collabPanel.startTitle')}</span>
        </button>

        {/* 分享论文（浮层）*/}
        <button className="topbar-action" title={tx('papers.share.tooltip')} onClick={onOpenShare}>
          <Icon name="share" size={14} />
          <span>{tx('papers.share.sessionTitle')}</span>
        </button>

        {/* 编辑器视图（模式开关，激活时呈激活态） */}
        <button
          className={`topbar-action${editorView ? ' is-active' : ''}`}
          title={editorView ? tx('chat.editorView.exit') : tx('chat.editorView.enter')}
          aria-pressed={editorView}
          onClick={onToggleEditorView}
        >
          <Icon name="columns-2" size={14} />
          <span>{tx('chat.editorView.enter')}</span>
        </button>

        {/* 环境（锚点浮层） */}
        <div className="topbar-anchor">
          <button
            className={`topbar-action${envOpen ? ' is-active' : ''}`}
            title={tx('chat.chatPage.environment')}
            aria-expanded={envOpen}
            aria-haspopup="menu"
            onClick={() => setEnvOpen((v) => !v)}
          >
            <Icon name="monitor" size={14} />
            <span>{tx('chat.chatPage.environment')}</span>
          </button>

          <EnvironmentMenu
            open={envOpen}
            onClose={() => setEnvOpen(false)}
            onOpenSettings={onOpenEnvironment}
            onOpenVersions={onOpenVersions}
            editorView={editorView}
            onToggleEditorView={onToggleEditorView}
            hasProject={hasProject}
            onOpenProjectIn={onOpenProjectIn}
            onRevealInFolder={onRevealInFolder}
          />
        </div>

        {/* 打开面板：纯显隐切换（原版语义，保留上次 tab） */}
        <button
          className="topbar-action"
          title={tx('chat.chatPage.openPanel')}
          onClick={onTogglePanel}
        >
          <Icon name="panel-right-close" size={14} />
          <span>{tx('chat.chatPage.openPanel')}</span>
        </button>
      </div>
      )}
    </header>
  );
}
