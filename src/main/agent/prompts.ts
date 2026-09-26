/**
 * 提示词与工作区指令 —— 数学建模任务的统一入口。
 *
 * 任务模式、模板说明、项目规则和模型选择提示集中维护，主进程、工作流
 * 与输入框因此共享同一套可读规则。修改时请保持模式边界清楚，并补充测试。
 */
import type { PaperTemplateRef } from '@shared/types';

// ─────────────────────────────────────────────────────────────
// 一、任务模板
// ─────────────────────────────────────────────────────────────

/** 任务类型 —— 决定注入哪条起始指令 */
export type TaskKind = 'chat' | 'paper' | 'figure' | 'review' | 'data' | 'sprint';

/**
 * 输入框为空时按任务类型自动填入的起始提示词。
 * `chat` 为空串（不预填）。
 */
export const TASK_TEMPLATES: Record<TaskKind, string> = {
  chat: '',
  paper: '/write-paper 完成一篇内容完整和图表丰富多彩，结果正确的、格式正确的、可直接提交的数学建模论文',
  figure:
    '/draw-figures 根据下面的需求绘制投稿级图表，图片保存到当前项目的 figures/ 目录；项目里有 document.tex 时同时给出可直接粘贴的插图 LaTeX 片段',
  review:
    '/review-paper 按数学建模竞赛评审标准审读论文，输出评分与逐条修改建议（review.md），未经确认不要直接改动论文正文',
  data:
    '/data-search 查找并核验下面描述的公开数据，下载到当前项目的 data/ 目录并记录来源与许可',
  sprint:
    '/competition-sprint 按 72 小时竞赛节奏，从审题、数据、建模、图表到论文成稿全流程冲刺：先给出分段排程与每阶段验收标准，再逐段推进，最终交付可直接提交的论文与附件清单',
};

// ─────────────────────────────────────────────────────────────
// 二、模板来源说明
// ─────────────────────────────────────────────────────────────

/**
 * ⚠️ 类型定义搬到了 `@shared/types`（单一真相源）—— 项目契约里这个结构同时是
 *    **项目配置文件的字段**（`template: {id,name,entryFile,source,sourcePath}`），
 *    主进程写盘、提示词组装、渲染层弹层三处都要引同一份，放在 main 里会让
 *    渲染层无法复用。这里只做一次 re-export，保持既有 import 路径不变。
 */
export type { PaperTemplateRef };

/** 把论文模板来源写成给模型看的一段说明。 */
export function describeTemplateSource(t: PaperTemplateRef): string {
  if (t.source === 'custom' && t.sourcePath) {
    return [
      '使用下面的自定义模板源目录：',
      t.sourcePath,
      '由你按 write-paper 的规则将它完整复制到当前论文项目；',
    ].join('\n');
  }
  return `使用本 Skill 的 \`assets/template/${t.id}/\` 比赛模板。`;
}

// ─────────────────────────────────────────────────────────────
// 三、斜杠命令探测
// ─────────────────────────────────────────────────────────────

/** 匹配文本里的 `/xxx` 斜杠命令。 */
export const SLASH_COMMAND_RE = /(?:^|\s)\/([A-Za-z][\w-]*)(?=\s|$)/;

/** 取出文本中的斜杠命令名，无则 null。 */
export function detectSlashCommand(text: string): string | null {
  return SLASH_COMMAND_RE.exec(text)?.[1] ?? null;
}

// ─────────────────────────────────────────────────────────────
// 四、提示词组装
// ─────────────────────────────────────────────────────────────

/**
 * 组装规则：
 *   t = 任务类型，e = 用户输入文本，n = { paperTemplate }
 *
 * 规则（逐条照搬）：
 *   - chat 直接返回用户原文，不做任何包装
 *   - 非 chat：先探测用户是否已手写斜杠命令；
 *     若已写命令且「不是 write-paper 且带模板」→ 直接返回，不注入模板段
 *   - 已写 `/write-paper` 且有模板 → 用户原文 + 模板来源说明（不重复注入 Rwe 模板）
 *   - 其余 → [Rwe 模板, 模板来源说明, 用户原文] 过滤空值后用换行拼接
 */
