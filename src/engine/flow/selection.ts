import { create } from 'zustand';

/* Node canvas selection, shared with the agent. Kept out of the persisted store:
   selecting nodes must never trigger a state save. */

interface SelectionState {
  bySession: Record<string, string[]>;
}

export const useNodeSelection = create<SelectionState>(() => ({ bySession: {} }));

export function setNodeSelection(sessionId: string, ids: Iterable<string>): void {
  const next = [...ids].sort();
  const prev = useNodeSelection.getState().bySession[sessionId] ?? [];
  if (prev.length === next.length && prev.every((id, i) => id === next[i])) return;
  useNodeSelection.setState((s) => ({ bySession: { ...s.bySession, [sessionId]: next } }));
}

export function nodeSelection(sessionId: string): string[] {
  return useNodeSelection.getState().bySession[sessionId] ?? [];
}
