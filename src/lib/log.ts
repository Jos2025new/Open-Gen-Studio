import { safeData } from './debug';

/*
 * A line per event that matters, in the app's own data folder (T5): the local dev/preview server appends it to
 * data/logs/app.log. Without that server (a static build) there is nowhere to write and nothing happens: this
 * never blocks the app and never throws. Keys never reach a line (see lib/debug).
 */

export type LogKind = 'provider-error' | 'retry' | 'harness' | 'save-conflict' | 'agent' | 'app';

/** Serialized so lines arrive in order even when several come at once. */
let chain: Promise<void> = Promise.resolve();

export function logEvent(kind: LogKind, data: Record<string, unknown>): void {
  const line = JSON.stringify({ at: new Date().toISOString(), kind, data: safeData(data) }).slice(0, 4000);
  chain = chain
    .then(() =>
      fetch('/x/store/log', {
        method: 'POST',
        body: line,
        headers: { 'Content-Type': 'application/json' },
        keepalive: line.length < 60_000,
      }).then(
        () => undefined,
        () => undefined,
      ),
    )
    .catch(() => undefined);
}

/** Waits for the pending lines (tests, and anything that must not outlive a save). */
export function logSettled(): Promise<void> {
  return chain;
}
