import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localStore } from '../server/local-store.js';
import { createStoreV2 } from '../server/store-v2.js';
import { canonicalStateText, createSqliteStore, migrateFromV2, sqliteHead, stateSha } from '../server/store-sqlite.js';

const json = (v: unknown) => JSON.stringify(v);
const session = json({ id: 'ses_a', feed: [{ id: 'f0', text: 'hola' }], docs: [] });

function globals(zoom = 1) {
  return json({
    settings: { theme: 'dark' }, spentUsd: 0, spendLog: [], generations: { gen_0: { id: 'gen_0', prompt: 'p0' } }, assets: {}, library: [{ id: 'lib_a', name: 'A' }],
    composer: { text: '' }, ui: { zoom },
  });
}

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

describe('phase 2: migration from format 1 and format 2 folders', () => {
  it('migrates format 2 (copy first, one transaction, verified by sha, v2 untouched for rollback, second migration stops without deleting)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-v2-'));
    const dir = join(root, 'data');
    const v2 = createStoreV2(dir);
    expect((await v2.commit({ savedAt: 1000, baseAt: 0, version: 1, globals: globals(1), order: ['ses_a'], sessions: { ses_a: session } })).status).toBe(204);
    const headBefore = readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8');
    const globalsBefore = readFileSync(join(dir, 'store-v2', 'globals.json'), 'utf8');
    const v2Text = (await v2.read())!;

    // Mid-transaction failure rolls back completely, leaving no head and store-v2 intact.
    await expect(migrateFromV2(dir, { fault: (p) => { if (p === 'globals') throw new Error('cut mid-tx'); } })).rejects.toThrow('cut mid-tx');
    expect(sqliteHead(dir)).toBeNull();
    expect(await v2.read()).toBe(v2Text);

    const res = await migrateFromV2(dir);
    expect(res).toMatchObject({ ok: true, format: 2, savedAt: 1000, sessions: 1, sha: stateSha(v2Text), readSource: 'copy' });
    expect(readFileSync(join(res.backupDir, 'HEAD.json'), 'utf8')).toBe(headBefore);
    expect(readFileSync(join(res.backupDir, 'globals.json'), 'utf8')).toBe(globalsBefore);
    expect(readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8')).toBe(headBefore);

    const store = createSqliteStore(dir);
    expect(store.read()).toBe(canonicalStateText(v2Text));
    expect(store.commit({ savedAt: 2000, baseAt: 1000, version: 1, globals: globals(2), order: ['ses_a'], sessions: {} }).status).toBe(204);
    store.close();

    // Second migration after SQLite advanced stops and deletes nothing.
    const dbBytesBefore = new Uint8Array(readFileSync(join(dir, 'ogs.sqlite')));
    await expect(migrateFromV2(dir)).rejects.toThrow(/left intact/);
    expect(new Uint8Array(readFileSync(join(dir, 'ogs.sqlite')))).toEqual(dbBytesBefore);

    // Rollback: removing ogs.sqlite falls right back to untouched store-v2.
    rmSync(join(dir, 'ogs.sqlite'), { force: true });
    rmSync(join(dir, 'state-cache.txt'), { force: true });
    const { callBody } = mount(root);
    expect((await callBody('GET', '/x/store/state')).body).toBe(v2Text);
  });

  it('migrates format 1 (state.json) and refuses protected data/ or .sandbox/ folders', async () => {
    await expect(migrateFromV2('data')).rejects.toThrow(/refusing to migrate protected folder/);
    await expect(migrateFromV2('.sandbox/data')).rejects.toThrow(/refusing to migrate protected folder/);

    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-v1-'));
    const dir = join(root, 'data');
    mkdirSync(dir, { recursive: true });
    const v1Text = json({
      savedAt: 500,
      state: {
        settings: { theme: 'dark' }, spentUsd: 0, spendLog: [], generations: {}, assets: {}, library: [{ id: 'lib_a', name: 'A' }],
        ui: { zoom: 1.25 }, sessions: { ses_a: JSON.parse(session) },
      },
      version: 1,
    });
    writeFileSync(join(dir, 'state.json'), v1Text);

    const res = await migrateFromV2(dir);
    expect(res).toMatchObject({ ok: true, format: 1, savedAt: 500, sessions: 1, sha: stateSha(v1Text), readSource: 'copy' });
    expect(readFileSync(join(res.backupDir, 'state.json'), 'utf8')).toBe(v1Text);
    expect(readFileSync(join(dir, 'state.json'), 'utf8')).toBe(v1Text);

    const { callBody } = mount(root);
    expect(stateSha((await callBody('GET', '/x/store/state')).body)).toBe(stateSha(v1Text));
    expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 1500, baseAt: 500, version: 1, globals: globals(3), order: ['ses_a'], sessions: {} }))).status).toBe(204);
    await expect(migrateFromV2(dir)).rejects.toThrow(/left intact/);
  });

  it('refuses symlinks outside the repository pointing to protected data/ or .sandbox/ folders', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-mig-sym-'));
    const linkData = join(root, 'link-data');
    const linkSandbox = join(root, 'link-sandbox');
    const linkRepo = join(root, 'link-repo');
    symlinkSync(join(process.cwd(), 'data'), linkData);
    symlinkSync(join(process.cwd(), '.sandbox', 'data'), linkSandbox);
    symlinkSync(process.cwd(), linkRepo);

    await expect(migrateFromV2(linkData)).rejects.toThrow(/refusing to migrate protected folder/);
    await expect(migrateFromV2(join(linkData, 'nested'))).rejects.toThrow(/refusing to migrate protected folder/);
    await expect(migrateFromV2(linkSandbox)).rejects.toThrow(/refusing to migrate protected folder/);
    await expect(migrateFromV2(join(linkRepo, 'data'))).rejects.toThrow(/refusing to migrate protected folder/);
    await expect(migrateFromV2(join(linkRepo, '.sandbox', 'data'))).rejects.toThrow(/refusing to migrate protected folder/);

    const safeDir = join(root, 'safe');
    mkdirSync(safeDir);
    symlinkSync(join(process.cwd(), 'data', 'store-v2'), join(safeDir, 'store-v2'));
    await expect(migrateFromV2(safeDir)).rejects.toThrow(/refusing to migrate protected folder/);
  });
});

