/** Local to one mounted chat page. Typing notifies the composer, never the message history. */
export function createComposerDraft() {
  let value = '';
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => value,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set: (next: string) => { if (next === value) return; value = next; listeners.forEach(listener => listener()); },
  };
}
