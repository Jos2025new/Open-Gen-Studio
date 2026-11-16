import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ reads: 0, delta: null as any, stats: null as any, copyGate: null as null | (() => Promise<void>) }));
vi.mock('../server/sqlite/store-ba.js', async (original) => {
  const mod = await original<any>();
  return { ...mod, createStoreBA: (...args: any[]) => {
    const store = mod.createStoreBA(...args);
    const read = store.read;
    const commit = store.commit;
    store.commit = (body: any) => { calls.delta = body.delta; const result = commit(body); calls.stats = store.lastStats(); return result; };
    store.read = () => { calls.reads++; return read(); };
    return store;
  } };
});
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true }));
vi.mock('node:fs/promises', async (original) => {
  const mod = await original<any>();
  return { ...mod, copyFile: async (...args: any[]) => {
    if (String(args[0]).endsWith('/ogs.sqlite') && calls.copyGate) await calls.copyGate();
    return mod.copyFile(...args);
  } };
});
import { localStore } from '../server/local-store.js';
import { createKeyStore } from '../server/keys.js';
import { createSqliteStore, DatabaseSync, sqliteHead } from '../server/store-sqlite.js';

const json = (v: unknown) => JSON.stringify(v);
const bytes = (text: string) => new TextEncoder().encode(text).length;

function globals(zoom = 1, library = [{ id: 'lib_a', name: 'A' }, { id: 'lib_b', name: 'B' }]) {
  const generations: Record<string, { id: string; prompt: string }> = {};
  for (let i = 0; i < 40; i++) generations[`gen_${i}`] = { id: `gen_${i}`, prompt: `prompt ${i}` };
  return json({
    settings: { theme: 'dark' }, spentUsd: 0, spendLog: [], generations, assets: {}, library,
    composer: { text: '' }, ui: { zoom },
  });
}

const session = json({ id: 'ses_a', feed: [{ id: 'f0', text: 'hola' }], docs: [] });

function commit(store: ReturnType<typeof createSqliteStore>, savedAt: number, baseAt: number, zoom: number, sessions: Record<string, string> = {}) {
  return store.commit({ savedAt, baseAt, version: 1, globals: globals(zoom), order: ['ses_a'], sessions });
}

