import { PROVIDER_LABELS, parseModelRef } from '../providers/types';
import { modelSummary } from '../catalog';

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
const slow = new Map<string, (ref: string) => void>();

/** The model lookup of a session's plan check, telling the watcher when one ref takes longer than WAIT_MS. */
export function watchModel<R>(sessionId: string, lookup: (ref: string) => Promise<R>): (ref: string) => Promise<R> {
  return (ref) => {
    const work = lookup(ref);
    const say = slow.get(sessionId);
    if (!say) return work;
    const timer = setTimeout(() => say(ref), WAIT_MS);
    return work.finally(() => clearTimeout(timer));
  };
}

export function waitLabel(ref: string): string {
  const parsed = parseModelRef(ref);
  const from = parsed ? PROVIDER_LABELS[parsed.provider] : 'the provider';
  return `Waiting for ${from} to send the parameters of ${modelSummary(ref)?.name ?? ref}…`;
}

/** Runs the plan check stoppable, and names what it waits for once it is slow. */
export async function checkingPlan<T>(sessionId: string, signal: AbortSignal, say: (label: string) => void, run: () => Promise<T>): Promise<T> {
  slow.set(sessionId, (ref) => { if (!signal.aborted) say(waitLabel(ref)); });
  try {
    return await untilStopped(run(), signal);
  } finally {
    slow.delete(sessionId);
  }
}
