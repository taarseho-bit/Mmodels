import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type RequestListener } from 'node:http';
import { anthropicToOpenAIRequest, AnthropicStreamEncoder, applyReasoning, type AnthropicRequest } from './bridge';
import { BridgeRegistry } from './bridge-registry';
import { userMcpOptions, sdkModel } from './runtime-options';
import { aggregateCapabilityUsage } from './usage-stats';
import { MODELING_AGENTS, ROLE_SKILL_HINTS } from './modeling-agents';
vi.mock('electron', () => ({ app: { getPath: () => 'unused-test-path' } }));
import { projectSkillsPlugin, workspaceInstructions } from './project-plugins';

const dirs: string[] = [], servers: Server[] = [], registries: BridgeRegistry[] = [];
afterEach(async () => {
  await Promise.all(registries.splice(0).map(r => r.stop()));
  await Promise.all(servers.splice(0).map(s => { s.closeAllConnections(); return new Promise<void>(r => s.close(() => r())); }));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const request = (patch: Partial<AnthropicRequest> = {}): AnthropicRequest => ({ model: 'deepseek-flash', max_tokens: 500, messages: [{ role: 'user', content: '检查约束' }], ...patch });
const provider = { id: 'fixture', name: '测试', baseUrl: 'https://api.deepseek.com', apiKey: 'fixture-only', apiFormat: 'openai' as const, models: ['first', 'selected'], enabled: true };
const events = (sse: string) => sse.split('\n').filter(s => s.startsWith('data:')).map(s => JSON.parse(s.slice(5)));

describe('核心能力对齐', () => {
  it('不能转换的助手附件明确报错，不静默丢弃', () => {
    expect(() => anthropicToOpenAIRequest(request({ messages: [{ role: 'assistant', content: [
      { type: 'image', source: { type: 'url', url: 'https://example.org/fixture.png' } },
    ] }] }))).toThrow('不能忽略');
  });
  it('压缩等控制指令不冒充技能调用', () => {
    const stats = aggregateCapabilityUsage([{ session_id: 's', role: 'user', blocks: JSON.stringify([{ kind: 'text', text: '/compact' }]) }]);
    expect(stats.skillEntryCount).toBe(0);
    expect(stats.bySkill).toEqual([]);
  });
  it('图片和技能结果里的图片均不丢失', () => {
    const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png', data: 'AAAA' } };
    const out = anthropicToOpenAIRequest(request({ messages: [{ role: 'user', content: [image] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: [image] }] }] }));
    expect(JSON.stringify(out.messages)).toContain('data:image/png;base64,AAAA');
    expect(out.messages.every(m => Array.isArray(m.content))).toBe(true);
  });
  it('PDF document 内容自动降级并提示改用本地路径，不再让整轮 400', () => {
    const embedded = { type: 'document' as const, title: '题目.pdf', source: { type: 'base64' as const, media_type: 'application/pdf', data: 'JVBERi0=' } };
    const text = { type: 'document' as const, source: { type: 'text' as const, media_type: 'text/plain', data: '已提取的题目正文' } };
    const out = anthropicToOpenAIRequest(request({ messages: [
      { role: 'user', content: [embedded] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'read_pdf', content: [embedded, text] }] },
    ] }));
    const serialized = JSON.stringify(out.messages);
    expect(serialized).toContain('改用用户消息中的原始文件路径');
    expect(serialized).toContain('pdftotext');
    expect(serialized).toContain('已提取的题目正文');
    expect(serialized).not.toContain('JVBERi0=');
  });
  it('保留 Skill 工具定义、调用、工具结果和推理内容', () => {
    const out = anthropicToOpenAIRequest(request({ messages: [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'fixture-reasoning' }, { type: 'tool_use', id: 't', name: 'Skill', input: { skill: 'nature-figure' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'fixture-skill-body' }] },
    ], tools: [{ name: 'Skill', input_schema: { type: 'object' } }] }));
    expect(out.messages[0].reasoning_content).toBe('fixture-reasoning');
    expect(out.messages[0].tool_calls?.[0].function.name).toBe('Skill');
    expect(out.messages[1].content).toBe('fixture-skill-body');
    expect(out.tools).toHaveLength(1);
  });
  it.each([['low', 'low'], ['medium', 'high'], ['high', 'high'], ['xhigh', 'max'], ['max', 'max']])('DeepSeek 档位 %s → %s', (effort, expected) => {
    const req = request(), out = anthropicToOpenAIRequest(req);
    applyReasoning(out, req, { openaiBaseUrl: provider.baseUrl, apiKey: '', effort });
    expect(out.reasoning_effort).toBe(expected); expect(out.thinking?.type).toBe('enabled');
  });
  it('关闭思考不发送努力档位', () => {
    const req = request(), out = anthropicToOpenAIRequest(req);
    applyReasoning(out, req, { openaiBaseUrl: provider.baseUrl, apiKey: '', effort: 'max', disableThinking: true });
    expect(out.thinking?.type).toBe('disabled'); expect(out.reasoning_effort).toBeUndefined();
  });
  it('SSE 回传输入用量、思考与被分片的工具名称', () => {
    const encoder = new AnthropicStreamEncoder('fixture');
    const chunks = [
      { choices: [{ delta: { reasoning_content: 'fixture' } }] },
      { choices: [{ delta: { content: '开始' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'Sk', arguments: '{"skill":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'ill', arguments: '"nature-figure"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 45 } },
    ];
    const e = events(chunks.map(c => encoder.handleChunk(c)).join('') + encoder.finish());
    expect(e.find(x => x.type === 'message_delta').usage).toEqual({ input_tokens: 1200, output_tokens: 45 });
    expect(e.some(x => x.delta?.type === 'thinking_delta')).toBe(true);
    expect(e.find(x => x.content_block?.type === 'tool_use').content_block.name).toBe('Skill');
  });
  it('用户连接器按名称传递且尊重停用状态', () => {
    expect(userMcpOptions([{ name: 'one', transport: 'http', url: 'https://example.org/mcp' }, { name: 'off', transport: 'stdio', enabled: false }]))
      .toEqual({ one: { type: 'http', url: 'https://example.org/mcp', headers: undefined } });
    expect(() => userMcpOptions([{ name: 'broken', transport: 'stdio' }])).toThrow('启动命令');
  });
  it('原版 DeepSeek 长上下文映射只作用于匹配端点', () => {
    expect(sdkModel({ ...provider, apiFormat: 'anthropic', baseUrl: 'https://api.deepseek.com/anthropic' }, 'deepseek-v4-flash')).toBe('deepseek-v4-flash[1m]');
    expect(sdkModel(provider, 'deepseek-flash')).toBe('deepseek-flash[1m]');
  });
  it('专业子智能体有 Skill，同时保留各自工具权限边界', () => {
    for (const agent of Object.values(MODELING_AGENTS)) expect(agent.tools).toContain('Skill');
    expect(MODELING_AGENTS['paper-reviewer'].tools).not.toContain('Write');
  });
  it('每个角色的提示词绑定专属技能清单并强制优先调用技能', () => {
    for (const [id, agent] of Object.entries(MODELING_AGENTS)) {
      const hint = ROLE_SKILL_HINTS[id];
      expect(hint, `${id} 缺少常用技能清单`).toBeTruthy();
      expect(agent.prompt, `${id} 提示词未注入技能清单`).toContain(hint);
      expect(agent.prompt).toContain('必须实际调用该技能');
    }
    // 与 session.ts 协作组映射同源的抽查：求解员绑定算法库与选型，绘图员绑定用户点名的绘图技能
    expect(ROLE_SKILL_HINTS['model-solver']).toContain('modeling-algorithms');
    expect(ROLE_SKILL_HINTS['figure-maker']).toContain('scipilot-figure-skill');
    expect(ROLE_SKILL_HINTS['figure-maker']).toContain('academic-figures');
  });
  it('项目技能独立加载并保留全局配置隔离', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mm-core-test-')); dirs.push(dir);
    const cwd = join(dir, 'project'), skill = join(cwd, '.claude/skills/local-test');
    mkdirSync(skill, { recursive: true }); writeFileSync(join(skill, 'SKILL.md'), '---\nname: local-test\ndescription: test\n---\nfixture');
    const plugin = projectSkillsPlugin(cwd, join(dir, 'storage'));
    expect(plugin).toContain('project-skills-plugins');
    expect(projectSkillsPlugin(cwd, join(dir, 'storage'))).toBe(plugin);
    writeFileSync(join(cwd, 'AGENTS.md'), '项目约定'); writeFileSync(join(cwd, 'CLAUDE.md'), '补充约定');
    expect(workspaceInstructions(cwd)).toContain('项目约定'); expect(workspaceInstructions(cwd)).toContain('补充约定');
  });
  it('统计分开入口、Skill、Agent、连接器，超过20类仍计算总数', () => {
    const rows = [
      { session_id: 's', role: 'user', blocks: JSON.stringify([{ kind: 'text', text: '/mma-paper 写论文' }]) },
      { session_id: 's', role: 'assistant', blocks: JSON.stringify([
        { kind: 'tool_use', toolName: 'Agent', toolInput: { subagent_type: 'general-purpose' } },
        { kind: 'tool_use', toolName: 'mcp__test__search' },
        ...Array.from({ length: 25 }, (_, i) => ({ kind: 'tool_use', toolName: 'Skill', toolUseId: `t${i}`, toolInput: { skill: `mathmodel:skill-${i}` } })),
      ]) },
    ];
    const result = aggregateCapabilityUsage([...rows, rows[1]]);
    expect(result.skillEntryCount).toBe(1); expect(result.skillLoadCount).toBe(25);
    expect(result.skillsExplored).toBe(26); expect(result.bySkill.some(x => x.name === 'general-purpose')).toBe(false);
    expect(result.agentRuns).toBe(2); expect(result.connectorRuns).toBe(2);
  });
});

