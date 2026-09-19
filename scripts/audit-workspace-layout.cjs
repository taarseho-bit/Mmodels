// 只读诊断：不读取/输出密钥、对话正文或工具参数。
const { join } = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const dir = process.argv[2];
const db = new Database(join(dir, 'mmodels.db'), { readonly: true });
console.log('projects', JSON.stringify(db.prepare('SELECT name,root FROM projects').all()));
console.log('workflow', JSON.stringify(db.prepare('SELECT snapshot FROM workflow_runs ORDER BY started_at DESC LIMIT 3').all().map(r => {
  const run = JSON.parse(r.snapshot);
  return { status: run.status, nodes: run.nodes.map(n => ({ id: n.id, parent: n.parentId, name: n.name, tools: [...new Set(n.tools.map(t => t.name))], skills: n.tools.filter(t => t.skill).map(t => t.skill) })) };
})));
const config = JSON.parse(fs.readFileSync(join(dir, 'config.json'), 'utf8'));
console.log('providers', JSON.stringify((config.providers || []).map(p => ({ name:p.name, host: (()=>{try{return new URL(p.baseUrl).hostname}catch{return 'invalid'}})(), models:p.models, apiFormat:p.apiFormat }))));
db.close();
