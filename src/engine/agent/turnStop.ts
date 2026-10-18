import { modelSummary } from '../catalog';
import { useStore } from '../../store/store';
import type { ModelSchema, ModelSummary } from '../types';
import type { WaitHooks } from './schemaWait';

/**
 * Stop must free the composer whatever the turn awaits (a stream, a schema load, a tool). The turn's awaits are
 * raced against its AbortSignal: on abort the race rejects with an AbortError and the turn's own abort path
 * unwinds. The awaited work may go on in the background (a schema fetch fills the cache); a continuation that
 * writes checks `signal.aborted` first and does nothing.
 */
export function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    work.catch(() => undefined);
    return Promise.reject(new DOMException('Stopped', 'AbortError'));
  }
  return new Promise<T>((resolve, reject) => {
    const stop = () => reject(new DOMException('Stopped', 'AbortError'));
    signal.addEventListener('abort', stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

interface Watcher { waits?: WaitHooks }
const watchers = new Map<string, Watcher>();

type Resolved = { model: ModelSummary; schema: ModelSchema } | null;

/** The model lookup of a session's plan check, telling the watcher about each schema load it makes (cached schemas are no wait). */
export function watchModel(sessionId: string, lookup: (ref: string) => Promise<Resolved>): (ref: string) => Promise<Resolved> {
  return (ref) => {
    const watch = watchers.get(sessionId);
    if (!watch) return lookup(ref);
    const cached = useStore.getState().catalog.schemas[ref];
    const loads = !cached || cached.source === 'derived';
    const name = modelSummary(ref)?.name ?? ref.split('::').pop() ?? ref;
    const started = Date.now();
    if (loads) watch.waits?.begin(ref, name);
    const work = lookup(ref);
    return work.then(
      (r) => {
        if (loads) watch.waits?.end(ref, name, r != null && r.schema.source !== 'derived', Date.now() - started);
        return r;
      },
      (err: unknown) => {
        if (loads) watch.waits?.end(ref, name, false, Date.now() - started);
        throw err;
      },
    );
  };
}

/** Runs the plan check stoppable, Schema loads, which are what it waits for, are reported through `waits` while the check runs. */
export async function checkingPlan<T>(sessionId: string, signal: AbortSignal, run: () => Promise<T>, waits?: WaitHooks): Promise<T> {
  // A late continuation after Stop writes nothing: the turn no longer has its activity block or pending marks.
  const live = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (!signal.aborted) f(...a); };
  watchers.set(sessionId, {
    waits: waits && { begin: live(waits.begin), end: live(waits.end) },
  });
  try {
    return await untilStopped(run(), signal);
  } finally {
    watchers.delete(sessionId);
  }
}