export function composePrompt(
  kind: TaskKind,
  userText: string,
  opts?: { paperTemplate?: PaperTemplateRef },
): string {
  if (kind === 'chat') return userText;

  const cmd = detectSlashCommand(userText);
  const tpl = kind === 'paper' ? opts?.paperTemplate : undefined;

  // 已有斜杠命令，且不是「write-paper 且有模板」的组合 → 尊重用户写法
  if (cmd && !(cmd === 'write-paper' && tpl)) return userText;

  const trimmed = userText.trim();

  if (cmd === 'write-paper' && tpl) {
    return [trimmed, describeTemplateSource(tpl)].join('\n');
  }

  return [TASK_TEMPLATES[kind], tpl ? describeTemplateSource(tpl) : null, trimmed]
    .filter(Boolean)
    .join('\n');
}

// ─────────────────────────────────────────────────────────────
// 五、项目工作区指令
// ─────────────────────────────────────────────────────────────

/**
 * 主进程写入项目根 `AGENTS.md` / `CLAUDE.md` 的约定。
 * 各条按数学建模任务顺序排列，便于维护和审阅。
 */
export const PROJECT_INSTRUCTIONS: string = [
  '# MModels 数学建模项目',
  '',
  '## 论文工作约定',
  '',
  '- 使用 `/write-paper` 完成建模、求解、写作、绘图和编译；完整处理每个问题，不跳过子问题。',
  '- 开始工作前先读取 `.mathmodel/paper/config.json`；其中的模板、比赛字段和队伍档案是用户数据。',
  '- 若项目里只存在旧的 `.mmodels/paper/config.json`（早期版本写下的目录名），内容与 `.mathmodel/paper/config.json` 等价，同样可以读；不要删它。',
  '- 使用配置指定的比赛模板：`builtin` 从 `write-paper/assets/template/<id>/` 定位，`custom` 从 `sourcePath` 定位；仅在入口文件尚不存在时完整复制到当前项目，不覆盖已有论文或项目配置。',
  '- 身份与联系方式只能写入模板明确要求的封面、承诺书或报名页，禁止出现在匿名正文、页眉、图表、代码和文件名中。',
  '- 每个问题保留可复现的独立求解脚本，数据、图表和结论必须可追溯；不得编造数据、运行结果或参考文献。',
  '- 图表保持统一风格和清晰标注，图注简短、分析写入正文；引用图表、公式和文献时保持编号一致，文章结构紧凑、逻辑清晰。',
].join('\n');

// ─────────────────────────────────────────────────────────────
// 六、模型选择引导卡
// ─────────────────────────────────────────────────────────────

/** 方法名。 */
export const METHOD_NAMES = {
  arima: 'ARIMA 时间序列预测',
  randomForest: '随机森林回归',
  nsga2: 'NSGA-II 多目标优化',
  topsis: 'TOPSIS 综合评价',
  regression: '回归分析',
  geometry: '几何计算',
} as const;

/** 选用理由。 */
export const METHOD_RATIONALE = {
  arima: '利用序列自身的滞后与误差结构预测未来，适合单变量时间序列基线。',
  randomForest: '用多棵决策树拟合非线性关系，对表格数据和复杂特征交互较稳健。',
  metaheuristic: '通过群体协同搜索连续空间中的较优解，适合黑箱和非凸目标函数。',
  topsis: '根据各方案到正、负理想解的距离，对多指标方案进行综合排序。',
} as const;

/** 方法选择引导的四类判断。 */
export const METHOD_SELECTION_HINTS = {
  singleTarget: '只有一个目标或需要唯一解',
  conflictNoWeights: '目标冲突且不能预先确定权重',
  needGlobalOptimum: '需要严格全局最优证明',
  correlatedMetrics: '指标高度相关但未做筛选',
  shortSample: '样本过短或频繁结构突变',
  stationaryDiff: '差分后平稳的时间序列',
  evenInterval: '等时间间隔的单变量序列',
  multiObjective: '多个目标函数、变量边界与约束',
  objectiveBounds: '目标函数、变量边界与计算预算',
  decisionMatrix: '方案 × 指标决策矩阵',
  metricWeights: '指标权重与正负方向',
} as const;

