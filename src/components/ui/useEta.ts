import { useMemo } from 'react';
import { useStore } from '../../store/store';
import { etaIndex, etaKey, etaLabel } from '../../engine/eta';
import type { Generation } from '../../engine/types';
import { useNow } from './hooks';

/** The typical-duration line for a running generation that reports no progress of its own; null otherwise. Looked up once per generation, not per tick. */
export function useEta(g: Pick<Generation, 'id' | 'kind' | 'modelRef' | 'op' | 'status' | 'progress' | 'startedAt'> | undefined): string | null {
  const active = !!g && g.status === 'running' && g.progress == null && g.startedAt != null;
  const key = g ? etaKey(g) : '';
  const typical = useMemo(() => (active ? etaIndex(useStore.getState().generations).get(key) ?? null : null), [active, key, g?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const now = useNow(1000, active && typical != null);
  return active && typical != null ? etaLabel(typical, now - g!.startedAt!) : null;
}
