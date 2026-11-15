import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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

  it('a small edit of a large set keeps the HTTP body to the globals and reads no record rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-sql-'));
    const store = createSqliteStore(dir);
    const generations: Record<string, { id: string; prompt: string }> = {};
    for (let i = 0; i < 3000; i++) generations[`gen_${i}`] = { id: `gen_${i}`, prompt: 'p' };
    const globalsAt = (zoom: number) => json({ settings: { theme: 'dark' }, spentUsd: 0, spendLog: [], generations, assets: {}, library: [{ id: 'lib_a', name: 'A' }], composer: { text: '' }, ui: { zoom } });
    const put = (savedAt: number, baseAt: number, zoom: number, sessions: Record<string, string>) => {
      const globalsText = globalsAt(zoom);
      const raw = json({ savedAt, baseAt, version: 1, globals: globalsText, order: ['ses_a'], sessions });
      return { raw, globalsText, result: store.commit(JSON.parse(raw)) };
    };
    expect(put(1000, 0, 1, { ses_a: session }).result.status).toBe(204);
    store.idle();
    const edit = put(2000, 1000, 2, {});
    expect(edit.result.status).toBe(204);
    const stats = store.lastStats();
    const wal = store.sizes().wal;
    const escaped = bytes(json(edit.globalsText));
    if (bytes(edit.raw) > escaped + 256) throw new Error(`server/local-store.js:238: a small edit sent ${bytes(edit.raw) - escaped} bytes beyond the globals`);
    if (stats.recGets !== 0 || stats.recWrites !== 0 || stats.posUpdates !== 0) throw new Error(`server/sqlite/store-b.js:175: a small edit read ${stats.recGets}, wrote ${stats.recWrites}, moved ${stats.posUpdates}`);
    if (wal > 256 * 1024) throw new Error(`server/sqlite/store-b.js:60: WAL after one small edit is ${wal} bytes`);
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
