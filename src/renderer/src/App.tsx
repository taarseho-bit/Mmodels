/**
 * 应用外壳。
 *
 * 布局（复刻原版的三栏结构）：
 *   ┌─────────────────────────────────────────────────┐
 *   │ TopBar  项目名 · 模型 · 侧栏开关                 │
 *   ├──────────┬──────────────────────────┬───────────┤
 *   │ Sidebar  │ 主内容区（路由页面）      │ SidePanel │
 *   │ 项目     │                          │ 文件/终端 │
 *   │ 会话列表 │                          │ /技能     │
 *   └──────────┴──────────────────────────┴───────────┘
 *
 * ⚠️ 与原版实机对齐：**没有底部状态栏**（原版所有页面都没有），
 *    顶栏也没有品牌块与多余图标。
 * ⚠️ 没有登录页、没有账户菜单、没有额度显示 —— 按要求排除计费功能。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApprovalDecision, ApprovalRequest, AskUserRequest, TourId } from '@shared/types';
import { useApp, type SidePanelTab } from './store/app';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { SidePanel } from './components/SidePanel';
import { ResizeHandle } from './components/ResizeHandle';
import { ChatPage } from './pages/ChatPage';
import { WelcomePage } from './pages/WelcomePage';
import { SettingsPage } from './pages/SettingsPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { PapersPage } from './pages/PapersPage';
import { OnboardingWizard } from './components/OnboardingWizard';
import { GuidedTour } from './components/GuidedTour';
import { ErrorBoundary } from './components/ErrorBoundary';
import { WhatsNew } from './components/WhatsNew';
import { PaperShareDialog } from './components/PaperShareDialog';
import { CollabPanel } from './components/CollabPanel';
import { AskUserDialog } from './components/AskUserDialog';
import { ApprovalDialog } from './components/ApprovalDialog';
import { Icon } from './components/Icon';
import { FilesPanel } from './components/FilesPanel';
import { DiffPanel } from './components/DiffPanel';
import { ArtifactPanes } from './components/ArtifactPanes';
import { VersionHistoryPanel } from './components/VersionHistoryPanel';
import { setLang, t, tx, useLang } from './i18n';
import { onOpenRoute, onOpenSettings } from './lib/settings-nav';
import { installKeybindings, registerCommand, RULES, APP_COMMANDS } from './keybindings/dispatch';

/** 路由 —— 与原版顶栏导航一致（不含账号相关页面） */
export type Route =
  | 'workbench'
  | 'chat'
  | 'competitions'
  | 'gallery'
  | 'datasets'
  | 'papers'
  | 'automation'
  | 'extensions'
  | 'settings';

