import { useSyncExternalStore } from 'react';
import { useStore } from '../store/store';
import type { Generation } from './types';

/*
 * The live trace of each generation: every status the provider loop reports (submitting, each poll, retries) and how
 * it ended. Kept in memory only — a poll every few seconds never becomes a disk write — so it starts again after a
 * reload. Shown in Details → Trace and read by the agent's generation_status tool.
 */

export interface TraceEntry {
  at: number;
  text: string;
  progress?: number;
}

const MAX_ENTRIES = 60;
const MAX_GENERATIONS = 40;
const EMPTY: TraceEntry[] = [];
const traces = new Map<string, TraceEntry[]>();
const listeners = new Set<() => void>();

export function recordTrace(id: string, text: string, progress?: number, at = Date.now()): void {
  const list = traces.get(id) ?? EMPTY;
  if (list.at(-1)?.text === text) return;
  // Re-inserted so the generation followed longest ago is the first one dropped.
  traces.delete(id);
  traces.set(id, [...list, { at, text, ...(progress != null ? { progress } : {}) }].slice(-MAX_ENTRIES));
  if (traces.size > MAX_GENERATIONS) traces.delete(traces.keys().next().value!);
  for (const l of [...listeners]) l();
}

export function traceOf(id: string): TraceEntry[] {
  return traces.get(id) ?? EMPTY;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useJobTrace(id: string | undefined): TraceEntry[] {
  return useSyncExternalStore(subscribe, () => (id ? traceOf(id) : EMPTY));
}

const END: Partial<Record<Generation['status'], string>> = { done: 'Done', canceled: 'Canceled', error: 'Failed' };

/** A new status text, or the end of a generation, becomes a trace line. */
export function diffTrace(prev: Record<string, Generation>, next: Record<string, Generation>, now = Date.now()): void {
  for (const id in next) {
    const g = next[id];
    const p = prev[id];
    if (g === p) continue;
    if (g.statusText && g.statusText !== p?.statusText) recordTrace(id, g.statusText, g.progress, now);
    else if (p && p.status !== g.status && END[g.status]) recordTrace(id, g.status === 'error' && g.error ? `Failed · ${g.error}` : END[g.status]!, undefined, now);
  }
}

let stop: (() => void) | undefined;
/** Follows the store from app start; only a change to the generations is looked at (one reference check otherwise). */
export function startJobTrace(): void {
  stop ??= useStore.subscribe((s, prev) => {
    if (s.generations !== prev.generations) diffTrace(prev.generations, s.generations);
  });
}
