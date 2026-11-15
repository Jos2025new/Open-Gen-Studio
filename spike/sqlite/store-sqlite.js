// SPIKE, not production. SQLite version of server/store-v2.js with the same read() / commit(body) contract:
// same body, same 409 on a stale baseAt, same loss guard (server/save-guard.js, imported unchanged), and sessions +
// globals + head written in ONE transaction. Generations and spend live in append-only tables instead of globals.
// Layout: <dir>/ogs.sqlite (+ -wal, -shm) and <dir>/backups/ (periodic VACUUM INTO copies, like v2-* snapshots).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { looksLost, sha256 } from '../../server/save-guard.js';
import { assembleText } from '../../server/store-v2.js';

export const SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const KEPT = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const JOURNAL_LIMIT = 64 * 1024 * 1024;
const json = (v) => JSON.stringify(v);

const MIGRATION_1 = `
CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, version INTEGER NOT NULL,
  order_json TEXT NOT NULL, spend_len INTEGER NOT NULL, spend_last INTEGER NOT NULL);
CREATE TABLE globals (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
-- Append-only history of generations: every change is a new row; deleted = tombstone row (deleted = 1).
CREATE TABLE generations (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL,
  session_id TEXT, refs TEXT NOT NULL, meta TEXT NOT NULL, deleted INTEGER NOT NULL);
-- Current view: one row per live generation, pointing at its newest event and keeping the object order (pos).
CREATE TABLE gen_head (id TEXT PRIMARY KEY, pos INTEGER NOT NULL, hash TEXT NOT NULL, seq INTEGER NOT NULL);
-- Append-only spend log: rows are never updated; the window of the app's spendLog is head.spend_len rows ending at spend_last.
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL,
  session_id TEXT, refs TEXT NOT NULL, meta TEXT NOT NULL);
CREATE TABLE removed_sessions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, removed_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE copies (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
`;

