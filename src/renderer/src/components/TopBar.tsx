/** Task-focused title bar: frequent panel access, secondary actions in one menu. */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { EnvironmentMenu } from './EnvironmentMenu';
import { useApp } from '../store/app';

interface Props {
  showActions: boolean;
  onTogglePanel: () => void;
  onOpenVersions: () => void;
  onOpenEnvironment: () => void;
  onOpenShare: () => void;
  onOpenCollab: () => void;
  editorView: boolean;
  onToggleEditorView: () => void;
  hasProject: boolean;
  onOpenProjectIn: (target: 'editor' | 'systemDefault') => void;
  onRevealInFolder: () => void;
}

export function TopBar({
  showActions, onTogglePanel, onOpenVersions, onOpenEnvironment, onOpenShare,
  onOpenCollab, editorView, onToggleEditorView, hasProject, onOpenProjectIn, onRevealInFolder,
}: Props): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const project = useApp(s => s.currentProject);
  const sessions = useApp(s => s.sessions);
  const activeSessionId = useApp(s => s.activeSessionId);
  const settings = useApp(s => s.settings);
  const patchSettings = useApp(s => s.patchSettings);
  const taskView = useApp(s => s.taskView);
  const setTaskView = useApp(s => s.setTaskView);
  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;
  const [sessionRunning, setSessionRunning] = useState(activeSession?.status === 'running');
  useEffect(() => { setSessionRunning(activeSession?.status === 'running'); }, [activeSessionId, activeSession?.status]);
  useEffect(() => window.mathmodel.session.onStream((sessionId, event) => {
    if (sessionId !== activeSessionId) return;
    if (event.type === 'session-start') setSessionRunning(true);
    if (event.type === 'session-end') setSessionRunning(false);
  }), [activeSessionId]);
  useEffect(() => { setMoreOpen(false); setEnvOpen(false); }, [activeSessionId, project?.id, showActions]);
  useEffect(() => {
    if (!moreOpen) return;
    const items = () => [...(anchor.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    items()[0]?.focus();
    const pointer = (e: PointerEvent) => { if (!anchor.current?.contains(e.target as Node)) setMoreOpen(false); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMoreOpen(false); trigger.current?.focus(); }
      if (e.key === 'Tab') { setMoreOpen(false); trigger.current?.focus(); }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const nodes = items(), current = nodes.indexOf(document.activeElement as HTMLButtonElement);
      const index = e.key === 'Home' ? 0 : e.key === 'End' ? nodes.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + nodes.length) % nodes.length;
      nodes[index]?.focus();
    };
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key, true); };
  }, [moreOpen]);
  const action = (fn: () => void) => { setMoreOpen(false); trigger.current?.focus(); fn(); };
  const petEnabled = settings?.modelingPetEnabled !== false;

  return <header className="topbar">
    {showActions ? <div className="topbar-context topbar-no-drag" aria-label="当前项目和任务">
      <div className="topbar-context-copy">
        <div className="topbar-context-path">
          <Icon name="folder" size={14} />
          <span className="truncate">{project?.name ?? '未选择项目'}</span>
          <Icon name="chevron-right" size={12} />
          <strong className="truncate">{activeSession?.title || '新任务'}</strong>
          {sessionRunning && <span className="topbar-status-dot running" title="正在处理" aria-label="正在处理" />}
        </div>
      </div>
    </div> : <div className="studio-top-context"><span>{project?.name ?? 'MModels'}</span></div>}
    <div className="grow" />
    {showActions && <div className="topbar-actions topbar-no-drag">
      <div className="workflow-switch" role="group" aria-label="任务视图">
        <button aria-pressed={taskView === 'chat'} onClick={() => setTaskView('chat')}>对话</button>
        <button aria-pressed={taskView === 'workflow'} onClick={() => setTaskView('workflow')}>工作流</button>
      </div>
      <button className="topbar-action studio-panel-toggle" title="打开或收起文件面板" aria-label="打开或收起文件面板" onClick={onTogglePanel}>
        <Icon name="panel-right-close" size={16} /><span>文件</span>
      </button>
      <div className="topbar-anchor" ref={anchor}>
        <button ref={trigger} className="topbar-action" aria-label="更多任务操作" title="更多任务操作" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => { setEnvOpen(false); setMoreOpen(v => !v); }}>
          <Icon name="ellipsis" size={18} />
        </button>
        {moreOpen && <div className="studio-task-menu" role="menu" aria-label="更多任务操作">
          <div className="studio-menu-label">任务与文件</div>
          <button role="menuitem" onClick={() => action(onOpenCollab)}><Icon name="users" size={15} /><span>局域网协作</span></button>
          <button role="menuitem" onClick={() => action(onOpenShare)}><Icon name="share" size={15} /><span>上传优秀论文</span></button>
          <button role="menuitem" disabled={!hasProject} onClick={() => action(onOpenVersions)}><Icon name="refresh-cw" size={15} /><span>项目版本</span></button>
          <button role="menuitem" disabled={!hasProject} onClick={() => action(onRevealInFolder)}><Icon name="folder-open" size={15} /><span>在文件夹中显示</span></button>
          <div className="studio-menu-label">工作方式</div>
          <button role="menuitemcheckbox" aria-checked={editorView} onClick={() => action(onToggleEditorView)}><Icon name="columns-2" size={15} /><span>编辑器视图</span>{editorView && <Icon name="check" size={13} />}</button>
          <button role="menuitem" onClick={() => action(() => setEnvOpen(true))}><Icon name="notebook-tabs" size={15} /><span>项目工具与记事本</span></button>
          <button role="menuitem" onClick={() => action(onOpenEnvironment)}><Icon name="settings" size={15} /><span>运行环境设置</span></button>
          <button role="menuitemcheckbox" aria-checked={petEnabled} onClick={() => action(() => { void patchSettings({ modelingPetEnabled: !petEnabled }); })}><Icon name="sigma" size={15} /><span>桌面小模</span>{petEnabled && <Icon name="check" size={13} />}</button>
        </div>}
        <EnvironmentMenu open={envOpen} onClose={() => setEnvOpen(false)} onOpenSettings={onOpenEnvironment}
          onOpenVersions={onOpenVersions} editorView={editorView} onToggleEditorView={onToggleEditorView}
          hasProject={hasProject} onOpenProjectIn={onOpenProjectIn} onRevealInFolder={onRevealInFolder} />
      </div>
    </div>}
  </header>;
}
