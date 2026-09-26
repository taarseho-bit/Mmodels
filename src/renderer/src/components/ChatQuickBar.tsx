/**
 * chat 路由的快捷工具条：渲染在侧边栏顶部（搜索框上方）。
 *
 * 对话/工作流切换、文件面板和任务菜单集中在侧栏，主区只保留内容，
 * 侧栏是独立列，
 * 无论弹出什么都压不住主区；同时主内容保持上抬（app-shell 单行模板）。
 *
 * ⚠️ 侧栏 overflow:hidden 会裁掉 absolute 定位的菜单，所以「更多」菜单
 *    必须走 Popover（portal + fixed 定位，不受祖先裁剪）。
 *    EnvironmentMenu 自身是 absolute 布局，放进 Popover 时用
 *    `.cz-pop .envmenu { position: static; ... }` 覆盖成流式。
 */
import { useState } from 'react';
import { Icon } from './Icon';
import { EnvironmentMenu } from './EnvironmentMenu';
import { Popover } from './Popover';
import { useApp } from '../store/app';

interface Props {
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

export function ChatQuickBar({
  onTogglePanel, onOpenVersions, onOpenEnvironment, onOpenShare,
  onOpenCollab, editorView, onToggleEditorView, hasProject, onOpenProjectIn, onRevealInFolder,
}: Props): JSX.Element {
  const [moreOpen, setMoreOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const taskView = useApp(s => s.taskView);
  const setTaskView = useApp(s => s.setTaskView);
  const settings = useApp(s => s.settings);
  const patchSettings = useApp(s => s.patchSettings);
  const petEnabled = settings?.modelingPetEnabled !== false;

  const action = (fn: () => void) => { setMoreOpen(false); fn(); };

  return (
    <div className="chat-quickbar">
      <div className="workflow-switch" role="group" aria-label="任务视图">
        <button aria-pressed={taskView === 'chat'} onClick={() => setTaskView('chat')}>对话</button>
        <button aria-pressed={taskView === 'workflow'} onClick={() => setTaskView('workflow')}>工作流</button>
      </div>
      <button
        className="chat-quickbar-btn"
        title="打开或收起文件面板"
        aria-label="打开或收起文件面板"
        onClick={onTogglePanel}
      >
        <Icon name="panel-right-close" size={15} />
      </button>
      <div className="chat-quickbar-anchor">
        <button
          className="chat-quickbar-btn"
          aria-label="更多任务操作"
          title="更多任务操作"
          onClick={() => { setEnvOpen(false); setMoreOpen(v => !v); }}
        >
          <Icon name="ellipsis" size={16} />
        </button>
        <Popover open={moreOpen} onClose={() => setMoreOpen(false)} align="right">
          <div className="studio-task-menu" role="menu" aria-label="更多任务操作">
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
          </div>
        </Popover>
        {/* 环境菜单包进 Popover（portal）：否则 absolute 定位会被侧栏 overflow:hidden 裁掉；
            .cz-pop .envmenu 覆盖其 absolute 布局为流式 */}
        <Popover open={envOpen} onClose={() => setEnvOpen(false)} align="right">
          <EnvironmentMenu open={envOpen} onClose={() => setEnvOpen(false)} onOpenSettings={onOpenEnvironment}
            onOpenVersions={onOpenVersions} editorView={editorView} onToggleEditorView={onToggleEditorView}
            hasProject={hasProject} onOpenProjectIn={onOpenProjectIn} onRevealInFolder={onRevealInFolder} />
        </Popover>
      </div>
    </div>
  );
}
