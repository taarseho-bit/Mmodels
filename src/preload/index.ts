/**
 * Preload —— 主进程与渲染层之间唯一的桥。
 *
 * 约定：
 *  1. **绝不暴露 ipcRenderer 本身**，只暴露具体方法，避免渲染层任意调用
 *  2. 所有通道名来自 `@shared/types` 的 IPC 常量（单一真相源）
 *  3. 订阅类方法统一返回「取消订阅函数」，方便 React useEffect 清理
 *  4. `serverPort` / `serverToken` 通过**同步 IPC** 拿 —— 因为服务是在
 *     窗口创建**之前**启动的，命令行参数拿不到（详见 main/index.ts 注释）
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { IPC } from '@shared/types';
import { COMPETITION_IPC, type CompetitionLibraryApi } from '../shared/competition-studio';
import { WORKFLOW_IPC, type WorkflowApi } from '../shared/workflow';
import type {
  AppSettings,
  AskUserRequest,
  ApprovalDecision,
  ApprovalRequest,
  BotSecretStatus,
  ChatMessage,
  CollabDiscoverResult,
  CollabEvent,
  CollabFileResult,
  CollabJoinResult,
  CollabRole,
  CollabRoomInfo,
  CollabTaskStatus,
  FileNode,
  FilePreview,
  InflightTurn,
  PaperConfigPatch,
  PaperGetConfigResult,
  PaperSaveResult,
  PaperTemplateDeleteResult,
  PaperTemplateForkResult,
  PaperTemplateLibraryResult,
  PaperTemplatesResult,
  PresetProvider,
  ProjectMeta,
  ProviderConfig,
  ProxyDetection,
  ProxySettings,
  SessionMeta,
  SkillMeta,
  StreamEvent,
  UsageStats,
} from '@shared/types';

/** 算法目录快照（与 main/ipc/algorithms.ts 返回一致） */
interface AlgorithmsSnapshot {
  source: 'bundled';
  catalogVersion: number;
  python: { state: 'ready' | 'installable' | 'no-python' | 'broken'; cmd: string | null; version: string; pipOk: boolean };
  algorithms: {
    id: string;
    name: string;
    task: string;
    packageName: string;
    versionRange: string;
    license: string;
    summary: string;
    suitableFor: string[];
    inputs: string[];
    outputs: string[];
    notFor: string[];
    docs: string;
    installed: boolean;
    installing: boolean;
  }[];
}

