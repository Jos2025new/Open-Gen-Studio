import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localStore } from '../server/local-store.js';
import { createSqliteStore } from '../server/store-sqlite.js';
import { createStoreV2 } from '../server/store-v2.js';
import { idsHash } from '../server/save-guard.js';

/* Library loss guard: a save that drops most of the library, the assets or the generations is refused like one that drops sessions. */
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

vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true }));

interface Shape { library?: number | string[]; assets?: Record<string, string>; gens?: Record<string, string> }
/** n records of a session: { a0: 's1', … } */
const of = (n: number, sessionId: string, prefix = 'a') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, sessionId]));
const records = (o: Record<string, string> = {}) => Object.fromEntries(Object.entries(o).map(([id, sessionId]) => [id, { id, sessionId }]));
const library = (l: number | string[] = []) => (typeof l === 'number' ? Array.from({ length: l }, (_, i) => `lib${i}`) : l).map((id) => ({ id, kind: 'moodboard', name: id }));
const globalsObj = (s: Shape) => ({ settings: {}, spentUsd: 0, spendLog: [], generations: records(s.gens), assets: records(s.assets), library: library(s.library), ui: {} });
const ses = (id: string) => JSON.stringify({ id, feed: [{ id: 'f0', text: 'hola' }], docs: [] });

type Result = { status: number; reason?: string; records?: Array<{ coll: string; lost: number; diskHash: string }>; total?: unknown; rejectedFile?: string };
const dir = () => mkdtempSync(join(tmpdir(), 'ogs-libguard-'));
const opened: Array<{ close(): void }> = [];
afterEach(() => { for (const s of opened.splice(0)) s.close(); });

function open(kind: 'sqlite' | 'files', at = dir()) {
  const sql = kind === 'sqlite' ? createSqliteStore(at) : null;
  if (sql) opened.push(sql);
  const store = sql ?? createStoreV2(at);
  let base = 0;
  const save = async (s: Shape, order = ['s1', 's2', 's3'], extra: Record<string, unknown> = {}): Promise<Result> => {
    const savedAt = base + 1000;
    const r = await store.commit({ savedAt, baseAt: base, version: 1, globals: JSON.stringify(globalsObj(s)), order, sessions: base ? {} : Object.fromEntries(order.map((id) => [id, ses(id)])), ...extra } as never) as Result;
    if (r.status === 204) base = savedAt;
    return r;
  };
  const state = async () => (JSON.parse((await store.read())!) as { state: { library: unknown[]; assets: object; generations: object } }).state;
  return { dir: at, save, state, sql };
}