function migrate(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v > SCHEMA_VERSION) throw new Error(`store written by a newer version (${v})`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('PRAGMA user_version').get().user_version === 0) {
      db.exec(MIGRATION_1);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Keys for a spend window: content hash + occurrence index inside the array (identical entries stay distinct). */
function spendKeys(list) {
  const occ = new Map();
  return list.map((e) => {
    const h = sha256(json(e));
    const n = occ.get(h) ?? 0;
    occ.set(h, n + 1);
    return `${h}#${n}`;
  });
}

/**
 * @param {string} dir data folder of the spike (created if missing)
 * @param {{ synchronous?: 'FULL'|'NORMAL', fault?: (point: string) => void }} [opts] fault: test hook, throws to simulate a crash mid-commit
 */
export function createStoreSqlite(dir, opts = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'ogs.sqlite');
  const backups = join(dir, 'backups');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = ${opts.synchronous ?? 'FULL'}; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = ${JOURNAL_LIMIT};`);
  migrate(db);
  const q = {
    headGet: db.prepare('SELECT saved_at, version, order_json, spend_len, spend_last FROM head WHERE id = 1'),
    headPut: db.prepare('INSERT OR REPLACE INTO head (id, saved_at, version, order_json, spend_len, spend_last) VALUES (1, ?, ?, ?, ?, ?)'),
    globalsGet: db.prepare('SELECT json FROM globals WHERE id = 1'),
    globalsPut: db.prepare('INSERT OR REPLACE INTO globals (id, json) VALUES (1, ?)'),
    sessGet: db.prepare('SELECT json FROM sessions WHERE id = ?'),
    sessIds: db.prepare('SELECT id FROM sessions'),
    sessPut: db.prepare('INSERT INTO sessions (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'),
    sessDel: db.prepare('DELETE FROM sessions WHERE id = ?'),
    removedPut: db.prepare('INSERT INTO removed_sessions (id, removed_at, json) VALUES (?, ?, ?)'),
    copyPut: db.prepare('INSERT INTO copies (ts, kind, payload) VALUES (?, ?, ?)'),
    genHeads: db.prepare('SELECT id, pos, hash, seq FROM gen_head'),
    genEvent: db.prepare('INSERT INTO generations (id, ts, session_id, refs, meta, deleted) VALUES (?, ?, ?, ?, ?, ?)'),
    genHeadPut: db.prepare('INSERT OR REPLACE INTO gen_head (id, pos, hash, seq) VALUES (?, ?, ?, ?)'),
    genHeadDel: db.prepare('DELETE FROM gen_head WHERE id = ?'),
    genRead: db.prepare('SELECT h.id AS id, e.meta AS meta FROM gen_head h JOIN generations e ON e.seq = h.seq ORDER BY h.pos'),
    spendPut: db.prepare('INSERT OR IGNORE INTO spend (id, ts, session_id, refs, meta) VALUES (?, ?, ?, ?, ?)'),
    spendSeqOf: db.prepare('SELECT seq FROM spend WHERE id = ?'),
    spendIdOf: db.prepare('SELECT id FROM spend WHERE seq = ?'),
    spendTail: db.prepare('SELECT meta FROM spend WHERE seq <= ? ORDER BY seq DESC LIMIT ?'),
  };
  const fault = (point) => opts.fault?.(point);
  let lastSnapshot = 0;

  /** Whole state as format-1 text (same text as store-v2 read()), or null when no commit has happened yet. */
  function read() {
    const h = q.headGet.get();
    if (!h) return null;
    const rest = q.globalsGet.get()?.json;
    if (rest == null) throw new Error('store corrupt: head without globals');
    const order = JSON.parse(h.order_json);
    // Generations and spend are assembled as text: their rows already hold JSON.
    const gens = q.genRead.all().map((r) => `${json(r.id)}:${r.meta}`).join(',');
    const spend = h.spend_len ? q.spendTail.all(h.spend_last, h.spend_len).reverse().map((r) => r.meta).join(',') : '';
    const inner = rest.slice(1, -1);
    const globals = `{${inner}${inner ? ',' : ''}"generations":{${gens}},"spendLog":[${spend}]}`;
    const sessions = {};
    for (const id of order) {
      const row = q.sessGet.get(id);
      if (!row) throw new Error(`store corrupt: session ${id} is in the order but not in the table`);
      sessions[id] = row.json;
    }
    return assembleText({ savedAt: h.saved_at, version: h.version, globals, order, sessions });
  }

  function writeGenerations(gens, savedAt) {
    const heads = new Map(q.genHeads.all().map((r) => [r.id, r]));
    let nextPos = 0;
    for (const r of heads.values()) nextPos = Math.max(nextPos, r.pos + 1);
    const seen = new Set();
    for (const [id, g] of Object.entries(gens)) {
      seen.add(id);
      const meta = json(g);
      const hash = sha256(meta);
      const cur = heads.get(id);
      if (cur && cur.hash === hash) continue;
      const seq = Number(q.genEvent.run(id, savedAt, g?.sessionId ?? null, json(g?.inputs?.refs ?? []), meta, 0).lastInsertRowid);
      q.genHeadPut.run(id, cur ? cur.pos : nextPos++, hash, seq);
    }
    for (const id of heads.keys()) {
      if (seen.has(id)) continue;
      q.genEvent.run(id, savedAt, null, '[]', '{}', 1);
      q.genHeadDel.run(id);
    }
  }

  function writeSpend(list) {
    const keys = spendKeys(list);
    const h = q.headGet.get();
    // The stored window ends at spend_last; only the entries after that key are new (the app only appends and trims the front).
    let start = 0;
    if (h && h.spend_len && h.spend_last) {
      const lastKey = q.spendIdOf.get(h.spend_last)?.id;
      const at = keys.indexOf(lastKey);
      if (at >= 0) start = at + 1;
    }
    for (let i = start; i < list.length; i++) {
      const e = list[i];
      q.spendPut.run(keys[i], e.at, e.sessionId ?? null, '[]', json(e));
    }
    return {
      len: list.length,
      last: list.length ? Number(q.spendSeqOf.get(keys[keys.length - 1]).seq) : 0,
    };
  }

  function commitTx(body) {
    const { savedAt, baseAt, version, globals, order, sessions = {}, keep } = body;
    const head = q.headGet.get();
    const current = head ? head.saved_at : 0;
    if (current && current !== baseAt) return { status: 409, reason: 'conflict', savedAt: current };

    for (const id of order) {
      if (!(id in sessions) && !q.sessGet.get(id)) return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
    }
    // Same loss rules as store-v2.js: a total loss, and each session that loses most of its user content.
    const prevOrder = head ? JSON.parse(head.order_json) : [];
    const had = prevOrder.length, has = order.length;
    const total = had >= 2 && has < had / 2 ? { diskOrderHash: sha256(json(prevOrder)) } : null;
    const totalOk = total && keep?.total?.diskOrderHash === total.diskOrderHash && keep.total.candidateOrderHash === sha256(json(order));
    const approved = new Map((Array.isArray(keep?.sessions) ? keep.sessions : []).map((k) => [k.sessionId, k]));
    const losses = [], kept = [];
    for (const [id, text] of Object.entries(sessions)) {
      const prev = q.sessGet.get(id)?.json;
      if (prev == null || !looksLost(prev, text)) continue;
      const diskHash = sha256(prev), k = approved.get(id);
      if (k && k.diskHash === diskHash && k.candidateHash === sha256(text)) kept.push([id, prev]);
      else losses.push({ sessionId: id, diskHash, text });
    }
    const now = Date.now();
    if ((total && !totalOk) || losses.length) {
      // Refused: the payload is kept in copies (the only write of this transaction); the state is not touched.
      const first = losses[0];
      const copyId = Number(q.copyPut.run(now, first ? `rejected-session-${first.sessionId}` : 'rejected', first ? first.text : json(body)).lastInsertRowid);
      for (const l of losses.slice(1)) q.copyPut.run(now, `rejected-session-${l.sessionId}`, l.text);
      return {
        status: 409, reason: 'possible-loss', ...(first ? { sessionId: first.sessionId, diskHash: first.diskHash } : {}),
        losses: losses.map(({ sessionId, diskHash }) => ({ sessionId, diskHash })), ...(total ? { total } : {}),
        rejectedFile: `copies/${copyId}`, savedAt: current,
      };
    }
    if (totalOk) q.copyPut.run(now, 'kept-before-order', json(head ?? {}));
    for (const [id, prev] of kept) q.copyPut.run(now, `kept-before-${id}`, prev);

    const parsedGlobals = JSON.parse(globals);
    const { generations = {}, spendLog = [], ...rest } = parsedGlobals;
    for (const [id, text] of Object.entries(sessions)) q.sessPut.run(id, text);
    fault('sessions');
    writeGenerations(generations, savedAt);
    const spend = writeSpend(spendLog);
    q.globalsPut.run(json(rest));
    fault('globals');
    // Sessions no longer in the order move to removed_sessions: nothing is deleted.
    const known = new Set(order);
    for (const { id } of q.sessIds.all()) {
      if (known.has(id)) continue;
      q.removedPut.run(id, now, q.sessGet.get(id).json);
      q.sessDel.run(id);
    }
    fault('head');
    q.headPut.run(savedAt, version, json(order), spend.len, spend.last);
    return { status: 204, savedAt };
  }

  /** One commit = one transaction (BEGIN IMMEDIATE .. COMMIT). Returns { status, savedAt } like store-v2 commit(). */
  function commit(body) {
    const { savedAt, version, globals, order, sessions = {} } = body;
    if (!Number.isFinite(savedAt) || !Array.isArray(order)) return { status: 400, reason: 'savedAt and order are required' };
    if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
    if (typeof globals !== 'string' || !globals.startsWith('{') || !globals.endsWith('}')) return { status: 400, reason: 'globals must be a JSON text (a string), not an object' };
    if (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
    for (const [id, text] of Object.entries(sessions)) {
      if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
      if (!order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
    }
    db.exec('BEGIN IMMEDIATE');
    let r;
    try {
      r = commitTx(body);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    if (r.status === 204) snapshot();
    return r;
  }

  function snapshot() {
    if (Date.now() - lastSnapshot < SNAPSHOT_EVERY_MS) return;
    lastSnapshot = Date.now();
    mkdirSync(backups, { recursive: true });
    db.exec(`VACUUM INTO '${join(backups, `v2sqlite-${Date.now()}.db`)}'`);
    const kept = readdirSync(backups).filter((f) => f.startsWith('v2sqlite-')).sort();
    for (const f of kept.slice(0, -KEPT)) rmSync(join(backups, f), { force: true });
  }

  /** Sizes in bytes: the database, its WAL and its shared memory file (0 when absent). */
  function sizes() {
    const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
    return { db: size(file), wal: size(`${file}-wal`), shm: size(`${file}-shm`) };
  }

  return { read, commit, sizes, close: () => db.close(), file, schemaVersion: () => db.prepare('PRAGMA user_version').get().user_version };
}
