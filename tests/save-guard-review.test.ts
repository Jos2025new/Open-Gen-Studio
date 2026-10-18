// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The six findings of the external review of phase 1 (2026-10-18), each reproduced first: the real disk.ts and idb.ts
 * against a scripted server and an in-memory IndexedDB; the lock as a switch (lost / held).
 */
const { stores, lock, fail } = vi.hoisted(() => ({ stores: new Map<string, Map<string, unknown>>(), lock: { held: true }, fail: { conflictCopy: false } }));
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => lock.held }));
vi.mock('idb-keyval', () => {
  const map = (name: string) => { let m = stores.get(name); if (!m) stores.set(name, m = new Map()); return m; };
  return {
    createStore: (name: string) => Object.defineProperty(async (_mode: string, cb: (s: unknown) => unknown) => {
      const m = map(name), tx: { oncomplete?: () => void } = {};
      const result = cb({ transaction: tx, put: (v: unknown, k: string) => { m.set(k, v); }, delete: (k: string) => { m.delete(k); } });
      queueMicrotask(() => tx.oncomplete?.());
      return result;
    }, 'name', { value: name }),
    get: async (k: string, s: { name: string }) => map(s.name).get(k),
    set: async (k: string, v: unknown, s: { name: string }) => {
      if (fail.conflictCopy && k.includes(':conflict-')) throw new DOMException('quota', 'QuotaExceededError');
      map(s.name).set(k, v);
    },
    del: async (k: string, s: { name: string }) => { map(s.name).delete(k); },
    delMany: async (ks: string[], s: { name: string }) => ks.forEach((k) => map(s.name).delete(k)),
    getMany: async (ks: string[], s: { name: string }) => ks.map((k) => map(s.name).get(k)),
    keys: async (s: { name: string }) => [...map(s.name).keys()],
    clear: async (s: { name: string }) => map(s.name).clear(),
  };
});

interface Req { url: string; method: string; body: any }
type Reply = { status: number; body?: string };
const net = { disk: '', reqs: [] as Req[], handle: (_r: Req, _n: number): Reply | Promise<Reply> => ({ status: 204 }) };
const commits = () => net.reqs.filter((r) => r.url === '/x/store/v2/commit');
const KEY = 'ogs-app';
const sess = (id: string, v: number) => JSON.stringify({ id, v });
const val = (o: Record<string, string>) => ({ text: () => '', blob: () => new Blob([]), v2: { version: 1, globals: '{"settings":{}}', order: Object.keys(o), sessions: new Map(Object.entries(o)) } }) as never;
const diskText = (at: number, o: Record<string, string>) => `{"savedAt":${at},"state":{"settings":{},"sessions":{${Object.entries(o).map(([id, t]) => `${JSON.stringify(id)}:${t}`).join(',')}}},"version":1}`;
const v2 = () => stores.get('ogs-store-v2') ?? new Map<string, unknown>();
const until = async (done: () => boolean) => { for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5)); if (!done()) throw new Error('timeout'); };
const deferred = () => { let resolve!: (r: Reply) => void; const promise = new Promise<Reply>((r) => { resolve = r; }); return { promise, resolve }; };

