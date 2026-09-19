/** 仅用于隔离测试库的界面样例。不能导入用户库，也不代表模型真实解题。 */
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const Database = require('better-sqlite3');
const [file, sessionId] = process.argv.slice(2);
const relative = path.relative(os.tmpdir(), path.resolve(file));
if (relative.startsWith('..') || path.isAbsolute(relative) || !/^mm-real-test-\d+[\\/]userdata[\\/]mmodels\.db$/.test(relative)) {
  throw new Error('只允许向隔离的工作流测试数据库写入样例');
}
const db = new Database(file);
db.pragma('foreign_keys = ON');
const session = db.prepare('SELECT title FROM sessions WHERE id=?').get(sessionId);
if (session?.title !== '工作流界面验证样例（非真实解题）') throw new Error('不是测试任务');
const now = Date.now();
const node = (id, name, agentType, tools) => ({ id, name, agentType, status: 'returned', startedAt: now, endedAt: now + 1000, tools });
const tool = (id, name, label, skill, artifact) => ({ id, name, label, skill, artifact, status: 'completed', startedAt: now, endedAt: now + 1000 });
const run = { id: randomUUID(), sessionId, startedAt: now, updatedAt: now + 1000, revision: 7,
  status: 'running', collaborationEnabled: true, truncated: false,
  nodes: [
    node('main', '建模主助手', 'main', [tool('p', 'Skill', '论文写作', 'mathmodel:mma-paper'), tool('w', 'Write', '生成文件', undefined, 'workflow-ui-sample.md')]),
    node('a', '题意分析员', 'problem-analyst', [tool('r', 'Read', '阅读资料')]),
    node('b', '数据分析员', 'data-analyst', [tool('s', 'Skill', '数据检索', 'mathmodel:data-search'), tool('c', 'Bash', '运行计算或命令')]),
    node('c', '灵敏度核验员', 'general-purpose', [tool('v', 'Skill', '比赛交付核对', 'mathmodel:competition-audit')]),
  ],
};
run.nodes[0].status = 'running'; run.nodes[2].status = 'running';
run.nodes[2].tools[1].status = 'running';
for (const item of run.nodes.slice(1)) item.parentId = 'main';
db.prepare('INSERT INTO workflow_runs (id, session_id, started_at, snapshot) VALUES (?, ?, ?, ?)').run(run.id, sessionId, now, JSON.stringify(run));
const prior = { ...run, id: randomUUID(), startedAt: now - 10000, status: 'stopped', nodes: [node('main', '建模主助手', 'main', [])] };
prior.nodes[0].status = 'stopped';
db.prepare('INSERT INTO workflow_runs (id, session_id, started_at, snapshot) VALUES (?, ?, ?, ?)').run(prior.id, sessionId, prior.startedAt, JSON.stringify(prior));
db.prepare('INSERT INTO messages (id, session_id, role, blocks, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), sessionId, 'assistant', JSON.stringify([{ kind: 'text', text: '工作流界面验证样例，不是模型解题结果。' }]), now);
db.close();
console.log('已写入隔离测试样例');
