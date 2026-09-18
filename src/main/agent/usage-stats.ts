import type { ContentBlock } from '@shared/types';
type Row = { session_id: string; role: string; blocks: string };
type Counter = Map<string, { runs: number; sessions: Set<string> }>;
export function aggregateCapabilityUsage(rows: Row[]) {
  const skills: Counter = new Map(), agents: Counter = new Map(), connectors: Counter = new Map();
  let entries = 0, loads = 0;
  const seenTools = new Set<string>();
  const controlCommands = new Set(['compact', 'clear', 'help', 'exit', 'quit', 'model', 'cost', 'context', 'status', 'resume', 'rewind', 'permissions', 'config', 'login', 'logout']);
  const canonical = (name: string) => name.trim().replace(/^\//, '').replace(/^mathmodel:/, '');
  const add = (map: Counter, name: string, session: string) => {
    const previous = map.get(name) ?? { runs: 0, sessions: new Set<string>() };
    previous.runs++; previous.sessions.add(session); map.set(name, previous);
  };
  for (const row of rows) {
    let blocks: ContentBlock[];
    try { blocks = JSON.parse(row.blocks); if (!Array.isArray(blocks)) continue; } catch { continue; }
    if (row.role === 'user') {
      const text = blocks.filter(b => b.kind === 'text').map(b => b.text ?? '').join('\n');
      const command = /^\s*\/((?:[\w-]+:)?[\w-]+)(?=\s|$)/.exec(text)?.[1];
      if (command && !controlCommands.has(command)) { entries++; add(skills, canonical(command), row.session_id); }
      continue;
    }
    for (const b of blocks) {
      if (b.kind !== 'tool_use') continue;
      const key = b.toolUseId ? `${row.session_id}:${b.toolUseId}` : null;
      if (key && seenTools.has(key)) continue;
      if (key) seenTools.add(key);
      const input = (b.toolInput ?? {}) as Record<string, unknown>;
      if (b.toolName === 'Skill') {
        loads++; add(skills, canonical(String(input.skill ?? input.command ?? '未命名技能')), row.session_id);
      } else if (b.toolName === 'Agent' || b.toolName === 'Task') {
        add(agents, String(input.subagent_type ?? input.agent ?? '通用子智能体'), row.session_id);
      } else if (b.toolName?.startsWith('mcp__')) add(connectors, b.toolName.split('__')[1], row.session_id);
    }
  }
  const list = (map: Counter) => [...map].map(([name, v]) => ({ name, runs: v.runs, sessions: v.sessions.size }))
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  const sum = (map: Counter) => [...map.values()].reduce((n, v) => n + v.runs, 0);
  return { bySkill: list(skills), byAgent: list(agents), byConnector: list(connectors),
    skillsExplored: skills.size, skillsUsed: loads, skillEntryCount: entries, skillLoadCount: loads,
    agentRuns: sum(agents), connectorRuns: sum(connectors) };
}