describe('sqlite store behind the current commit body', () => {
  it('round-trips a commit and refuses a stale baseAt without writing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-sql-'));
    const store = createSqliteStore(dir);
    expect(commit(store, 1000, 0, 1, { ses_a: session }).status).toBe(204);
    const text = store.read();
    expect(text).toContain('"zoom":1');
    expect(text).toContain('"ses_a"');
    const refused = commit(store, 2000, 1, 2, {});
    expect(refused).toMatchObject({ status: 409, reason: 'conflict', savedAt: 1000 });
    expect(store.read()).toBe(text);
    store.close();
  });

  it('keeps a removed session as a recoverable backup file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-removed-'));
    const store = createSqliteStore(dir);
    const other = json({ id: 'ses_b', feed: [{ text: 'recover me' }] });
    expect(store.commit({ savedAt: 1, baseAt: 0, version: 1, globals: globals(), order: ['ses_a', 'ses_b'], sessions: { ses_a: session, ses_b: other } }).status).toBe(204);
    expect(store.commit({ savedAt: 2, baseAt: 1, version: 1, globals: globals(), order: ['ses_a'], sessions: {} }).status).toBe(204);
    const dirBackup = join(dir, 'backups', 'removed-sessions');
    const files = readdirSync(dirBackup).filter((f) => f.endsWith('-ses_b.json'));
    expect(files).toHaveLength(1);
    expect(readFileSync(join(dirBackup, files[0]), 'utf8')).toBe(other);
    store.close();
  });

  it('backs up a removed session whose valid id exceeds a filesystem name limit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-long-id-'));
    const store = createSqliteStore(dir);
    const id = 's'.repeat(256);
    const text = json({ id, feed: ['recover me'] });
    expect(store.commit({ savedAt: 1, baseAt: 0, version: 1, globals: globals(), order: ['ses_a', id], sessions: { ses_a: session, [id]: text } }).status).toBe(204);
    expect(store.commit({ savedAt: 2, baseAt: 1, version: 1, globals: globals(), order: ['ses_a'], sessions: {} }).status).toBe(204);
    const backup = join(dir, 'backups', 'removed-sessions');
    expect(readdirSync(backup).map((f) => readFileSync(join(backup, f), 'utf8'))).toContain(text);
    store.close();
  });

  it('reads the initial state once when opening and serving it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-open-'));
    const first = createSqliteStore(dir);
    expect(commit(first, 1, 0, 1, { ses_a: session }).status).toBe(204);
    first.close();
    calls.reads = 0;
    const reopened = createSqliteStore(dir);
    expect(reopened.read()).toContain('ses_a');
    expect(calls.reads).toBe(1);
    reopened.close();
  });

  it('a session that looks lost is a 409 and the previous text stays', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-sql-'));
    const store = createSqliteStore(dir);
    const fat = json({ id: 'ses_a', feed: Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, text: 'word '.repeat(30) })), docs: [] });
    expect(store.commit({ savedAt: 1000, baseAt: 0, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: fat } }).status).toBe(204);
    const before = store.read();
    const thin = json({ id: 'ses_a', feed: [], docs: [] });
    const refused = store.commit({ savedAt: 2000, baseAt: 1000, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: thin } });
    expect(refused.status).toBe(409);
    expect(refused.reason).toBe('possible-loss');
    expect(store.read()).toBe(before);
    store.close();
  });

  it('sends the real client HTTP body and avoids full record order on a large small edit', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-client-perf-'));
    const { callBody } = mount(root);
    const generations: Record<string, { id: string; prompt: string }> = {};
    for (let i = 0; i < 3000; i++) generations[`gen_${i}`] = { id: `gen_${i}`, prompt: 'p' };
    const globalsAt = (zoom: number) => json({ settings: {}, spentUsd: 0, spendLog: [], generations, assets: {}, library: [{ id: 'lib_a' }], ui: { zoom } });
    const order = Array.from({ length: 8 }, (_, i) => `ses_${i}`);
    const all = order.map((id) => [id, json({ id, feed: [] })] as [string, string]);
    let sent = '';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return new Response('ok');
      sent = String(init?.body ?? '');
      const result = await callBody(init?.method ?? 'GET', url, sent);
      return new Response(result.status === 204 ? null : result.body, { status: result.status });
    });
    try {
      const { disk } = await import('../src/lib/disk');
      disk.reset();
      expect(await disk.setCommit({ savedAt: 1000, version: 1, globals: globalsAt(1), order, changed: all })).toBe('ok');
      expect(await disk.setCommit({ savedAt: 2000, version: 1, globals: globalsAt(2), order, changed: [] })).toBe('ok');
      const body = JSON.parse(sent);
      expect(body.globals).toBeUndefined();
      expect(body.delta).toBeDefined();
      expect(body.order).toEqual(order);
      expect(body.sessions).toEqual({});
      expect(bytes(sent)).toBeLessThan(1024);
      expect(calls.delta.order).toBeUndefined();
      expect(bytes(json(calls.delta))).toBeLessThan(1024);
      expect(calls.stats).toMatchObject({ recGets: 0, recWrites: 0, posUpdates: 0 });
    } finally { vi.unstubAllGlobals(); }
  });

  it('phase 3: client resends unacknowledged delta idempotently after a network abort and stops on a 409 conflict', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-phase3-net-'));
    const { callBody } = mount(root);
    const order = ['ses_a'];
    const all = [['ses_a', session]] as Array<[string, string]>;
    let failNext = false;
    let commitsSent = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return new Response('ok');
      if (url === '/x/store/v2/commit') {
        commitsSent++;
        if (failNext) {
          failNext = false;
          throw new TypeError('network abort');
        }
      }
      const result = await callBody(init?.method ?? 'GET', url, String(init?.body ?? ''));
      return new Response(result.status === 204 ? null : result.body, { status: result.status });
    });
    try {
      const { disk } = await import('../src/lib/disk');
      disk.reset();
      const g1 = { settings: {}, spentUsd: 0.1, spendLog: [{ id: 's1', usd: 0.1 }], generations: { g1: { id: 'g1', prompt: 'one' } }, assets: {}, library: [{ id: 'lib_a', name: 'A' }, { id: 'lib_b', name: 'B' }], ui: { zoom: 1 } };
      expect(await disk.setCommit({ savedAt: 1000, version: 1, globals: json(g1), order, changed: all })).toBe('ok');

      // Abort a commit that adds g2, appends spend s2, and reorders library: deltaClient stays unacked.
      failNext = true;
      const g2 = { ...g1, spentUsd: 0.2, spendLog: [{ id: 's1', usd: 0.1 }, { id: 's2', usd: 0.1 }], generations: { ...g1.generations, g2: { id: 'g2', prompt: 'two' } }, library: [{ id: 'lib_b', name: 'B' }, { id: 'lib_a', name: 'A' }], ui: { zoom: 2 } };
      expect(await disk.setCommit({ savedAt: 2000, version: 1, globals: json(g2), order, changed: [] })).toBe('fail');

      // Subsequent small edit resends g2, s2, and library reorder idempotently.
      const g3 = { ...g2, ui: { zoom: 3 } };
      expect(await disk.setCommit({ savedAt: 3000, version: 1, globals: json(g3), order, changed: [] })).toBe('ok');
      const stateAfter = JSON.parse((await callBody('GET', '/x/store/state')).body).state;
      expect(Object.keys(stateAfter.generations).sort()).toEqual(['g1', 'g2']);
      expect(stateAfter.spendLog).toHaveLength(2);
      expect(stateAfter.library.map((x: { id: string }) => x.id)).toEqual(['lib_b', 'lib_a']);
      expect(stateAfter.ui.zoom).toBe(3);

      // Concurrent commit on the server advances savedAt to 4000 -> client gets 409 conflict and stops sending.
      expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 4000, baseAt: 3000, version: 1, globals: json({ ...g3, ui: { zoom: 9 } }), order, sessions: {} }))).status).toBe(204);
      const beforeConflict = commitsSent;
      expect(await disk.setCommit({ savedAt: 5000, version: 1, globals: json({ ...g3, ui: { zoom: 4 } }), order, changed: [] })).toBe('conflict');
      expect(disk.isStale()).toBe(true);
      expect(commitsSent).toBe(beforeConflict + 1);
      expect(await disk.setCommit({ savedAt: 6000, version: 1, globals: json({ ...g3, ui: { zoom: 5 } }), order, changed: [] })).toBe('conflict');
      expect(commitsSent).toBe(beforeConflict + 1);
    } finally { vi.unstubAllGlobals(); }
  });

  it('preserves identical consecutive spendLog entries and duplicate library ids', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-dup-spend-'));
    const store = createSqliteStore(dir);
    const spendA = { id: 'sp_1', usd: 0.05 };
    const spendB = { id: 'sp_2', usd: 0.1 };
    const dupLib = [{ id: 'lib_a', name: 'A1' }, { id: 'lib_a', name: 'A2' }, { name: 'no-id-1' }, { name: 'no-id-2' }];
    const g1 = json({ settings: {}, spentUsd: 0.15, spendLog: [spendA, spendB], generations: {}, assets: {}, library: dupLib });
    expect(store.commit({ savedAt: 1, baseAt: 0, version: 1, globals: g1, order: ['ses_a'], sessions: { ses_a: session } }).status).toBe(204);
    const g2 = json({ settings: {}, spentUsd: 0.25, spendLog: [spendA, spendB, spendB], generations: {}, assets: {}, library: dupLib });
    expect(store.commit({ savedAt: 2, baseAt: 1, version: 1, globals: g2, order: ['ses_a'], sessions: {} }).status).toBe(204);
    const parsed = JSON.parse(store.read()!).state;
    expect(parsed.spendLog).toEqual([spendA, spendB, spendB]);
    expect(parsed.library).toEqual(dupLib);
    store.close();
  });

});

