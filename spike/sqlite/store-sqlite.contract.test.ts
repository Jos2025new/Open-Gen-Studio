// @ts-nocheck -- spike: plain JS modules without types, same as the rest of the spike.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createStoreSqlite } from './store-sqlite.js';
import { S, expectedState, sessionId, stepBody } from './fixture.mjs';
import { sha256 } from '../../server/save-guard.js';

const ROOT = '/tmp/ogs-sqlite-spike-data';
const ITEMS = 60; // big enough that a session is over the 4 KB guard threshold
const json = JSON.stringify;

beforeAll(() => mkdirSync(ROOT, { recursive: true }));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

let store;
let dir;
beforeEach(() => {
  if (store) store.close();
  dir = mkdtempSync(join(ROOT, 't-'));
  store = createStoreSqlite(dir);
});

/** Parses read() and returns { savedAt, globals (without sessions), sessions }. */
function parsed() {
  const o = JSON.parse(store.read());
  const { sessions, ...globals } = o.state;
  return { savedAt: o.savedAt, globals, sessions };
}

/** Commits step k (all sessions at k=1, one changed session later) and moves the base along. */
function step(k, baseAt = S(k - 1)) {
  return store.commit(stepBody(k, k === 1 ? 0 : baseAt, { items: ITEMS }));
}

/** Seeds k = 1..n so the store holds the expected state at step n. */
function seed(n) {
  for (let k = 1; k <= n; k++) expect(step(k).status).toBe(204);
}

describe('contract: read / commit', () => {
  it('reads null before any commit and uses user_version 1', () => {
    expect(store.read()).toBeNull();
    expect(store.schemaVersion()).toBe(1);
  });

  it('a commit reads back the same state (globals and sessions, semantically)', () => {
    seed(3);
    const exp = expectedState(3, { items: ITEMS });
    const got = parsed();
    expect(got.savedAt).toBe(S(3));
    expect(isDeepStrictEqual(got.globals, exp.globals)).toBe(true);
    expect(isDeepStrictEqual(got.sessions, exp.sessions)).toBe(true);
  });

  it('refuses a stale baseAt with 409 conflict and leaves the state unchanged', () => {
    seed(3);
    const before = store.read();
    const r = store.commit(stepBody(4, S(2), { items: ITEMS }));
    expect(r).toEqual({ status: 409, reason: 'conflict', savedAt: S(3) });
    expect(store.read()).toBe(before);
  });

  it('refuses a body with a session that is neither sent nor stored (400, names the session)', () => {
    seed(1);
    const body = stepBody(2, S(1), { items: ITEMS });
    body.order = [...body.order, 'ses_new'];
    const r = store.commit(body);
    expect(r.status).toBe(400);
    expect(r.reason).toMatch(/ses_new/);
  });

  it('rejects a bad body before touching the database', () => {
    expect(store.commit({ savedAt: 1, version: 1, globals: '[]', order: [] }).status).toBe(400);
    expect(store.commit({ savedAt: 1, version: 1, globals: '{}', order: ['a', 'a'] }).status).toBe(400);
  });
});

