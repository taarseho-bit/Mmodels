import { describe, expect, it, vi } from 'vitest';
import { createComposerDraft } from './composer-draft';
import { withPendingMessage } from '../lib/optimistic-message';
import type { ChatMessage } from '@shared/types';

describe('即时输入与发送回显', () => {
  it('输入同步更新，只通知自己的输入框，不需要 IPC 或计时器', () => {
    const draft = createComposerDraft(), other = createComposerDraft();
    const listener = vi.fn(), otherListener = vi.fn();
    const off = draft.subscribe(listener); other.subscribe(otherListener);
    draft.set('中文输入');
    expect(draft.getSnapshot()).toBe('中文输入');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
    draft.set('中文输入'); expect(listener).toHaveBeenCalledTimes(1);
    off(); draft.set(''); expect(listener).toHaveBeenCalledTimes(1);
  });
  it('后台记录未返回时保留消息，落库后去重，不误吞同样内容的旧消息', () => {
    const pending: ChatMessage = { id: 'local', role: 'user', createdAt: 100, blocks: [{ kind: 'text', text: '继续' }] };
    expect(withPendingMessage([], pending)).toEqual([pending]);
    const old = { ...pending, id: 'old', createdAt: 90 };
    expect(withPendingMessage([old], pending)).toEqual([old, pending]);
    const persisted = [{ ...pending, id: 'saved', createdAt: 101 }];
    expect(withPendingMessage(persisted, pending)).toBe(persisted);
  });
});
