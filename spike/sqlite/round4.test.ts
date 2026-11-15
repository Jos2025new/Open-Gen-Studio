// @ts-nocheck -- spike: plain JS modules without types, same as store-sqlite.contract.test.ts.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../../server/save-guard.js';
import { createStoreV2 } from '../../server/store-v2.js';
import { createStoreBA } from './store-ba.js';
import { createDeltaClient } from './delta-client.mjs';
import { createResilientDeltaClient } from './delta-sync.mjs';
import { canonicalStateText, migrateFromV2, stateSha } from './migrate-v2.mjs';
import { buildFixture, makeAsset, makeGeneration, makeSession, makeSpend, rng, sessionId } from './fixture.mjs';

const ROOT = '/tmp/ogs-sqlite-spike-data/vitest-r4';
const MIGRATE_SCRIPT = fileURLToPath(new URL('./migrate-v2.mjs', import.meta.url));
const json = (v) => JSON.stringify(v);

beforeAll(() => mkdirSync(ROOT, { recursive: true }));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

describe('Part 1: B+A combined store (store-ba.js)', () => {
  it('writes deltas via B, serves startup read from state-cache.txt after idle(), and falls back to tables when stale or corrupt', () => {
    const dir = mkdtempSync(join(ROOT, 'ba-'));
    const store = createStoreBA(dir);
    const fx = buildFixture({ sessions: 8, items: 20, generations: 200, spend: 100, assets: 80 });
    const g = JSON.parse(fx.globals);
    const client = createDeltaClient();

    expect(store.read()).toBeNull();
    expect(store.lastReadSource()).toBe('empty');

    const r1 = store.commit({
      savedAt: fx.savedAt,
      baseAt: 0,
      version: 1,
      order: fx.order,
      sessions: fx.sessions,
      delta: client.diff(g),
    });
    expect(r1.status).toBe(204);
    client.ack();

    // Before idle(), read() must assemble from SQLite tables.
    const fromTables = store.read();
    expect(store.lastReadSource()).toBe('tables');
    const sha1 = sha256(fromTables);

    // After idle(), state-cache.txt is written and read() uses the copy with identical sha256.
    const wrote = store.idle();
    expect(wrote).toBeGreaterThan(10_000);
    const fromCopy = store.read();
    expect(store.lastReadSource()).toBe('copy');
    expect(sha256(fromCopy)).toBe(sha1);

    // A new commit advances HEAD without updating state-cache.txt: read() must detect the stale header and fall back to tables.
    g.ui.zoom = 1.75;
    g.generations.gen_201 = makeGeneration(201, rng(201), 8);
    const r2 = store.commit({
      savedAt: fx.savedAt + 1000,
      baseAt: fx.savedAt,
      version: 1,
      order: fx.order,
      sessions: {},
      delta: client.diff(g),
    });
    expect(r2.status).toBe(204);
    client.ack();

    const afterEdit = store.read();
    expect(store.lastReadSource()).toBe('tables');
    const sha2 = sha256(afterEdit);
    expect(sha2).not.toBe(sha1);

    // Refresh idle copy, then corrupt a byte at the end of state-cache.txt -> must fall back to tables.
    store.idle();
    expect(sha256(store.read())).toBe(sha2);
    expect(store.lastReadSource()).toBe('copy');
    writeFileSync(store.cacheFile, readFileSync(store.cacheFile, 'utf8').slice(0, -5));
    expect(sha256(store.read())).toBe(sha2);
    expect(store.lastReadSource()).toBe('tables');

    store.close();
  });

  it('persists a library reorder and a session reorder', () => {
    const dir = mkdtempSync(join(ROOT, 'ord-'));
    const store = createStoreBA(dir);
    const fx = buildFixture({ sessions: 4, items: 4, generations: 6, spend: 3, assets: 3 });
    const g = JSON.parse(fx.globals);
    g.library = [{ id: 'lib_a', name: 'A' }, { id: 'lib_b', name: 'B' }, { id: 'lib_c', name: 'C' }];
    const client = createDeltaClient();
    expect(store.commit({
      savedAt: fx.savedAt, baseAt: 0, version: 1, order: fx.order, sessions: fx.sessions, delta: client.diff(g),
    }).status).toBe(204);
    client.ack();
    g.library = [{ id: 'lib_c', name: 'C' }, { id: 'lib_a', name: 'A' }, { id: 'lib_b', name: 'B' }];
    const order = [fx.order[2], fx.order[0], fx.order[1], fx.order[3]];
    expect(store.commit({
      savedAt: fx.savedAt + 1000, baseAt: fx.savedAt, version: 1, order, sessions: {}, delta: client.diff(g),
    }).status).toBe(204);
    const state = JSON.parse(store.read()).state;
    expect(state.library.map((item) => item.id)).toEqual(['lib_c', 'lib_a', 'lib_b']);
    expect(Object.keys(state.sessions)).toEqual(order);
    store.close();
  });
});

