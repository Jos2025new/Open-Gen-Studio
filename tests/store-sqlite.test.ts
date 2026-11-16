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
import { createSqliteStore } from '../server/store-sqlite.js';

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
      expect(body.order).toEqual(order);
      expect(body.sessions).toEqual({});
      expect(bytes(sent)).toBeLessThan(bytes(json(globalsAt(2))) + 512);
      expect(calls.delta.order).toBeUndefined();
      expect(bytes(json(calls.delta))).toBeLessThan(1024);
      expect(calls.stats).toMatchObject({ recGets: 0, recWrites: 0, posUpdates: 0 });
    } finally { vi.unstubAllGlobals(); }
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
