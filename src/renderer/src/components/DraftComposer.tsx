import { useSyncExternalStore } from 'react';
import { Composer, type ComposerProps } from './Composer';
import type { createComposerDraft } from '../store/composer-draft';

export function DraftComposer({ draft, ...props }: Omit<ComposerProps, 'value' | 'onChange'> & {
  draft: ReturnType<typeof createComposerDraft>;
}): JSX.Element {
  const value = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  return <Composer {...props} value={value} onChange={draft.set} />;
}
