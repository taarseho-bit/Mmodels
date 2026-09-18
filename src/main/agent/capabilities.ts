/** Latest verified SDK registration, not a guess based on directories. No credentials. */
export interface RuntimeCapabilities {
  sessionId: string;
  model: string;
  skills: string[];
  tools: string[];
  mcpServers: { name: string; status: string }[];
  checkedAt: number;
}
const sessions = new Map<string, RuntimeCapabilities>();
export function recordCapabilities(value: RuntimeCapabilities): void {
  const previous = sessions.get(value.sessionId);
  if (!value.skills.length && previous) value.skills = previous.skills;
  sessions.delete(value.sessionId);
  sessions.set(value.sessionId, value);
  if (sessions.size > 100) sessions.delete(sessions.keys().next().value!);
}
export function getCapabilities(sessionId?: string): RuntimeCapabilities | null {
  return sessionId ? sessions.get(sessionId) ?? null : [...sessions.values()].at(-1) ?? null;
}