/** 结果呈现要求。 */
export const RESULT_SECTIONS = {
  optimization: '最优解、目标值与求解状态',
  pareto: 'Pareto 解集、前沿图与权衡分析',
  forecast: '预测值、置信区间与残差诊断',
  regression: '预测值、交叉验证指标与特征重要性',
} as const;

// ─────────────────────────────────────────────────────────────
// 七、模型选择向导（AskUserQuestion 约束）
// ─────────────────────────────────────────────────────────────

export const ASK_USER_QUESTION_NOTICE = [
  'AskUserQuestion 一次最多 4 个问题，每个问题 2-4 个选项，字段固定为 header / question / options / multiSelect',
].join('\n');

// ─────────────────────────────────────────────────────────────
// 八、界面固定文案
// ─────────────────────────────────────────────────────────────

export const UI_TEXT = {
  idle: '⚪ 空闲',
  running: '🟢 运行中',
  interrupted: '⏹️ 已打断当前回合。',
  sending: '上一条消息还在处理，请稍候…',
  done: '✅ 成功',
  failed: '执行失败',
  completed: '执行完成',
  noOutput: '（无输出）',
  reload: '重新加载',
  errorPrefix: '出错了：',
  errorLabel: '错误：',
  cost: '耗时：',
  logDir: '日志目录：',
  // 定时任务
  schedulerStarted: '[定时任务] 调度器已启动，tick 周期 30s',
  cronInvalid: 'cron 表达式不合法（需 5 个字段：分 时 日 月 周）',
  automationMissing: '该定时任务不存在',
  automationMaxRuns: ' 已达最大运行次数 ',
  automationAutoDisabled: '，自动停用',
  automationManualFailed: '[定时任务] 手动运行失败: ',
  // 会话
  newSessionStarted: '✅ 已开始一个新会话，之前的会话仍可在桌面端查看。',
  sessionDeleted: '绑定的会话已被删除，发一条新消息即可重新创建。',
  noBoundSession: '当前没有绑定的会话。',
  noBoundSessionHint: '当前没有绑定的会话，发一条消息即可自动创建。',
  collaborationTask: '协作任务',
  teamContext: '【团队对话上下文】',
  currentRequest: '【当前请求】',
  teamAttachments: '【团队附件（房主本机路径）】',
  collabFrom: '【协作任务 · 由队友「',
  collabFromEnd: '」发起】',
  mediaUnsupported: '（暂不支持媒体消息，请发送文字）',
  // 崩溃恢复
  windowCrashed: 'MModels 窗口意外停止。',
  windowStopped: 'MModels 窗口已停止',
  windowCrashLoop: 'MModels 窗口连续崩溃了 ',
  rendererGone: '窗口的渲染进程已退出（',
  noAutoRetry: '该退出原因重载后必然复现，因此没有自动重试。',
  reloadPaused: '已暂停自动重载，避免反复崩溃的窗口在后台不停重启。',
  // 供应商 / 协议桥
  baseUrlEmpty: 'OpenAI Base URL 不能为空',
  baseUrlScheme: 'OpenAI Base URL 只支持 HTTP 或 HTTPS',
  baseUrlInvalid: 'OpenAI Base URL 无效',
  providerMissing: '供应商不存在',
  bridgeNotReady: 'OpenAI 兼容协议桥尚未就绪',
  bridgeNotEnabled: '该供应商未启用 OpenAI 兼容协议',
  anthropicConvertFailed: 'Anthropic 请求无法转换为 OpenAI Chat Completions',
  streamFormatMismatch: 'OpenAI 流式响应格式不兼容：',
  streamNotSse: 'OpenAI 兼容 API 忽略了流式请求，未返回 SSE',
  streamReadFailed: '读取 OpenAI 流式响应失败：',
  upstreamFailed: '上游 API 请求失败（HTTP ',
  upstreamStreamFailed: '上游 API 流式请求失败：',
  connectFailed: '无法连接 OpenAI 兼容 API：',
  connectOk: '连接成功',
  requestCanceled: '请求已取消',
} as const;
