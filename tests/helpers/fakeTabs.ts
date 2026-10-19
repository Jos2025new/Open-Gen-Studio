/*
 * Doubles for the writer lock tests (plan 1.4): several "tabs" in one test. A tab is a fresh copy of the app modules
 * (vi.resetModules) that shares the fake Web Locks manager, the BroadcastChannel bus, IndexedDB and the disk server.
 */
import { vi } from 'vitest';

type Store = Map<string, unknown>;
const g = globalThis as unknown as { __fakeIdb?: Map<string, Store> };
/** IndexedDB for every tab of a test: databases by name. Cleared by `resetWorld`. */
export const idbStores = (): Map<string, Store> => (g.__fakeIdb ??= new Map());

/** The idb-keyval double (same shape the save-guard tests use): `vi.mock('idb-keyval', () => idbKeyval())`. */
export function idbKeyval() {
  const map = (name: string) => { let m = idbStores().get(name); if (!m) idbStores().set(name, m = new Map()); return m; };
  return {
    createStore: (name: string) => Object.defineProperty(async (_mode: string, cb: (s: unknown) => unknown) => {
      const m = map(name), tx: { oncomplete?: () => void } = {};
      const result = cb({ transaction: tx, put: (v: unknown, k: string) => { m.set(k, v); }, delete: (k: string) => { m.delete(k); } });
      queueMicrotask(() => tx.oncomplete?.());
      return result;
    }, 'name', { value: name }),
    get: async (k: string, s: { name: string }) => map(s.name).get(k),
    set: async (k: string, v: unknown, s: { name: string }) => { map(s.name).set(k, v); },
    del: async (k: string, s: { name: string }) => { map(s.name).delete(k); },
    delMany: async (ks: string[], s: { name: string }) => ks.forEach((k) => map(s.name).delete(k)),
    getMany: async (ks: string[], s: { name: string }) => ks.map((k) => map(s.name).get(k)),
    keys: async (s: { name: string }) => [...map(s.name).keys()],
    clear: async (s: { name: string }) => map(s.name).clear(),
  };
}

/** A string snapshot of the three databases a tab must not touch without the lock (blobs by size). */
export function snapshotDbs(): string {
  const out: Record<string, Record<string, unknown>> = {};
  for (const name of ['ogs-store-v2', 'ogs-state', 'ogs-blobs']) {
    const m = idbStores().get(name) ?? new Map();
    out[name] = Object.fromEntries([...m].map(([k, v]) => [k, v instanceof Blob ? `blob:${v.size}` : v]));
  }
  return JSON.stringify(out);
}

/** An exclusive Web Locks manager: FIFO queue, AbortSignal for queued requests, `steal` rejecting the holder with AbortError. */
export function fakeLocks() {
  let holder: { reject: (e: unknown) => void } | null = null;
  const queue: Array<{ start: () => void; abort: () => void }> = [];
  const next = () => { if (!holder && queue.length) queue.shift()!.start(); };
  const run = (cb: (l: unknown) => unknown, resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    let done = false;
    const me = { reject: (e: unknown) => { if (!done) { done = true; reject(e); } } };
    holder = me;
    const end = (fn: () => void) => { if (!done) { done = true; fn(); } if (holder === me) { holder = null; next(); } };
    Promise.resolve().then(() => cb({ name: 'ogs-writer' })).then((v) => end(() => resolve(v)), (e) => end(() => reject(e)));
  };
  return {
    get held() { return holder !== null; },
    /** The holder's page ends: its lock is released and nothing is rejected (the page is gone). */
    terminate() { holder = null; next(); },
    request(_name: string, a: unknown, b?: unknown): Promise<unknown> {
      const [opts, cb] = (typeof a === 'function' ? [{}, a] : [a, b]) as [{ steal?: boolean; signal?: AbortSignal }, (l: unknown) => unknown];
      return new Promise((resolve, reject) => {
        if (opts.steal) {
          holder?.reject(new DOMException('The lock was stolen', 'AbortError'));
          holder = null;
          run(cb, resolve, reject);
          return;
        }
        const entry = { start: () => run(cb, resolve, reject), abort: () => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1); reject(new DOMException('aborted', 'AbortError')); } };
        opts.signal?.addEventListener('abort', entry.abort);
        queue.push(entry);
        next();
      });
    },
  };
}

/** A BroadcastChannel bus: a message reaches the other channels of the same name (not the sender). `deaf` ids hear nothing (a frozen tab). */
export function fakeBroadcast() {
  const all: Array<InstanceType<typeof Chan>> = [];
  const deaf = new Set<number>();
  class Chan {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    readonly id = all.length + 1;
    constructor(readonly name: string) { all.push(this); }
    postMessage(data: unknown) {
      for (const c of all) if (c !== this && c.name === this.name) queueMicrotask(() => { if (!deaf.has(c.id)) c.onmessage?.({ data: structuredClone(data) }); });
    }
    close() { all.splice(all.indexOf(this), 1); }
    unref() {}
  }
  return { Chan, deaf, all };
}

/** Installs a fresh Web Locks manager and bus as the browser's; returns them. Call before opening the first tab. */
export function resetWorld() {
  idbStores().clear();
  const locks = fakeLocks(), bus = fakeBroadcast();
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
  vi.stubGlobal('BroadcastChannel', bus.Chan);
  return { locks, bus };
}

/** Lets promises and microtask chains (message delivery, lock grants, rehydration) settle. */
export async function settle(times = 30): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Polls `done` on real time until it is true. */
export async function until(done: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  if (!done()) throw new Error('timeout');
}
