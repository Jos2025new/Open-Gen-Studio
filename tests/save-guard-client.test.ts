// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from '../server/save-guard.js';

/*
 * Phase 1 of the save-protection plan, client half: the real disk.ts and idb.ts against a scripted server (fetch) and an
 * in-memory IndexedDB. Plan tests 3 (client side), 5, 6, 7, 8, 9, 11, 15b and the result of a refused write.
 */
const { stores } = vi.hoisted(() => ({ stores: new Map<string, Map<string, unknown>>() }));
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
    set: async (k: string, v: unknown, s: { name: string }) => { map(s.name).set(k, v); },
    del: async (k: string, s: { name: string }) => { map(s.name).delete(k); },
    delMany: async (ks: string[], s: { name: string }) => ks.forEach((k) => map(s.name).delete(k)),
    getMany: async (ks: string[], s: { name: string }) => ks.map((k) => map(s.name).get(k)),
    keys: async (s: { name: string }) => [...map(s.name).keys()],
    clear: async (s: { name: string }) => map(s.name).clear(),
  };
});

interface Req { url: string; method: string; body: any }
type Reply = { status: number; body?: string };
const net = { disk: '' as string, reqs: [] as Req[], handle: (_r: Req, _n: number): Reply | Promise<Reply> => ({ status: 204 }) };
const commits = () => net.reqs.filter((r) => r.url === '/x/store/v2/commit');
const KEY = 'ogs-app';
const sess = (id: string, v: number) => JSON.stringify({ id, v });
const val = (o: Record<string, string>) => ({ text: () => '', blob: () => new Blob([]), v2: { version: 1, globals: '{"settings":{}}', order: Object.keys(o), sessions: new Map(Object.entries(o)) } }) as never;
const diskText = (at: number, o: Record<string, string>) => `{"savedAt":${at},"state":{"settings":{},"sessions":{${Object.entries(o).map(([id, t]) => `${JSON.stringify(id)}:${t}`).join(',')}}},"version":1}`;
const v2 = () => stores.get('ogs-store-v2') ?? new Map<string, unknown>();
const until = async (done: () => boolean) => { for (let i = 0; i < 400 && !done(); i++) await new Promise((r) => setTimeout(r, 5)); if (!done()) throw new Error('timeout'); };
const deferred = () => { let resolve!: (r: Reply) => void; const promise = new Promise<Reply>((r) => { resolve = r; }); return { promise, resolve }; };
const loss = (diskHash?: string): Reply => ({ status: 409, body: JSON.stringify({ reason: 'possible-loss', sessionId: 'ses_a', rejectedFile: 'rejected-session-ses_a-1.json', ...(diskHash ? { diskHash } : {}), savedAt: 1000 }) });