async function boot(o: Record<string, string>, at = 1000) {
  net.disk = diskText(at, o);
  vi.resetModules();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/x/store/ping') return new Response('ok');
    if (url === '/x/store/state' && init?.method !== 'PUT') return new Response(net.disk);
    const req: Req = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body };
    net.reqs.push(req);
    const r = await net.handle(req, net.reqs.length);
    return new Response(r.body ?? null, { status: r.status });
  });
  const { stateDb } = await import('../src/lib/idb');
  const { disk } = await import('../src/lib/disk');
  const { guard } = await import('../src/lib/saveGuard');
  await stateDb.get(KEY);
  net.reqs.length = 0;
  return { db: stateDb, disk, guard };
}
beforeEach(() => {
  stores.clear();
  net.reqs.length = 0;
  net.handle = () => ({ status: 204 });
  lock.held = true;
  fail.conflictCopy = false;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('review of phase 1', () => {
  it('1: going back to the disk text while a save is in flight is still sent (memory, IndexedDB and disk end equal)', async () => {
    const s1 = sess('ses_a', 1), s2 = sess('ses_a', 2);
    const { db } = await boot({ ses_a: s1 });
    const gate = deferred();
    net.handle = (_r, n) => (n === 1 ? gate.promise : { status: 204 });
    const p2 = db.set(KEY, val({ ses_a: s2 }));
    await until(() => commits().length === 1);
    const p1 = db.set(KEY, val({ ses_a: s1 })); // undo before the ack
    gate.resolve({ status: 204 });
    expect(await p2).toBe('ok');
    expect(await p1).toBe('ok');
    expect(commits()).toHaveLength(2);
    expect(commits()[1].body.sessions).toEqual({ ses_a: s1 });
    expect(v2().get('session:ses_a')).toBe(s1);
    expect(v2().get('pending')).toBeUndefined();
  });

  it('2: a save queued when the lock is lost is not sent; its pending revision stays for the next holder', async () => {
    const { db } = await boot({ ses_a: sess('ses_a', 1) });
    const gate = deferred();
    net.handle = (_r, n) => (n === 1 ? gate.promise : { status: 204 });
    const pA = db.set(KEY, val({ ses_a: sess('ses_a', 2) }));
    await until(() => commits().length === 1);
    const pB = db.set(KEY, val({ ses_a: sess('ses_a', 3) }));
    await until(() => v2().get('session:ses_a') === sess('ses_a', 3));
    lock.held = false; // handed over while A is in flight and B waits
    gate.resolve({ status: 204 });
    await pA;
    expect(await pB).toBe('browser-only');
    expect(commits()).toHaveLength(1);
    expect(v2().get('pending')).toMatchObject({ rev: 2 });
  });

  it('3: a revert whose copy cannot be written adopts nothing, and saving keeps working (never a silent ok)', async () => {
    const { db, guard } = await boot({ ses_a: sess('ses_a', 1) });
    await db.set(KEY, val({ ses_a: sess('ses_a', 2) }));
    fail.conflictCopy = true; // quota
    await expect(db.revertToDisk(KEY)).rejects.toThrow();
    expect(guard.discarding).toBe(false);
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 2));
    fail.conflictCopy = false;
    net.reqs.length = 0;
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 3) }))).toBe('ok');
    expect(commits()[0].body.sessions).toEqual({ ses_a: sess('ses_a', 3) });
  });

  it('3: while the disk version is adopted, a late write answers fail, not ok', async () => {
    const { db, guard } = await boot({ ses_a: sess('ses_a', 1) });
    guard.discarding = true;
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 9) }))).toBe('fail');
  });

  it('5: keep approves every loss the server listed for the exact texts sent', async () => {
    const a = sess('ses_a', 1), b = sess('ses_b', 1);
    const { db } = await boot({ ses_a: a, ses_b: b });
    const both = { reason: 'possible-loss', sessionId: 'ses_a', diskHash: 'a'.repeat(64), losses: [{ sessionId: 'ses_a', diskHash: 'a'.repeat(64) }, { sessionId: 'ses_b', diskHash: 'b'.repeat(64) }], total: { diskOrderHash: 'c'.repeat(64) }, savedAt: 1000 };
    net.handle = (_r, n) => (n === 1 ? { status: 409, body: JSON.stringify(both) } : { status: 204 });
    const small = { ses_a: sess('ses_a', 0), ses_b: sess('ses_b', 0) };
    expect(await db.set(KEY, val(small))).toBe('rejected');
    expect(await db.set(KEY, val(small), { keep: true })).toBe('ok');
    const keep = commits()[1].body.keep;
    expect(keep.sessions.map((k: { sessionId: string; diskHash: string }) => [k.sessionId, k.diskHash])).toEqual([['ses_a', 'a'.repeat(64)], ['ses_b', 'b'.repeat(64)]]);
    expect(keep.total.diskOrderHash).toBe('c'.repeat(64));
  });

  it('6: a tab that went stale and takes the lock back saves normally once it loads again', async () => {
    const { db, disk } = await boot({ ses_a: sess('ses_a', 1) });
    net.handle = () => ({ status: 409, body: JSON.stringify({ reason: 'conflict', savedAt: 2000 }) });
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2) }))).toBe('conflict');
    expect(disk.isStale()).toBe(true);
    // Another tab resolved it: it wrote the shared IndexedDB and the disk (same content, nothing pending). This tab
    // takes the lock back and hydrates that copy.
    const at = Date.now() + 1000;
    net.disk = diskText(at, { ses_a: sess('ses_a', 5) });
    v2().delete('pending');
    v2().set('session:ses_a', sess('ses_a', 5));
    v2().set('manifest', { savedAt: at, version: 1, order: ['ses_a'] });
    net.handle = () => ({ status: 204 });
    await db.get(KEY);
    expect(disk.isStale()).toBe(false);
    net.reqs.length = 0;
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 6) }))).toBe('ok');
    expect(commits()).toHaveLength(1);
  });
});
