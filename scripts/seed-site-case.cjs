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
const runStart = now - 18 * 60 * 1000;
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
      { kind: 'text', text: '### 模型已经求解，结论可以复核\n\n> 教学演示 · 合成数据 · 本地 SciPy / HiGHS 求解\n\n| 验证项 | 结果 |\n| --- | --- |\n| 需求 / 供给 | 1,170 / 1,250 单位 |\n| 基线 → 优化成本 | 12,450 → 9,520 单位·km |\n| 运输成本改善 | **23.53%** |\n| 需求与容量约束 | 全部满足 |\n\n**边界检查：**需求增加 5% 时仍可行；增加 10% 时供给不足，需要追加资源。当前结论描述运输成本，不能直接等同于到达时间。\n\n复算脚本、分配矩阵、结果图与技术路线已保存在项目中。下一步：把假设、模型、结果与局限整理进论文。' },
      { kind: 'tool_use', toolName: 'TaskUpdate', toolUseId: 'case-task-update-1', toolInput: { taskId: '1', status: 'completed' }, toolResult: '任务 #1 已完成：核对题目与约束' },
      { kind: 'tool_use', toolName: 'Write', toolUseId: 'case-write-1', toolInput: { file_path: 'results/模型摘要.md' }, toolResult: '文件已写入 results/模型摘要.md' },
      { kind: 'tool_use', toolName: 'Skill', toolUseId: 'case-skill-2', toolInput: { skill: 'mathmodel:paper-diagram' }, toolResult: '已生成论文结构与图表规划清单' },
    ],
  },
  {
    role: 'user',
    blocks: [{ kind: 'text', text: '把整个建模过程画成流程图，保留不可行场景的反馈路径。' }],
  },
  {
    role: 'assistant',
    blocks: [{ kind: 'text', text: '### 从题意到交付，一张图看清路线\n\n```mermaid\nflowchart LR\n A[赛题与约束] --> B[数据体检]\n B --> C[基线方案]\n B --> D[线性规划]\n C --> E[结果比较]\n D --> E\n E --> F[灵敏度分析]\n F --> G{容量核验}\n G -->|满足| H[论文与图表]\n G -->|不足| I[补充供给]\n I --> D\n H --> J[复算交付]\n```\n\n**模型、代码、图表与论文共用一个项目。** 图中的反馈分支对应已经求解的供给不足场景。\n\n> 官网演示案例；对话与协作记录用于功能回放，本地数值结果可复算。' }],
  },
];
const node = (id, name, agentType, assignment, tools, status = 'returned') => ({
  id,
  name,
  agentType,
  assignment,
  status,
  startedAt: runStart + Number(id === 'main' ? 0 : id.length) * 12000,
  endedAt: status === 'running' ? undefined : now - 45000,
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
  startedAt: runStart + 45000,
  endedAt: status === 'running' ? undefined : now - 60000,
});
const run = {
  id: randomUUID(),
  sessionId,
  projectId,
  sessionTitle: session.title,
  startedAt: runStart,
  updatedAt: now,
  revision: 72,
  status: 'running',
  collaborationEnabled: true,
  truncated: false,
  workflowStages: ['理解题目', '并行研究与计算', '交叉核验', '论文与复算交付'],
  currentStage: 3,
  stageStatus: 'running',
  exchanges: [
    ...[['main','problem'],['problem','data'],['problem','assumptions'],['literature','baseline'],['data','forecast'],['data','solver'],['assumptions','solver'],['baseline','solver'],['forecast','simulation'],['solver','simulation'],['simulation','review'],['solver','review'],['review','figure'],['literature','paper'],['figure','paper'],['paper','citation'],['citation','audit'],['audit','reproduce'],['reproduce','main']].map(([source,target],i)=>({id:`ex-${i+1}`,source,target})),
  ],
  nodes: [
    node('main', '建模主控', 'main', '推理模型 · 统筹 14 位成员与交付闭环', [tool('m1','Skill','问题拆解','mathmodel:problem-parser'),...['研究任务','计算任务','核验任务','论文任务'].map((x,i)=>tool(`m${i+2}`,'Agent',`派发${x}`)),tool('m6','TaskOutput','汇总成员结果')], 'running'),
    node('problem','题意解析','problem-analyst','推理模型 · 目标、变量、约束与验收口径',[tool('p1','Read','阅读赛题',undefined,'题目说明.md'),tool('p2','Skill','题型识别','mathmodel:problem-classifier'),tool('p3','Skill','约束提取','mathmodel:problem-parser'),tool('p4','Write','保存问题拆解',undefined,'results/问题拆解.md')]),
    node('data','数据审计','data-analyst','分析模型 · 3 座仓库、4 个服务区的数据核验',[tool('d1','Read','检查原始数据',undefined,'data/应急资源需求.csv'),tool('d2','Skill','单位与缺失检查','mathmodel:data-auditor-cleaner'),tool('d3','Bash','计算供需统计'),tool('d4','Write','保存质量报告',undefined,'results/数据质量.md')]),
    node('literature','文献调研','literature-researcher','研究模型 · 比较应急调度的建模方法',[tool('l1','Skill','文献检索','mathmodel:paper-search'),tool('l2','WebSearch','检索运输规划研究'),tool('l3','WebFetch','阅读方法与适用条件'),tool('l4','Write','整理方法证据',undefined,'paper/方法依据.md')]),
    node('assumptions','假设审查','general-purpose','推理模型 · 需求确定性与容量边界',[tool('a1','Read','核对题意与数据'),tool('a2','Skill','模型方法选型','mathmodel:method-selector'),tool('a3','Write','保存假设与局限',undefined,'results/假设清单.md')]),
    node('baseline','基线方案','model-solver','代码模型 · 最邻近分配与可行基线',[tool('b1','Skill','优化方法比较','mathmodel:method-selector'),tool('b2','Bash','求解基线成本 12,450'),tool('b3','Write','保存基线矩阵',undefined,'results/基线方案.csv')]),
    node('solver','规划求解','model-solver','代码模型 · HiGHS 最优成本 9,520',[tool('s1','Skill','选择规划方法','mathmodel:method-selector'),tool('s2','Read','检查容量与成本矩阵'),tool('s3','Bash','执行 SciPy / HiGHS',undefined,'code/solver.py'),tool('s4','Bash','校验约束残差'),tool('s5','Write','保存求解指标',undefined,'results/metrics.json')]),
    node('forecast','需求分析','data-analyst','分析模型 · ±5%、±10% 需求情景',[tool('q1','Skill','需求数据审计','mathmodel:data-auditor-cleaner'),tool('q2','Bash','构造需求扰动场景'),tool('q3','Write','保存情景参数',undefined,'results/需求场景.csv')]),
    node('simulation','情景仿真','model-solver','代码模型 · 5% 可行、10% 供给不足',[tool('c1','Read','读取扰动场景'),tool('c2','Bash','复算 +5% 需求'),tool('c3','Bash','复算 +10% 需求'),tool('c4','Write','记录不可行反馈',undefined,'results/情景结果.csv')]),
    node('review','稳健性核验','general-purpose','推理模型 · 成本改善 23.53% 的适用边界',[tool('r1','Skill','稳健性检查','mathmodel:robustness-checker'),tool('r2','Skill','独立结果复算','mathmodel:result-reproducibility'),tool('r3','Read','核对求解指标'),tool('r4','Write','记录敏感性结论',undefined,'results/敏感性分析.md')]),
    node('figure','科研图表','general-purpose','视觉模型 · 分配、成本与灵敏度表达',[tool('f1','Skill','科研绘图','mathmodel:nature-figure'),tool('f2','Skill','技术路线图','mathmodel:paper-diagram'),tool('f3','Bash','绘制三联结果图'),tool('f4','Write','导出高清图',undefined,'figures/模型结果.png')]),
    node('paper','论文写作','paper-reviewer','写作模型 · 摘要、假设、模型、结果与局限',[tool('w1','Skill','论文写作','mathmodel:write-paper'),tool('w2','Read','读取核验结果与图表'),tool('w3','Write','编排论文结构',undefined,'模型结果报告.md'),tool('w4','Skill','学术表达润色','mathmodel:paper-polish',undefined,'running')], 'running'),
    node('citation','引用核验','paper-reviewer','研究模型 · 引用对应原文与结论',[tool('v1','Skill','论文审阅','mathmodel:review-paper'),tool('v2','Read','检查方法依据与引用'),tool('v3','Write','保存引用检查单',undefined,'paper/引用核验.md')]),
    node('audit','交付审计','paper-reviewer','推理模型 · 数值、页数、匿名信息与附件',[tool('u1','Skill','比赛交付核对','mathmodel:competition-delivery-check'),tool('u2','Skill','页数与版式检查','mathmodel:paper-page-fit'),tool('u3','Read','交叉核对正文与结果'),tool('u4','Write','整理交付清单',undefined,'paper/交付检查单.md')], 'running'),
    node('reproduce','复算交付','general-purpose','代码模型 · 脚本、数据、图表与说明打包',[tool('z1','Skill','复现验证','mathmodel:result-reproducibility'),tool('z2','Bash','复跑模型脚本'),tool('z3','Read','比较指标与分配矩阵'),tool('z4','Write','保存复算说明',undefined,'results/复算说明.md')]),
  ],
};
const parentByAgent = {
  problem: 'main', data: 'main', literature: 'main', assumptions: 'problem', baseline: 'data',
  forecast: 'data', solver: 'assumptions', simulation: 'forecast', review: 'solver', figure: 'review',
  paper: 'figure', citation: 'paper', audit: 'paper', reproduce: 'audit',
};
for (const item of run.nodes.slice(1)) item.parentId = parentByAgent[item.id] || 'main';

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
