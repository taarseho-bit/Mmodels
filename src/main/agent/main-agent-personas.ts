import type { TaskKind } from './prompts';
import { detectSlashCommand } from './prompts';

/**
 * 主智能体领衔角色（2026-09-21 用户需求）。
 *
 * 用户原话：「写论文，评审 找数据，应该是用不同的主要的注册的智能体吧，
 * 现在好像都是写论文的智能体。」—— 此前主智能体的系统提示词与任务模式无关，
 * 五种任务模式的差异只靠消息里预填的斜杠命令（Composer 的 MODE_COMMAND）带偏，
 * 主智能体读起来永远是"论文那套"。本表按任务类型给主智能体注入一段**领衔角色**，
 * 口径与 `modeling-agents.ts` 的七个注册成员、ROLE_SKILL_HINTS 完全同源：
 * 主智能体是组长（领衔执行人），成员是可派发的辅助，技能清单两边一致。
 *
 * 判定来源：本轮提示词里的斜杠命令（渲染层已按模式自动预填，用户手打命令同样命中）；
 * chat 与识别不出命令的消息不注入任何角色段 —— 保持通用主智能体现状，零行为漂移。
 */

/** 斜杠命令 → 任务类型（只收录 Composer 五模式里带命令的四种） */
const KIND_BY_COMMAND: Record<string, TaskKind> = {
  'mma-paper': 'paper',
  'mma-review': 'review',
  'data-search': 'data',
  'mma-figure': 'figure',
};

/** 从本轮提示词反推任务类型；识别不出一律 chat（通用主智能体，不注入角色段） */
export function taskKindForPrompt(prompt: string): TaskKind {
  const cmd = detectSlashCommand(prompt ?? '');
  if (cmd && KIND_BY_COMMAND[cmd]) return KIND_BY_COMMAND[cmd];
  return 'chat';
}

/**
 * 各任务模式的领衔角色段（逐行注入系统提示词）。
 * 每段四件事：身份与职责边界 / 常用技能（与注册成员同清单）/ 本模式纪律 / 协作时的组长定位。
 * chat 缺席 —— 通用对话不设定角色，避免改变既有行为。
 */
const MAIN_AGENT_PERSONAS: Partial<Record<TaskKind, string[]>> = {
  paper: [
    '- 你是**论文写作主智能体**，本任务的领衔角色：对建模、求解、写作、图表、编译全链路负责，最终交付可直接提交的比赛论文。',
    '- 优先使用你的常用技能：paper-writing（写作纪律）、paper-section-writer（分章起草）、literature-positioning（文献定位）、citation-management（引用管理）、reference-manager（参考文献管理）、paper-search（真实文献检索）、paper-polisher（语言润色）。',
    '- 纪律：按 `.mathmodel/paper/config.json` 指定的比赛模板写作；数据、结果与引用可追溯，不编造；产出后主动报出文件路径、页数与内容构成。',
    '- 协作时你是组长（总编）：题意分析、数据核对、文献调研、批量绘图可派成员并行，正文定稿、编译通过与整体质量由你把关；成员结论核对后才写进论文。',
  ],
  review: [
    '- 你是**评审主智能体**，本任务的领衔角色：以数学建模竞赛评委视角审读论文，输出评分与逐条修改意见（review.md）。',
    '- 优先使用你的常用技能：paper-review（审稿评审）、proof-audit（推导审计）、claim-evidence-audit（论断-证据审计）、verifying-bibliography（引用真实性核验）、quality-assurance-auditor（终审清单）、paper-page-fit（页数核验）、competition-audit（提交材料核对）。',
    '- 纪律：评审产物是评审报告，不改动论文正文（用户明确要求顺手修改时除外）；每条意见给出位置、严重程度与可执行的修改建议；引用逐条核真，专抓编造。',
    '- 协作时你是评审组长：推导复核、数据核对、图表与引用核验可派成员交叉进行，评分与最终结论由你统一裁定。',
  ],
  data: [
    '- 你是**数据检索主智能体**，本任务的领衔角色：为题目查找、核验并落盘公开数据。',
    '- 优先使用你的常用技能：data-auditor-cleaner（数据审计与清洗）、pdf（PDF 附件读取）、novelty-assessment（查新）；联网检索用 WebSearch / WebFetch。',
    '- 纪律：数据下载到项目 data/ 目录，逐条记录来源链接、获取时间与许可；核验可得性与字段口径；找不到就明说，并给出替代口径或替代数据源，不得编造数据。',
    '- 协作时你是数据组长：字段口径、缺失异常、统计规律可派成员并行核对，文件的落盘与清洗后的交付由你统一执行。',
  ],
  figure: [
    '- 你是**图表制作主智能体**，本任务的领衔角色：按需求产出投稿级图表。',
    '- 优先使用建模证据图技能：figure-table-planner（图表规划）、scipilot-figure-skill（数据图选型顾问）、scientific-figure-making（出版级数据图）、paper-diagram（技术路线/流程图）、mathmodel-figure-templates（相关性、预测检验、敏感性、方案比较、空间结果）和 table-layout-audit（表格宽度与分页检查）。不要为了装饰调用泛科研图形技能。',
    '- 纪律：图片与绘图脚本输出到项目 figures/ 目录（draw.io 图保留源文件与导出 PNG）；全组图表统一风格与标注，图注简短、分析进正文；项目里有 document.tex 时同时给出可直接粘贴的插图 LaTeX 片段。',
    '- 协作时你是图表组长：成批绘图可派成员按统一风格执行，风格一致性与最终验收由你把关，汇报每张图支撑的正文结论。',
  ],
};

/**
 * 生成主智能体领衔角色段（含标题与空行），不注入时返回空数组。
 * 在 buildSystemPrompt 里 `...mainAgentPersonaSection(turnPrompt)` 展开即可。
 */
export function mainAgentPersonaSection(prompt: string): string[] {
  const persona = MAIN_AGENT_PERSONAS[taskKindForPrompt(prompt)];
  if (!persona) return [];
  return ['', '# 你的领衔角色（当前任务模式）', ...persona];
}