describe('contract: loss guard', () => {
  it('refuses a session that loses most of its user content (409 possible-loss), keeps a copy, and accepts it only with the exact approval', () => {
    seed(2);
    const id = sessionId(0);
    const prev = json(expectedState(1, { items: ITEMS }).sessions[id]);
    const tiny = json({ id, feed: [] });
    const body = stepBody(3, S(2), { items: ITEMS });
    body.sessions[id] = tiny;
    const r = store.commit(body);
    expect(r.status).toBe(409);
    expect(r.reason).toBe('possible-loss');
    expect(r.sessionId).toBe(id);
    expect(r.diskHash).toBe(sha256(prev));
    expect(parsed().sessions[id].feed.length).toBeGreaterThan(0); // unchanged

    const approved = stepBody(3, S(2), { items: ITEMS });
    approved.sessions[id] = tiny;
    approved.keep = { sessions: [{ sessionId: id, diskHash: sha256(prev), candidateHash: sha256(tiny) }] };
    expect(store.commit(approved).status).toBe(204);
    expect(parsed().sessions[id].feed).toEqual([]);
  });

  it('refuses a total loss (fewer than half of the sessions) unless the exact order is approved', () => {
    seed(2);
    const prevOrder = Object.keys(parsed().sessions);
    const body = stepBody(3, S(2), { items: ITEMS });
    body.order = body.order.slice(0, 10);
    for (const id of Object.keys(body.sessions)) if (!body.order.includes(id)) delete body.sessions[id];
    const r = store.commit(body);
    expect(r.status).toBe(409);
    expect(r.reason).toBe('possible-loss');
    expect(r.total.diskOrderHash).toBe(sha256(json(prevOrder)));
    expect(Object.keys(parsed().sessions)).toHaveLength(prevOrder.length); // nothing removed

    const approved = { ...body, keep: { total: { diskOrderHash: sha256(json(prevOrder)), candidateOrderHash: sha256(json(body.order)) } } };
    expect(store.commit(approved).status).toBe(204);
    expect(Object.keys(parsed().sessions)).toHaveLength(10);
  });

  it('moves a session that leaves the order to removed_sessions (nothing is deleted)', () => {
    seed(2);
    const body = stepBody(3, S(2), { items: ITEMS });
    const gone = body.order.pop();
    // The total-loss rule does not apply to one session out of 50; the removal is recorded.
    expect(store.commit(body).status).toBe(204);
    expect(parsed().sessions[gone]).toBeUndefined();
    const db = new DatabaseSync(store.file);
    const n = db.prepare('SELECT COUNT(*) AS n FROM removed_sessions WHERE id = ?').get(gone).n;
    db.close();
    expect(n).toBe(1);
  });
});

describe('contract: append-only history', () => {
  it('a generation that leaves the window becomes a tombstone row; old rows are never rewritten', () => {
    // Step k keeps generations k-299..k, so generation 1 leaves at step 301.
    const db0 = () => new DatabaseSync(store.file);
    seed(1);
    for (let k = 2; k <= 300; k++) expect(step(k).status).toBe(204);
    const db = db0();
    const firstRow = db.prepare('SELECT meta FROM generations WHERE id = ? ORDER BY seq LIMIT 1').get('gen_1').meta;
    const before = db.prepare('SELECT COUNT(*) AS n FROM generations').get().n;
    db.close();
    expect(step(301).status).toBe(204);
    const after = db0();
    const tomb = after.prepare('SELECT deleted FROM generations WHERE id = ? ORDER BY seq DESC LIMIT 1').get('gen_1');
    const same = after.prepare('SELECT meta FROM generations WHERE id = ? ORDER BY seq LIMIT 1').get('gen_1').meta;
    const n = after.prepare('SELECT COUNT(*) AS n FROM generations').get().n;
    after.close();
    expect(tomb.deleted).toBe(1);
    expect(same).toBe(firstRow);
    expect(n).toBeGreaterThan(before);
    expect(parsed().globals.generations.gen_1).toBeUndefined();
  });

  it('spend keeps every entry in the table while the state holds only the app window', () => {
    seed(1);
    for (let k = 2; k <= 310; k++) expect(step(k).status).toBe(204);
    const db = new DatabaseSync(store.file);
    const rows = db.prepare('SELECT COUNT(*) AS n FROM spend').get().n;
    db.close();
    expect(rows).toBe(310);
    expect(parsed().globals.spendLog).toHaveLength(300);
    expect(isDeepStrictEqual(parsed().globals.spendLog, expectedState(310, { items: ITEMS }).globals.spendLog)).toBe(true);
  });
});

describe('contract: one transaction', () => {
  it('a crash in the middle of a commit leaves the previous state (rollback)', () => {
    seed(3);
    const before = store.read();
    const faulty = createStoreSqlite(dir, { fault: (p) => { if (p === 'globals') throw new Error('simulated crash'); } });
    expect(() => faulty.commit(stepBody(4, S(3), { items: ITEMS }))).toThrow('simulated crash');
    faulty.close();
    expect(store.read()).toBe(before);
  });
});