describe('routes keep the current body and an existing format-2 folder', () => {
  it('a new /v2/commit is stored in SQLite and a folder that already has HEAD.json stays on its files', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'ogs-route-'));
    mkdirSync(join(fresh, 'data'));
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    (localStore(fresh).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    const call = (method: string, url: string, body = '') => new Promise<number>((resolve) => {
      const req = { method, url, headers: { 'x-ogs': '1', host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (body) yield new TextEncoder().encode(body); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: () => resolve(res.statusCode) };
      mw(req, res, () => resolve(404));
    });
    const payload = json({ savedAt: 1000, baseAt: 0, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: session } });
    expect(await call('PUT', '/x/store/v2/commit', payload)).toBe(204);
    expect(existsSync(join(fresh, 'data', 'ogs.sqlite'))).toBe(true);
    expect(existsSync(join(fresh, 'data', 'store-v2', 'HEAD.json'))).toBe(false);
    expect(await call('GET', '/x/store/state')).toBe(200);

    const legacy = mkdtempSync(join(tmpdir(), 'ogs-v2-'));
    mkdirSync(join(legacy, 'data', 'store-v2'), { recursive: true });
    writeFileSync(join(legacy, 'data', 'store-v2', 'HEAD.json'), json({ format: 2, savedAt: 5, version: 1, order: [] }));
    let legacyMw: typeof mw = () => undefined;
    (localStore(legacy).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof legacyMw) => (legacyMw = fn) } });
    const callLegacy = (body: string) => new Promise<number>((resolve) => {
      const req = { method: 'PUT', url: '/x/store/v2/commit', headers: { 'x-ogs': '1', host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: () => resolve(res.statusCode) };
      legacyMw(req, res, () => resolve(404));
    });
    await callLegacy(payload);
    expect(existsSync(join(legacy, 'data', 'ogs.sqlite'))).toBe(false);
    expect(existsSync(join(legacy, 'data', 'store-v2', 'HEAD.json'))).toBe(true);
  });

  it('rejects an invalid first commit without creating SQLite and accepts a later valid one', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-invalid-'));
    const { call } = mount(root);
    const invalid = json({ savedAt: 1, globals: '{}', order: ['ses_a'], sessions: {} });
    expect(await call('PUT', '/x/store/v2/commit', invalid)).toBe(400);
    expect(existsSync(join(root, 'data', 'ogs.sqlite'))).toBe(false);
    const malformedKeep = json({ savedAt: 1, version: 1, globals: '{}', order: [], sessions: {}, keep: { sessions: [null] } });
    expect(await call('PUT', '/x/store/v2/commit', malformedKeep)).toBe(400);
    expect(existsSync(join(root, 'data', 'ogs.sqlite'))).toBe(false);
    const inherited = json({ savedAt: 1, version: 1, globals: '{}', order: ['constructor'], sessions: {} });
    expect(await call('PUT', '/x/store/v2/commit', inherited)).toBe(400);
    expect(existsSync(join(root, 'data', 'ogs.sqlite'))).toBe(false);
    expect(await call('GET', '/x/store/state')).toBe(200);
    expect(await call('PUT', '/x/store/v2/commit', json({ savedAt: 2, baseAt: 0, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: session } }))).toBe(204);
  });

  it('a format-1 folder stays on its file: an empty first commit does not hide the old sessions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-f1-'));
    const data = join(root, 'data');
    mkdirSync(data);
    const marker = 'session-that-must-stay';
    writeFileSync(join(data, 'state.json'), json({
      savedAt: 1000,
      state: { sessions: { ses_a: { id: 'ses_a', feed: [{ text: marker }] }, ses_b: { id: 'ses_b', feed: [{ text: 'dos' }] } } },
      version: 1,
    }));
    const { call } = mount(root);
    const empty = json({ savedAt: 2000, baseAt: 0, version: 1, globals: '{}', order: [], sessions: {} });
    expect(await call('PUT', '/x/store/v2/commit', empty)).toBe(409);
    expect(existsSync(join(data, 'ogs.sqlite'))).toBe(false);
    expect(existsSync(join(data, 'store-v2', 'HEAD.json'))).toBe(false);
    expect(readFileSync(join(data, 'state.json'), 'utf8')).toContain(marker);
  });

  it('a corrupt sqlite file is an error, not the old state.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-bad-'));
    const data = join(root, 'data');
    mkdirSync(data);
    writeFileSync(join(data, 'ogs.sqlite'), 'not a database');
    writeFileSync(join(data, 'state.json'), json({ savedAt: 5, state: { sessions: { ses_a: { id: 'ses_a', feed: [{ text: 'legacy-marker' }] } } }, version: 1 }));
    const { callBody } = mount(root);
    const got = await callBody('GET', '/x/store/state');
    expect(got.status).toBe(500);
    expect(got.body).not.toContain('legacy-marker');
  });

  it('serializes a concurrent save until the SQLite export copy is complete', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-export-race-'));
    const { callBody } = mount(root);
    const payload = (at: number, base: number, zoom: number, sessions: Record<string, string>) => json({ savedAt: at, baseAt: base, version: 1, globals: globals(zoom), order: ['ses_a'], sessions });
    expect((await callBody('PUT', '/x/store/v2/commit', payload(1, 0, 1, { ses_a: session }))).status).toBe(204);
    let release!: () => void, reached!: () => void;
    const entered = new Promise<void>((r) => { reached = r; });
    const gate = new Promise<void>((r) => { release = r; });
    calls.copyGate = async () => { reached(); await gate; };
    try {
      const exported = callBody('GET', '/x/store/export');
      await entered;
      let finished = false;
      const saved = callBody('PUT', '/x/store/v2/commit', payload(2, 1, 2, {})).then((r) => { finished = true; return r; });
      await new Promise((r) => setTimeout(r, 25));
      expect(finished).toBe(false);
      release();
      const [archive, result] = await Promise.all([exported, saved]);
      expect(result.status).toBe(204);
      const entries = unzip(archive.raw);
      expect(new TextDecoder().decode(entries.get('state.json'))).toContain('"zoom": 1');
      const exportDir = join(root, 'extracted');
      mkdirSync(exportDir);
      writeFileSync(join(exportDir, 'ogs.sqlite'), entries.get('ogs.sqlite')!);
      const db = createSqliteStore(exportDir);
      expect(JSON.parse(db.read()!).savedAt).toBe(1);
      db.close();
    } finally { calls.copyGate = null; release(); }
  });

  it('export carries the assembled state and a coherent sqlite copy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-exp-'));
    mkdirSync(join(root, 'data'));
    const { callBody } = mount(root);
    const payload = json({ savedAt: 1000, baseAt: 0, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: session } });
    expect((await callBody('PUT', '/x/store/v2/commit', payload)).status).toBe(204);
    const got = await callBody('GET', '/x/store/export');
    expect(got.status).toBe(200);
    const entries = unzip(got.raw);
    const state = new TextDecoder().decode(entries.get('state.json'));
    expect(state).toContain('ses_a');
    expect(new TextDecoder().decode(entries.get('ogs.sqlite')!.subarray(0, 15))).toBe('SQLite format 3');
    expect(new TextDecoder().decode(entries.get('ogs.sqlite'))).toContain('ses_a');
  });

  it('an empty ogs.sqlite after a rolled-back first commit does not brick the folder, while missing head with data still errors', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-first-fail-'));
    const data = join(root, 'data');
    mkdirSync(data);
    let fail = true;
    const store = createSqliteStore(data, { fault: (p: string) => { if (fail && p === 'globals') throw new Error('disk full'); } });
    const payload = { savedAt: 1000, baseAt: 0, version: 1, globals: globals(), order: ['ses_a'], sessions: { ses_a: session } };
    expect(() => store.commit(payload)).toThrow('disk full');
    store.close();
    expect(existsSync(join(data, 'ogs.sqlite'))).toBe(true);
    expect(sqliteHead(data)).toBeNull();

    const { call, callBody } = mount(root);
    const emptyState = await callBody('GET', '/x/store/state');
    expect(emptyState.status).toBe(200);
    expect(emptyState.body).toBe('');
    fail = false;
    expect(await call('PUT', '/x/store/v2/commit', json(payload))).toBe(204);
    expect(sqliteHead(data)?.savedAt).toBe(1000);

    const db = new DatabaseSync(join(data, 'ogs.sqlite'));
    db.exec('DELETE FROM head');
    db.close();
    expect(() => sqliteHead(data)).toThrow('ogs.sqlite has no head');
    expect((await callBody('GET', '/x/store/state')).status).toBe(500);
  });

  it('strips settings.keys from exported ogs.sqlite and migrates real keys out of ogs.sqlite', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-sql-keys-'));
    const data = join(root, 'data');
    mkdirSync(data);
    const secret = 'sk-or-v1-supersecret9876';
    const gWithoutKey = json({
      settings: { theme: 'dark', keys: { openrouter: '', fal: '' } },
      spentUsd: 0, spendLog: [], generations: {}, assets: {}, library: [],
    });
    const store = createSqliteStore(data);
    expect(store.commit({ savedAt: 1000, baseAt: 0, version: 1, globals: gWithoutKey, order: ['ses_a'], sessions: { ses_a: session } }).status).toBe(204);
    store.idle();
    store.close();
    // Simulate a legacy ogs.sqlite created before commit-time key sanitization.
    const legacyDb = new DatabaseSync(join(data, 'ogs.sqlite'));
    legacyDb.exec(`UPDATE small SET json = '${json({ settings: { theme: 'dark', keys: { openrouter: secret, fal: '' } }, spentUsd: 0 })}' WHERE id = 1`);
    legacyDb.close();

    const ks = createKeyStore(data, { tool: '/nonexistent/secret-tool' });
    const migrated = await ks.migrate();
    expect(migrated.migrated).toContain('openrouter');
    expect(await ks.get('openrouter')).toBe(secret);
    const reopened = createSqliteStore(data);
    const after = reopened.read()!;
    expect(after).not.toContain(secret);
    expect(after).toContain('ogs:****9876');
    reopened.close();

    const { callBody } = mount(root);
    const secret2 = 'sk-or-v1-exportsecret5432';
    const gWithKey2 = json({
      settings: { theme: 'dark', keys: { openrouter: secret2, fal: '' } },
      spentUsd: 0, spendLog: [], generations: {}, assets: {}, library: [],
    });
    expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 2000, baseAt: 1000, version: 1, globals: gWithKey2, order: ['ses_a'], sessions: {} }))).status).toBe(204);
    const got = await callBody('GET', '/x/store/export');
    expect(got.status).toBe(200);
    const entries = unzip(got.raw);
    expect(new TextDecoder().decode(entries.get('state.json'))).not.toContain(secret2);
    expect(new TextDecoder().decode(entries.get('ogs.sqlite'))).not.toContain(secret2);
  });

  it('sanitizes settings.keys before persisting delta.small and excludes backups from export', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-sql-sanitize-'));
    const data = join(root, 'data');
    mkdirSync(data);

    // 1. Direct store commit with delta.small containing a real key and a marker.
    const secretDirect = 'sk-or-v1-directsecret1234';
    const marker = 'ogs:****9999';
    const store = createSqliteStore(data);
    expect(store.commit({
      savedAt: 1000,
      baseAt: 0,
      version: 1,
      order: ['ses_a'],
      sessions: { ses_a: session },
      delta: {
        full: true,
        small: json({ settings: { theme: 'dark', keys: { openrouter: secretDirect, fal: marker } }, spentUsd: 0 }),
        up: { generations: {}, assets: {}, library: {} },
        del: { generations: [], assets: [], library: [] },
        spend: { append: [], len: 0 },
      },
    } as never).status).toBe(204);
    store.idle();
    const readAfterDirect = store.read()!;
    expect(readAfterDirect).not.toContain(secretDirect);
    expect(readAfterDirect).toContain(marker);
    expect(new TextDecoder().decode(readFileSync(join(data, 'ogs.sqlite')))).not.toContain(secretDirect);
    expect(readFileSync(join(data, 'state-cache.txt'), 'utf8')).not.toContain(secretDirect);
    const snaps = readdirSync(join(data, 'backups')).filter((f) => f.startsWith('v2sqlite-'));
    expect(snaps.length).toBeGreaterThan(0);
    for (const s of snaps) {
      expect(new TextDecoder().decode(readFileSync(join(data, 'backups', s)))).not.toContain(secretDirect);
    }
    store.close();

    // 2. Through localStore HTTP after startup migration has already run once.
    const { callBody } = mount(root);
    expect((await callBody('GET', '/x/store/state')).status).toBe(200);
    const secretLate = 'sk-or-v1-latesecret5678';
    expect((await callBody('PUT', '/x/store/v2/commit', json({
      savedAt: 2000,
      baseAt: 1000,
      version: 1,
      order: ['ses_a'],
      sessions: {},
      delta: {
        small: json({ settings: { theme: 'dark', keys: { openrouter: secretLate, fal: marker } }, spentUsd: 0 }),
        up: { generations: {}, assets: {}, library: {} },
        del: { generations: [], assets: [], library: [] },
        spend: { append: [], len: 0 },
      },
    }))).status).toBe(204);
    expect(new TextDecoder().decode(readFileSync(join(data, 'ogs.sqlite')))).not.toContain(secretLate);

    // 3. Export must exclude backups/ and store-v2/ (even if they contain secrets) while keeping media.
    mkdirSync(join(data, 'asset'), { recursive: true });
    writeFileSync(join(data, 'asset', 'ast_1.png'), 'pngbytes');
    mkdirSync(join(data, 'backups', 'v1-pre-sqlite'), { recursive: true });
    writeFileSync(join(data, 'backups', 'v1-pre-sqlite', 'state.json'), json({ secret: 'sk-backup-leak-1' }));
    writeFileSync(join(data, 'backups', 'rejected-1.json'), json({ secret: 'sk-backup-leak-2' }));
    mkdirSync(join(data, 'store-v2'), { recursive: true });
    writeFileSync(join(data, 'store-v2', 'globals.json'), json({ settings: { keys: { fal: 'sk-v2-leak-3' } } }));

    const got = await callBody('GET', '/x/store/export');
    expect(got.status).toBe(200);
    const entries = unzip(got.raw);
    expect(entries.has('asset/ast_1.png')).toBe(true);
    for (const [name, content] of entries) {
      expect(name.startsWith('backups/')).toBe(false);
      expect(name.startsWith('store-v2/')).toBe(false);
      const text = new TextDecoder().decode(content);
      expect(text).not.toContain('sk-backup-leak-1');
      expect(text).not.toContain('sk-backup-leak-2');
      expect(text).not.toContain('sk-v2-leak-3');
      expect(text).not.toContain(secretLate);
    }
  });
});

