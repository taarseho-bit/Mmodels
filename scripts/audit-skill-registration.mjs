/** Initialize the real bundled CLI without sending a prompt or using API credentials. */
import * as sdk from '@anthropic-ai/claude-agent-sdk';
const { query } = sdk;
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'mmodels-skill-audit-'));
const workspace = join(temp, 'workspace');
mkdirSync(workspace);
// Synthetic local skill: tests discovery with settingSources: [], not a real project change.
const fixtureDir = join(workspace, '.claude', 'skills', 'audit-project-fixture');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(join(fixtureDir, 'SKILL.md'), '---\nname: audit-project-fixture\ndescription: Offline discovery fixture, never execute.\n---\nNo work to perform.\n');
const require = createRequire(import.meta.url);
const moduleObject = { exports: {} };
const code = ts.transpileModule(readFileSync(resolve('src/main/agent/project-plugins.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'module', 'exports', code)(name => name === 'electron' ? { app: { getPath: () => temp } } : require(name), moduleObject, moduleObject.exports);
const projectPlugin = moduleObject.exports.projectSkillsPlugin(workspace, temp);
let builtinPlugin = process.argv[2] || 'C:/Users/xh/AppData/Roaming/mmodels-desktop/skills-plugin';
if (process.argv.includes('--source-skills')) {
  builtinPlugin = join(temp, 'builtin-plugin');
  mkdirSync(join(builtinPlugin, '.claude-plugin'), { recursive: true });
  mkdirSync(join(builtinPlugin, 'skills'));
  writeFileSync(join(builtinPlugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'mathmodel', version: '0.1.0', description: 'Offline source registration audit' }));
  for (const entry of readdirSync(resolve('resources/builtin-skills'), { withFileTypes: true })) {
    const source = resolve('resources/builtin-skills', entry.name);
    if (entry.isDirectory() && existsSync(join(source, 'SKILL.md')) && !existsSync(join(source, '.disabled-by-default'))) {
      symlinkSync(source, join(builtinPlugin, 'skills', entry.name), process.platform === 'win32' ? 'junction' : 'dir');
    }
  }
}
// Real SDK servers and schemas; application services are unavailable by design.
// This checks registration only: no tool handler may read or modify user data.
function loadRegistrationSource(file) {
  const m = { exports: {} };
  const js = ts.transpileModule(readFileSync(resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === '@anthropic-ai/claude-agent-sdk') return sdk;
    if (name === './browser-tools') return loadRegistrationSource('src/main/agent/browser-tools.ts');
    if (name === 'electron' || name.startsWith('.') || name.startsWith('@shared/')) return {};
    return require(name);
  }, m, m.exports);
  return m.exports;
}
const mcpServers = await loadRegistrationSource('src/main/agent/builtin-mcp.ts').buildBuiltinMcp({
  sessionId: 'offline-registration-audit', cwd: workspace, interactionMode: 'plan',
});
const env = { ...process.env };
for (const name of Object.keys(env)) {
  if (/^(ANTHROPIC_|OPENAI_|CLAUDE_|CLAUDECODE$)/.test(name)) delete env[name];
}
Object.assign(env, {
  ANTHROPIC_BASE_URL: 'http://127.0.0.1:1', ANTHROPIC_API_KEY: 'offline-audit-not-a-real-key',
  CLAUDE_CONFIG_DIR: join(temp, 'config'), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1', DISABLE_TELEMETRY: '1',
});
let endInput;
const inputDone = new Promise(resolve => { endInput = resolve; });
const abortController = new AbortController();
const timer = setTimeout(() => { abortController.abort(); endInput(); }, 25000);
const q = query({
  prompt: (async function* () { await inputDone; })(),
  options: {
    cwd: workspace, env, settingSources: [], abortController,
    pathToClaudeCodeExecutable: resolve('resources/claude-code/claude.exe'),
    plugins: [{ type: 'local', path: builtinPlugin }, { type: 'local', path: projectPlugin }],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: '离线技能注册检查。没有用户任务，不执行任何工作。' },
    model: 'deepseek-flash[1m]',
    mcpServers,
    settings: { autoCompactEnabled: true, precomputeCompactionEnabled: true, autoCompactWindow: 900000 },
  },
});
try {
  const commands = await q.supportedCommands();
  if (!commands.some(c => c.name.includes('audit-project-fixture'))) throw new Error('项目技能未注册');
  if (!commands.some(c => c.name === 'mathmodel:write-paper')) throw new Error('论文技能未注册');
  if (process.argv.includes('--source-skills') && !commands.some(c => c.name === 'mathmodel:competition-audit')) throw new Error('新增比赛核验技能未注册');
  const context = await q.getContextUsage();
  if (!context.isAutoCompactEnabled || context.autoCompactThreshold > 900000) throw new Error('压缩触发线未在真实容量的90%以内');
  let connectors = await q.mcpServerStatus();
  const deadline = Date.now() + 10000;
  while (connectors.filter(s => s.status === 'connected').length < 2 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 200));
    connectors = await q.mcpServerStatus();
  }
  for (const [name, count] of [['mathmodel', 15], ['mathmodel-browser', 14]]) {
    const server = connectors.find(s => s.name === name);
    if (server?.status !== 'connected' || server.tools?.length !== count) throw new Error(`内置工具注册不完整：${name} ${JSON.stringify(server)}`);
  }
  console.log(JSON.stringify({ scope: '仅初始化；未发送题目；无真实密钥；模型端点指向本机关闭端口',
    temporaryDirectory: temp,
    connectors: connectors.map(s => ({ name: s.name, status: s.status, tools: s.tools?.map(t => t.name) })),
    context: { model: context.model, total: context.maxTokens, raw: context.rawMaxTokens, autoCompactThreshold: context.autoCompactThreshold, enabled: context.isAutoCompactEnabled },
    projectSkillDiscovered: commands.some(c => c.name.includes('audit-project-fixture')),
    mathmodelSkills: commands.filter(c => c.name.startsWith('mathmodel:')).map(c => c.name),
    otherCommandCount: commands.filter(c => !c.name.startsWith('mathmodel:')).length }, null, 2));
} finally {
  clearTimeout(timer);
  endInput();
  q.close();
  abortController.abort();
}
