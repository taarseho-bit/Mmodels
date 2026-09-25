import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { chineseAgentName, taskAgentAssignment, taskAgentName, workflowToolLabel, type WorkflowNode, type WorkflowRun, type WorkflowStatus } from '@shared/workflow';

/** 纯观察器：空 hook 返回值不改变审批、工具参数或模型结果。 */
export class WorkflowTrace {
  readonly run: WorkflowRun;
  private timer?: ReturnType<typeof setTimeout>;
  private requests = new Map<string, { name: string; owner: string; assignment?: string }>();
  private linkedRequests = new Set<string>();
  private toolOwners = new Map<string, string>();
  private toolParents = new Map<string, string>();
  private agentAliases = new Map<string, string>();
  private connect(owner: string, dispatch: string): void {
    const request = this.requests.get(dispatch), node = this.run.nodes.find(n => n.id === owner);
    if (!request || !node || owner === 'main' || owner === request.owner) return;
    node.parentId = request.owner;
    if (request.name) this.rename(node, request.name);
    node.assignment ??= request.assignment;
    this.linkedRequests.add(dispatch);
  }
  /** SDK 消息携带真实 parent_tool_use_id；与 hook 的工具标识双向对账，不按启动时间猜。 */
  observeMessage(value: unknown): void {
    if (this.run.status !== 'running' || !value || typeof value !== 'object') return;
    const m = value as Record<string, any>;
    if (typeof m.parent_tool_use_id !== 'string') return;
    const ids: string[] = m.type === 'tool_progress' ? [m.tool_use_id]
      : m.type === 'assistant' && Array.isArray(m.message?.content) ? m.message.content.filter((b: any) => b.type === 'tool_use').map((b: any) => b.id) : [];
    for (const id of ids) {
      if (typeof id !== 'string' || this.toolParents.size >= 500) continue;
      this.toolParents.set(id, m.parent_tool_use_id);
      const owner = this.toolOwners.get(id); if (owner) this.connect(owner, m.parent_tool_use_id);
    }
    if (ids.length) this.changed();
  }
  constructor(
    sessionId: string,
    private readonly collaborationEnabled: boolean,
    private publish: (run: WorkflowRun) => void,
    private readonly maxParallelAgents = 2,
    private readonly maxTotalAgents = 4,
    workflowStages?: string[],
  ) {
    const now = Date.now();
    this.run = { id: randomUUID(), sessionId, startedAt: now, updatedAt: now, revision: 0,
      status: 'running', collaborationEnabled: this.collaborationEnabled, truncated: false, nodes: [],
      workflowStages: workflowStages?.length ? workflowStages.slice(0, 8) : ['了解问题', '研究与计算', '核对结果', '整理交付'],
      currentStage: 0, stageStatus: 'running' };
    this.node('main', 'main');
    this.flush();
  }
  private node(id: string, type: string, description = ''): WorkflowNode | undefined {
    const previous = this.run.nodes.find(n => n.id === id);
    if (previous) return previous;
    if (this.run.nodes.length >= 40) { this.run.truncated = true; return; }
    const name = chineseAgentName(type, description);
    const node: WorkflowNode = { id, agentType: type, name, status: 'running', tools: [], startedAt: Date.now() };
    this.run.nodes.push(node);
    return node;
  }
  private rename(node: WorkflowNode, base: string): void {
    node.name = base;
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
    try {
      const decision = this.observe(input, toolUseID);
      this.changed();
      return decision;
    } catch {
      /* 观察失败不得打断工具执行 */
      return {};
    }
  };
  private activeCollaboratorCount(): number {
    const runningNodes = this.run.nodes.filter(node => node.id !== 'main' && node.status === 'running').length;
    const pendingDispatches = [...this.requests.keys()].filter(id => !this.linkedRequests.has(id)).length;
    return runningNodes + pendingDispatches;
  }
  /** 由真实工具活动推进阶段，不读取工具参数正文，也不猜成员关系。 */
  private advanceStage(toolName: string, skill?: string): void {
    const stages = this.run.workflowStages ?? [];
    if (!stages.length) return;
    const value = `${toolName} ${skill ?? ''}`.toLowerCase();
    let next = 0;
    if (/review|audit|page-fit|delivery|终审|核验|复核/.test(value)) next = stages.length - 1;
    else if (/write|edit|notebook|paper|figure|diagram|polish|论文|图表/.test(value)) next = Math.min(2, stages.length - 1);
    else if (/bash|python|计算|model|solve|optimization|求解/.test(value)) next = Math.min(1, stages.length - 1);
    this.run.currentStage = Math.max(this.run.currentStage ?? 0, next);
  }
  private observe(input: HookInput, toolUseID?: string): Record<string, unknown> {
    const event = input.hook_event_name;
    if (event === 'UserPromptExpansion') {
      const node = this.node(input.agent_id || 'main', input.agent_id ? input.agent_type ?? '' : 'main');
      if (!node) return {};
      if (this.run.nodes.reduce((n, entry) => n + entry.tools.length, 0) >= 500) { this.run.truncated = true; return {}; }
      const command = input.command_name.replace(/^\//, '').slice(0, 100);
      node.tools.push({ id: randomUUID(), name: command, label: `载入入口指令 · ${workflowToolLabel('Skill', command)}`,
        skill: command, skillSource: 'entry',
        status: 'completed', startedAt: Date.now(), endedAt: Date.now() });
      return {};
    }
    if (event === 'SubagentStart') {
      // SDK 偶尔不带 toolUseID；只有恰好一条尚未关联的派发时才补回身份，多条并行时仍不猜。
      let requestId = toolUseID && this.requests.has(toolUseID) ? toolUseID : undefined;
      if (!requestId) {
        const pending = [...this.requests.keys()].filter(id => !this.linkedRequests.has(id));
        if (pending.length === 1) requestId = pending[0];
      }
      const request = requestId ? this.requests.get(requestId) : undefined;
      const node = this.node(input.agent_id, input.agent_type);
      if (node && request && request.owner !== node.id) {
        node.parentId = request.owner;
        this.rename(node, request.name);
        node.assignment ??= request.assignment;
        this.linkedRequests.add(requestId!);
      }
      return {};
    }
    if (event === 'SubagentStop') {
      const node = this.node(input.agent_id, input.agent_type);
      if (node) { node.status = 'returned'; node.endedAt = Date.now();
        for (const tool of node.tools) if (tool.status === 'running') tool.status = 'unknown'; }
      return {};
    }
    if (event !== 'PreToolUse' && event !== 'PostToolUse' && event !== 'PostToolUseFailure') return {};
    if (event === 'PreToolUse' && /^(Agent|Task)$/.test(input.tool_name) && this.collaborationEnabled && this.activeCollaboratorCount() >= this.maxParallelAgents) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `本轮已达到 ${this.maxParallelAgents} 位协作成员的并行上限，请复用已完成成员或由主助手继续。`,
        },
      };
    }
    if (event === 'PreToolUse' && /^(Agent|Task)$/.test(input.tool_name) && this.collaborationEnabled && this.requests.size >= this.maxTotalAgents) {
      return {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `本轮协作预算已用完（最多 ${this.maxTotalAgents} 位成员），请复用已有成员或由主助手继续。`,
        },
      };
    }
    const owner = input.agent_id || 'main';
    const node = this.node(owner, owner === 'main' ? 'main' : input.agent_type ?? '');
    if (!node) return {};
    if (this.toolOwners.size < 500) this.toolOwners.set(input.tool_use_id, owner);
    const dispatch = this.toolParents.get(input.tool_use_id);
    if (dispatch) this.connect(owner, dispatch);
    const data = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input as Record<string, unknown> : {};
    if (event === 'PreToolUse' && /^(Agent|Task)$/.test(input.tool_name) && this.requests.size < 80) {
      // 从真实派发任务生成短中文名称；只存名称，不保存派发正文或内部提示词。
      const description = typeof data.description === 'string' ? data.description : '';
      const prompt = typeof data.prompt === 'string' ? data.prompt : '';
      const name = taskAgentName(description) ?? taskAgentName(prompt)
        ?? chineseAgentName(typeof data.subagent_type === 'string' ? data.subagent_type : 'general-purpose');
      this.requests.set(input.tool_use_id, { name, owner, assignment: taskAgentAssignment(description) });
    }
    let tool = node.tools.find(t => t.id === input.tool_use_id);
    if (!tool) {
      if (this.run.nodes.reduce((n, entry) => n + entry.tools.length, 0) >= 500) { this.run.truncated = true; return {}; }
      const skill = input.tool_name === 'Skill' && typeof data.skill === 'string' ? data.skill.slice(0, 100) : undefined;
      tool = { id: input.tool_use_id, name: input.tool_name.slice(0, 100), label: workflowToolLabel(input.tool_name, skill),
        skill, status: 'running', startedAt: Date.now() };
      if (typeof data.description === 'string' && /[\u3400-\u9fff]/.test(data.description)) {
        tool.action = data.description.replace(/[\r\n]+/g, ' ').slice(0, 100);
        if (node.id !== 'main') node.assignment ??= taskAgentAssignment(data.description);
      }
      node.tools.push(tool);
    }
    this.advanceStage(input.tool_name, tool.skill);
    if (event === 'PostToolUse') {
      tool.status = 'completed'; tool.endedAt = Date.now();
      if (/^(Agent|Task)$/.test(input.tool_name) && input.tool_response && typeof input.tool_response === 'object') {
        const response = input.tool_response as Record<string, unknown>;
        const childId = response.agentId ?? response.agent_id;
        if (typeof childId === 'string' && childId.length < 150) {
          this.node(childId, typeof data.subagent_type === 'string' ? data.subagent_type : 'general-purpose');
          this.connect(childId, input.tool_use_id);
          if (typeof data.name === 'string') this.agentAliases.set(data.name, childId);
        }
      }
      if (input.tool_name === 'SendMessage') {
        const recipient = data.recipient ?? data.target_agent_id;
        const target = typeof recipient === 'string' ? this.agentAliases.get(recipient) ?? recipient : '';
        if (target !== owner && this.run.nodes.some(n => n.id === target)) {
          const links = this.run.exchanges ??= [];
          if (links.length < 80 && !links.some(l => l.id === tool!.id)) links.push({ id: tool.id, source: owner, target });
        }
      }
      if (input.tool_name === 'Read' && typeof data.file_path === 'string') {
        const match = data.file_path.replace(/\\/g, '/').match(/\/skills\/([^/]+)\/SKILL\.md$/i);
        if (match) { tool.skill = match[1]; tool.skillSource = 'read'; tool.label = `参考技能 · ${workflowToolLabel('Skill', match[1])}`; }
      }
      if (/^(Write|Edit|NotebookEdit)$/.test(input.tool_name)) {
        const file = data.file_path ?? data.notebook_path;
        if (typeof file === 'string') tool.artifact = file.slice(0, 1024);
      }
    }
    if (event === 'PostToolUseFailure') { tool.status = input.is_interrupt ? 'stopped' : 'unsuccessful'; tool.endedAt = Date.now(); }
    return {};
  }
  finish(status: Exclude<WorkflowStatus, 'running'>): void {
    if (this.run.status !== 'running') return;
    this.run.status = status;
    this.run.stageStatus = 'completed';
    for (const node of this.run.nodes) {
      if (node.status === 'running') node.status = status === 'completed' && node.id === 'main' ? 'returned' : status === 'stopped' ? 'stopped' : 'unknown';
      node.endedAt ??= Date.now();
      for (const tool of node.tools) if (tool.status === 'running') { tool.status = status === 'stopped' ? 'stopped' : 'unknown'; tool.endedAt = Date.now(); }
    }
    this.flush(); this.requests.clear(); this.linkedRequests.clear(); this.toolOwners.clear(); this.toolParents.clear(); this.agentAliases.clear();
  }
}