describe.each(['sqlite', 'files'] as const)('library loss guard (%s)', (kind) => {
  it('emptying the library, the assets or the generations is refused and writes nothing', async () => {
    const full: Shape = { library: 4, assets: of(30, 's1'), gens: of(30, 's1', 'g') };
    for (const [part, coll] of [['library', 'library'], ['assets', 'assets'], ['gens', 'generations']] as const) {
      const s = open(kind);
      expect((await s.save(full)).status).toBe(204);
      const r = await s.save({ ...full, [part]: undefined });
      expect(r.status).toBe(409);
      expect(r.reason).toBe('possible-loss');
      expect(r.records!.map((x) => x.coll)).toEqual([coll]);
      expect(readdirSync(join(s.dir, 'backups'))).toContain(r.rejectedFile);
      const st = await s.state();
      expect([st.library.length, Object.keys(st.assets).length, Object.keys(st.generations).length]).toEqual([4, 30, 30]);
    }
  });

  it('every collection lost in one save is listed together', async () => {
    const s = open(kind);
    await s.save({ library: 2, assets: of(20, 's1'), gens: of(20, 's1', 'g') });
    const r = await s.save({});
    expect(r.records!.map((x) => [x.coll, x.lost])).toEqual([['generations', 20], ['assets', 20], ['library', 2]]);
  });

  it('ordinary deletions pass: one entry at a time, one batch of results, exactly half', async () => {
    const s = open(kind);
    await s.save({ library: 3, assets: of(9, 's1') });
    for (const n of [2, 1, 0]) expect((await s.save({ library: n, assets: of(9, 's1') })).status).toBe(204);
    expect((await s.save({})).status).toBe(204);
    expect((await s.save({ assets: of(40, 's1') })).status).toBe(204);
    expect((await s.save({ assets: of(20, 's1') })).status).toBe(204);
    expect((await s.save({ assets: of(9, 's1') })).status).toBe(409);
  });

  it('new records do not make up for the lost ones', async () => {
    const s = open(kind);
    await s.save({ library: ['a', 'b', 'c', 'd'] });
    expect((await s.save({ library: ['w', 'x', 'y', 'z'] })).status).toBe(409);
  });

  it('deleting a session takes its own results with it; results of other sessions still count', async () => {
    const mine = of(40, 's1'), others = of(4, 's2', 'o');
    const a = open(kind);
    await a.save({ library: 2, assets: { ...mine, ...others }, gens: of(40, 's1', 'g') });
    expect((await a.save({ library: 2, assets: others }, ['s2', 's3'])).status).toBe(204);
    const b = open(kind);
    await b.save({ assets: { ...mine, ...of(12, 's2', 'o') } });
    expect((await b.save({}, ['s2', 's3'])).records!.map((x) => [x.coll, x.lost])).toEqual([['assets', 12]]);
    const c = open(kind);
    await c.save({ library: 3 });
    expect((await c.save({}, ['s2', 's3'])).records!.map((x) => x.coll)).toEqual(['library']);
  });

  it('keep: needs both lists of ids and every collection, keeps what was on disk, and is single use', async () => {
    const s = open(kind);
    const full: Shape = { library: 4, assets: of(20, 's1') };
    await s.save(full);
    const refused = await s.save({ library: 1 });
    const ok = refused.records!.map(({ coll, diskHash }) => ({ coll, diskHash, candidateHash: idsHash(coll === 'library' ? ['lib0'] : []) }));
    const keep = (r: unknown[]) => s.save({ library: 1 }, undefined, { keep: { sessions: [], records: r } });
    expect((await keep(ok.slice(0, 1))).status).toBe(409);
    expect((await keep(ok.map((k) => ({ ...k, candidateHash: 'x' })))).status).toBe(409);
    expect((await keep(ok.map((k) => ({ ...k, diskHash: 'x' })))).status).toBe(409);
    expect((await s.save({ library: 0 }, undefined, { keep: { sessions: [], records: ok } })).status).toBe(409);
    expect((await keep(ok)).status).toBe(204);
    const kept = readdirSync(join(s.dir, 'backups')).find((f) => f.startsWith('kept-before-records'))!;
    expect(readFileSync(join(s.dir, 'backups', kept), 'utf8')).toContain('lib3');
    expect((await s.state()).library).toHaveLength(1);
    await s.save(full);
    expect((await keep(ok.slice(0, 1))).status).toBe(409);
  });

  it('an old baseAt is still a conflict, and the first save has nothing to compare', async () => {
    const s = open(kind);
    expect((await s.save({ library: 4 })).status).toBe(204);
    expect((await s.save({}, undefined, { baseAt: 1 })).reason).toBe('conflict');
  });

  it('a store opened again still knows what it holds', async () => {
    const s = open(kind);
    await s.save({ library: 4 });
    if (kind === 'sqlite') opened.splice(0).forEach((x) => x.close());
    const again = kind === 'sqlite' ? createSqliteStore(s.dir) : createStoreV2(s.dir);
    if (kind === 'sqlite') opened.push(again as never);
    const r = await again.commit({ savedAt: 5000, baseAt: 1000, version: 1, globals: JSON.stringify(globalsObj({})), order: ['s1', 's2', 's3'], sessions: {} } as never);
    expect((r as Result).status).toBe(409);
  });
});

describe('library loss guard: the delta as it comes', () => {
  const whole = (s: ReturnType<typeof open>, ids: string[]) => s.save({ library: ids }, ['s1']);
  const send = (s: ReturnType<typeof open>, delta: object) => s.sql!.commit({ savedAt: 9000, baseAt: 1000, version: 1, order: ['s1'], sessions: {}, delta: { up: {}, spend: { append: [], len: 0 }, ...delta } });

  it('ids that are not texts are refused: SQLite could match them to other rows', async () => {
    const s = open('sqlite');
    await whole(s, ['5.0', '8.0', '13.0']);
    expect(send(s, { del: { library: [5, 8, 13] } }).status).toBe(400);
    expect((await s.state()).library).toHaveLength(3);
  });

  it('a session removed by the delta takes its own results with it', async () => {
    const s = open('sqlite');
    await s.save({ assets: of(12, 's1') });
    const assets = Object.keys(of(12, 's1'));
    const del = (sessions: string[]) => s.sql!.commit({ savedAt: 9000, baseAt: 1000, version: 1, sessions: {}, delta: { up: {}, del: { assets, sessions }, spend: { append: [], len: 0 } } } as never).status;
    expect(del([])).toBe(409);
    expect(del(['s1'])).toBe(204);
  });

  it('a full delta that does not carry the records is a loss', async () => {
    const s = open('sqlite');
    await whole(s, ['1', '2', '3']);
    expect(send(s, { full: true, small: '{}' }).status).toBe(409);
  });

  it('a record both sent and deleted ends up deleted, so it counts', async () => {
    const s = open('sqlite');
    await whole(s, ['1', '2', '3']);
    const up = Object.fromEntries(['1', '2', '3'].map((id) => [id, JSON.stringify({ id })]));
    expect(send(s, { up: { library: up }, del: { library: ['1', '2', '3'] } }).status).toBe(409);
  });
});

