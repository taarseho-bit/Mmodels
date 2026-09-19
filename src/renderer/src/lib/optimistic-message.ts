import type { ChatMessage } from '@shared/types';

/** Keep a just-sent bubble while session creation/history reads are still in flight. */
export function withPendingMessage(history: ChatMessage[], pending: ChatMessage | null): ChatMessage[] {
  if (!pending) return history;
  const text = pending.blocks.map(b => b.text ?? '').join('');
  const persisted = history.some(m => m.role === 'user' && m.createdAt >= pending.createdAt
    && m.blocks.map(b => b.text ?? '').join('') === text);
  return persisted ? history : [...history, pending];
}