export function App(): JSX.Element {
  const ready = useApp((s) => s.ready);
  const bootError = useApp((s) => s.bootError);
  const currentProject = useApp((s) => s.currentProject);
  const settings = useApp((s) => s.settings);
  const bootstrap = useApp((s) => s.bootstrap);
  const patchSettings = useApp((s) => s.patchSettings);
  const sidePanel = useApp((s) => s.sidePanel);
  const setSidePanel = useApp((s) => s.setSidePanel);
  /** 「编辑器视图」模式（原版是模式，不是「打开文件面板」一次性动作） */
  const editorView = useApp((s) => s.editorView);
  const setEditorView = useApp((s) => s.setEditorView);
  const pendingPrompt = useApp((s) => s.pendingPrompt);
  const notifyTourFinished = useApp((s) => s.notifyTourFinished);
  /** 编辑器视图·对话列里的「项目会话」列表 */
  const sessions = useApp((s) => s.sessions);
  const activeSessionId = useApp((s) => s.activeSessionId);
  const beginNewChat = useApp((s) => s.beginNewChat);
  const selectSession = useApp((s) => s.selectSession);
  /** 编辑器视图·编辑区里内联打开的文件（原版：文件树选中 → 编辑区） */
  const activeArtifact = useApp((s) => s.activeArtifact);
  const openArtifact = useApp((s) => s.openArtifact);
  const [route, setActualRoute] = useState<Route>('chat');
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const setRoute = useCallback((next: Route) => {
    if (['gallery', 'competitions', 'datasets', 'automation', 'extensions'].includes(next)) {
      setSettingsSection(next); setActualRoute('settings');
    } else setActualRoute(next);
  }, []);

  /**
   * 编辑器视图的三栏状态（`original/08-editorview.png`：文件树 | 编辑区 | 对话）。
   *  - `editorCol`：第二栏显示什么（活动栏切换；再点一次收起第二栏）
   *  - `editorChatOpen`：第三栏「对话」列的显隐（原版 `showChat` / `hideChat`）
   *  - `editorHistoryOpen`：「项目会话」列表是否展开（原版 `chatHistory`）
   */
  const [editorCol, setEditorCol] = useState<'files' | 'changes' | 'versions' | null>('files');
  const [editorChatOpen, setEditorChatOpen] = useState(true);
  const [editorHistoryOpen, setEditorHistoryOpen] = useState(false);

  /** 首次运行向导 / 引导巡览的显示状态 */
  const [showWizard, setShowWizard] = useState(false);
  /**
   * 正在播的巡览。null = 不播；对象里的 tourId 决定跑哪一段教程
   * （设置页「新手教程」7 张卡各一个 id，见 shared/types 的 TourId）。
   */
  const [showTour, setShowTour] = useState<{ tourId?: TourId } | null>(null);
  /** 顶栏浮层：分享论文 / 局域网协作（原版是浮层，不是路由页） */
  const [showShare, setShowShare] = useState(false);
  const [showCollab, setShowCollab] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  /** 是否已经就「要不要弹向导」做过判断（避免设置加载完又弹一次） */
  const decidedRef = useRef(false);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // 桌面小模可以在主窗口之外修改开关，主界面需要立即跟上，不能等到重启。
  useEffect(() => {
    return window.mathmodel.settings.onChanged((next) => {
      useApp.setState({ settings: next });
    });
  }, []);

  // 界面语言跟随设置（原版：i18next 默认 zh-CN 可切 en）
  const lang = useLang();
  useEffect(() => {
    if (settings?.locale) setLang(settings.locale);
  }, [settings?.locale]);

  // 本地版启动后必须可以立即使用各个页面。模型向导保留为可选配置入口，
  // 不再用模态层挡住整个应用；未配置模型时，输入区会明确引导到设置页。
  useEffect(() => {
    if (!ready || !settings || decidedRef.current) return;
    decidedRef.current = true;
    if (!settings.onboardingDone) void patchSettings({ onboardingDone: true });
  }, [ready, settings, patchSettings]);

  // 有「待填入的提示词」→ 自动切回对话页（原版：选模板后进入新会话并填好输入框）
  useEffect(() => {
    if (pendingPrompt) setRoute('chat');
  }, [pendingPrompt]);

  // 设置页「新手教程」点某张卡 → 起那段教程
  const tourRequest = useApp((s) => s.tourRequest);
  const requestedTour = useApp((s) => s.requestedTour);
  useEffect(() => {
    if (tourRequest > 0) setShowTour({ tourId: requestedTour ?? undefined });
  }, [tourRequest, requestedTour]);

  // 任意位置请求打开设置页（可带分区，如扩展页的「跳到运行环境」）
  //
  // ⚠️ 分区必须**存下来**带给 SettingsPage：设置页自己的分区监听是在它 mount
  //    之后才注册的，从设置页**外面**调 openSettings(section) 时事件已经过去了，
  //    没人听 —— 页面会停在默认分区（踩过：教程卡跳「论文与比赛」落到「个人资料」）。
  useEffect(() => {
    return onOpenSettings(({ section }) => {
      setSettingsSection(section ?? null);
      setRoute('settings');
    });
  }, []);

  // 任意位置请求跳到某个页面（教程卡「带到对应功能」、扩展页的跨页入口、「＋」菜单的管理项）
  //
  // ⚠️ 与设置页那条同理：分区**必须存下来**带给目标页。事件是"当场派发"的，
  //    而目标页此刻多半还没挂载 —— 只在目标页里 `onOpenRoute(...)` 是收不到的。
  const [extensionsSection, setExtensionsSection] = useState<string | null>(null);
  useEffect(() => {
    return onOpenRoute(({ route: r, panel, section }) => {
      setRoute(r as Route);
      if (panel) setSidePanel(panel as SidePanelTab);
      if (r === 'extensions') setExtensionsSection(section ?? null);
    });
  }, [setSidePanel]);

  // 系统通知被点击（带 sessionId）→ 跳到对应会话
  useEffect(() => {
    const off = window.mathmodel.notifications.onOpenSession((sessionId) => {
      useApp.setState({ activeSessionId: sessionId });
      setRoute('chat');
    });
    return off;
  }, []);

  /**
   * Agent 提问（AskUserQuestion 工具）→ 弹确认框。
   *
   * 主进程那条 canUseTool promise 会一直挂着，直到用户在这里作答或取消，
   * 所以这个弹窗是模态的、必须给出结果（不能静默丢弃）。
   */
  const [askRequest, setAskRequest] = useState<AskUserRequest | null>(null);
  useEffect(() => {
    return window.mathmodel.session.onAskUser((req) => setAskRequest(req));
  }, []);

  const answerAskUser = useCallback((answers: Record<string, string> | null): void => {
    setAskRequest((cur) => {
      if (cur) {
        void window.mathmodel.session.answerUser(cur.sessionId, cur.requestId, answers);
      }
      return null;
    });
  }, []);

  /**
   * 工具审批（权限模式 = 需要批准时，canUseTool 拦下工具调用）→ 弹审批框。
   *
   * 与提问框同理：主进程那条 canUseTool promise 会一直挂着直到用户做出决定，
   * 所以这个弹窗**不能静默丢弃**（丢一次就把整个回合卡死）。
   *
   * 只保留「最新一条」：一次 run 里 CLI 是串行执行工具的，同一时刻只会有一条待审批。
   * 万一来得更快，覆盖旧的那条会把它卡住 —— 所以有条数上限的判断题留在这里写清楚：
   * 真要出现并发，需要改成队列（当前 CLI 不会这么发，不做过度设计）。
   */
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  useEffect(() => {
    return window.mathmodel.session.onApprovalAsk((req) => setApprovalRequest(req));
  }, []);

  const answerApproval = useCallback((decision: ApprovalDecision): void => {
    setApprovalRequest((cur) => {
      if (cur) {
        void window.mathmodel.session.answerApproval(cur.sessionId, cur.requestId, decision);
      }
      return null;
    });
  }, []);

  /**
   * 全局键盘快捷键 —— **统一分发器**（见 `keybindings/dispatch.ts`）。
   *
   * 这里只做两件事：① 挂上那**唯一**一个 `keydown`；② 登记 App 自己负责的命令。
   *
   * ⚠️ 这个 `useEffect` **替换掉了**原来那段"自己拼 `Ctrl + N` 字符串再比较"的临时监听：
   *   - 原来只有 2 条命令生效，而且**都不在**设置页的 14 条清单里（`new-chat` / `open-settings`）；
   *   - 清单里那 14 条**全仓零消费点** ⇒ 用户录了自定义键位按下去没反应（本项要修的病灶）；
   *   - 现在两条历史命令走同一套归一化/匹配，行为不变（默认值仍是 `Ctrl + N` / `Ctrl + ,`）。
   */
  useEffect(() => {
    const offNew = registerCommand('new-chat', () => {
      useApp.getState().beginNewChat();
      setRoute('chat');
    });
    const offSettings = registerCommand('open-settings', () => setRoute('settings'));
    const offShortcuts = registerCommand('shortcuts.help', () => setShowShortcuts(true));
    const uninstall = installKeybindings();
    return () => {
      uninstall();
      offNew();
      offSettings();
      offShortcuts();
    };
  }, []);

  /** 向导完成 / 关闭 */
  const finishWizard = useCallback(
    (opts: { startTour: boolean }): void => {
      setShowWizard(false);
      void patchSettings({ onboardingDone: true, tourDone: !opts.startTour });
      if (opts.startTour) {
        // 等一帧让界面稳定，再起完整巡览
        setTimeout(() => setShowTour({ tourId: 'quickStart' }), 260);
      }
    },
    [patchSettings],
  );

  const closeTour = useCallback((): void => {
    // 完整导览结束后照旧回对话页收尾；短教程（图库/扩展/广场…）就停在原地，
    // 用户正站在刚讲的那个功能上，把他拽回对话页反而莫名其妙。
    const isShort =
      !!showTour?.tourId && showTour.tourId !== 'quickStart';
    setShowTour(null);
    // 通知教程卡结算「这一段看完了」
    notifyTourFinished();
    // tourDone 只属于完整导览；短教程不该把「快速开始」也标成已完成
    if (!isShort) void patchSettings({ tourDone: true });
    if (!isShort) setRoute('chat');
  }, [patchSettings, showTour, notifyTourFinished]);

  /**
   * 环境浮层里的「在 <编辑器> 中打开」/「默认应用」。
   * 原版能探测本机编辑器并按名字拉起（`openInEditorNamed` 是插值键）；本地版
   * 没有编辑器探测/拉起 IPC，两个启动器都交给主进程 `shell.openPath`，由系统按
   * 「目录」的注册程序打开。真正拉起 Cursor 需要主进程 spawn —— 见汇报遗留点。
   */
  const openProjectIn = useCallback((target: 'editor' | 'systemDefault'): void => {
    const root = useApp.getState().currentProject?.root;
    if (!root) return;
    switch (target) {
      case 'editor':
      case 'systemDefault':
        void window.mathmodel.app.openPath(root);
        break;
    }
  }, []);

  /** 环境浮层里的「在文件夹中显示」 */
  const revealProjectInFolder = useCallback((): void => {
    const root = useApp.getState().currentProject?.root;
    if (root) void window.mathmodel.app.showItemInFolder(root);
  }, []);

  if (!ready) {
    return (
      <div className="boot-splash">
        <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />
        <div className="muted" style={{ marginTop: 12 }}>
          {t('正在启动 MModels…')}
        </div>
      </div>
    );
  }

  if (bootError) {
    return (
      <div className="boot-splash">
        <div style={{ marginBottom: 8 }}>
          <Icon name="triangle-alert" size={32} />
        </div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('启动失败')}</div>
        <div className="muted" style={{ maxWidth: 520, lineHeight: 1.7 }}>
          {bootError}
        </div>
      </div>
    );
  }

  // 没有项目 → 走欢迎页（创建项目）；key=lang 保证切语言时整树刷新文案
  if (!currentProject) {
    return (
      <ErrorBoundary key={lang}>
        <WelcomePage />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary key={lang}>
      <div className={`app-shell competition-shell${route === 'settings' ? ' no-topbar' : ''}`}>
        {/*
          ⚠️ 设置页是**全屏接管**（原版实机取证：`original/s05-env.txt` 里没有
          新建会话/科研绘图/… 这些应用侧栏项，设置导航从 x≈10 就开始）。
          所以进设置页要收起顶栏与应用侧栏，否则会变成"双栏并排"。
        */}
        {route !== 'settings' && (
          <TopBar
            showActions={route === 'chat'}
            onTogglePanel={() => {
              // 编辑器视图下没有右栏，「打开面板」切换的是第二栏（文件树/更改）
              if (editorView) setEditorCol((c) => (c === null ? 'files' : null));
              else setSidePanel(sidePanel === null ? 'files' : null);
            }}
            onOpenVersions={() =>
              editorView ? setEditorCol('versions') : setSidePanel('versions')
            }
            onOpenEnvironment={() => { setSettingsSection('env'); setRoute('settings'); }}
            onOpenShare={() => setShowShare(true)}
            onOpenCollab={() => setShowCollab(true)}
            editorView={editorView}
            onToggleEditorView={() => setEditorView(!editorView)}
            hasProject={currentProject !== null}
            onOpenProjectIn={openProjectIn}
            onRevealInFolder={revealProjectInFolder}
          />
        )}

        <div className="app-body">
          {/*
            ⚠️ 全屏接管的两处：
              - 设置页（原版实机：设置导航从 x≈10 开始，没有应用侧栏）
              - 编辑器视图（原版 `original/08-editorview.txt` 里同样没有
                新建会话/科研绘图/… 这些应用侧栏项，左边缘只有图标活动栏）
          */}
          {route !== 'settings' && !(route === 'chat' && editorView) && (
            <Sidebar route={route} setRoute={setRoute} />
          )}

          {/*
            编辑器视图（`original/08-editorview.png`）：活动栏 | 文件树 | 编辑区 | 对话 四列。
            key 固定 —— 「对话」列在普通视图与编辑器视图之间只能换位置、不能换身份，
            否则 ChatPage 会被卸载，正在流式的回复会丢。
          */}
          <main className={`app-main${route === 'chat' && editorView ? ' is-editorview' : ''}`}>
            {route === 'chat' && editorView && (
              <div className="editorview-head">
                <button
                  type="button"
                  className="editorview-head-btn"
                  title={tx('chat.editorView.backToProject')}
                  onClick={() => setEditorView(false)}
                >
                  <Icon name="panel-left" size={15} />
                  <span>{tx('chat.editorView.backToProject')}</span>
                </button>
                <button
                  type="button"
                  className="editorview-head-btn"
                  title={tx('chat.editorView.backToTemplates')}
                  onClick={() => {
                    setEditorView(false);
                    setRoute('gallery');
                  }}
                >
                  <Icon name="blocks" size={15} />
                  <span>{tx('chat.editorView.backToTemplates')}</span>
                </button>

                <div className="grow" />

                <button
                  type="button"
                  className="editorview-head-btn"
                  aria-pressed={editorChatOpen}
                  title={
                    editorChatOpen
                      ? tx('chat.editorView.hideChat')
                      : tx('chat.editorView.showChat')
                  }
                  onClick={() => setEditorChatOpen((v) => !v)}
                >
                  <Icon name="message-square" size={15} />
                  <span>
                    {editorChatOpen
                      ? tx('chat.editorView.hideChat')
                      : tx('chat.editorView.showChat')}
                  </span>
                </button>
                <button
                  type="button"
                  className="editorview-head-btn"
                  title={tx('chat.editorView.exit')}
                  onClick={() => setEditorView(false)}
                >
                  <Icon name="x" size={15} />
                  <span>{tx('chat.editorView.exit')}</span>
                </button>
              </div>
            )}

            <div className="app-main-body">
              {route === 'chat' ? (
                <>
                  {/* 第一栏：编辑器活动栏 */}
                  {editorView && (
                    <div
                      key="rail"
                      className="editorview-rail"
                      role="toolbar"
                      aria-label={tx('chat.editorView.activityBar')}
                    >
                      <button
                        type="button"
                        className={`editorview-rail-btn${editorCol === 'files' ? ' is-active' : ''}`}
                        title={tx('chat.editorView.files')}
                        onClick={() =>
                          setEditorCol((c) => (c === 'files' ? null : 'files'))
                        }
                      >
                        <Icon name="folder" size={16} />
                      </button>
                      <button
                        type="button"
                        className={`editorview-rail-btn${editorCol === 'changes' ? ' is-active' : ''}`}
                        title={tx('chat.editorView.changes')}
                        onClick={() =>
                          setEditorCol((c) => (c === 'changes' ? null : 'changes'))
                        }
                      >
                        <Icon name="file-diff" size={16} />
                      </button>
                    </div>
                  )}

                  {/* 第二栏：文件树 / 更改 / 项目版本（复用既有面板，不另起一套） */}
                  {editorView && editorCol !== null && (
                    <div key="col" className="editorview-col">
                      <ResizeHandle storageKey="mm-editor-files-width" label="调整编辑器文件栏宽度" min={160} max={420} fraction={.28} />
                      {editorCol === 'files' && <FilesPanel treeOnly />}
                      {editorCol === 'changes' && <DiffPanel />}
                      {editorCol === 'versions' && <VersionHistoryPanel />}
                    </div>
                  )}

                  {/* 第三栏：编辑区 */}
                  {editorView && (
                    <div key="editor" className="editorview-stage">
                      {activeArtifact ? (
                        <ArtifactPanes
                          relPath={activeArtifact}
                          onClose={() => openArtifact(null)}
                        />
                      ) : (
                        <div className="editorview-stage-empty">
                          <Icon name="folder-open" size={30} />
                          <div className="editorview-stage-empty-title">
                            {tx('dock.fileViewer.emptyTitle')}
                          </div>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {tx('dock.fileViewer.emptyDescription')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 第四栏：对话（普通视图下这一栏就是主区） */}
                  <div
                    key="chat"
                    className={`editorview-chatcol${editorView ? '' : ' is-main'}${
                      editorView && !editorChatOpen ? ' is-folded' : ''
                    }`}
                  >
                    {editorView && (
                      <div className="editorview-chatcol-head">
                        <span className="editorview-chatcol-title">
                          {tx('chat.editorView.chat')}
                        </span>
                        <button
                          type="button"
                          className="editorview-chatcol-btn"
                          title={tx('chat.editorView.newChat')}
                          aria-label={tx('chat.editorView.newChat')}
                          onClick={() => {
                            beginNewChat();
                            setEditorChatOpen(true);
                            setEditorHistoryOpen(false);
                          }}
                        >
                          <Icon name="plus" size={14} />
                        </button>
                        <button
                          type="button"
                          className={`editorview-chatcol-btn${editorHistoryOpen ? ' is-active' : ''}`}
                          title={tx('chat.editorView.chatHistory')}
                          aria-label={tx('chat.editorView.chatHistory')}
                          aria-expanded={editorHistoryOpen}
                          onClick={() => setEditorHistoryOpen((v) => !v)}
                        >
                          <Icon name="rotate-cw" size={14} />
                        </button>
                      </div>
                    )}

                    {editorView && <ResizeHandle storageKey="mm-editor-chat-width" label="调整编辑器对话宽度" edge="left" initial={360} min={280} max={680} fraction={.45} />}

                    {editorView && editorHistoryOpen && (
                      <div className="editorview-chatlist">
                        <div className="editorview-chatlist-title">
                          {tx('chat.editorView.projectChats')}
                        </div>
                        {sessions.length === 0 ? (
                          <div className="editorview-chatlist-empty">
                            {tx('chat.editorView.noProjectChats')}
                          </div>
                        ) : (
                          sessions.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              className={`editorview-chatlist-item${
                                s.id === activeSessionId ? ' is-active' : ''
                              }`}
                              title={s.title}
                              onClick={() => {
                                selectSession(s.id);
                                setEditorChatOpen(true);
                              }}
                            >
                              {s.title || tx('integrations.taskCompletion.untitledChat')}
                            </button>
                          ))
                        )}
                      </div>
                    )}

                    <ChatPage />
                  </div>
                </>
              ) : (
                <div key="stage" className="app-main-stage">
                  {route === 'workbench' && <WorkbenchPage />}
                  {route === 'papers' && <PapersPage />}
                  {route === 'settings' && (
                    <SettingsPage
                      onBack={() => setRoute('chat')}
                      onOpenAutomations={() => setRoute('automation')}
                      requestedSection={settingsSection}
                      requestedExtensionTab={extensionsSection}
                      onNavigate={setRoute}
                    />
                  )}
                </div>
              )}
            </div>
          </main>

          {route === 'chat' && !editorView && sidePanel !== null && <SidePanel />}
        </div>
      </div>

      {/* ── 首次运行向导（完成前不自动消失）── */}
      {showWizard && (
        <OnboardingWizard onClose={() => finishWizard({ startTour: false })} onFinish={finishWizard} />
      )}

      {/* ── 引导巡览（聚光灯 + 气泡）── */}
      {showTour && (
        <GuidedTour
          tourId={showTour.tourId}
          onClose={closeTour}
          onNavigate={(r) => setRoute(r as Route)}
        />
      )}

      {/* ── 更新日志（新版本首次启动弹出）── */}
      <WhatsNew />

      {/* ── 顶栏浮层：分享论文 / 局域网协作 ── */}
      <PaperShareDialog open={showShare} onClose={() => setShowShare(false)} />
      <CollabPanel open={showCollab} onClose={() => setShowCollab(false)} />

      {/* ── Agent 提问确认框（AskUserQuestion）── */}
      {askRequest && (
        <AskUserDialog
          request={askRequest}
          onSubmit={(answers) => answerAskUser(answers)}
          onCancel={() => answerAskUser(null)}
        />
      )}

      {/* ── 工具审批框（权限模式 = 需要批准）── */}
      {approvalRequest && (
        <ApprovalDialog request={approvalRequest} onDecide={answerApproval} />
      )}

      {showShortcuts && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowShortcuts(false)}>
          <div className="modal shortcuts-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><span className="modal-title">{t('快捷键')}</span><button className="btn btn-sm btn-ghost" aria-label={t('关闭')} onClick={() => setShowShortcuts(false)}><Icon name="x" size={13} /></button></div>
            <div className="modal-body shortcuts-list">
              {[...RULES.filter((r) => r.defaultBinding || r.display), ...APP_COMMANDS.map((r) => ({ command: r.command, labelKey: r.command, defaultBinding: r.defaultBinding }))].map((rule) => {
                const binding = 'display' in rule && rule.display ? rule.display.join(' + ') : ('defaultBinding' in rule ? rule.defaultBinding : '');
                const label = 'labelKey' in rule && rule.labelKey.startsWith('shell.') ? tx(rule.labelKey) : rule.command;
                return <div className="shortcut-row" key={rule.command}><span>{label}</span><kbd>{binding}</kbd></div>;
              })}
            </div>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}
