import type { ContentBlock } from './types';

/** Presentation is separate from execution. Never strip commands typed by the user. */
export function userTextBlock(prompt: string, displayText?: string): ContentBlock {
  return { kind: 'text', text: typeof displayText === 'string' ? displayText : prompt,
    ...(typeof displayText === 'string' && displayText !== prompt ? { modelText: prompt } : {}) };
}
