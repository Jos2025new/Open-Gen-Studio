import { PROVIDER_LABELS, parseModelRef } from '../providers/types';
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

/** A schema or model-list load that takes longer than this is named in the activity block (it is never cut). */
export const WAIT_MS = 3000;
interface Watcher { say: (ref: string) => void; waits?: WaitHooks }
const watchers = new Map<string, Watcher>();

type Resolved = { model: ModelSummary; schema: ModelSchema } | null;

/** The model lookup of a session's plan check, telling the watcher when one ref takes longer than WAIT_MS and each schema load it makes (cached schemas are no wait). */
export function watchModel(sessionId: string, lookup: (ref: string) => Promise<Resolved>): (ref: string) => Promise<Resolved> {
  return (ref) => {
    const watch = watchers.get(sessionId);
    if (!watch) return lookup(ref);
    const cached = useStore.getState().catalog.schemas[ref];
    const loads = !cached || cached.source === 'derived';
    const name = modelSummary(ref)?.name ?? ref.split('::').pop() ?? ref;
    const timer = setTimeout(() => watch.say(ref), WAIT_MS);
    const started = Date.now();
    if (loads) watch.waits?.begin(ref, name);
    const work = lookup(ref);
    return work.then(
      (r) => {
        clearTimeout(timer);
        if (loads) watch.waits?.end(ref, name, r != null && r.schema.source !== 'derived', Date.now() - started);
        return r;
      },
      (err: unknown) => {
        clearTimeout(timer);
        if (loads) watch.waits?.end(ref, name, false, Date.now() - started);
        throw err;
      },
    );
  };
}

export function waitLabel(ref: string): string {
  const parsed = parseModelRef(ref);
  const from = parsed ? PROVIDER_LABELS[parsed.provider] : 'the provider';
  return `Waiting for ${from} to send the parameters of ${modelSummary(ref)?.name ?? ref}…`;
}

/** Runs the plan check stoppable, and names what it waits for once it is slow. Schema loads are reported through `waits` while the check runs. */
export async function checkingPlan<T>(sessionId: string, signal: AbortSignal, say: (label: string) => void, run: () => Promise<T>, waits?: WaitHooks): Promise<T> {
  // A late continuation after Stop writes nothing: the turn no longer has its activity block or pending marks.
  const live = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => { if (!signal.aborted) f(...a); };
  watchers.set(sessionId, {
    say: live((ref: string) => say(waitLabel(ref))),
    waits: waits && { begin: live(waits.begin), end: live(waits.end) },
  });
  try {
    return await untilStopped(run(), signal);
  } finally {
    watchers.delete(sessionId);
  }
}