describe('library loss guard: format 1 on disk', () => {
  it('the first format-2 commit is compared with state.json', async () => {
    const at = dir();
    writeFileSync(join(at, 'state.json'), JSON.stringify({ savedAt: 700, state: { ...globalsObj({ library: 5 }), sessions: { s1: JSON.parse(ses('s1')) } }, version: 1 }));
    const r = await createStoreV2(at).commit({ savedAt: 800, baseAt: 700, version: 1, globals: JSON.stringify(globalsObj({})), order: ['s1'], sessions: { s1: ses('s1') } });
    expect(r.records!.map((x) => [x.coll, x.lost])).toEqual([['library', 5]]);
  });

  it('a session removed by that first commit takes its own results with it', async () => {
    const at = dir();
    const sessions = Object.fromEntries(['s1', 's2', 's3'].map((id) => [id, JSON.parse(ses(id))]));
    writeFileSync(join(at, 'state.json'), JSON.stringify({ savedAt: 700, state: { ...globalsObj({ assets: of(12, 's1') }), sessions }, version: 1 }));
    const r = await createStoreV2(at).commit({ savedAt: 800, baseAt: 700, version: 1, globals: JSON.stringify(globalsObj({})), order: ['s2', 's3'], sessions: { s2: ses('s2'), s3: ses('s3') } });
    expect(r.status).toBe(204);
  });
});

describe('library loss guard: the 409 bodies through the HTTP layer', () => {
  const put = (root: string) => {
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    return (url: string, body: string) => new Promise<{ status: number; body: string }>((resolve) => {
      const req = { method: 'PUT', url, headers: { 'x-ogs': '1', host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: (b?: string) => resolve({ status: res.statusCode, body: String(b ?? '') }) };
      mw(req, res, () => resolve({ status: 404, body: '' }));
    });
  };
  const root = () => { const at = dir(); mkdirSync(join(at, 'data')); return at; };
  const text = (savedAt: number, baseAt: number | null, s: Shape) => `{"savedAt":${savedAt},${baseAt == null ? '' : `"baseAt":${baseAt},`}"state":${JSON.stringify({ ...globalsObj(s), sessions: { s1: JSON.parse(ses('s1')) } })},"version":1}`;

  it('v2 commit and the legacy PUT name the collection, how many it loses and the hash of the ids on disk', async () => {
    const send = put(root());
    const commit = (savedAt: number, baseAt: number, s: Shape) => JSON.stringify({ savedAt, baseAt, version: 1, globals: JSON.stringify(globalsObj(s)), order: ['s1'], sessions: { s1: ses('s1') } });
    expect((await send('/x/store/v2/commit', commit(1000, 0, { library: 3 }))).status).toBe(204);
    const records = [{ coll: 'library', lost: 3, diskHash: idsHash(['lib0', 'lib1', 'lib2']) }];
    for (const [url, body] of [['/x/store/v2/commit', commit(1001, 1000, {})], ['/x/store/state', text(1001, 1000, {})]]) {
      const r = await send(url, body);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body)).toMatchObject({ reason: 'possible-loss', records, savedAt: 1000 });
    }
  });

  it('a format-1 state.json is not replaced by one that loses its library', async () => {
    const at = root();
    writeFileSync(join(at, 'data', 'state.json'), text(700, null, { library: 3 }));
    const send = put(at);
    const r = await send('/x/store/state', text(800, 700, {}));
    expect(r.status).toBe(409);
    expect(JSON.parse(r.body)).toMatchObject({ reason: 'possible-loss', records: [{ coll: 'library', lost: 3 }] });
    expect(JSON.parse(readFileSync(join(at, 'data', 'state.json'), 'utf8')).state.library).toHaveLength(3);
    expect((await send('/x/store/state', text(800, 700, { library: 2 }))).status).toBe(204);
  });
});