/** 统一的订阅助手：返回取消函数 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler as never);
  return () => ipcRenderer.removeListener(channel, handler as never);
}

// ── 本地服务凭据（同步拿，必须在 expose 之前）──
interface ServerInfoLike {
  port: number;
  token: string;
  baseUrl: string;
}
let serverInfo: ServerInfoLike | null = null;
try {
  serverInfo = ipcRenderer.sendSync(IPC.APP_SERVER_INFO) as ServerInfoLike | null;
} catch {
  serverInfo = null;
}

const competition: CompetitionLibraryApi = {
  state: () => ipcRenderer.invoke(COMPETITION_IPC.state),
  ensureProject: id => ipcRenderer.invoke(COMPETITION_IPC.ensureProject, id),
  saveProject: p => ipcRenderer.invoke(COMPETITION_IPC.saveProject, p),
  pickPapers: () => ipcRenderer.invoke(COMPETITION_IPC.pickPapers),
  importPapers: (rows, rights) => ipcRenderer.invoke(COMPETITION_IPC.importPapers, rows, rights),
  paperNote: (id, notes, favorite) => ipcRenderer.invoke(COMPETITION_IPC.paperNote, id, notes, favorite),
  openPaper: id => ipcRenderer.invoke(COMPETITION_IPC.openPaper, id),
  libraryFolder: () => ipcRenderer.invoke(COMPETITION_IPC.libraryFolder),
  revealLibrary: () => ipcRenderer.invoke(COMPETITION_IPC.revealLibrary),
  revealProject: id => ipcRenderer.invoke(COMPETITION_IPC.revealProject, id),
  onState: cb => subscribe(COMPETITION_IPC.changed, cb),
};
const api = {
  workflow: {
    list: sessionId => ipcRenderer.invoke(WORKFLOW_IPC.list, sessionId),
    onChanged: cb => subscribe(WORKFLOW_IPC.changed, cb),
  } satisfies WorkflowApi,
  competition,
  // ── 本地服务凭据 ──────────────────────────────────────────
  /** 随机端口（0 表示服务未起来） */
  serverPort: serverInfo?.port ?? 0,
  /** 访问本地服务必须带的 token */
  serverToken: serverInfo?.token ?? '',
  /** 完整 baseUrl，方便渲染层直接拼 */
  serverBaseUrl: serverInfo?.baseUrl ?? '',

  // ── 应用 ──────────────────────────────────────────────────
  app: {
    version: (): Promise<{
      app: string;
      electron: string;
      chrome: string;
      node: string;
      platform: string;
      arch: string;
      packaged: boolean;
    }> => ipcRenderer.invoke(IPC.APP_VERSION),
    openPath: (p: string): Promise<boolean> => ipcRenderer.invoke(IPC.APP_OPEN_PATH, p),
    showItemInFolder: (p: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.APP_SHOW_IN_FOLDER, p),
    setNativeTheme: (theme: 'light' | 'dark' | 'system'): Promise<boolean> =>
      ipcRenderer.invoke(IPC.APP_SET_THEME, theme),
    /**
     * keybindings.json 的磁盘路径（不存在时按当前设置生成）。
     * 传 rules 会顺手把键位覆盖写进该文件。
     */
    keybindingsFile: (rules?: Record<string, string>): Promise<string> =>
      ipcRenderer.invoke(IPC.APP_KEYBINDINGS_FILE, rules),
    /** 从拖拽的 File 对象拿到真实磁盘路径（Electron 33+ 必须走 webUtils） */
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
  },

  // ── 文件 ──────────────────────────────────────────────────
  file: {
    selectDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.FILE_SELECT_DIR),
    selectFiles: (): Promise<string[] | null> => ipcRenderer.invoke(IPC.FILE_SELECT_FILES),
    saveText: (defaultName: string, content: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_TEXT, defaultName, content),
    saveBinary: (defaultName: string, base64: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_BINARY, defaultName, base64),
    /** 打开外部文本文件（原版 openTextFile，用于会话导入）：取消/失败返回 null */
    openText: (): Promise<{ path: string; content: string } | null> =>
      ipcRenderer.invoke(IPC.FILE_OPEN_TEXT),
    /** 把 HTML 渲染成分享图 PNG 保存（原版 saveShareImage）：取消返回 null */
    saveShareImage: (opts: {
      defaultName?: string;
      html: string;
    }): Promise<{ path: string } | null> =>
      ipcRenderer.invoke(IPC.FILE_SAVE_SHARE_IMAGE, opts),
    preview: (relPath: string): Promise<FilePreview> =>
      ipcRenderer.invoke(IPC.FILE_READ_PREVIEW, relPath),
    tree: (): Promise<FileNode[]> => ipcRenderer.invoke(IPC.FILE_TREE),
    write: (relPath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.FILE_WRITE, relPath, content),
    rename: (from: string, to: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.FILE_RENAME, from, to),
    remove: (relPath: string): Promise<boolean> => ipcRenderer.invoke(IPC.FILE_DELETE, relPath),
    duplicate: (relPath: string): Promise<{ path: string; name: string } | null> =>
      ipcRenderer.invoke(IPC.FILE_DUPLICATE, relPath),
  },

  // ── 系统通知（对应原版 notifications 命名空间）──────────────
  notifications: {
    isSupported: (): Promise<boolean> => ipcRenderer.invoke(IPC.NOTIFY_IS_SUPPORTED),
    show: (opts: {
      title: string;
      body?: string;
      sessionId?: string;
      silent?: boolean;
    }): Promise<boolean> => ipcRenderer.invoke(IPC.NOTIFY_SHOW, opts),
    /** 用户点击了带 sessionId 的通知 → 渲染层跳转到该会话 */
    onOpenSession: (cb: (sessionId: string) => void): (() => void) =>
      subscribe<{ sessionId: string }>(IPC.NOTIFY_OPEN_SESSION, (p) => cb(p.sessionId)),
  },

  // ── 本地用量统计（个人资料页）──────────────────────────────
  stats: {
    get: (): Promise<UsageStats> => ipcRenderer.invoke(IPC.STATS_GET),
  },

  // ── 算法市场 + Python 运行时 ───────────────────────────────
  algorithms: {
    list: (): Promise<AlgorithmsSnapshot> => ipcRenderer.invoke(IPC.ALG_LIST),
    install: (packageName: string): Promise<{ ok: boolean; code: number }> =>
      ipcRenderer.invoke(IPC.ALG_INSTALL, packageName),
    installPython: (): Promise<{ ok: boolean; version?: string }> =>
      ipcRenderer.invoke(IPC.ALG_INSTALL_PYTHON),
    /** 安装日志行（pip 输出 / 下载进度） */
    onInstallProgress: (cb: (line: string) => void): (() => void) =>
      subscribe<{ line: string }>(IPC.ALG_INSTALL_PROGRESS, (p) => cb(p.line)),
  },

  // ── 项目 ──────────────────────────────────────────────────
  project: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke(IPC.PROJECT_LIST),
    /** 会弹目录选择框；用户取消返回 null */
    create: (name: string): Promise<ProjectMeta | null> =>
      ipcRenderer.invoke(IPC.PROJECT_CREATE, name),
    open: (id: string): Promise<ProjectMeta | null> => ipcRenderer.invoke(IPC.PROJECT_OPEN, id),
    remove: (id: string, deleteMeta?: boolean): Promise<ProjectMeta[]> =>
      ipcRenderer.invoke(IPC.PROJECT_REMOVE, id, deleteMeta ?? false),
    /** 只改显示名，不动磁盘目录 */
    rename: (id: string, name: string): Promise<ProjectMeta | null> =>
      ipcRenderer.invoke(IPC.PROJECT_RENAME, id, name),
    current: (): Promise<ProjectMeta | null> => ipcRenderer.invoke(IPC.PROJECT_CURRENT),
    /** 启动时播种的默认项目 id；没有默认项目时为 null */
    defaultId: (): Promise<string | null> => ipcRenderer.invoke(IPC.PROJECT_DEFAULT_ID),
  },

  // ── 会话 ──────────────────────────────────────────────────
  session: {
    list: (projectId: string): Promise<SessionMeta[]> =>
      ipcRenderer.invoke(IPC.SESSION_LIST, projectId),
    create: (projectId: string, title?: string): Promise<SessionMeta> =>
      ipcRenderer.invoke(IPC.SESSION_CREATE, projectId, title ?? ''),
    /**
     * 读取会话（元信息 + 已落库的消息）。
     *
     * ⚠️ `inflight` 是**可选**的，且只在"该会话有一轮正在进行中"时才挂上这个键
     *    （见 `main/ipc/session.ts` 的 SESSION_GET）。它是 `turn_spills` 那行快照，
     *    用来复原"切走时还没跑完的那一轮"的过程块。
     *    没有进行中回合时**这个键根本不出现**（不是给空数组）——所以判断方式必须是
     *    `'inflight' in res` 或 `res.inflight !== undefined`，不能拿 `res.inflight?.length === 0`
     *    去推断"没有"（两者语义不同，后者会把"有一轮但恰好还没产出块"误判成没在跑）。
     */
    get: (
      id: string,
    ): Promise<{ meta: SessionMeta; messages: ChatMessage[]; inflight?: InflightTurn }> =>
      ipcRenderer.invoke(IPC.SESSION_GET, id),
    remove: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.SESSION_DELETE, id),
    rename: (id: string, title: string): Promise<SessionMeta | null> =>
      ipcRenderer.invoke(IPC.SESSION_RENAME, id, title),
    /** 注意：返回后要立刻挂 onStream 才开始收事件 */
    send: (id: string, prompt: string, displayText?: string): Promise<{ messageId: string }> =>
      ipcRenderer.invoke(IPC.SESSION_SEND, id, prompt, displayText),
    abort: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.SESSION_ABORT, id),
    onStream: (cb: (sessionId: string, ev: StreamEvent) => void): (() => void) =>
      subscribe<{ sessionId: string; event: StreamEvent }>(IPC.SESSION_STREAM, (p) =>
        cb(p.sessionId, p.event),
      ),
    /** Agent 调用 AskUserQuestion → 弹确认框 */
    onAskUser: (cb: (req: AskUserRequest) => void): (() => void) =>
      subscribe<AskUserRequest>(IPC.SESSION_ASK_USER, cb),
    /** 提交作答；answers=null 表示取消（模型会收到「用户未作答」） */
    answerUser: (
      sessionId: string,
      requestId: string,
      answers: Record<string, string> | null,
    ): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SESSION_ANSWER_USER, sessionId, requestId, answers),
    /** 权限模式 = 需要批准时，canUseTool 拦下工具调用 → 弹审批框 */
    onApprovalAsk: (cb: (req: ApprovalRequest) => void): (() => void) =>
      subscribe<ApprovalRequest>(IPC.SESSION_APPROVAL_ASK, cb),
    /** 提交审批决定（`cancel` 会中断本轮，所以那个按钮是「取消回合」） */
    answerApproval: (
      sessionId: string,
      requestId: string,
      decision: ApprovalDecision,
    ): Promise<boolean> =>
      ipcRenderer.invoke(IPC.SESSION_ANSWER_APPROVAL, sessionId, requestId, decision),
  },

  // ── 模型 ──────────────────────────────────────────────────
  llm: {
    listProviders: (): Promise<ProviderConfig[]> => ipcRenderer.invoke(IPC.LLM_LIST_PROVIDERS),
    upsertProvider: (p: ProviderConfig): Promise<ProviderConfig[]> =>
      ipcRenderer.invoke(IPC.LLM_UPSERT_PROVIDER, p),
    deleteProvider: (id: string): Promise<ProviderConfig[]> =>
      ipcRenderer.invoke(IPC.LLM_DELETE_PROVIDER, id),
    testProvider: (id: string): Promise<{ ok: boolean; detail: string }> =>
      ipcRenderer.invoke(IPC.LLM_TEST_PROVIDER, id),
    presets: (): Promise<PresetProvider[]> => ipcRenderer.invoke(IPC.LLM_PRESETS),
    listModels: (providerId: string): Promise<string[]> =>
      ipcRenderer.invoke(IPC.LLM_LIST_MODELS, providerId),
  },

  // ── 设置 ──────────────────────────────────────────────────
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
    set: (patch: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC.SETTINGS_SET, patch),
    onChanged: (cb: (settings: AppSettings) => void): (() => void) =>
      subscribe<AppSettings>(IPC.SETTINGS_CHANGED, cb),
  },

  // ── 桌面小模 ──────────────────────────────────────────────
  pet: {
    showMain: (): Promise<boolean> => ipcRenderer.invoke(IPC.PET_SHOW_MAIN),
    setInteractive: (interactive: boolean): void =>
      ipcRenderer.send(IPC.PET_SET_INTERACTIVE, interactive),
    dragStart: (point: { x: number; y: number }): void =>
      ipcRenderer.send(IPC.PET_DRAG_START, point),
    dragMove: (point: { x: number; y: number }): void =>
      ipcRenderer.send(IPC.PET_DRAG_MOVE, point),
    dragEnd: (): void => ipcRenderer.send(IPC.PET_DRAG_END),
  },

  // ── 技能 ──────────────────────────────────────────────────
  skill: {
    runtime: (sessionId?: string): Promise<{ sessionId: string; model: string; skills: string[]; tools: string[]; mcpServers: { name: string; status: string }[]; checkedAt: number } | null> => ipcRenderer.invoke(IPC.SKILL_RUNTIME, sessionId),
    addPlugin: (): Promise<AppSettings | null> => ipcRenderer.invoke(IPC.PLUGIN_ADD),
    list: (): Promise<SkillMeta[]> => ipcRenderer.invoke(IPC.SKILL_LIST),
    toggle: (dirName: string, enabled: boolean): Promise<SkillMeta[]> =>
      ipcRenderer.invoke(IPC.SKILL_TOGGLE, dirName, enabled),
    read: (dirName: string): Promise<string> => ipcRenderer.invoke(IPC.SKILL_READ, dirName),
    /** 会弹目录选择框；取消返回 null */
    import: (): Promise<SkillMeta[] | null> => ipcRenderer.invoke(IPC.SKILL_IMPORT),
    /** 删除用户技能（内置技能会拒绝并抛错） */
    delete: (dirName: string): Promise<SkillMeta[]> =>
      ipcRenderer.invoke(IPC.SKILL_DELETE, dirName),
  },

  // ── 终端 ──────────────────────────────────────────────────
  terminal: {
    create: (cwd: string, cols?: number, rows?: number): Promise<{ termId: string; pid: number }> =>
      ipcRenderer.invoke(IPC.TERM_CREATE, cwd, cols ?? 100, rows ?? 30),
    write: (termId: string, data: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.TERM_WRITE, termId, data),
    resize: (termId: string, cols: number, rows: number): Promise<boolean> =>
      ipcRenderer.invoke(IPC.TERM_RESIZE, termId, cols, rows),
    kill: (termId: string): Promise<boolean> => ipcRenderer.invoke(IPC.TERM_KILL, termId),
    onData: (cb: (termId: string, data: string) => void): (() => void) =>
      subscribe<{ termId: string; data: string }>(IPC.TERM_DATA, (p) => cb(p.termId, p.data)),
    onExit: (cb: (termId: string, exitCode: number) => void): (() => void) =>
      subscribe<{ termId: string; exitCode: number }>(IPC.TERM_EXIT, (p) =>
        cb(p.termId, p.exitCode),
      ),
  },

  // ── 自动化 ────────────────────────────────────────────────
  automation: {
    list: (projectId: string): Promise<unknown[]> =>
      ipcRenderer.invoke(IPC.AUTOMATION_LIST, projectId),
    upsert: (input: {
      id?: string;
      projectId: string;
      name: string;
      prompt: string;
      cron: string;
      enabled?: boolean;
    }): Promise<unknown[]> => ipcRenderer.invoke(IPC.AUTOMATION_UPSERT, input),
    remove: (id: string): Promise<unknown[]> => ipcRenderer.invoke(IPC.AUTOMATION_DELETE, id),
    toggle: (id: string, enabled: boolean): Promise<unknown[]> =>
      ipcRenderer.invoke(IPC.AUTOMATION_TOGGLE, id, enabled),
    runNow: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.AUTOMATION_RUN_NOW, id),
    runs: (automationId: string): Promise<unknown[]> =>
      ipcRenderer.invoke(IPC.AUTOMATION_RUNS, automationId),
    onChanged: (cb: (payload: unknown) => void): (() => void) =>
      subscribe(IPC.AUTOMATION_CHANGED, cb),
  },

  // ── 版本历史（git）────────────────────────────────────────
  git: {
    info: (): Promise<unknown> => ipcRenderer.invoke(IPC.GIT_INFO),
    status: (): Promise<unknown> => ipcRenderer.invoke(IPC.GIT_STATUS),
    diff: (path: string): Promise<unknown> => ipcRenderer.invoke(IPC.GIT_DIFF, path),
    versions: (): Promise<unknown> => ipcRenderer.invoke(IPC.GIT_VERSIONS),
    saveVersion: (name: string, kind?: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.GIT_SAVE_VERSION, name, kind),
    restore: (sha: string): Promise<unknown> => ipcRenderer.invoke(IPC.GIT_RESTORE, sha),
    onChanged: (cb: (payload: unknown) => void): (() => void) =>
      subscribe(IPC.GIT_CHANGED, cb),
  },

  // ── 流程图（draw.io）─────────────────────────────────────
  diagram: {
    list: (): Promise<unknown> => ipcRenderer.invoke(IPC.DIAGRAM_LIST),
  },

  // ── 内置浏览器 ────────────────────────────────────────────
  browser: {
    /** 把 webview 页面截图写入系统剪贴板 */
    capture: (webContentsId: number): Promise<unknown> =>
      ipcRenderer.invoke(IPC.BROWSER_CAPTURE, webContentsId),
    openExternal: (url: string): Promise<unknown> =>
      ipcRenderer.invoke(IPC.BROWSER_OPEN_EXTERNAL, url),
    setZoom: (webContentsId: number, factor: number): Promise<unknown> =>
      ipcRenderer.invoke(IPC.BROWSER_SET_ZOOM, webContentsId, factor),
  },

  // ── 数据集 ────────────────────────────────────────────────
  dataset: {
    /** 扫描项目里的数据文件（CSV/TSV/XLSX…） */
    list: (): Promise<unknown> => ipcRenderer.invoke(IPC.DATASET_LIST),
    /** 弹选择框并把选中文件**复制**进项目的 data/ 目录 */
    importFiles: (): Promise<unknown> => ipcRenderer.invoke(IPC.DATASET_IMPORT),
  },

  // ── 运行环境检查 ──────────────────────────────────────────
  env: {
    check: (): Promise<unknown> => ipcRenderer.invoke(IPC.ENV_CHECK),
  },

  // ── 论文模板与比赛信息 ────────────────────────────────────
  paper: {
    templates: (): Promise<PaperTemplatesResult> => ipcRenderer.invoke(IPC.PAPER_TEMPLATES),
    getConfig: (): Promise<PaperGetConfigResult> => ipcRenderer.invoke(IPC.PAPER_GET_CONFIG),
    saveConfig: (config: PaperConfigPatch): Promise<PaperSaveResult> =>
      ipcRenderer.invoke(IPC.PAPER_SAVE_CONFIG, config),
    /**
     * 受管模板库的**合并**列表（内置 + 「我的模板」）—— 扩展页「论文模板」用。
     * 输入区的比赛模板选择器读的是 `templates()`（只有内置），别混用。
     */
    library: (): Promise<PaperTemplateLibraryResult> =>
      ipcRenderer.invoke(IPC.PAPER_TEMPLATE_LIBRARY),
    /** 基于某条模板派生一条自定义模板（归入「我的模板」分组） */
    forkTemplate: (templateId: string, name: string): Promise<PaperTemplateForkResult> =>
      ipcRenderer.invoke(IPC.PAPER_TEMPLATE_FORK, { templateId, name }),
    /**
     * 删除一条自定义模板。
     * 内置模板会被主进程拒绝（`builtin_template_readonly` / 403）——
     * 别在渲染层把它当成"删掉了"。
     */
    deleteTemplate: (templateId: string): Promise<PaperTemplateDeleteResult> =>
      ipcRenderer.invoke(IPC.PAPER_TEMPLATE_DELETE, templateId),
  },

  // ── 局域网协作（**非云端**：房主本机起服务，UDP 广播发现附近房间）──
  collab: {
    /** 当前房间快照；没开房也没加入时返回 null */
    info: (): Promise<CollabRoomInfo | null> => ipcRenderer.invoke(IPC.COLLAB_INFO),
    /** 开房（需要先打开一个项目） */
    start: (name: string): Promise<CollabRoomInfo> =>
      ipcRenderer.invoke(IPC.COLLAB_START, name),
    stop: (): Promise<boolean> => ipcRenderer.invoke(IPC.COLLAB_STOP),
    /** 「换一个」加入码，旧的立即作废 */
    refreshCode: (): Promise<CollabRoomInfo | null> => ipcRenderer.invoke(IPC.COLLAB_REFRESH_CODE),
    join: (input: { address: string; code: string; name: string }): Promise<CollabJoinResult> =>
      ipcRenderer.invoke(IPC.COLLAB_JOIN, input),
    leave: (): Promise<boolean> => ipcRenderer.invoke(IPC.COLLAB_LEAVE),
    approve: (requestId: string, role: CollabRole): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_APPROVE, requestId, role),
    reject: (requestId: string): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_REJECT, requestId),
    remove: (memberId: string): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_REMOVE, memberId),
    /** 附近房间（UDP 广播；`available:false` 表示自动发现不可用） */
    discover: (): Promise<CollabDiscoverResult> => ipcRenderer.invoke(IPC.COLLAB_DISCOVER),
    submitTask: (input: { title: string; prompt: string }): Promise<boolean> =>
      ipcRenderer.invoke(IPC.COLLAB_TASK_SUBMIT, input),
    decideTask: (taskId: string, approve: boolean): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_TASK_DECIDE, taskId, approve),
    setTaskStatus: (taskId: string, status: CollabTaskStatus): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_TASK_STATUS, taskId, status),
    setAutoApproveTasks: (value: boolean): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_SET_AUTO_APPROVE, value),
    /** 房主把项目内的文件加入共享（队员看不到这个入口） */
    shareFile: (path: string): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_SHARE_FILE, path),
    /** 房主把文件移出共享（磁盘上的文件不动） */
    unshareFile: (path: string): Promise<CollabRoomInfo | null> =>
      ipcRenderer.invoke(IPC.COLLAB_UNSHARE_FILE, path),
    /** 读共享文件（队员的读也走房主，房主那边才有最新版本） */
    fileRead: (path: string): Promise<CollabFileResult> =>
      ipcRenderer.invoke(IPC.COLLAB_FILE_READ, path),
    /**
     * 写共享文件：`baseVersion` 是「我改之前看到的版本号」。
     * 与房主当前版本不一致时返回 `error:'fileConflict'` + 磁盘上的最新内容。
     */
    fileWrite: (input: { path: string; content: string; baseVersion: number }): Promise<CollabFileResult> =>
      ipcRenderer.invoke(IPC.COLLAB_FILE_WRITE, input),
    /** 冲突处置之「另存」：把内容写成副本文件，副本自动进共享清单 */
    fileSaveCopy: (input: { path: string; content: string }): Promise<CollabFileResult> =>
      ipcRenderer.invoke(IPC.COLLAB_FILE_SAVE_COPY, input),
    /** 房间事件：成员变化 / 待批准 / 被拒 / 房间关闭 / 共享文件变更 */
    onEvent: (cb: (event: CollabEvent) => void): (() => void) =>
      subscribe<CollabEvent>(IPC.COLLAB_EVENT, cb),
  },

  // ── 网络代理与机器人（设置 → 网络 / 机器人）────────────────
  network: {
    getProxy: (): Promise<ProxySettings> => ipcRenderer.invoke(IPC.NETWORK_GET_PROXY),
    /** 保存后主进程会同步给 Agent 子进程环境（真正生效的地方） */
    setProxy: (cfg: ProxySettings): Promise<ProxySettings> =>
      ipcRenderer.invoke(IPC.NETWORK_SET_PROXY, cfg),
    /** 「重新检测」：系统模式会问 Electron resolveProxy，返回当前生效地址 */
    detectProxy: (): Promise<ProxyDetection> => ipcRenderer.invoke(IPC.NETWORK_DETECT_PROXY),
    /** 机器人密钥状态（只回「配没配 / 加没加密」，不回密钥本体） */
    botSecretStatus: (): Promise<{ feishu: BotSecretStatus }> =>
      ipcRenderer.invoke(IPC.NETWORK_BOT_SECRET_STATUS),
    setBotSecret: (
      kind: 'feishuAppSecret',
      secret: string,
    ): Promise<{ feishu: BotSecretStatus }> =>
      ipcRenderer.invoke(IPC.NETWORK_SET_BOT_SECRET, kind, secret),
    clearBotSecret: (kind: 'feishuAppSecret'): Promise<{ feishu: BotSecretStatus }> =>
      ipcRenderer.invoke(IPC.NETWORK_CLEAR_BOT_SECRET, kind),
  },

  // ── 通用：直接打本地 HTTP 服务（重业务 API 走这里）───────
  http: {
    /**
     * 带 token 请求本地服务。
     * 渲染层不必自己拼 token —— 那会让 token 出现在业务代码里。
     */
    request: async (
      path: string,
      init?: { method?: string; body?: unknown },
    ): Promise<unknown> => {
      if (!serverInfo) throw new Error('本地服务未启动');
      const res = await fetch(`${serverInfo.baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          'x-mathmodel-token': serverInfo.token,
        },
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      }
      return res.json();
    },
  },
};

export type MathModelApi = typeof api;

contextBridge.exposeInMainWorld('mathmodel', api);
