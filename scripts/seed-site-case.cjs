/**
 * 只给官网截图使用的隔离案例数据播种器。
 *
 * 这个文件必须由项目自带的 Electron Node 运行（而不是系统 Node），
 * 因为 better-sqlite3 的原生 ABI 与 Electron 版本绑定。它严格拒绝真实
 * userData 和仓库外的数据库路径，截图结束后整个 mm-site-shots 临时目录
 * 会随进程退出而由系统回收。
 */
'use strict';

const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');

const [file, sessionId, projectId] = process.argv.slice(2);
if (!file || !sessionId || !projectId) throw new Error('缺少隔离数据库、会话或项目参数');
const relative = path.relative(os.tmpdir(), path.resolve(file));
if (
  relative.startsWith('..') ||
  path.isAbsolute(relative) ||
  !/^mm-site-shots-[^\\/]+[\\/]userdata[\\/]mmodels\.db$/i.test(relative)
) {
  throw new Error('只允许向官网截图的隔离数据库写入样例');
}

const db = new Database(file);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');
const session = db.prepare('SELECT title, project_id FROM sessions WHERE id=?').get(sessionId);
if (session?.title !== '城市应急资源调度 · 从题意到论文' || session.project_id !== projectId) {
  db.close();
  throw new Error('不是预期的官网案例会话');
}

