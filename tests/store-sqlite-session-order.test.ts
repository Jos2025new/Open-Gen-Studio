import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/writerLock', () => ({ holdsWriterLock: () => true }));
import { localStore } from '../server/local-store.js';
import { createSqliteStore, DatabaseSync, sqliteHead } from '../server/store-sqlite.js';

const json = (v: unknown) => JSON.stringify(v);
const session = json({ id: 'ses_a', feed: [{ id: 'f0', text: 'hola' }], docs: [] });

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
  return { callBody };
}

describe('session order delta with fractional index across thousands of sessions', () => {
  it('sends only fractional order deltas on add, move, delete, and after getState seed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-sess-order-'));
    const data = join(root, 'data');
    mkdirSync(data);
    const { callBody } = mount(root);
    const order = Array.from({ length: 2500 }, (_, i) => `ses_${i}`);
    const all = order.map((id) => [id, json({ id, feed: [] })] as [string, string]);
    const g = (zoom: number) => json({ settings: {}, spentUsd: 0, spendLog: [], generations: {}, assets: {}, library: [], ui: { zoom } });
    let sent = '';
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return new Response('ok');
      if (init?.method === 'PUT') sent = String(init?.body ?? '');
      const result = await callBody(init?.method ?? 'GET', url, String(init?.body ?? ''));
      return new Response(result.status === 204 ? null : result.body, { status: result.status });
    });
    try {
      vi.resetModules();
      const { disk } = await import('../src/lib/disk');
      disk.reset();
      expect(await disk.setCommit({ savedAt: 1000, version: 1, globals: g(1), order, changed: all })).toBe('ok');

      // Move last session to front: only the moved session travels in delta.order.sessions.
      const movedOrder = [order[2499], ...order.slice(0, 2499)];
      expect(await disk.setCommit({ savedAt: 2000, version: 1, globals: g(1), order: movedOrder, changed: [] })).toBe('ok');
      const movedBody = JSON.parse(sent);
      expect(movedBody.order).toBeUndefined();
      expect(movedBody.delta.order.sessions).toEqual([{ after: null, before: 'ses_0', ids: ['ses_2499'] }]);
      expect(new TextEncoder().encode(sent).length).toBeLessThan(1024);

      // Insert a new session at index 1, and append another at the end (append needs no order move).
      const insertedOrder = [movedOrder[0], 'ses_new', ...movedOrder.slice(1)];
      expect(await disk.setCommit({ savedAt: 3000, version: 1, globals: g(1), order: insertedOrder, changed: [['ses_new', json({ id: 'ses_new', feed: [] })]] })).toBe('ok');
      const insertedBody = JSON.parse(sent);
      expect(insertedBody.order).toBeUndefined();
      expect(insertedBody.delta.order.sessions).toEqual([{ after: 'ses_2499', before: 'ses_0', ids: ['ses_new'] }]);
      expect(new TextEncoder().encode(sent).length).toBeLessThan(1024);

      const appendedOrder = [...insertedOrder, 'ses_tail'];
      expect(await disk.setCommit({ savedAt: 3500, version: 1, globals: g(1), order: appendedOrder, changed: [['ses_tail', json({ id: 'ses_tail', feed: [] })]] })).toBe('ok');
      const appendedBody = JSON.parse(sent);
      expect(appendedBody.order).toBeUndefined();
      expect(appendedBody.delta.order).toBeUndefined();
      expect(new TextEncoder().encode(sent).length).toBeLessThan(1024);

      // Delete a session from the middle.
      const deletedOrder = appendedOrder.filter((id) => id !== 'ses_1000');
      expect(await disk.setCommit({ savedAt: 4000, version: 1, globals: g(1), order: deletedOrder, changed: [] })).toBe('ok');
      const deletedBody = JSON.parse(sent);
      expect(deletedBody.order).toBeUndefined();
      expect(deletedBody.delta.del.sessions).toEqual(['ses_1000']);
      expect(deletedBody.delta.order).toBeUndefined();
      expect(new TextEncoder().encode(sent).length).toBeLessThan(1024);

      // Verify state order on disk and after reload + disk.getState() seed.
      const loaded = JSON.parse((await callBody('GET', '/x/store/state')).body);
      expect(Object.keys(loaded.state.sessions)).toEqual(deletedOrder);
      expect(sqliteHead(data)?.order).toEqual(deletedOrder);

      disk.reset();
      expect(await disk.getState()).not.toBeNull();
      expect(await disk.setCommit({ savedAt: 5000, version: 1, globals: g(2), order: deletedOrder, changed: [] })).toBe('ok');
      const seededBody = JSON.parse(sent);
      expect(seededBody.order).toBeUndefined();
      expect(seededBody.delta.order).toBeUndefined();
      expect(new TextEncoder().encode(sent).length).toBeLessThan(1024);
    } finally { vi.unstubAllGlobals(); }
  });

  it('handles session order abort recovery, legacy schema migration, total-loss guard without full order, and invalid delta.order', async () => {
    // 1. Invalid delta.order.sessions on a fresh folder is refused without creating ogs.sqlite.
    const freshRoot = mkdtempSync(join(tmpdir(), 'ogs-sess-invalid-'));
    const freshData = join(freshRoot, 'data');
    mkdirSync(freshData);
    const freshMount = mount(freshRoot);
    const invalidRes = await freshMount.callBody('PUT', '/x/store/v2/commit', json({
      savedAt: 1000, baseAt: 0, version: 1, sessions: { ses_a: session },
      delta: { full: true, small: '{}', up: { generations: {}, assets: {}, library: {} }, del: { generations: [], assets: [], library: [] }, order: { sessions: [{ after: null, before: 'ses_missing', ids: ['ses_a'] }] }, spend: { append: [], len: 0 } },
    }));
    expect(invalidRes.status).toBe(400);
    expect(sqliteHead(freshData)).toBeNull();

    // 2. Legacy ogs.sqlite (head.order_json without sessions.pos) migrates automatically on open.
    const legRoot = mkdtempSync(join(tmpdir(), 'ogs-sess-leg-'));
    const legData = join(legRoot, 'data');
    mkdirSync(legData);
    const legDb = new DatabaseSync(join(legData, 'ogs.sqlite'));
    legDb.exec(`
      PRAGMA user_version = 1;
      CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, version INTEGER NOT NULL, order_json TEXT NOT NULL, spend_len INTEGER NOT NULL, spend_last INTEGER NOT NULL);
      CREATE TABLE small (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
      CREATE TABLE sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE records (coll TEXT NOT NULL, id TEXT NOT NULL, pos TEXT NOT NULL, meta TEXT NOT NULL, fp TEXT NOT NULL, PRIMARY KEY (coll, id));
      CREATE TABLE gen_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, meta TEXT NOT NULL, deleted INTEGER NOT NULL);
      CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, meta TEXT NOT NULL);
      CREATE TABLE removed_sessions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, removed_at INTEGER NOT NULL, json TEXT NOT NULL);
      INSERT INTO head VALUES (1, 1000, 1, '${json(['ses_b', 'ses_a'])}', 0, 0);
      INSERT INTO small VALUES (1, '{}');
      INSERT INTO sessions VALUES ('ses_a', '${json({ id: 'ses_a', feed: [] })}');
      INSERT INTO sessions VALUES ('ses_b', '${json({ id: 'ses_b', feed: [] })}');
    `);
    legDb.close();
    expect(sqliteHead(legData)?.order).toEqual(['ses_b', 'ses_a']);
    const migrated = createSqliteStore(legData);
    expect(Object.keys(JSON.parse(migrated.read()!).state.sessions)).toEqual(['ses_b', 'ses_a']);
    migrated.close();
    expect(sqliteHead(legData)?.order).toEqual(['ses_b', 'ses_a']);

    // 3. Network abort + order revert + total-loss guard without sending full order.
    const root = mkdtempSync(join(tmpdir(), 'ogs-sess-abort-'));
    const data = join(root, 'data');
    mkdirSync(data);
    const { callBody } = mount(root);
    const g = (zoom: number) => json({ settings: {}, spentUsd: 0, spendLog: [], generations: {}, assets: {}, library: [], ui: { zoom } });
    const order = ['ses_1', 'ses_2', 'ses_3'];
    const all = order.map((id) => [id, json({ id, feed: [] })] as [string, string]);
    let dropAfterCommit = false;
    let abortBeforeCommit = false;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url === '/x/store/ping') return new Response('ok');
      if (url === '/x/store/v2/commit' && abortBeforeCommit) {
        abortBeforeCommit = false;
        throw new TypeError('aborted before server');
      }
      const result = await callBody(init?.method ?? 'GET', url, String(init?.body ?? ''));
      if (url === '/x/store/v2/commit' && dropAfterCommit) {
        dropAfterCommit = false;
        throw new TypeError('dropped after commit');
      }
      return new Response(result.status === 204 ? null : result.body, { status: result.status });
    });
    try {
      vi.resetModules();
      const { disk } = await import('../src/lib/disk');
      disk.reset();
      expect(await disk.setCommit({ savedAt: 1000, version: 1, globals: g(1), order, changed: all })).toBe('ok');

      // Reorder reaches server, response is dropped; next commit reverts back to original order.
      dropAfterCommit = true;
      expect(await disk.setCommit({ savedAt: 2000, version: 1, globals: g(1), order: ['ses_3', 'ses_1', 'ses_2'], changed: [] })).toBe('fail');
      expect(sqliteHead(data)?.order).toEqual(['ses_3', 'ses_1', 'ses_2']);
      expect(await disk.setCommit({ savedAt: 3000, version: 1, globals: g(1), order, changed: [] })).toBe('ok');
      expect(sqliteHead(data)?.order).toEqual(order);

      // Reorder aborted before server; next commit reverts back to original order.
      abortBeforeCommit = true;
      expect(await disk.setCommit({ savedAt: 4000, version: 1, globals: g(1), order: ['ses_3', 'ses_1', 'ses_2'], changed: [] })).toBe('fail');
      expect(sqliteHead(data)?.order).toEqual(order);
      expect(await disk.setCommit({ savedAt: 5000, version: 1, globals: g(1), order, changed: [] })).toBe('ok');
      expect(sqliteHead(data)?.order).toEqual(order);

      // Removing 2 of 3 sessions without keep.total triggers 409 possible-loss even without body.order.
      expect(await disk.setCommit({ savedAt: 6000, version: 1, globals: g(1), order: ['ses_1'], changed: [] })).toBe('rejected');
      expect(sqliteHead(data)?.order).toEqual(order);
    } finally { vi.unstubAllGlobals(); }
  });
});