function stubNet() {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/x/store/ping') return new Response('ok');
    if (url === '/x/store/state' && init?.method !== 'PUT') return new Response(net.disk);
    const req: Req = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body };
    net.reqs.push(req);
    const r = await net.handle(req, net.reqs.length);
    return new Response(r.body ?? null, { status: r.status });
  });
}
/** A fresh page: modules reloaded, IndexedDB kept. */
async function page() {
  vi.resetModules();
  stubNet();
  const { stateDb } = await import('../src/lib/idb');
  const { disk } = await import('../src/lib/disk');
  const guard = await import('../src/lib/saveGuard');
  return { db: stateDb, disk, guard: guard.guard };
}
/** A page whose disk and browser both hold `o` saved at `at`. */
async function boot(o: Record<string, string>, at = 1000) {
  net.disk = diskText(at, o);
  const p = await page();
  await p.db.get(KEY);
  net.reqs.length = 0;
  return p;
}
beforeEach(() => {
  stores.clear();
  net.reqs.length = 0;
  net.disk = '';
  net.handle = () => ({ status: 204 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('a refused or failed disk write', () => {
  it('5: a possible-loss does not stop the tab; a retry without edits sends the rejected session again', async () => {
    const a1 = sess('ses_a', 1), a2 = sess('ses_a', 2);
    const { db, disk, guard } = await boot({ ses_a: a1 });
    net.handle = (_r, n) => (n === 1 ? loss('h'.repeat(64)) : { status: 204 });
    expect(await db.set(KEY, val({ ses_a: a2 }))).toBe('rejected');
    expect(disk.isStale()).toBe(false);
    expect(guard.problem).toMatchObject({ reason: 'possible-loss', sessionId: 'ses_a', diskHash: 'h'.repeat(64) });
    expect(await db.set(KEY, val({ ses_a: a2 }))).toBe('ok');
    expect(commits()).toHaveLength(2);
    expect(commits()[1].body.sessions).toEqual({ ses_a: a2 });
    expect(guard.problem).toBeNull();
  });

  it('6: a network failure of A does not leave a hole: B still carries the session A could not send', async () => {
    const a1 = sess('ses_a', 1), b1 = sess('ses_b', 1);
    const { db } = await boot({ ses_a: a1, ses_b: b1 });
    net.handle = (_r, n) => { if (n === 1) throw new TypeError('network'); return { status: 204 }; };
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2), ses_b: b1 }))).toBe('fail');
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2), ses_b: sess('ses_b', 2) }))).toBe('ok');
    expect(commits()[1].body.sessions).toEqual({ ses_a: sess('ses_a', 2), ses_b: sess('ses_b', 2) });
  });

  it('9: IndexedDB is written after a possible-loss and after a conflict (a conflict still stops the disk sends)', async () => {
    const { db, disk } = await boot({ ses_a: sess('ses_a', 1) });
    net.handle = () => loss();
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2) }))).toBe('rejected');
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 2));
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 3) }))).toBe('rejected');
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 3));

    net.handle = () => ({ status: 409, body: JSON.stringify({ reason: 'conflict', savedAt: 5000 }) });
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 4) }))).toBe('conflict');
    expect(disk.isStale()).toBe(true);
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 4));
    const sent = commits().length;
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 5) }))).toBe('conflict');
    expect(commits()).toHaveLength(sent); // the stale tab sends nothing more
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 5)); // but keeps saving locally
  });

  it('a 409 without a reason (older server) is a conflict', async () => {
    const { db, disk } = await boot({ ses_a: sess('ses_a', 1) });
    net.handle = () => ({ status: 409 });
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2) }))).toBe('conflict');
    expect(disk.isStale()).toBe(true);
  });

  it('a conflict keeps this tab\'s copy active: the disk copy is not adopted', async () => {
    const { db } = await boot({ ses_a: sess('ses_a', 1) });
    net.handle = () => ({ status: 409, body: JSON.stringify({ reason: 'conflict', savedAt: 5000 }) });
    net.disk = diskText(5000, { ses_a: sess('ses_a', 9) });
    await db.set(KEY, val({ ses_a: sess('ses_a', 2) }));
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 2));
    expect([...(stores.get('ogs-state') ?? new Map()).keys()].some((k) => String(k).startsWith('ogs-app:conflict-'))).toBe(true);
  });
});

