/** 应用外壳 / 对话 / 自动化 / 欢迎页等新增界面的英文覆盖 —— 无应用约定键的文案 */
export const coreOv: Record<string, string> = {
  // ── App.tsx ──
  '正在启动 MModels…': 'Starting MModels…',
  '启动失败': 'Startup failed',

  // ── WelcomePage.tsx ──
  '建模任务 {{date}}': 'Modeling task {{date}}',
  '请输入项目名称。': 'Please enter a project name.',
  '已取消创建。': 'Creation cancelled.',
  '面向数学建模竞赛的桌面工作台 · 选题 → 建模 → 求解 → 论文':
    'Desktop workbench for math modeling contests · pick a problem → model → solve → write',
  '新建一个建模项目': 'Create a modeling project',
  '会创建标准工作目录，并写入': 'A standard workspace will be created with',
  '约定文件，之后代码、数据、图表、论文都会规整地放在里面。':
    'convention files — code, data, figures and the paper will all live in there.',
  '＋ 新建项目': '＋ New project',
  '例如：2026 国赛 A 题': 'e.g. CUMCM 2026 Problem A',
  '下一步请选择项目所在文件夹，代码、数据、图表和论文都会保存在该目录中。':
    'Next, pick the project folder — code, data, figures and the paper will be saved there.',
  '选择文件夹并创建': 'Choose folder & create',
  '最近的项目': 'Recent projects',
  '从列表移除（不删除磁盘文件）': 'Remove from list (files on disk are kept)',
  '从列表移除「{{name}}」？\n\n⚠️ 只移出列表，磁盘上的文件不会被删除。':
    'Remove "{{name}}" from the list?\n\n⚠️ It is only removed from the list — files on disk are not deleted.',
  '多智能体编排': 'Multi-agent orchestration',
  '选题分析 / 建模 / 编码 / 论文四个角色分工，不是一个大 prompt 硬扛':
    'Four roles — analysis / modeling / coding / writing — split the work instead of one giant prompt',
  '可插拔技能': 'Pluggable skills',
  '论文模板、数据分析、绘图、LaTeX 编译等能力按需挂载':
    'Paper templates, data analysis, plotting, LaTeX builds — attach on demand',
  '真实终端': 'Real terminal',
  'agent 跑 python / latex 的每一步你都看得见，随时能接手':
    'Watch every python / latex step the agent runs and take over anytime',
  '产物透明': 'Transparent artifacts',
  '所有中间结果都落在项目目录，不藏在数据库里':
    'All intermediate results land in the project folder, not hidden in a database',

  // ── OnboardingWizard.tsx ──
  '粘贴服务商提供的 API Key': 'Paste the API key from your provider',
  '接口地址：': 'Base URL:',
  '默认模型': 'default model',
  '必需': 'required',
  '建议': 'recommended',
  '看一遍界面引导': 'Take the interface tour',

  // ── TerminalPanel.tsx ──
  '先打开一个项目，终端才有工作目录。': 'Open a project first — the terminal needs a working directory.',
  '结束': 'Kill',
  '已退出（{{code}}）': 'Exited ({{code}})',
  '终端未启动': 'Terminal not started',
  '启动': 'Start',
  '点「启动」开一个 PowerShell。': 'Click "Start" to open a PowerShell.',
  '可以用它跑 python、装依赖、编译 LaTeX。': 'Use it to run python, install deps, build LaTeX.',
  '输入命令，回车执行（Ctrl+C 中断）': 'Type a command, Enter to run (Ctrl+C to interrupt)',

  // ── AutomationPage.tsx ──
  '⚠️ 需要 5 段（分 时 日 月 周）': '⚠️ Needs 5 fields (min hour day month weekday)',
  '自定义表达式': 'Custom expression',
  '（已过期）': '(expired)',
  '{{n}} 分钟后': 'in {{n}} min',
  '{{n}} 小时后': 'in {{n}} h',
  '{{n}} 天后': 'in {{n}} d',
  '任务名称不能为空。': 'Task name cannot be empty.',
  '提示词不能为空 —— agent 需要知道该做什么。': 'Prompt cannot be empty — the agent needs to know what to do.',
  'cron 表达式需要 5 段（分 时 日 月 周），当前 {{n}} 段。':
    'A cron expression needs 5 fields (min hour day month weekday); got {{n}}.',
  '删除自动化任务「{{name}}」？\n\n历史运行记录也会一并移除。':
    'Delete automation "{{name}}"?\n\nIts run history will be removed as well.',
  '请先打开一个项目，自动化任务绑定在项目上。': 'Open a project first — automations are bound to projects.',
  '← 返回': '← Back',
  '编辑任务': 'Edit task',
  '新建定时任务': 'New scheduled task',
  '任务名称': 'Task name',
  '比如：每日数据复盘': 'e.g. Daily data review',
  '给 agent 的指令': 'Instructions for the agent',
  '比如：读取 data/ 下最新数据，重新拟合预测模型，把图表写入 figures/，并在 report.md 里追加一段结论。':
    'e.g. Read the latest data in data/, refit the forecast model, write figures to figures/, and append a conclusion to report.md.',
  '每次触发都会**新建一个会话**来跑这段指令，所以上下文是干净的 ——':
    'Each run **starts a fresh session** for this prompt, so the context is clean —',
  '需要的历史信息请在指令里写明路径，或写进': 'state required paths in the prompt or put them in',
  '触发时间（cron，5 段：分 时 日 月 周）': 'Schedule (cron, 5 fields: min hour day month weekday)',
  '每天早上 8 点': 'Every day at 8:00',
  '工作日开工前把结果准备好': 'Have results ready before the workday starts',
  '每 6 小时': 'Every 6 hours',
  '一天四次，跟进数据变化': 'Four times a day to track data changes',
  '每小时': 'Every hour',
  '适合监控型任务': 'Good for monitoring tasks',
  '每周一 9 点': 'Mondays at 9:00',
  '周报场景': 'For weekly reports',
  '每 30 分钟': 'Every 30 minutes',
  '高频，注意 token 消耗': 'High frequency — mind token usage',
  '当前含义：': 'Current meaning:',
  '例：': 'e.g.',
  '表示周一至周五 8:00': 'means Mon–Fri at 8:00',
  '保存后立即启用': 'Enable immediately after saving',
  '保存中…': 'Saving…',
  '读取中…': 'Loading…',
  '下次 ': 'Next ',
  '立即执行一次，不影响后续排期': 'Run once now without affecting the schedule',
  '立即运行': 'Run now',
  '收起历史': 'Hide history',
  '运行历史': 'Run history',
  '上次运行：': 'Last run: ',
  '下次运行：': 'Next run: ',
  '还没有运行记录。': 'No runs yet.',

  // ── CompetitionsPage.tsx（应用约定无对应键的少量界面文案） ──
  '展开': 'Expand',
  '收起': 'Collapse',
  '{{year}}年{{month}}月': '{{month}}/{{year}}',

  // ── PapersPage.tsx（广场筛选维度里的竞赛名） ──
  '全国大学生数学建模竞赛': 'National College Student Mathematical Modeling Contest',
  '研究生数学建模竞赛': 'Postgraduate Mathematical Modeling Contest',

  // ── ErrorBoundary.tsx ──
  '错误：': 'Error: ',
  '调用栈：': 'Stack:',
  '组件栈：': 'Component stack:',
  '界面出现异常': 'Something went wrong',
  '这不是致命错误，应用其他部分仍然可用。你可以尝试重试；如果反复出现，请把下面的信息复制出来反馈。':
    'This is not fatal — the rest of the app still works. Try again; if it keeps happening, copy the details below for feedback.',
  '复制错误信息': 'Copy error details',
  '重新加载界面': 'Reload UI',
  '错误信息': 'Error message',
  '调用栈': 'Stack',
  '组件栈': 'Component stack',

  // ── Composer.tsx ──
  '有 {{n}} 个文件无法取得磁盘路径（可能来自网页拖拽），已跳过。请用 ＋ 按钮从本机选择。':
    '{{n}} file(s) could not be resolved to a disk path (likely dragged from a web page) and were skipped. Use the ＋ button to pick local files.',
  '松手即可添加为附件': 'Drop to attach',
  '未配置模型': 'No model configured',
  '尚未配置供应商，请前往设置': 'No provider configured — go to Settings',
  '推理强度': 'Reasoning effort',
  'Agent 正在运行…': 'Agent is running…',
  // ── ChatPage.tsx ──
  '工具': 'tool',
  '执行中…': 'Running…',
  '参数': 'Input',
  '返回': 'Output',
  '…（已截断）': '… (truncated)',
  '思考过程': 'Thinking',
  '{{n}} 字': '{{n}} chars',
  '请先打开一个项目。': 'Open a project first.',
  '{{n}} 条消息': '{{n}} messages',
  '尚未创建会话': 'No session yet',
  '读取会话失败：': 'Failed to load session: ',
  '载入历史消息…': 'Loading history…',
  '出错了：': 'Error: ',
  '发送失败：{{msg}}': 'Send failed: {{msg}}',
  '2023 华数杯 C 题': '2023 Huashu Cup Problem C',
  '母亲身心健康对婴儿成长的影响': 'The impact of maternal health on infant growth',
  '统计': 'Statistics',
  '回归分析': 'Regression',
  '分类预测': 'Classification',
  '2024 高教杯 C 题': '2024 CUMCM-Societies Problem C',
  '农作物的种植策略': 'Crop planting strategy',
  '优化': 'Optimization',
  '规划': 'Planning',
  '种植策略': 'Planting strategy',
  '2023 国赛 A 题': '2023 CUMCM Problem A',
  '定日镜场的优化设计': 'Optimized design of a heliostat field',
  '物理建模': 'Physical modeling',
  '几何计算': 'Geometry',

  // ── Markdown.tsx ──
  'Markdown 渲染失败': 'Markdown render failed',
  'Mermaid 渲染失败': 'Mermaid render failed',

  // ── ArtifactPanes.tsx ──
  '产物面板': 'Artifacts',
  '在左侧文件树里点一个产物即可查看；文本产物可以直接编辑并保存。':
    'Click an artifact in the file tree to view it; text artifacts can be edited and saved in place.',
  '产物不存在': 'Artifact not found',
  '文件过大': 'File too large',
  '无法内联预览': 'Cannot preview inline',

  // ── FilesPanel.tsx ──
  '项目目录还是空的。': 'The project folder is empty.',
  '和 agent 聊一次，产物就会出现。': 'Chat with the agent once and artifacts will show up here.',

  // ── DataFilePreview.tsx ──
  '列 {{n}}': 'Column {{n}}',

  // ── PdfFilePreview.tsx ──
  '在浏览器标签页打开': 'Open in a browser tab',
  '用系统程序打开': 'Open with system app',

  // ── DiagramsPanel.tsx ──
  '（根目录）': '(root)',

  // ── VersionHistoryPanel.tsx ──
  '未检测到 Git。项目版本需要 Git 才能使用。': 'Git not detected — project versions require Git.',

  // ── TopBar.tsx ──
  '（当前版本暂未实现）': ' (not implemented in this build)',
  '界面引导': 'Interface tour',
  '切换到浅色': 'Switch to light',
  '切换到深色': 'Switch to dark',

  // ── SidePanel.tsx ──
  '产物': 'Artifacts',

  // ── TaskProgress.tsx（任务进度面板，用户点名新增）──
  // 面板本身的文案用应用约定已有的 composer.composerTaskListCard.*（见 zh.ts/en.ts），
  // 这里只登记当前没有的两条。
  '全部任务已完成': 'All tasks completed',
  '未命名任务': 'Untitled task',

  // ── Sidebar.tsx 右键上下文菜单（当前没有，用户点名新增）──
  '打开文件夹目录': 'Open folder',
  '打开会话所在文件夹': 'Open chat folder',
  '复制会话标题': 'Copy chat title',
  '复制会话 ID': 'Copy chat ID',
  '删除会话': 'Delete chat',

  // ── StatusBar.tsx ──
  '未打开项目': 'No project open',
  '检测服务…': 'Checking service…',
  '本地服务 :{{port}}': 'Local service :{{port}}',
  '服务未响应': 'Service not responding',
  '已关闭思考（DeepSeek V4 等默认开思考的模型建议开启此项）':
    'Thinking disabled (recommended for models like DeepSeek V4 that default to thinking)',
  '思考已关': 'Thinking off',
  '{{n}} 个任务运行中': '{{n}} task(s) running',
  '已启用技能数': 'Enabled skills',
  '技能 {{enabled}}/{{total}}': 'Skills {{enabled}}/{{total}}',
};
