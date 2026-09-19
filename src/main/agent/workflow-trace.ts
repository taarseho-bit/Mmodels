import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { chineseAgentName, workflowToolLabel, type WorkflowNode, type WorkflowRun, type WorkflowStatus } from '@shared/workflow';

/** 纯观察器：空 hook 返回值不改变审批、工具参数或模型结果。 */
export class WorkflowTrace {
  readonly run: WorkflowRun;
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new Map<string, { role: string; owner: string }>();
  constructor(sessionId: string, enabled: boolean, private publish: (run: WorkflowRun) => void) {
    const now = Date.now();
    this.run = { id: randomUUID(), sessionId, startedAt: now, updatedAt: now, revision: 0,
      status: 'running', collaborationEnabled: enabled, truncated: false, nodes: [] };
    this.node('main', 'main');
    this.flush();
  }
  private node(id: string, type: string, description = ''): WorkflowNode | undefined {
    const previous = this.run.nodes.find(n => n.id === id);
    if (previous) return previous;
    if (this.run.nodes.length >= 40) { this.run.truncated = true; return; }
    const base = chineseAgentName(type, description);
    const count = this.run.nodes.filter(n => n.name === base || n.name.startsWith(`${base} · `)).length;
    const name = count ? `${base} · ${count + 1}` : base;
    const node: WorkflowNode = { id, agentType: type, name, status: 'running', tools: [], startedAt: Date.now() };
    this.run.nodes.push(node);
    return node;
  }
  private flush(): void {
    clearTimeout(this.timer); this.timer = undefined;
    this.run.updatedAt = Date.now(); this.run.revision++;
    // 演示记录不可影响解题；快照也不能被后续事件原地修改。
    try { this.publish(structuredClone(this.run)); } catch { /* 记录不可用时仍允许任务继续 */ }
  }
  private changed(): void {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), 250);
  }
  readonly hook: HookCallback = async (input, toolUseID) => {
    if (this.run.status !== 'running') return {};
    try { this.observe(input, toolUseID); this.changed(); } catch { /* 观察失败不得打断工具执行 */ }
    return {};
  };
  private observe(input: HookInput, toolUseID?: string): void {
    const event = input.hook_event_name;
    if (event === 'UserPromptExpansion') {
      const node = this.node(input.agent_id || 'main', input.agent_id ? input.agent_type ?? '' : 'main');
      if (!node) return;
      if (this.run.nodes.reduce((n, entry) => n + entry.tools.length, 0) >= 500) { this.run.truncated = true; return; }
      const command = input.command_name.replace(/^\//, '').slice(0, 100);
      node.tools.push({ id: randomUUID(), name: command, label: `载入入口指令 · ${workflowToolLabel('Skill', command)}`,
        status: 'completed', startedAt: Date.now(), endedAt: Date.now() });
      return;
    }
    if (event === 'SubagentStart') {
      // toolUseID 缺失时不按类型/时间猜测身份，两个同类智能体也保持独立。
      const request = toolUseID ? this.requests.get(toolUseID) : undefined;
      const node = this.node(input.agent_id, input.agent_type, request?.role);
      if (node && request && request.owner !== node.id) node.parentId = request.owner;
      return;
    }
    if (event === 'SubagentStop') {
      const node = this.node(input.agent_id, input.agent_type);
      if (node) { node.status = 'returned'; node.endedAt = Date.now();
        for (const tool of node.tools) if (tool.status === 'running') tool.status = 'unknown'; }
      return;
    }
    if (event !== 'PreToolUse' && event !== 'PostToolUse' && event !== 'PostToolUseFailure') return;
    const owner = input.agent_id || 'main';
    const node = this.node(owner, owner === 'main' ? 'main' : input.agent_type ?? '');
    if (!node) return;
    const data = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
    if (event === 'PreToolUse' && /^(Agent|Task)$/.test(input.tool_name) && this.requests.size < 80) {
      // 仅保留短中文角色名，不保存派发任务正文。
      const description = typeof data.description === 'string' ? data.description : '';
      this.requests.set(input.tool_use_id, { role: description.match(/角色名[：:]\s*[\u3400-\u9fff]{2,12}/)?.[0] ?? '', owner });
    }
    let tool = node.tools.find(t => t.id === input.tool_use_id);
    if (!tool) {
      if (this.run.nodes.reduce((n, entry) => n + entry.tools.length, 0) >= 500) { this.run.truncated = true; return; }
      const skill = input.tool_name === 'Skill' && typeof data.skill === 'string' ? data.skill.slice(0, 100) : undefined;
      tool = { id: input.tool_use_id, name: input.tool_name.slice(0, 100), label: workflowToolLabel(input.tool_name, skill),
        skill, status: 'running', startedAt: Date.now() };
      if (typeof data.description === 'string' && /[\u3400-\u9fff]/.test(data.description)) {
        tool.action = data.description.replace(/[\r\n]+/g, ' ').slice(0, 100);
      }
      node.tools.push(tool);
    }
    if (event === 'PostToolUse') {
      tool.status = 'completed'; tool.endedAt = Date.now();
      if (/^(Write|Edit|NotebookEdit)$/.test(input.tool_name)) {
        const file = data.file_path ?? data.notebook_path;
        if (typeof file === 'string') tool.artifact = file.slice(0, 1024);
      }
    }
    if (event === 'PostToolUseFailure') { tool.status = input.is_interrupt ? 'stopped' : 'unsuccessful'; tool.endedAt = Date.now(); }
  }
  finish(status: Exclude<WorkflowStatus, 'running'>): void {
    if (this.run.status !== 'running') return;
    this.run.status = status;
    for (const node of this.run.nodes) {
      if (node.status === 'running') node.status = status === 'completed' && node.id === 'main' ? 'returned' : status === 'stopped' ? 'stopped' : 'unknown';
      node.endedAt ??= Date.now();
      for (const tool of node.tools) if (tool.status === 'running') { tool.status = status === 'stopped' ? 'stopped' : 'unknown'; tool.endedAt = Date.now(); }
    }
    this.flush(); this.requests.clear();
  }
}