describe('pending revisions', () => {
  it('7 and 15b: the ack of A does not clear B; B\'s base moves to A\'s savedAt; a reload resends B with that base', async () => {
    const a1 = sess('ses_a', 1), a2 = sess('ses_a', 2), a3 = sess('ses_a', 3);
    const { db } = await boot({ ses_a: a1 });
    const gateA = deferred(), gateB = deferred();
    net.handle = (_r, n) => (n === 1 ? gateA.promise : gateB.promise);
    const pA = db.set(KEY, val({ ses_a: a2 }));
    await until(() => commits().length === 1);
    const atA = commits()[0].body.savedAt as number;
    const pB = db.set(KEY, val({ ses_a: a3 }));
    await until(() => v2().get('session:ses_a') === a3);
    expect(v2().get('pending')).toMatchObject({ rev: 2, baseAt: 1000 });
    gateA.resolve({ status: 204 });
    expect(await pA).toBe('ok');
    expect(v2().get('pending')).toEqual({ rev: 2, baseAt: atA }); // still pending, rebased on A
    // Reload before B is acknowledged: the disk holds A.
    net.disk = diskText(atA, { ses_a: a2 });
    net.reqs.length = 0;
    net.handle = () => ({ status: 204 });
    const fresh = await page();
    const text = await fresh.db.get(KEY);
    expect(text).toContain('"v":3');
    // The reloaded page's resend (the old page's queued send of B, still alive in this test, goes to the v2 commit).
    const put = net.reqs.find((r) => r.method === 'PUT' && r.url === '/x/store/state');
    expect(JSON.stringify(put?.body)).toContain(`"baseAt":${atA}`);
    expect(JSON.stringify(put?.body)).toContain('"v":3');
    expect(fresh.guard.problem).toBeNull();
    expect(v2().get('pending')).toBeUndefined();
    gateB.resolve({ status: 204 });
    await pB;
  });

  it('7: the ack of the newest revision clears pending', async () => {
    const { db } = await boot({ ses_a: sess('ses_a', 1) });
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 2) }))).toBe('ok');
    expect(v2().has('pending')).toBe(false);
  });

  it('a failed send leaves pending with the base it was built on', async () => {
    const { db } = await boot({ ses_a: sess('ses_a', 1) });
    net.handle = () => { throw new TypeError('network'); };
    await db.set(KEY, val({ ses_a: sess('ses_a', 2) }));
    expect(v2().get('pending')).toMatchObject({ baseAt: 1000 });
  });

  const seedPending = (baseAt: number) => {
    stores.set('ogs-store-v2', new Map<string, unknown>([
      ['manifest', { savedAt: 3000, version: 1, order: ['ses_a'] }],
      ['globals', '{"settings":{}}'],
      ['session:ses_a', sess('ses_a', 7)],
      ['pending', { rev: 3, baseAt }],
    ]));
  };

  it('8: startup with pending and a disk equal to its base resends the local copy with that base', async () => {
    seedPending(1000);
    net.disk = diskText(1000, { ses_a: sess('ses_a', 1) });
    const { db, guard } = await page();
    expect(await db.get(KEY)).toContain('"v":7');
    const put = net.reqs.find((r) => r.method === 'PUT');
    expect(JSON.stringify(put?.body)).toContain('"baseAt":1000');
    expect(JSON.stringify(put?.body)).toContain('"v":7');
    expect(guard.problem).toBeNull();
    expect(v2().has('pending')).toBe(false);
  });

  it('8: startup with pending and a different disk keeps both copies, adopts nothing and sends nothing', async () => {
    seedPending(1000);
    net.disk = diskText(1500, { ses_a: sess('ses_a', 99) });
    const { db, guard } = await page();
    expect(await db.get(KEY)).toContain('"v":7');
    expect(net.reqs.filter((r) => r.method === 'PUT')).toHaveLength(0);
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 7));
    expect(v2().get('pending')).toMatchObject({ baseAt: 1000 });
    expect(guard.problem).toMatchObject({ reason: 'conflict' });
    // later edits are saved locally and not sent
    expect(await db.set(KEY, val({ ses_a: sess('ses_a', 8) }))).toBe('conflict');
    expect(v2().get('session:ses_a')).toBe(sess('ses_a', 8));
    expect(commits()).toHaveLength(0);
  });

  it('8: a disk that already holds the pending content (the ack was lost) is not a conflict', async () => {
    seedPending(1000);
    net.disk = diskText(2900, { ses_a: sess('ses_a', 7) });
    const { db, guard } = await page();
    await db.get(KEY);
    expect(guard.problem).toBeNull();
    expect(v2().has('pending')).toBe(false);
  });
});

describe('keep this version', () => {
  it('11: the payload carries the disk hash from the 409 and the hash of the exact text sent', async () => {
    const a1 = sess('ses_a', 1), a2 = sess('ses_a', 2);
    const { db } = await boot({ ses_a: a1 });
    net.handle = (_r, n) => (n === 1 ? loss(sha256(a1)) : { status: 204 });
    expect(await db.set(KEY, val({ ses_a: a2 }))).toBe('rejected');
    expect(await db.set(KEY, val({ ses_a: a2 }), { keep: true })).toBe('ok');
    const sent = commits()[1].body;
    expect(sent.sessions.ses_a).toBe(a2);
    expect(sent.keep).toEqual({ sessions: [{ sessionId: 'ses_a', diskHash: sha256(a1), candidateHash: sha256(a2) }] });
  });

  it('11: without a diskHash in the 409 it hashes the text the disk last acknowledged', async () => {
    const a1 = sess('ses_a', 1), a2 = sess('ses_a', 2);
    const { db } = await boot({ ses_a: a1 });
    net.handle = (_r, n) => (n === 1 ? loss() : { status: 204 });
    await db.set(KEY, val({ ses_a: a2 }));
    await db.set(KEY, val({ ses_a: a2 }), { keep: true });
    expect(commits()[1].body.keep).toEqual({ sessions: [{ sessionId: 'ses_a', diskHash: sha256(a1), candidateHash: sha256(a2) }] });
  });

  it('11: an ordinary save never carries keep', async () => {
    const { db } = await boot({ ses_a: sess('ses_a', 1) });
    await db.set(KEY, val({ ses_a: sess('ses_a', 2) }));
    expect(commits()[0].body.keep).toBeUndefined();
  });
});
