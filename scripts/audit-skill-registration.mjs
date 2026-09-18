/** Initialize the real bundled CLI without sending a prompt or using API credentials. */
import { query } from '@anthropic-ai/claude-agent-sdk';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const temp = mkdtempSync(join(tmpdir(), 'mmodels-skill-audit-'));
const workspace = join(temp, 'workspace');
mkdirSync(workspace);
// Synthetic local skill: tests discovery with settingSources: [], not a real project change.
const fixtureDir = join(workspace, '.claude', 'skills', 'audit-project-fixture');
mkdirSync(fixtureDir, { recursive: true });
writeFileSync(join(fixtureDir, 'SKILL.md'), '---\nname: audit-project-fixture\ndescription: Offline discovery fixture, never execute.\n---\nNo work to perform.\n');
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
    plugins: [{ type: 'local', path: process.argv[2] || 'C:/Users/xh/AppData/Roaming/mmodels-desktop/skills-plugin' }],
    systemPrompt: '离线技能注册检查。没有用户任务，不执行任何工作。',
  },
});
try {
  const commands = await q.supportedCommands();
  console.log(JSON.stringify({ scope: '仅初始化；未发送题目；无真实密钥；模型端点指向本机关闭端口',
    temporaryDirectory: temp,
    projectSkillDiscovered: commands.some(c => c.name.includes('audit-project-fixture')),
    mathmodelSkills: commands.filter(c => c.name.startsWith('mathmodel:')).map(c => c.name),
    otherCommandCount: commands.filter(c => !c.name.startsWith('mathmodel:')).length }, null, 2));
} finally {
  clearTimeout(timer);
  endInput();
  q.close();
  abortController.abort();
}
