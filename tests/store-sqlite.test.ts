import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

  it('a small edit sends no order, touches no record rows, and leaves a small WAL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ogs-sql-'));
    const store = createSqliteStore(dir);
    expect(commit(store, 1000, 0, 1, { ses_a: session }).status).toBe(204);
    store.idle();
    expect(commit(store, 2000, 1000, 2, {}).status).toBe(204);
    const delta = store.lastDelta();
    const size = bytes(json(delta));
    const stats = store.lastStats();
    const wal = store.sizes().wal;
    if (delta?.order) throw new Error('spike/sqlite/delta-client.mjs:68: a small edit must not send order');
    if (stats.recWrites !== 0 || stats.posUpdates !== 0) throw new Error(`spike/sqlite/store-b.js:180: a small edit rewrote ${stats.recWrites} rows and moved ${stats.posUpdates}`);
    if (size > 2048) throw new Error(`server/store-sqlite.js:52: a small edit built a ${size}-byte delta`);
    if (wal > 256 * 1024) throw new Error(`spike/sqlite/store-b.js:60: WAL after one small edit is ${wal} bytes`);
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
});