const now = Date.now();
const addMessage = db.prepare(
  'INSERT INTO messages (id, session_id, role, blocks, model, created_at, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
);
const messages = [
  {
    role: 'user',
    blocks: [{ kind: 'text', text: '请先拆解这道城市应急资源调度题，明确目标函数、约束条件、数据口径，并给出后续建模路线。' }],
  },
  {
    role: 'assistant',
    blocks: [
      { kind: 'thinking', text: '先确认资源、区域、优先级和容量约束，再比较线性规划与启发式方案。' },
      { kind: 'text', text: '我已把题目拆成四层：**问题理解 → 数据体检 → 方案求解 → 论文交付**。\n\n当前首选线性规划，原因是运输成本、缺口惩罚和最低保障量都能写成可解释的约束；随后用灵敏度分析检查需求波动下的稳定性。' },
      { kind: 'tool_use', toolName: 'TaskCreate', toolUseId: 'case-task-1', toolInput: { subject: '核对题目与约束', description: '提取目标、变量、边界条件', activeForm: '正在核对题目与约束' }, toolResult: 'Task #1 created successfully: 核对题目与约束' },
      { kind: 'tool_use', toolName: 'Skill', toolUseId: 'case-skill-1', toolInput: { skill: 'mathmodel:data-auditor-cleaner' }, toolResult: '已完成数据字段、缺失值与异常值检查' },
    ],
  },
  {
    role: 'user',
    blocks: [{ kind: 'text', text: '继续完成方案对比，并把结果整理成可以复核的论文结构。需要同时保留图表和数据来源。' }],
  },
  {
    role: 'assistant',
    blocks: [
      { kind: 'text', text: '已完成基线方案与优化方案对比。建议论文按以下结构推进：\n\n1. 问题重述与符号说明\n2. 数据来源与预处理\n3. 目标函数和约束条件\n4. 求解结果与方案比较\n5. 灵敏度分析与稳健性\n6. 结论、局限与推广\n\n所有中间数据、模型脚本和图表清单都已写入项目目录，后续可以直接复算。' },
      { kind: 'tool_use', toolName: 'TaskUpdate', toolUseId: 'case-task-update-1', toolInput: { taskId: '1', status: 'completed' }, toolResult: '任务 #1 已完成：核对题目与约束' },
      { kind: 'tool_use', toolName: 'Write', toolUseId: 'case-write-1', toolInput: { file_path: 'results/模型摘要.md' }, toolResult: '文件已写入 results/模型摘要.md' },
      { kind: 'tool_use', toolName: 'Skill', toolUseId: 'case-skill-2', toolInput: { skill: 'mathmodel:paper-diagram' }, toolResult: '已生成论文结构与图表规划清单' },
    ],
  },
];
const node = (id, name, agentType, assignment, tools, status = 'returned') => ({
  id,
  name,
  agentType,
  assignment,
  status,
  startedAt: now,
  endedAt: status === 'running' ? undefined : now + 1000,
  tools,
});
const tool = (id, name, label, skill, artifact, status = 'completed') => ({
  id,
  name,
  label,
  skill,
  skillSource: skill ? 'call' : undefined,
  verified: true,
  artifact,
  status,
  startedAt: now,
  endedAt: status === 'running' ? undefined : now + 1000,
});
const run = {
  id: randomUUID(),
  sessionId,
  projectId,
  sessionTitle: session.title,
  startedAt: now,
  updatedAt: now,
  revision: 18,
  status: 'running',
  collaborationEnabled: true,
  truncated: false,
  workflowStages: ['理解题目', '研究与计算', '核对结果', '整理交付'],
  currentStage: 2,
  stageStatus: 'running',
  exchanges: [
    { id: 'ex-1', source: 'main', target: 'problem' },
    { id: 'ex-2', source: 'problem', target: 'data' },
    { id: 'ex-3', source: 'data', target: 'solver' },
    { id: 'ex-4', source: 'solver', target: 'review' },
  ],
  nodes: [
    node('main', '建模主助手', 'main', '统筹本轮目标与最终结果', [tool('m1', 'Skill', '题意解析', 'mathmodel:problem-parser'), tool('m2', 'Agent', '分配协作任务')], 'running'),
    node('problem', '题意约束分析员', 'problem-analyst', '提取目标、变量、约束和数据需求', [tool('p1', 'Read', '阅读题目资料', undefined, '题目说明.md'), tool('p2', 'Skill', '题型识别', 'mathmodel:problem-classifier')]),
    node('data', '数据特征分析员', 'data-analyst', '检查需求数据的口径、缺失与异常', [tool('d1', 'Skill', '数据体检与清洗', 'mathmodel:data-auditor-cleaner'), tool('d2', 'Write', '整理数据报告', undefined, 'results/数据体检.md')], 'running'),
    node('solver', '模型求解研究员', 'model-solver', '比较线性规划与启发式方案', [tool('s1', 'Skill', '方法选型', 'mathmodel:method-selector'), tool('s2', 'Bash', '运行模型计算', undefined, 'results/solver.py')]),
    node('review', '稳健性核验员', 'general-purpose', '检查扰动下的结论稳定性', [tool('r1', 'Skill', '稳健性分析', 'mathmodel:robustness-checker'), tool('r2', 'Skill', '结果复现', 'mathmodel:result-reproducibility')]),
    node('paper', '论文结构研究员', 'paper-reviewer', '把结果整理为可复核的论文结构', [tool('w1', 'Skill', '论文写作', 'mathmodel:write-paper'), tool('w2', 'Write', '生成论文提纲', undefined, 'results/paper-outline.md')]),
  ],
};
for (const item of run.nodes.slice(1)) item.parentId = 'main';

const writeAll = db.transaction(() => {
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];
    addMessage.run(
      randomUUID(),
      sessionId,
      message.role,
      JSON.stringify(message.blocks),
      'deepseek-chat',
      now + i * 1200,
      420 + i * 40,
      680 + i * 60,
    );
  }
  db.prepare('UPDATE sessions SET message_count = ?, updated_at = ?, input_tokens = ?, output_tokens = ? WHERE id = ?').run(messages.length, now + 4000, 1600, 2500, sessionId);
  db.prepare('INSERT INTO workflow_runs (id, session_id, started_at, snapshot) VALUES (?, ?, ?, ?)').run(run.id, sessionId, now, JSON.stringify(run));
});

// 单次事务写入消息、会话统计和工作流快照，避免截图出现半套素材。
writeAll();

db.close();
console.log('site-case-seeded');