describe('Part 2: Robustness of B (409 holds, network abort idempotency, randomized conflicts)', () => {
  it('holds the local copy on a 409 and does not overwrite a concurrent edit of the same record', async () => {
    const dir = mkdtempSync(join(ROOT, 'rebase-'));
    const store = createStoreBA(dir);
    const fx = buildFixture({ sessions: 6, items: 16, generations: 30, spend: 20, assets: 15 });

    // Initial seed on server via client0.
    const c0 = createDeltaClient();
    expect(store.commit({
      savedAt: fx.savedAt,
      baseAt: 0,
      version: 1,
      order: fx.order,
      sessions: fx.sessions,
      delta: c0.diff(JSON.parse(fx.globals)),
    }).status).toBe(204);
    c0.ack();

    const initialText = store.read();
    // Both clientA and clientB hydrate from the same server state (savedAt = fx.savedAt).
    const clientA = createResilientDeltaClient({ initialServerText: initialText });
    const clientB = createResilientDeltaClient({ initialServerText: initialText });

    // Client B makes concurrent changes and commits them first (moving server savedAt to fx.savedAt + 1000).
    const stateB = clientB.getLocalState();
    stateB.globals.generations.gen_b1 = makeGeneration(1001, rng(1001), 6);
    stateB.globals.generations.gen_2 = { ...stateB.globals.generations.gen_2, status: 'done', prompt: 'updated by B' };
    delete stateB.globals.generations.gen_3;
    stateB.globals.assets.ast_b1 = makeAsset(1001, rng(1001));
    stateB.globals.library.push({ id: 'lib_b1', title: 'Library B1' });
    stateB.globals.spendLog.push(makeSpend(1001));
    stateB.globals.spentUsd = Number(stateB.globals.spendLog.reduce((a, e) => a + e.usd, 0).toFixed(4));
    stateB.sessions[sessionId(1)] = makeSession(1, 50, { items: 16 });

    const resB = await clientB.sync({
      sendCommit: async (b) => store.commit(b),
      readServer: async () => store.read(),
      nextSavedAt: fx.savedAt + 1000,
    });
    expect(resB.status).toBe(204);
    expect(resB.rebases).toBe(0);

    const serverAfterB = store.read();

    // Meanwhile Client A (still at baseAt = fx.savedAt) edits the SAME generation B already changed, and reorders sessions.
    const stateA = clientA.getLocalState();
    stateA.globals.generations.gen_2 = { ...stateA.globals.generations.gen_2, prompt: 'updated by A' };
    stateA.order = [stateA.order[1], stateA.order[0], ...stateA.order.slice(2)];

    let sends = 0;
    const resA = await clientA.sync({
      sendCommit: async (b) => { sends++; return store.commit(b); },
      readServer: async () => store.read(),
      nextSavedAt: fx.savedAt + 1000,
    });
    expect(resA.status).toBe(409);
    expect(resA.reason).toBe('conflict');
    expect(resA.held).toBe(true);
    expect(sends).toBe(1);
    expect(store.read()).toBe(serverAfterB);
    expect(clientA.getLocalState().globals.generations.gen_2.prompt).toBe('updated by A');
    expect(resA.copy.globals.generations.gen_2.prompt).toBe('updated by A');
    expect(resA.copy.order).toEqual(stateA.order);

    const again = await clientA.sync({
      sendCommit: async () => { sends++; return { status: 204 }; },
      readServer: async () => store.read(),
      nextSavedAt: fx.savedAt + 5000,
    });
    expect(again.held).toBe(true);
    expect(sends).toBe(1);
    expect(JSON.parse(store.read()).state.generations.gen_2.prompt).toBe('updated by B');

    const db = new DatabaseSync(store.file, { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM spend').get().n).toBe(21);
    db.close();
    store.close();
  });

  it('preserves pending delta across pre-commit and post-commit network aborts and resends idempotently', async () => {
    const dir = mkdtempSync(join(ROOT, 'abort-'));
    const store = createStoreBA(dir);
    const fx = buildFixture({ sessions: 5, items: 12, generations: 20, spend: 10, assets: 10 });
    const c0 = createDeltaClient();
    store.commit({
      savedAt: fx.savedAt,
      baseAt: 0,
      version: 1,
      order: fx.order,
      sessions: fx.sessions,
      delta: c0.diff(JSON.parse(fx.globals)),
    });
    c0.ack();

    const client = createResilientDeltaClient({ initialServerText: store.read() });
    const st = client.getLocalState();
    st.globals.generations.gen_net1 = makeGeneration(501, rng(501), 5);
    st.globals.spendLog.push(makeSpend(501));
    st.globals.spentUsd = Number(st.globals.spendLog.reduce((a, e) => a + e.usd, 0).toFixed(4));

    let calls = 0;
    // Call 1: pre-commit abort (throws before reaching store.commit).
    // Call 2: post-commit abort (reaches store.commit and commits 204, then throws network error before client gets ack!).
    // Call 3: the ack was lost, so baseAt is stale. That 409 holds the local copy and does not send again.
    const res = await client.sync({
      sendCommit: async (body) => {
        calls++;
        if (calls === 1) throw new Error('ECONNRESET before server commit');
        if (calls === 2) {
          const r = store.commit(body);
          expect(r.status).toBe(204);
          throw new Error('ECONNRESET after server commit (lost ack)');
        }
        return store.commit(body);
      },
      readServer: async () => store.read(),
      nextSavedAt: fx.savedAt + 1000,
    });

    expect(res.status).toBe(409);
    expect(res.held).toBe(true);
    expect(res.aborts).toBe(2);
    expect(calls).toBe(3);
    expect(res.copy.globals.generations.gen_net1).toBeDefined();

    const db = new DatabaseSync(store.file, { readOnly: true });
    // Call 2 committed once. Call 3 did not rebase and did not insert again.
    expect(db.prepare('SELECT COUNT(*) AS n FROM spend').get().n).toBe(11);
    expect(db.prepare("SELECT COUNT(*) AS n FROM gen_history WHERE id = 'gen_net1'").get().n).toBe(1);
    db.close();
    store.close();
  });

  it('randomized test includes same-record edits and session reorders, and a 409 keeps both sides', async () => {
    let sameHits = 0;
    let reorderHits = 0;
    let conflicts = 0;
    for (const seed of [101, 202, 303, 404, 505]) {
      const pick = rng(seed);
      const dir = mkdtempSync(join(ROOT, `rand-${seed}-`));
      const store = createStoreBA(dir);
      const fx = buildFixture({ sessions: 6, items: 10, generations: 25, spend: 15, assets: 12, seed });
      const seedClient = createDeltaClient();
      expect(store.commit({
        savedAt: fx.savedAt, baseAt: 0, version: 1, order: fx.order, sessions: fx.sessions,
        delta: seedClient.diff(JSON.parse(fx.globals)),
      }).status).toBe(204);
      seedClient.ack();
      let client = createResilientDeltaClient({ initialServerText: store.read() });

      for (let step = 1; step <= 12; step++) {
        const local = client.getLocalState();
        const mark = `a_${seed}_${step}`;
        local.globals.generations.gen_1 = { ...local.globals.generations.gen_1, prompt: mark };
        let reordered = false;
        if (step % 2 === 0) {
          const shifted = [...local.order];
          shifted.unshift(shifted.pop());
          local.order = shifted;
          reordered = true;
        }
        const peer = pick() < 0.65;
        if (peer) {
          const before = store.read();
          const other = createResilientDeltaClient({ initialServerText: before });
          const st = other.getLocalState();
          st.globals.generations.gen_1 = { ...st.globals.generations.gen_1, prompt: `b_${seed}_${step}` };
          if (reordered) {
            const shifted = [...st.order];
            shifted.push(shifted.shift());
            st.order = shifted;
          }
          const at = JSON.parse(before).savedAt + 400;
          const peerRes = await other.sync({
            sendCommit: async (b) => store.commit(b),
            readServer: async () => store.read(),
            nextSavedAt: at,
          });
          expect(peerRes.status).toBe(204);
        }
        const serverBefore = store.read();
        const res = await client.sync({
          sendCommit: async (b) => store.commit(b),
          readServer: async () => store.read(),
          nextSavedAt: (base) => base + 1000,
        });
        if (peer) {
          expect(res.status).toBe(409);
          expect(res.held).toBe(true);
          expect(store.read()).toBe(serverBefore);
          expect(JSON.parse(serverBefore).state.generations.gen_1.prompt).toBe(`b_${seed}_${step}`);
          expect(client.getLocalState().globals.generations.gen_1.prompt).toBe(mark);
          let sent = false;
          const again = await client.sync({
            sendCommit: async () => { sent = true; return { status: 204 }; },
            readServer: async () => store.read(),
            nextSavedAt: 1,
          });
          expect(sent).toBe(false);
          expect(again.held).toBe(true);
          conflicts++;
          sameHits++;
          if (reordered) reorderHits++;
          client = createResilientDeltaClient({ initialServerText: store.read() });
        } else {
          expect(res.status).toBe(204);
          expect(JSON.parse(store.read()).state.generations.gen_1.prompt).toBe(mark);
          if (reordered) expect(Object.keys(JSON.parse(store.read()).state.sessions)[0]).toBe(local.order[0]);
        }
      }
      store.close();
    }
    expect(conflicts).toBeGreaterThan(5);
    expect(sameHits).toBeGreaterThan(5);
    expect(reorderHits).toBeGreaterThan(2);
  });

});

describe('Part 3: Migration from format 2 (store-v2 -> store-ba)', () => {
  it('copies store-v2 to backups first, imports in one transaction, verifies sha256 match, and leaves store-v2 untouched', async () => {
    const dir = mkdtempSync(join(ROOT, 'mig-'));
    const v2 = createStoreV2(dir);
    const fx = buildFixture({ sessions: 12, items: 25, generations: 500, spend: 300, assets: 200 });
    expect((await v2.commit(fx)).status).toBe(204);
    // Perform a second format-2 commit updating one session so store-v2 is exercised realistically.
    const g2 = JSON.parse(fx.globals);
    g2.ui.zoom = 1.4;
    g2.library = [{ id: 'lib_1', name: 'Brush' }];
    expect((await v2.commit({
      savedAt: fx.savedAt + 1000,
      baseAt: fx.savedAt,
      version: 1,
      globals: json(g2),
      order: fx.order,
      sessions: { [sessionId(0)]: json(makeSession(0, 9, { items: 25 })) },
    })).status).toBe(204);

    // Snapshot every file in store-v2 before migration to prove it is untouched.
    const v2BeforeText = await v2.read();
    const v2BeforeSha = stateSha(v2BeforeText);
    const v2RawBeforeSha = sha256(v2BeforeText);
    const headBefore = readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8');
    const globalsBefore = readFileSync(join(dir, 'store-v2', 'globals.json'), 'utf8');
    const sessFilesBefore = readdirSync(join(dir, 'store-v2', 'sessions')).sort();
    const sessHashesBefore = sessFilesBefore.map((f) => [f, sha256(readFileSync(join(dir, 'store-v2', 'sessions', f), 'utf8'))]);

    const res = await migrateFromV2(dir);
    expect(res.ok).toBe(true);
    expect(res.sha).toBe(v2BeforeSha);
    expect(res.readSource).toBe('copy');

    // 1. Backup folder was created with exact copies of HEAD.json, globals.json, sessions/*.json.
    expect(existsSync(join(res.backupDir, 'HEAD.json'))).toBe(true);
    expect(readFileSync(join(res.backupDir, 'HEAD.json'), 'utf8')).toBe(headBefore);
    expect(readFileSync(join(res.backupDir, 'globals.json'), 'utf8')).toBe(globalsBefore);
    expect(readdirSync(join(res.backupDir, 'sessions')).sort()).toEqual(sessFilesBefore);

    // 2. Reopening store-ba reads from copy AND from tables with the exact v2 stateSha (and byte-for-byte canonicalStateText).
    const ba = createStoreBA(dir);
    expect(ba.read()).toBe(canonicalStateText(v2BeforeText));
    expect(stateSha(ba.read())).toBe(v2BeforeSha);
    expect(ba.lastReadSource()).toBe('copy');
    rmSync(ba.cacheFile, { force: true });
    expect(ba.read()).toBe(canonicalStateText(v2BeforeText));
    expect(stateSha(ba.read())).toBe(v2BeforeSha);
    expect(ba.lastReadSource()).toBe('tables');
    ba.close();

    // 3. store-v2 is completely untouched: rollback is just pointing back to createStoreV2(dir).
    expect(readFileSync(join(dir, 'store-v2', 'HEAD.json'), 'utf8')).toBe(headBefore);
    expect(readFileSync(join(dir, 'store-v2', 'globals.json'), 'utf8')).toBe(globalsBefore);
    const sessHashesAfter = readdirSync(join(dir, 'store-v2', 'sessions')).sort().map((f) => [f, sha256(readFileSync(join(dir, 'store-v2', 'sessions', f), 'utf8'))]);
    expect(sessHashesAfter).toEqual(sessHashesBefore);
    expect(sha256(await v2.read())).toBe(v2RawBeforeSha);
  });

  it('recovers cleanly when killed with SIGKILL (kill -9) mid-import and succeeds on rerun', async () => {
    const dir = mkdtempSync(join(ROOT, 'mig-kill-'));
    const v2 = createStoreV2(dir);
    const fx = buildFixture({ sessions: 10, items: 20, generations: 400, spend: 200, assets: 150 });
    expect((await v2.commit(fx)).status).toBe(204);
    const v2RawSha = sha256(await v2.read());
    const v2Sha = stateSha(await v2.read());

    // Test SIGKILL at three points: mid-copy, mid-SQLite-transaction ('globals'), and post-commit ('before-verify').
    for (const killPoint of ['after-copy-tmp', 'globals', 'before-verify']) {
      const child = spawn(process.execPath, ['--no-warnings', MIGRATE_SCRIPT, '--child', dir, killPoint], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const [code, signal] = await once(child, 'exit');
      expect(signal === 'SIGKILL' || code !== 0).toBe(true);

      // When killed mid-transaction ('globals'), SQLite must roll back completely (read() === null).
      if (killPoint === 'globals') {
        const checkStore = createStoreBA(dir);
        expect(checkStore.read()).toBeNull();
        checkStore.close();
      }
      // In all cases, store-v2 must still be intact and readable.
      expect(sha256(await v2.read())).toBe(v2RawSha);
    }

    // Now rerun migrateFromV2(dir) to completion and verify sha256 matches v2.
    const res = await migrateFromV2(dir);
    expect(res.ok).toBe(true);
    expect(res.sha).toBe(v2Sha);

    const ba = createStoreBA(dir);
    expect(stateSha(ba.read())).toBe(v2Sha);
    expect(ba.lastReadSource()).toBe('copy');
    ba.close();
  });

  it('stops a second migration when sqlite differs and does not delete it', async () => {
    const dir = mkdtempSync(join(ROOT, 'mig-keep-'));
    const v2 = createStoreV2(dir);
    const fx = buildFixture({ sessions: 4, items: 6, generations: 12, spend: 4, assets: 4 });
    expect((await v2.commit(fx)).status).toBe(204);
    await migrateFromV2(dir);
    const ba = createStoreBA(dir);
    const client = createResilientDeltaClient({ initialServerText: ba.read() });
    client.getLocalState().globals.ui.zoom = 3.5;
    const savedAt = JSON.parse(ba.read()).savedAt;
    const synced = await client.sync({
      sendCommit: async (b) => ba.commit(b),
      readServer: async () => ba.read(),
      nextSavedAt: savedAt + 1000,
    });
    expect(synced.status).toBe(204);
    ba.close();
    const dbPath = join(dir, 'ogs.sqlite');
    const before = readFileSync(dbPath);
    await expect(migrateFromV2(dir)).rejects.toThrow(/left intact/);
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    const again = createStoreBA(dir);
    expect(JSON.parse(again.read()).state.ui.zoom).toBe(3.5);
    again.close();
  });
});