describe('phase 4: asset revisions and append-only event journal in SQLite', () => {
  it('records generations, spend, edits, reverts, deletes, imports and exports in event_journal and asset_revisions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-phase4-journal-'));
    const data = join(root, 'data');
    mkdirSync(data);
    const { callBody } = mount(root);

    // 1. Initial commit with an uploaded asset (import).
    const g1 = {
      settings: {}, spentUsd: 0, spendLog: [],
      generations: { gen_1: { id: 'gen_1', prompt: 'castle' } },
      assets: { ast_1: { id: 'ast_1', kind: 'image', origin: 'upload', width: 100, height: 100, mime: 'image/png' } },
      library: [{ id: 'lib_1', name: 'Castle', frontalAssetId: 'ast_1', refAssetIds: [] }],
      ui: { zoom: 1 },
    };
    expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 1000, baseAt: 0, version: 1, globals: json(g1), order: ['ses_a'], sessions: { ses_a: session } }))).status).toBe(204);

    // 2. New generation + spend + asset edit applied to original.
    const g2 = {
      ...g1,
      spentUsd: 0.04,
      spendLog: [{ id: 'sp_1', usd: 0.04 }],
      generations: { ...g1.generations, gen_2: { id: 'gen_2', prompt: 'tower' } },
      assets: {
        ast_1: {
          ...g1.assets.ast_1,
          width: 200,
          height: 200,
          originalRevision: { assetId: 'ast_rev_1', width: 100, height: 100, mime: 'image/png', createdAt: 1 },
          revisions: [{ assetId: 'ast_rev_1', width: 100, height: 100, mime: 'image/png', createdAt: 1 }],
        },
        ast_copy: { id: 'ast_copy', kind: 'image', origin: 'upload', width: 200, height: 200, mime: 'image/png', copiedFromAssetId: 'ast_1' },
      },
    };
    expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 2000, baseAt: 1000, version: 1, globals: json(g2), order: ['ses_a'], sessions: {} }))).status).toBe(204);

    // 3. Revert ast_1 to original + delete ast_copy.
    const g3 = {
      ...g2,
      assets: {
        ast_1: { id: 'ast_1', kind: 'image', origin: 'upload', width: 100, height: 100, mime: 'image/png', revertedAt: 3000, revisions: g2.assets.ast_1.revisions },
      },
    };
    expect((await callBody('PUT', '/x/store/v2/commit', json({ savedAt: 3000, baseAt: 2000, version: 1, globals: json(g3), order: ['ses_a'], sessions: {} }))).status).toBe(204);

    // 4. Export ZIP records an export event.
    expect((await callBody('GET', '/x/store/export')).status).toBe(200);

    const store = createSqliteStore(data);
    const revs = store.readAssetRevisions('ast_1');
    expect(revs.map((r) => r.kind)).toEqual(['create', 'edit', 'revert']);
    const copyRevs = store.readAssetRevisions('ast_copy');
    expect(copyRevs.map((r) => r.kind)).toEqual(['create', 'delete']);
    expect(copyRevs[1].meta).toMatchObject({ id: 'ast_copy', copiedFromAssetId: 'ast_1' });

    const journal = store.readJournal();
    const kinds = new Set(journal.map((e) => e.kind));
    for (const k of ['import', 'generation', 'spend', 'edit', 'revert', 'delete', 'export']) {
      expect(kinds.has(k)).toBe(true);
    }
    store.close();
  });
});
