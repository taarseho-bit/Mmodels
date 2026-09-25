/** 设置页（SettingsPage）新增界面的英文覆盖 —— 无原版键的文案 */
export const settingsOv: Record<string, string> = {
  '设置': 'Settings',
  '正在加载设置…': 'Loading settings…',
  '没有匹配的设置项': 'No matching settings',
  '显示名': 'Display name',
  '永久 VIP · 本地版': 'Lifetime VIP · Local edition',
  '数据不出本机': 'Data never leaves this machine',
  '{{n}} 天': '{{n}} days',
  '暂无数据 —— 开始第一次对话后这里会长出一片草原。':
    'No data yet — a meadow will grow here after your first conversation.',
  '{{day}} · {{tokens}} tokens · {{count}} 条': '{{day}} · {{tokens}} tokens · {{count}} msgs',
  '少': 'Less',
  '多': 'More',
  '推理强度 · {{label}}': 'Reasoning effort · {{label}}',
  '{{hour}}:00 前后': 'around {{hour}}:00',
  '已安装的 Skills': 'Installed Skills',
  '当前模型尚未产出数据。': 'No data for the current model yet.',
  '{{tokens}} · {{count}} 个会话': '{{tokens}} · {{count}} sessions',
  '默认论文模板': 'Default paper template',
  '新会话的「写论文」模式默认使用这套 LaTeX 文件；也可以在输入区的模板选择器里随时切换。':
    'New sessions in "Write paper" mode use this LaTeX bundle by default; you can switch anytime from the template picker in the composer.',
  '暂无模板 —— 请确认应用内置技能目录完整。':
    'No templates yet — please make sure the built-in skills directory is intact.',
  '写封面/声明页用的固定信息。比赛字段里选择「使用队伍档案」时自动带入；只保存在本机。':
    'Fixed info used for cover/declaration pages. Auto-filled when "Use team profile" is selected in competition fields; stored locally only.',
  '学校 / 单位': 'School / Institution',
  '例：某某大学': 'e.g. Some University',
  '队伍名称': 'Team name',
  '例：建模小分队': 'e.g. Modeling Squad',
  '队员名单（每行一位）': 'Member list (one per line)',
  '张三\n李四\n王五': 'Zhang San\nLi Si\nWang Wu',
  '默认任务模式': 'Default task mode',
  '新会话输入区默认选中的模式（与原版一致：默认「写论文」）。':
    'Mode preselected in the composer for new sessions (same as the original: "Write paper" by default).',
  'Agent 权限': 'Agent permissions',
  '对应输入区右下角的权限选择器。': 'Mirrors the permission picker at the bottom-right of the composer.',
  '完全访问（不逐次询问）': 'Full access (no per-action prompts)',
  '关闭后每次敏感操作前都会请求批准。': 'When off, approval is requested before each sensitive operation.',
  '默认模型': 'Default model',
  '模型名': 'Model name',
  '留空则用当前供应商的第一个模型': 'Leave empty to use the first model of the active provider',
  '推理强度（effort）': 'Reasoning effort',
  '默认（不指定）': 'Default (unspecified)',
  '低 — 快，适合简单任务': 'Low — fast, good for simple tasks',
  '高 — 适合复杂建模推理': 'High — good for complex modeling reasoning',
  '关闭模型思考': 'Disable model thinking',
  '⚠️ 强烈建议对 DeepSeek V4、以及任何「默认开思考」的推理模型开启此项，否则正文为空。':
    '⚠️ Strongly recommended for DeepSeek V4 and any reasoning model with thinking on by default, otherwise replies may be empty.',
  '启用内置 MCP 工具': 'Enable built-in MCP tools',
  '给 agent 提供内置浏览器等工具。关闭后 agent 只能用文件与终端能力。':
    'Gives the agent built-in tools such as the browser. When off, the agent can only use file and terminal capabilities.',
  '供应商名称不能为空。': 'Provider name cannot be empty.',
  '接口地址不能为空。': 'Base URL cannot be empty.',
  '密钥不能为空（本地 Ollama 等无需密钥的服务除外）。':
    'API key cannot be empty (except keyless local services like Ollama).',
  '删除供应商「{{name}}」？': 'Delete provider "{{name}}"?',
  '← 返回': '← Back',
  '配置供应商': 'Configure provider',
  '（新增）': ' (new)',
  '比如：MiniMax 生产密钥': 'e.g. MiniMax production key',
  '协议形态': 'API protocol',
  'Anthropic 协议（原生）': 'Anthropic protocol (native)',
  'OpenAI 协议（经转换桥）': 'OpenAI protocol (via bridge)',
  '将经过内置协议转换桥，把 Anthropic Messages 请求转成 OpenAI Chat Completions。':
    'Requests go through the built-in protocol bridge, translating Anthropic Messages into OpenAI Chat Completions.',
  '直接对接原生 Anthropic 接口，无需转换。': 'Connects directly to the native Anthropic API, no translation needed.',
  '接口基址': 'Base URL',
  '注意各家的路径不同：智谱是': 'Note the paths differ per vendor: Zhipu uses',
  '，通义是': ', Tongyi uses',
  '，不要一律补': ", don't blindly append",
  '。': '.',
  'API 密钥': 'API key',
  '本地服务，随便填': 'Local service, any value works',
  '密钥保存在本机用户数据目录，不会写进项目、也不会随项目分享出去。':
    'Keys are stored in the local user data directory and are never written into projects or shared with them.',
  '认证头方式': 'Auth header style',
  'x-api-key（Anthropic 官方 / 多数兼容端点）': 'x-api-key (official Anthropic / most compatible endpoints)',
  'Authorization: Bearer（部分中转服务）': 'Authorization: Bearer (some relay services)',
  '模型列表': 'Model list',
  '模型名，如 deepseek-chat': 'Model name, e.g. deepseek-chat',
  '＋ 添加模型': '＋ Add model',
  '列表里的第一个会成为该供应商的默认模型。': 'The first entry becomes the default model of this provider.',
  '接口基址（Base URL）': 'Base URL',
  '断开与「{{name}}」的连接？': 'Disconnect from "{{name}}"?',
  '本机 Codex CLI 不签发 API Key：接口地址请填本机 CLI 暴露的端点（http://127.0.0.1:<端口>/v1），密钥留空即可。':
    'The local Codex CLI issues no API key: enter the endpoint exposed by the local CLI (http://127.0.0.1:<port>/v1) and leave the key empty.',
  '对话中正在使用：{{name}}': 'In use in chats: {{name}}',
  '模型名（自由填写）': 'Model name (free text)',
  '本地附加项': 'Local additions',
  '本机附加的推理与工具开关，不影响上面的供应商与模型选择。':
    'Local reasoning and tool switches; they do not affect the provider and model selection above.',
  '该供应商还没有模型': 'This provider has no models yet',
  '当前：{{name}}': 'Current: {{name}}',
  '未选择': 'None selected',
  '还没有配置任何供应商。': 'No provider configured yet.',
  '从下面的预设里挑一个开始 —— 填上密钥就能用。': 'Pick one of the presets below to start — just fill in the key.',
  '当前使用': 'In use',
  '已填密钥': 'Key set',
  '缺密钥': 'Key missing',
  '模型：{{models}}': 'Models: {{models}}',
  '设为当前': 'Set active',
  '测试中…': 'Testing…',
  '测试连通性': 'Test connection',
  '快速添加（内置预设）': 'Quick add (built-in presets)',
  '＋ 自定义供应商': '＋ Custom provider',
  '检测中…': 'Checking…',
  // 原 `'⟳ 重新检测'` 已删除：EnvSection 的按钮文案已改回原版「重新检查」，
  // 且全仓 grep 无 `t('⟳ 重新检测')` 调用点 —— 留着就是孤儿键（i18n 护栏只管 tx()，
  // 查不到这类孤儿，靠人工清理）。
  '{{count}} 项待处理': '{{count}} to fix',
  '环境就绪': 'Environment ready',
  '必需': 'Required',
  '推荐': 'Recommended',
  '没有拿到检测结果。': 'No check results received.',
  '本地模式': 'Local mode',
  '本项目是本地运行的桌面应用：没有云端账号、没有遥测、没有更新服务器。':
    'This project is a locally-running desktop app: no cloud account, no telemetry, no update server.',
  '会话、统计、模板配置、队伍档案全部保存在本机用户数据目录。':
    'Sessions, stats, template config and team profiles are all stored in the local user data directory.',
  '唯一的外联是你配置的模型供应商接口':
    'The only outbound connection is the model provider endpoint you configured',
  '（当前：{{url}}）': ' (current: {{url}})',
  '（尚未配置供应商）': ' (no provider configured yet)',
  '登录、云端分享、自动更新等在线服务按需求未实现。':
    'Online services such as login, cloud sharing and auto-update are not implemented by design.',
  '附加系统提示词': 'Additional system prompt',
  '追加在 Agent 系统层末尾的自定义指令（原版同位置功能）。每个新会话生效，只保存在本机。':
    'Custom instructions appended to the end of the agent system layer (same feature as the original). Takes effect for each new session; stored locally only.',
  '例：所有图表统一使用科技期刊配色；代码注释用中文…':
    'e.g. All figures use sci-journal color schemes; code comments in Chinese…',
  '已保存 ✓ 下一个会话生效': 'Saved ✓ takes effect next session',
  '主题与语言': 'Theme & language',
  '外观主题与界面语言（原版：zh-CN 默认，可切 English）':
    'Appearance theme and UI language (original: zh-CN default, English available)',
  '换行': 'Newline',
  '打开设置': 'Open settings',
  '关闭弹层': 'Close popover',
  '按下组合键…': 'Press a key combination…',
  '自定义': 'Custom',
  '恢复默认': 'Restore default',
  '点击「自定义」后按下新的组合键；带 * 的是已覆盖默认值。':
    'Click "Custom" then press the new combination; entries with * override the default.',
  '系统通知': 'System notifications',
  '自动化任务在后台完成且窗口失焦时弹系统通知；点击通知可跳转到对应会话。':
    'Shows a system notification when an automation finishes in the background while the window is unfocused; click it to jump to the session.',
  '当前系统不支持原生通知（Windows 通知服务被关闭或环境不支持）。':
    'Native notifications are not supported on this system (Windows notification service disabled or unsupported).',
  '允许系统通知': 'Allow system notifications',
  '关闭后自动化完成不再弹系统级通知（界面内提示不受影响）。':
    'When off, finished automations no longer raise system-level notifications (in-app hints are unaffected).',
  'MModels 测试通知': 'MModels test notification',
  '通知工作正常': 'Notifications work fine',
  '已发出': 'Sent',
  '发送失败': 'Failed to send',
  '发送测试通知': 'Send test notification',
  '自动化机器人': 'Automation bots',
  '按 cron 定时跑任务的机器人（对应原版「机器人」）。完成时会发系统通知。':
    'Bots that run tasks on a cron schedule (mirrors "Bots" in the original). Sends a system notification on completion.',
  '读取中…': 'Loading…',
  '已创建 {{count}} 个自动化任务': '{{count}} automations created',
  '每个任务一个专属会话，可在自动化页查看运行历史与输出。':
    'Each task gets a dedicated session; view run history and output on the automations page.',
  '管理自动化': 'Manage automations',
  '界面巡览': 'UI tour',
  ' · 界面巡览': ' · UI tour',
  '用聚光灯带你认一遍主要功能位置，随时可按 Esc 退出。':
    'A spotlight walk-through of the main features; press Esc anytime to exit.',
  '建议在空会话页启动，效果最直观。': 'Best started from an empty session page.',
  '重新观看引导': 'Replay tour',
  '读取版本信息…': 'Reading version info…',
  '应用版本': 'App version',
  '平台': 'Platform',
  '（打包版）': ' (packaged)',
  '（开发版）': ' (dev)',
  '本地服务': 'Local server',
  '未启动': 'not running',
  '已鉴权': 'authenticated',
  '无 token': 'no token',
  'MModels · 本地数学建模智能体桌面版。': 'MModels · local math-modeling agent, desktop edition.',
  '无账号、无遥测、无云端依赖；登录 / 云分享 / 自动更新按需求未实现。':
    'No account, no telemetry, no cloud dependency; login / cloud sharing / auto-update are not implemented by design.',

  // ── 个人资料（对齐原版 s00-profile 后新增/替换）──
  '{{m}} 月': '{{m}}',
  '正在加载…': 'Loading…',

  // ── 论文与比赛（队伍档案列表管理）──
  '未命名档案': 'Untitled profile',

  // ── 关于（版本更新 / 外部链接 / 测试版 / 诊断骨架）──
  '自动更新按既定决策未提供，当前为本地版。':
    'Auto-update is not provided by design; this is the local edition.',
  '检查更新': 'Check for updates',
  '参加测试版': 'Join beta channel',
  '加入后优先收到测试版本；本地版不提供自动更新通道。':
    'Get test builds first; the local edition has no auto-update channel.',
  '暂不可用': 'Unavailable',

  // ── 网络（代理）─────────────────────────────────────────────
  '代理地址': 'Proxy address',
  '例：http://127.0.0.1:7890': 'e.g. http://127.0.0.1:7890',
  '已重新检测': 'Re-detected',

  // ── 机器人（飞书 / 微信）────────────────────────────────────
  // 飞书侧文案走原版键 integrations.feishuSection.*；
  // 微信侧原版键（integrations.weChatSection.*）尚未进 zh.ts/en.ts，先用中文即键。
  '微信机器人': 'WeChat bot',
  '扫码登录微信': 'Log in with WeChat QR code',
  '本地版不支持扫码授权': 'QR-code authorization is not available in the local edition',
  '请使用手机微信扫描二维码授权。个人账号自动化需注意官方对账号类型和消息频率的限制。':
    'Scan the QR code with WeChat on your phone to authorize. Automating a personal account is subject to official limits on account type and message frequency.',
  '本地版不连接外部服务，凭据仅保存在本机，不会发起长连接或事件回调。':
    'The local edition does not connect to external services; credentials stay on this machine and no long connection or event callback is made.',
  '本地版不连接外部服务，无法测试连接。':
    'The local edition does not connect to external services, so the connection cannot be tested.',
  '启用机器人': 'Enable bot',
  '接收微信私聊和群聊消息，并由 Agent 回复':
    'Receive WeChat direct and group messages and reply via the agent',
  '连接状态': 'Connection status',
  '未连接': 'Not connected',
  '未配置': 'Not configured',
  '已保存 ✓': 'Saved ✓',

  // ── 新手教程（7 卡网格）─────────────────────────────────────
  '新手教程': 'Tutorials',
  '本地版不提供云端分享，教程暂不可用':
    'Cloud sharing is not available in the local edition; this tutorial is unavailable',

  // ── 外观 / 键盘快捷键（s08 / s09）─────────────────────────────
  // 原版条目的文案一律走 zh.ts 里的原版键（tx），这里只登记新增文案。
  '打开所在目录': 'Show in folder',

  // ── 运行环境「一键安装」确认框（新增界面，原版无对应键）────────
  // 标题 / 正文 / 按钮分别是原版键 configureTitle / issuesDetectedDescription / common.cancel，
  // 这里只登记确认框自己新造的文案。
  '将交给 Agent 安装以下缺失项：': 'The agent will install the following missing items:',
  'Agent 会在本机执行安装：Python 包走清华镜像；uv / Git / LaTeX 等按当前平台给出最小安装方案。需要你决定时（例如输入密码）它会先问你。':
    'The agent installs on this machine: Python packages via the Tsinghua mirror; for uv / Git / LaTeX and similar it picks a minimal install path for your platform. If a decision is needed (e.g. entering a password) it asks you first.',
  '本次检测没有发现缺失项。仍可让 Agent 复核一遍整机环境，确认建模工作流所需配置齐全。':
    'No missing items were detected. You can still have the agent re-check the whole environment to confirm everything the modeling workflow needs is in place.',
  '开始安装': 'Start installation',
  '让 Agent 复核': 'Have the agent re-check',
  '启动安装失败：{{msg}}': 'Failed to start the installation: {{msg}}',

  // ── 运行环境（对齐原版 s05-env 5 行结构后新增）────────────────
  // Python 行在「解释器可用但建模包不全」时补的一行（原版无此行）。
  '建模包不完整，缺少 {{count}} 个：{{names}}':
    'Modeling packages incomplete, {{count}} missing: {{names}}',
  '复制失败，请手动安装 draw.io 桌面版。':
    'Copy failed — please install draw.io Desktop manually.',

  // ── 论文与比赛 ·「自定义模板」区（新增界面，原版无对应键）──────
  // 原版把模板来源存在项目配置里（template.source='custom' + sourcePath），
  // 但从没给过「选一个本地目录当模板源」的入口；这段是补的。
  '自定义模板': 'Custom template',
  '把任意本地目录作为论文模板源。Agent 写论文时会按 write-paper 的规则把该目录整体复制到项目里，从入口文件开始写。不选则使用内置比赛模板。':
    'Use any local folder as the paper template source. When writing a paper the agent copies that folder into the project per the write-paper rules and starts from its entry file. Leave unset to use a built-in contest template.',
  '自定义模板源': 'Custom template source',
  '内置比赛模板': 'Built-in contest template',
  '（未设置）': '(not set)',
  '选择模板目录…': 'Choose template folder…',
  '恢复内置模板': 'Restore built-in template',
  '已把该目录设为当前项目的论文模板源': 'That folder is now the paper template source for this project',
  '已恢复为内置模板': 'Restored to the built-in template',
  '没有可用的内置模板': 'No built-in templates available',
  '请先打开一个项目': 'Open a project first',

  // ── 论文与比赛 ·「比赛信息」弹层的自定义字段（新增界面）────────
  '字段名称': 'Field name',
  '例如：组别': 'e.g. Track',
  '字段值': 'Value',
  '删除这个字段': 'Remove this field',
  '添加字段': 'Add field',
};
