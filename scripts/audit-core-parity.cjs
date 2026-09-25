/** Read-only, offline comparison. Does not load provider credentials or call an API. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const original = process.argv[2] || 'C:/Users/xh/AppData/Local/Programs/@mathmodeldesktop/resources';
const runtime = process.argv[3] || 'C:/Users/xh/AppData/Roaming/mmodels-desktop/skills-plugin/skills';
const source = path.join(root, 'resources/builtin-skills');
const localBlocks = /<!-- MMODELS-LOCAL-START: [^>]+ -->\r?\n[\s\S]*?<!-- MMODELS-LOCAL-END: [^>]+ -->\r?\n?/g;
function files(dir, prefix = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const rel = prefix + e.name;
    return e.isDirectory() ? files(path.join(dir, e.name), rel + '/') : e.isFile() ? [rel] : [];
  }).sort();
}
function hash(file, normalize = false) {
  const bytes = fs.readFileSync(file);
  const value = normalize && /\.(md|py|tex|cls|sty|bib|json|txt|yml|yaml|toml|sh|ps1|bat|csv)$/i.test(file)
    ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes;
  return crypto.createHash('sha256').update(value).digest('hex');
}
function compare(a, b) {
  const left = files(a), right = new Set(files(b));
  const result = { originalFiles: left.length, currentFiles: right.size, identical: 0, lineEndingsOnly: [], changed: [], missing: [], added: [] };
  for (const f of left) {
    if (!right.delete(f)) { result.missing.push(f); continue; }
    if (hash(path.join(a, f)) === hash(path.join(b, f))) result.identical++;
    else if (hash(path.join(a, f), true) === hash(path.join(b, f), true)) result.lineEndingsOnly.push(f);
    else result.changed.push(f);
  }
  result.added = [...right];
  return result;
}
function skills(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => fs.existsSync(path.join(dir, n, 'SKILL.md'))).map(name => {
    const text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
    return { name, disabledByDefault: fs.existsSync(path.join(dir, name, '.disabled-by-default')),
      noAutoInvocation: /^disable-model-invocation:\s*true\s*$/m.test(text.split(/^---\s*$/m)[1] || '') };
  });
}
const report = {
  scope: '离线只读审计；目录存在不等于 SDK 实际成功注册；不使用 API、不读取密钥。',
  inventories: { original: skills(path.join(original, 'builtin-skills')), current: skills(source), runtime: skills(runtime) },
  originalVsSource: compare(path.join(original, 'builtin-skills'), source),
  paperRuntime: compare(path.join(source, 'write-paper'), path.join(runtime, 'write-paper')),
};
const oldPaper = fs.readFileSync(path.join(original, 'builtin-skills/write-paper/SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const newPaper = fs.readFileSync(path.join(source, 'write-paper/SKILL.md'), 'utf8').replace(localBlocks, '').replace(/\r\n/g, '\n');
report.paperOriginalBodyPreserved = oldPaper === newPaper;
const moduleObject = { exports: {} };
const bridgeCode = ts.transpileModule(fs.readFileSync(path.join(root, 'src/main/agent/bridge.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'module', 'exports', bridgeCode)(require, moduleObject, moduleObject.exports);
const currentBridge = moduleObject.exports;
const originalBridge = require(path.join(root, '.baseline/app/node_modules/@jtabet/anthropic-openai-bridge/dist/index.cjs'));
const fixtures = {
  text: { model: 'fixture-model', max_tokens: 200, messages: [{ role: 'user', content: '求解并验证。' }] },
  image: { model: 'fixture-model', max_tokens: 200, messages: [{ role: 'user', content: [
    { type: 'text', text: '识别约束图。' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' } },
  ] }] },
  skill: { model: 'fixture-model', max_tokens: 200, tools: [{ name: 'Skill', description: '加载技能', input_schema: { type: 'object', properties: { skill: { type: 'string' } } } }],
    messages: [{ role: 'user', content: '画图' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'fixture-call', name: 'Skill', input: { skill: 'mathmodel:paper-diagram' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'fixture-call', content: '技能正文' }] }] },
  reasoning: { model: 'fixture-model', max_tokens: 200, thinking: { type: 'enabled', budget_tokens: 100 }, output_config: { effort: 'high' }, messages: [{ role: 'user', content: '验证最优性' }] },
};
report.converterFixtures = Object.fromEntries(Object.entries(fixtures).map(([name, request]) => {
  const run = bridge => { try { return bridge.anthropicToOpenAIRequest(structuredClone(request)); } catch (error) { return { error: error.message }; } };
  return [name, { original: run(originalBridge), current: run(currentBridge) }];
}));
const encoder = new currentBridge.AnthropicStreamEncoder('fixture-model');
const sse = encoder.handleChunk({ choices: [{ delta: { content: '完成' } }] })
  + encoder.handleChunk({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 25 } }) + encoder.finish();
report.currentStreamUsage = sse.split('\n').filter(l => l.startsWith('data: ')).map(l => JSON.parse(l.slice(6)))
  .filter(e => e.usage || e.message?.usage).map(e => ({ type: e.type, usage: e.usage || e.message.usage }));
console.log(JSON.stringify(report, null, 2));