async function serve(handler: RequestListener) {
  const s = createServer(handler); servers.push(s);
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
describe('真实本地HTTP链路，无外部API', () => {
  it('选择第二个模型真正发第二个，多路模型共存，计数不误发生成', async () => {
    const bodies: any[] = [];
    const url = await serve(async (req, res) => {
      let body = ''; for await (const c of req) body += c;
      bodies.push(JSON.parse(body)); res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { content: '完成' }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 2 } }));
    });
    const r = new BridgeRegistry(); registries.push(r);
    const a = await r.ensureFor({ ...provider, baseUrl: url }, { model: 'selected' });
    const b = await r.ensureFor({ ...provider, baseUrl: url }, { model: 'first' });
    expect(a).not.toBe(b);
    for (const endpoint of [a, b, a]) expect((await fetch(`${endpoint}/v1/messages`, { method: 'POST', body: JSON.stringify(request()) })).ok).toBe(true);
    expect(bodies.map(b => b.model)).toEqual(['selected', 'first', 'selected']);
    const count = await fetch(`${a}/v1/messages/count_tokens`, { method: 'POST', body: '{}' });
    expect(count.status).toBe(501); expect(bodies).toHaveLength(3);
  });
  it('CRLF与末尾没有空行的流也能回传真实用量', async () => {
    const url = await serve((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"choices":[{"delta":{"content":"完成"}}]}\r\n\r\n');
      res.end('data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":5}}');
    });
    const r = new BridgeRegistry(); registries.push(r);
    const endpoint = await r.ensureFor({ ...provider, baseUrl: url }, { model: 'selected' });
    const response = await fetch(`${endpoint}/v1/messages`, { method: 'POST', body: JSON.stringify(request({ stream: true })) });
    expect(events(await response.text()).find(e => e.type === 'message_delta').usage.input_tokens).toBe(123);
  });
  it('客户端停止使上游连接关闭', async () => {
    let closed = false;
    const url = await serve((_req, res) => {
      res.setHeader('content-type', 'text/event-stream');
      res.write('data: {"choices":[{"delta":{"content":"正在计算"}}]}\n\n');
      res.on('close', () => { closed = true; });
    });
    const r = new BridgeRegistry(); registries.push(r);
    const endpoint = await r.ensureFor({ ...provider, baseUrl: url }, { model: 'selected' });
    const controller = new AbortController();
    const response = await fetch(`${endpoint}/v1/messages`, { method: 'POST', body: JSON.stringify(request({ stream: true })), signal: controller.signal });
    await response.body!.getReader().read(); controller.abort();
    await vi.waitFor(() => expect(closed).toBe(true), { timeout: 2000 });
  });
});