describe('library loss guard: the real client against the real store', () => {
  let sql: ReturnType<typeof createSqliteStore>;
  const bodies: any[] = [];
  let drop = false;
  beforeEach(async () => {
    stores.clear(); bodies.length = 0;
    vi.resetModules();
    sql = createSqliteStore(dir());
    opened.push(sql);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return new Response('ok');
      if (url === '/x/store/state') return new Response(sql.read() ?? '');
      const body = JSON.parse(init!.body as string);
      bodies.push(body);
      const r = sql.commit(body);
      if (drop) { drop = false; throw new TypeError('Failed to fetch'); }
      return new Response(r.status === 204 ? null : r.status === 409 ? JSON.stringify(r) : r.reason, { status: r.status });
    });
  });
  const value = (s: Shape) => {
    const g = globalsObj(s), globals = JSON.stringify(g);
    return { text: () => '', blob: () => new Blob([]), v2: { version: 1, globals, globalsObj: g, order: ['s1'], sessions: new Map([['s1', ses('s1')]]) } } as never;
  };

  it('a wiped library is refused, stays refused on autosave, and "Keep this version" saves it once', async () => {
    const { stateDb } = await import('../src/lib/idb');
    const { guard } = await import('../src/lib/saveGuard');
    await stateDb.get('ogs-app');
    expect(await stateDb.set('ogs-app', value({ library: 4, assets: of(30, 's1') }))).toBe('ok');
    const lost = value({ library: ['lib2', 'new'], assets: {} });
    expect(await stateDb.set('ogs-app', lost)).toBe('rejected');
    expect(guard.problem!.records!.map((r) => r.coll).sort()).toEqual(['assets', 'library']);
    expect(await stateDb.set('ogs-app', lost)).toBe('rejected');
    expect(bodies.at(-1).keep).toBeUndefined();
    expect(JSON.parse(sql.read()!).state.library).toHaveLength(4);
    expect(await stateDb.set('ogs-app', lost, { keep: true })).toBe('ok');
    expect(guard.problem).toBeNull();
    expect(JSON.parse(sql.read()!).state.library.map((x: { id: string }) => x.id)).toEqual(['lib2', 'new']);
    expect(await stateDb.set('ogs-app', value({ library: ['lib2', 'new', 'more'] }))).toBe('ok');
  });

  const ids = () => JSON.parse(sql.read()!).state.library.map((x: { id: string }) => x.id);

  it('a loss that grows after the notice needs one more "Keep", not a loop', async () => {
    const { stateDb } = await import('../src/lib/idb');
    await stateDb.get('ogs-app');
    await stateDb.set('ogs-app', value({ library: 4, assets: of(12, 's1') }));
    expect(await stateDb.set('ogs-app', value({ library: 4 }))).toBe('rejected');
    expect(await stateDb.set('ogs-app', value({}), { keep: true })).toBe('rejected');
    expect(await stateDb.set('ogs-app', value({}), { keep: true })).toBe('ok');
  });

  it('a shrunk session and a lost library are approved together, whatever the notice listed first', async () => {
    const { stateDb } = await import('../src/lib/idb');
    const big = JSON.stringify({ id: 's1', feed: Array.from({ length: 30 }, (_, i) => ({ id: `f${i}`, text: 'x'.repeat(400) })), docs: [] });
    const withSession = (text: string, s: Shape) => { const v = value(s) as unknown as { v2: { sessions: Map<string, string> } }; v.v2.sessions = new Map([['s1', text]]); return v as never; };
    await stateDb.get('ogs-app');
    await stateDb.set('ogs-app', withSession(big, { library: 4 }));
    expect(await stateDb.set('ogs-app', withSession(ses('s1'), { library: 4 }))).toBe('rejected');
    expect(await stateDb.set('ogs-app', withSession(ses('s1'), {}), { keep: true })).toBe('rejected');
    expect(await stateDb.set('ogs-app', withSession(ses('s1'), {}), { keep: true })).toBe('ok');
  });

  it('a deletion whose answer was lost and then undone is on disk again, and "Keep" still matches', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { stateDb } = await import('../src/lib/idb');
    await stateDb.get('ogs-app');
    const all = ['a', 'b', 'c', 'd', 'e'];
    await stateDb.set('ogs-app', value({ library: all }));
    drop = true;
    expect(await stateDb.set('ogs-app', value({ library: all.slice(1) }))).toBe('fail');
    expect(ids()).toEqual(all.slice(1));
    expect(await stateDb.set('ogs-app', value({ library: all }))).toBe('ok');
    expect(ids()).toEqual(all);
    drop = true;
    await stateDb.set('ogs-app', value({ library: all.slice(1) }));
    expect(await stateDb.set('ogs-app', value({ library: ['a'] }))).toBe('rejected');
    expect(await stateDb.set('ogs-app', value({ library: ['a'] }), { keep: true })).toBe('ok');
    expect(ids()).toEqual(['a']);
  });

  it('restoring the records lifts the refusal without any approval', async () => {
    const { stateDb } = await import('../src/lib/idb');
    const { guard } = await import('../src/lib/saveGuard');
    await stateDb.get('ogs-app');
    await stateDb.set('ogs-app', value({ library: 4 }));
    expect(await stateDb.set('ogs-app', value({}))).toBe('rejected');
    expect(await stateDb.set('ogs-app', value({ library: 5 }))).toBe('ok');
    expect(guard.problem).toBeNull();
  });
});
