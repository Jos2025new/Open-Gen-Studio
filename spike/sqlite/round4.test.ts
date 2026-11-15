// @ts-nocheck -- spike: plain JS modules without types, same as store-sqlite.contract.test.ts.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256 } from '../../server/save-guard.js';
import { assembleText, createStoreV2 } from '../../server/store-v2.js';
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
});

describe('Part 2: Robustness of B (409 rebase, network abort idempotency, randomized test)', () => {
  it('rebases pending delta on 409 conflict without losing or duplicating records', async () => {
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

    // Meanwhile Client A (still at baseAt = fx.savedAt) makes its own local edits:
    const stateA = clientA.getLocalState();
    stateA.globals.generations.gen_a1 = makeGeneration(2001, rng(2001), 6);
    stateA.globals.generations.gen_1 = { ...stateA.globals.generations.gen_1, prompt: 'updated by A' };
    delete stateA.globals.generations.gen_4;
    stateA.globals.assets.ast_a1 = makeAsset(2001, rng(2001));
    stateA.globals.library.push({ id: 'lib_a1', title: 'Library A1' });
    stateA.globals.spendLog.push(makeSpend(2001));
    stateA.globals.spentUsd = Number(stateA.globals.spendLog.reduce((a, e) => a + e.usd, 0).toFixed(4));
    stateA.globals.ui = { ...stateA.globals.ui, zoom: 2.25 };
    stateA.sessions[sessionId(2)] = makeSession(2, 77, { items: 16 });

    // First attempt by Client A must hit 409 conflict, rebase on B's state, and succeed on retry.
    const resA = await clientA.sync({
      sendCommit: async (b) => store.commit(b),
      readServer: async () => store.read(),
      nextSavedAt: fx.savedAt + 1000,
    });
    expect(resA.status).toBe(204);
    expect(resA.rebases).toBe(1);
    expect(resA.savedAt).toBe(fx.savedAt + 2000);

    const finalObj = JSON.parse(store.read());
    const finalG = finalObj.state;
    // Both B's and A's creations and updates are present; both deletions took effect.
    expect(finalG.generations.gen_b1).toBeDefined();
    expect(finalG.generations.gen_a1).toBeDefined();
    expect(finalG.generations.gen_2.prompt).toBe('updated by B');
    expect(finalG.generations.gen_1.prompt).toBe('updated by A');
    expect(finalG.generations.gen_3).toBeUndefined();
    expect(finalG.generations.gen_4).toBeUndefined();
    expect(finalG.assets.ast_b1).toBeDefined();
    expect(finalG.assets.ast_a1).toBeDefined();
    expect(finalG.library.map((x) => x.id)).toEqual(['lib_b1', 'lib_a1']);
    expect(finalG.spendLog).toHaveLength(22);
    expect(finalG.ui.zoom).toBe(2.25);
    expect(finalG.sessions[sessionId(1)].updatedAt).toBe(makeSession(1, 50, { items: 16 }).updatedAt);
    expect(finalG.sessions[sessionId(2)].updatedAt).toBe(makeSession(2, 77, { items: 16 }).updatedAt);

    // Check SQLite tables directly: no duplicate spend rows, no duplicate records.
    const db = new DatabaseSync(store.file, { readOnly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM spend').get().n).toBe(22);
    expect(db.prepare("SELECT COUNT(*) AS n FROM records WHERE coll = 'generations'").get().n).toBe(30);
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
    // Call 3: sees 409 because call 2 actually committed on the server, rebases idempotently, and commits 204!
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

    expect(res.status).toBe(204);
    expect(res.aborts).toBe(2);
    expect(res.rebases).toBe(1);

    const db = new DatabaseSync(store.file, { readOnly: true });
    // Even though gen_net1 and spend 501 were sent in Call 2 (committed) and rebased in Call 3:
    // 0 duplicate spend rows, 0 duplicate gen_history rows!
    expect(db.prepare('SELECT COUNT(*) AS n FROM spend').get().n).toBe(11);
    expect(db.prepare("SELECT COUNT(*) AS n FROM gen_history WHERE id = 'gen_net1'").get().n).toBe(1);
    db.close();
    store.close();
  });

  it('randomized test: interleaved edits, 409 conflicts and pre/post-commit aborts match reference state sha256', async () => {
    for (const seed of [101, 202, 303, 404, 505]) {
      const pick = rng(seed);
      const dir = mkdtempSync(join(ROOT, `rand-${seed}-`));
      const store = createStoreBA(dir);
      const fx = buildFixture({ sessions: 6, items: 10, generations: 25, spend: 15, assets: 12, seed });

      // Reference state tracker: maintains exact server insertion order and state without aborts or conflicts.
      const refDir = mkdtempSync(join(ROOT, `ref-${seed}-`));
      const refStore = createStoreBA(refDir);
      const refClient = createDeltaClient();

      const initG = JSON.parse(fx.globals);
      expect(store.commit({
        savedAt: fx.savedAt,
        baseAt: 0,
        version: 1,
        order: fx.order,
        sessions: fx.sessions,
        delta: createDeltaClient().diff(initG),
      }).status).toBe(204);

      const refState = {
        savedAt: fx.savedAt,
        version: 1,
        globals: JSON.parse(fx.globals),
        order: [...fx.order],
        sessions: Object.fromEntries(Object.entries(fx.sessions).map(([id, t]) => [id, JSON.parse(t)])),
      };
      const commitToRef = (savedAt) => {
        refState.savedAt = savedAt;
        const sessionsText = Object.fromEntries(refState.order.map((id) => [id, json(refState.sessions[id])]));
        const r = refStore.commit({
          savedAt,
          baseAt: refStore.read() ? JSON.parse(refStore.read()).savedAt : 0,
          version: 1,
          order: [...refState.order],
          sessions: sessionsText,
          delta: refClient.diff(refState.globals),
        });
        expect(r.status).toBe(204);
        refClient.ack();
      };
      commitToRef(fx.savedAt);

      const clientA = createResilientDeltaClient({ initialServerText: store.read() });
      let nextSeq = 1000;
      let total409 = 0, totalPreAbort = 0, totalPostAbort = 0;

      // Apply an edit function to a state object { globals, order, sessions }.
      const applyEdit = (target, op) => {
        const g = target.globals;
        if (op.type === 'addGen') {
          g.generations[op.id] = op.val;
        } else if (op.type === 'updGen') {
          if (g.generations[op.id]) g.generations[op.id] = { ...g.generations[op.id], ...op.patch };
        } else if (op.type === 'delGen') {
          delete g.generations[op.id];
        } else if (op.type === 'addAsset') {
          g.assets[op.id] = op.val;
        } else if (op.type === 'delAsset') {
          delete g.assets[op.id];
        } else if (op.type === 'addLib') {
          if (!g.library.some((x) => x.id === op.val.id)) g.library.push(op.val);
        } else if (op.type === 'addSpend') {
          if (!g.spendLog.some((x) => x.at === op.val.at && x.sessionId === op.val.sessionId)) {
            g.spendLog.push(op.val);
            g.spentUsd = g.spendLog.reduce((a, e) => a + e.usd, 0);
          }
        } else if (op.type === 'zoom') {
          g.ui = { ...g.ui, zoom: op.zoom };
        } else if (op.type === 'sess') {
          target.sessions[op.id] = op.val;
        }
      };

      const randomOp = (tag, stateSource, forbiddenIds = new Set()) => {
        const idNum = ++nextSeq;
        const roll = pick();
        const g = stateSource.globals;
        if (roll < 0.24) {
          return { type: 'addGen', id: `gen_${tag}_${idNum}`, val: makeGeneration(idNum, pick, 6) };
        }
        if (roll < 0.38) {
          const keys = Object.keys(g.generations).filter((k) => !forbiddenIds.has(k));
          if (keys.length > 0) {
            const id = keys[Math.floor(pick() * keys.length)];
            return { type: 'updGen', id, patch: { prompt: `edited_${tag}_${idNum}`, status: 'done' } };
          }
          return { type: 'addGen', id: `gen_${tag}_${idNum}`, val: makeGeneration(idNum, pick, 6) };
        }
        if (roll < 0.46) {
          const keys = Object.keys(g.generations).filter((k) => !forbiddenIds.has(k));
          if (keys.length > 5) {
            const id = keys[Math.floor(pick() * keys.length)];
            return { type: 'delGen', id };
          }
          return { type: 'addGen', id: `gen_${tag}_${idNum}`, val: makeGeneration(idNum, pick, 6) };
        }
        if (roll < 0.60) {
          return { type: 'addAsset', id: `ast_${tag}_${idNum}`, val: makeAsset(idNum, pick) };
        }
        if (roll < 0.68) {
          const keys = Object.keys(g.assets).filter((k) => !forbiddenIds.has(k));
          if (keys.length > 4) {
            const id = keys[Math.floor(pick() * keys.length)];
            return { type: 'delAsset', id };
          }
          return { type: 'addAsset', id: `ast_${tag}_${idNum}`, val: makeAsset(idNum, pick) };
        }
        if (roll < 0.78) {
          return { type: 'addLib', val: { id: `lib_${tag}_${idNum}`, name: `Item ${idNum}` } };
        }
        if (roll < 0.88) {
          return { type: 'addSpend', val: makeSpend(idNum) };
        }
        if (roll < 0.94 && !forbiddenIds.has('__zoom__')) {
          return { type: 'zoom', zoom: Number((0.5 + pick() * 2).toFixed(3)) };
        }
        const sCandidates = [0, 1, 2, 3, 4, 5].map((i) => sessionId(i)).filter((id) => !forbiddenIds.has(id));
        const sId = sCandidates.length ? sCandidates[Math.floor(pick() * sCandidates.length)] : sessionId(0);
        const sIdx = Number.parseInt(sId.slice(4), 36);
        return { type: 'sess', id: sId, val: makeSession(sIdx, idNum, { items: 10 }) };
      };

      // Queue of pending ops on clientA not yet committed to refState.
      let pendingOpsA = [];

      for (let step = 1; step <= 60; step++) {
        // Client A performs 1..3 local edits before attempting to sync.
        const nLocal = 1 + Math.floor(pick() * 3);
        for (let j = 0; j < nLocal; j++) {
          const op = randomOp('a', clientA.getLocalState());
          applyEdit(clientA.getLocalState(), op);
          pendingOpsA.push(op);
        }

        // With 40% probability, another writer (Client B) commits an edit directly on the server first -> forces 409!
        if (pick() < 0.4) {
          const serverText = store.read();
          const peer = createResilientDeltaClient({ initialServerText: serverText });
          const touchedByA = new Set(pendingOpsA.map((o) => o.id ?? (o.type === 'zoom' ? '__zoom__' : '')));
          const opB = randomOp('b', peer.getLocalState(), touchedByA);
          applyEdit(peer.getLocalState(), opB);
          const peerAt = JSON.parse(serverText).savedAt + 1000;
          const rPeer = await peer.sync({
            sendCommit: async (b) => store.commit(b),
            readServer: async () => store.read(),
            nextSavedAt: peerAt,
          });
          expect(rPeer.status).toBe(204);
          applyEdit(refState, opB);
          commitToRef(rPeer.savedAt);
        }

        // Decide fault injection for Client A's sync attempt.
        const faultRoll = pick();
        let injectPreAbort = faultRoll < 0.25;
        let injectPostAbort = !injectPreAbort && faultRoll < 0.45;

        const res = await clientA.sync({
          sendCommit: async (body) => {
            if (injectPreAbort) {
              injectPreAbort = false;
              totalPreAbort++;
              throw new Error('simulated pre-commit abort');
            }
            const r = store.commit(body);
            if (r.status === 204) {
              for (const op of pendingOpsA) applyEdit(refState, op);
              pendingOpsA = [];
              commitToRef(body.savedAt);
            }
            if (r.status === 204 && injectPostAbort) {
              injectPostAbort = false;
              totalPostAbort++;
              throw new Error('simulated post-commit abort (ack lost)');
            }
            if (r.status === 409) total409++;
            return r;
          },
          readServer: async () => store.read(),
          nextSavedAt: (base) => base + 1000,
        });

        expect(res.status).toBe(204);
      }

      expect(total409).toBeGreaterThan(5);
      expect(totalPreAbort).toBeGreaterThan(3);
      expect(totalPostAbort).toBeGreaterThan(2);

      // Final state sha256 must match the reference store sha256 byte-for-byte!
      const actualText = store.read();
      const refText = refStore.read();
      expect(sha256(actualText)).toBe(sha256(refText));

      store.close();
      refStore.close();
    }
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
});