describe('a backup copy never decides the commit', () => {
  it('a path with an apostrophe still copies, and a failed copy stays a 204', () => {
    const quoted = join(mkdtempSync(join(tmpdir(), 'ogs-q-')), "o'brien");
    mkdirSync(quoted);
    const store = createSqliteStore(quoted);
    const ok = commit(store, 1000, 0, 1, { ses_a: session });
    expect(ok.status).toBe(204);
    expect(ok.snapshotError).toBeUndefined();
    expect(readdirSync(join(quoted, 'backups')).some((f) => f.startsWith('v2sqlite-'))).toBe(true);
    store.close();

    const blocked = mkdtempSync(join(tmpdir(), 'ogs-novac-'));
    writeFileSync(join(blocked, 'backups'), 'not a directory');
    const broken = createSqliteStore(blocked);
    const saved = commit(broken, 1000, 0, 1, { ses_a: session });
    expect(saved.status).toBe(204);
    expect(saved.snapshotError).toBeTruthy();
    expect(broken.read()).toContain('ses_a');
    expect(commit(broken, 2000, 1000, 2, {}).status).toBe(204);
    broken.close();
  });
});

function mount(root: string) {
  let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
  (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
  const callBody = (method: string, url: string, body = '') => new Promise<{ status: number; body: string; raw: Uint8Array }>((resolve) => {
    const req = { method, url, headers: { 'x-ogs': '1', host: 'localhost:5173' }, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { if (body) yield new TextEncoder().encode(body); } };
    const res = {
      statusCode: 0, setHeader: () => undefined,
      end: (b?: Uint8Array | string) => {
        const raw = typeof b === 'string' ? new TextEncoder().encode(b) : new Uint8Array(b ?? []);
        resolve({ status: res.statusCode, body: new TextDecoder().decode(raw), raw });
      },
    };
    mw(req, res, () => resolve({ status: 404, body: '', raw: new Uint8Array() }));
  });
  const call = async (method: string, url: string, body = '') => (await callBody(method, url, body)).status;
  return { call, callBody };
}

function unzip(buf: Uint8Array) {
  const out = new Map<string, Uint8Array>();
  const u16 = (i: number) => (buf[i] ?? 0) | ((buf[i + 1] ?? 0) << 8);
  const u32 = (i: number) => u16(i) + u16(i + 2) * 65536;
  let o = 0;
  while (o + 30 < buf.length && u32(o) === 0x04034b50) {
    const method = u16(o + 8);
    const compSize = u32(o + 18);
    const nameLen = u16(o + 26);
    const extra = u16(o + 28);
    const name = new TextDecoder().decode(buf.subarray(o + 30, o + 30 + nameLen));
    const start = o + 30 + nameLen + extra;
    if (method === 0) out.set(name, buf.subarray(start, start + compSize));
    o = start + compSize;
  }
  return out;
}
