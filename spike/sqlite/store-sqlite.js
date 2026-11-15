// SPIKE, not production. SQLite version of server/store-v2.js, round 2. Same read() / commit(body) contract:
// same body, same 409 on a stale baseAt, same loss guard (server/save-guard.js, imported unchanged), and sessions +
// globals + head written in ONE transaction (BEGIN IMMEDIATE .. COMMIT, WAL, synchronous=FULL).
//
// Round 2 design (see RESULTADO.md):
// - globals are split by a structural scan of the body's text (no JSON.parse of the whole globals): scalars
//   (settings, ui, composer, ...) in one small row; generations, assets and library as one row per record; spendLog
//   as an append-only table with a window recorded in head. The body's text is the only input: a record is compared
//   by its raw text with the text stored before, and only changed records are written.
// - the store keeps the raw text of every record in memory (loaded at the first commit, not at open), like
//   persistJson.ts. A body whose globals text equals the last committed one is not scanned at all.
// - generations also keep an append-only history (gen_history): one row per change, never rewritten.
// - rejected and kept copies are files under backups/ (like store-v2), not rows; snapshots are VACUUM INTO every 10 min.
// Assumes the app's compact JSON (JSON.stringify output: no whitespace between tokens).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLost, sha256 } from '../../server/save-guard.js';
import { assembleText } from '../../server/store-v2.js';

export const SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const KEPT = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const JOURNAL_LIMIT = 64 * 1024 * 1024;
const DICT = ['generations', 'assets'];
const LIST = ['library'];
const SPEND = 'spendLog';
const json = (v) => JSON.stringify(v);

const MIGRATION_1 = `
CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, version INTEGER NOT NULL,
  order_json TEXT NOT NULL, spend_len INTEGER NOT NULL, spend_last INTEGER NOT NULL);
CREATE TABLE small (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE records (coll TEXT NOT NULL, id TEXT NOT NULL, pos INTEGER NOT NULL, meta TEXT NOT NULL, PRIMARY KEY (coll, id));
CREATE INDEX records_pos ON records (coll, pos);
CREATE TABLE gen_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, meta TEXT NOT NULL, deleted INTEGER NOT NULL);
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, meta TEXT NOT NULL);
CREATE TABLE removed_sessions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, removed_at INTEGER NOT NULL, json TEXT NOT NULL);
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

// ---- Structural scan of compact JSON text: finds member boundaries without parsing the values. ----

/** Index just after the string that starts at t[i] (a double quote). */
function skipString(t, i) {
  for (let j = i + 1; ; j++) {
    const c = t.charCodeAt(j);
    if (c === 92) j++; // backslash: skip the escaped character
    else if (c === 34) return j + 1;
  }
}

/** Index of the ',' or closing bracket that ends the value starting at t[i] (nested brackets and strings skipped). */
function skipValue(t, i) {
  let depth = 0;
  for (let j = i; ; j++) {
    const c = t.charCodeAt(j);
    if (c === 34) { j = skipString(t, j) - 1; continue; }
    if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) { if (depth === 0) return j; depth--; }
    else if (c === 44 && depth === 0) return j;
  }
}

/** Members of the object or array at t[from]: { k: raw key text or null, v: raw value text }. Values are not parsed. */
function members(t, from, isObject) {
  const closer = isObject ? 125 : 93;
  const out = [];
  let i = from + 1;
  if (t.charCodeAt(i) === closer) return out;
  for (;;) {
    let k = null;
    if (isObject) {
      const ks = i;
      i = skipString(t, i);
      k = t.slice(ks, i);
      i++; // the ':'
    }
    const vs = i;
    i = skipValue(t, i);
    out.push({ k, v: t.slice(vs, i) });
    if (t.charCodeAt(i) !== 44) return out;
    i++;
  }
}

const BLOCK = 1 << 20;

/** Length of the common prefix of a and b, compared in blocks (memcmp) and char by char only inside the mismatching block. */
function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n;) {
    const m = Math.min(n, i + BLOCK);
    if (a.slice(i, m) === b.slice(i, m)) { i = m; continue; }
    let j = i;
    while (j < m && a.charCodeAt(j) === b.charCodeAt(j)) j++;
    return j;
  }
  return n;
}

/** Length of the common suffix of a and b, at most `limit`. */
function commonSuffix(a, b, limit) {
  for (let s = 0; s < limit;) {
    const m = Math.min(limit, s + BLOCK);
    if (a.slice(a.length - m, a.length - s) === b.slice(b.length - m, b.length - s)) { s = m; continue; }
    let t = s;
    while (t < m && a.charCodeAt(a.length - 1 - t) === b.charCodeAt(b.length - 1 - t)) t++;
    return t;
  }
  return limit;
}

/** Top-level members of the globals object in [from, to): { name, rawKey, start, vStart, end } (absolute offsets). */
function scanRegion(t, from, to) {
  const out = [];
  let i = from;
  while (i < to) {
    const start = i;
    const ks = i;
    i = skipString(t, i);
    const rawKey = t.slice(ks, i);
    i++; // the ':'
    const vStart = i;
    i = skipValue(t, i);
    out.push({ name: JSON.parse(rawKey), rawKey, start, vStart, end: i });
    i++; // the ',' between members
  }
  return out;
}

/**
 * Layout of the new globals text, rescanning only the top-level members the change touches. The previous text and its
 * layout are the cache: members before the first changed character (end < p) and after the last one (start > oldEnd)
 * keep their text and offsets (shifted by the length change). Returns { top, mid }: the full layout and the rescanned members.
 */
function locateChanges(c, globals) {
  if (!c.top) { const top = scanRegion(globals, 1, globals.length - 1); return { top, mid: top }; }
  const prev = c.globals;
  const p = commonPrefix(prev, globals);
  const s = commonSuffix(prev, globals, Math.min(prev.length, globals.length) - p);
  const oldEnd = prev.length - s;
  const delta = globals.length - prev.length;
  let i0 = -1, i1 = -1;
  c.top.forEach((e, i) => {
    if (!(e.end < p) && !(e.start > oldEnd)) { if (i0 < 0) i0 = i; i1 = i; }
  });
  if (i0 < 0) { const top = scanRegion(globals, 1, globals.length - 1); return { top, mid: top }; }
  const mid = scanRegion(globals, c.top[i0].start, c.top[i1].end + delta);
  const after = c.top.slice(i1 + 1).map((e) => ({ ...e, start: e.start + delta, vStart: e.vStart + delta, end: e.end + delta }));
  return { top: [...c.top.slice(0, i0), ...mid, ...after], mid };
}

/** [id, text] pairs of a dict or list collection, in the body's order. Lists take item.id, or #index when there is none. */
function entriesOf(coll, raw) {
  if (raw == null) return [];
  if (DICT.includes(coll)) return members(raw, 0, true).map((m) => [JSON.parse(m.k), m.v]);
  const seen = new Set();
  return members(raw, 0, false).map((m, i) => {
    const id = JSON.parse(m.v)?.id;
    let key = id != null ? String(id) : `#${i}`;
    if (seen.has(key)) key = `#${i}`;
    seen.add(key);
    return [key, m.v];
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
    smallGet: db.prepare('SELECT json FROM small WHERE id = 1'),
    smallPut: db.prepare('INSERT OR REPLACE INTO small (id, json) VALUES (1, ?)'),
    sessGet: db.prepare('SELECT json FROM sessions WHERE id = ?'),
    sessIds: db.prepare('SELECT id FROM sessions'),
    sessPut: db.prepare('INSERT INTO sessions (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json'),
    sessDel: db.prepare('DELETE FROM sessions WHERE id = ?'),
    removedPut: db.prepare('INSERT INTO removed_sessions (id, removed_at, json) VALUES (?, ?, ?)'),
    recAll: db.prepare('SELECT coll, id, pos, meta FROM records ORDER BY coll, pos'),
    // Startup: one row per collection, already in the text form of the globals (ids quoted in SQL for dicts).
    bodies: db.prepare(`SELECT coll, group_concat(piece, ',') AS body FROM
      (SELECT coll, CASE WHEN coll IN ('generations', 'assets') THEN json_quote(id) || ':' || meta ELSE meta END AS piece
       FROM records ORDER BY coll, pos) GROUP BY coll`),
    recIns: db.prepare('INSERT INTO records (coll, id, pos, meta) VALUES (?, ?, ?, ?)'),
    recUpd: db.prepare('UPDATE records SET meta = ? WHERE coll = ? AND id = ?'),
    recDel: db.prepare('DELETE FROM records WHERE coll = ? AND id = ?'),
    histPut: db.prepare('INSERT INTO gen_history (id, ts, meta, deleted) VALUES (?, ?, ?, ?)'),
    spendPut: db.prepare('INSERT INTO spend (meta) VALUES (?)'),
    spendOne: db.prepare('SELECT meta FROM spend WHERE seq = ?'),
    spendTail: db.prepare('SELECT meta FROM spend WHERE seq <= ? ORDER BY seq DESC LIMIT ?'),
  };
  const fault = (point) => opts.fault?.(point);
  let lastSnapshot = 0;
  // In-memory mirror of the stored records (raw text), loaded at the first commit: a read does not pay for it.
  let cache = null;

  function loadCache() {
    const c = {
      globals: null, // globals text of the last commit: a body that repeats it is not scanned
      top: null, // its top-level layout (see locateChanges); null means "scan in full at the next commit"
      small: q.smallGet.get()?.json ?? null,
      coll: { generations: new Map(), assets: new Map(), library: new Map() },
      maxPos: {},
      spendLast: 0,
      spendLastText: null,
    };
    for (const r of q.recAll.all()) {
      c.coll[r.coll].set(r.id, { text: r.meta, pos: r.pos });
      c.maxPos[r.coll] = Math.max(c.maxPos[r.coll] ?? -1, r.pos);
    }
    const h = q.headGet.get();
    if (h?.spend_last) {
      c.spendLast = h.spend_last;
      c.spendLastText = q.spendOne.get(h.spend_last)?.meta ?? null;
    }
    cache = c;
    return c;
  }

  /** Whole state as format-1 text (same text as store-v2 read()), or null when no commit has happened yet. */
  function read() {
    const h = q.headGet.get();
    if (!h) return null;
    const smallText = q.smallGet.get()?.json;
    if (smallText == null) throw new Error('store corrupt: head without the small row');
    const bodies = Object.fromEntries(q.bodies.all().map((r) => [r.coll, r.body ?? '']));
    const spend = h.spend_len ? q.spendTail.all(h.spend_last, h.spend_len).reverse().map((r) => r.meta).join(',') : '';
    const inner = smallText.slice(1, -1);
    const globals = `{${inner}${inner ? ',' : ''}"generations":{${bodies.generations ?? ''}},"assets":{${bodies.assets ?? ''}},"library":[${bodies.library ?? ''}],"spendLog":[${spend}]}`;
    const order = JSON.parse(h.order_json);
    const sessions = {};
    for (const id of order) {
      const row = q.sessGet.get(id);
      if (!row) throw new Error(`store corrupt: session ${id} is in the order but not in the table`);
      sessions[id] = row.json;
    }
    return assembleText({ savedAt: h.saved_at, version: h.version, globals, order, sessions });
  }

  /** Writes only the records whose raw text changed; deletes the ones that left; generations keep a history row per change. */
  function writeCollection(c, coll, entries, savedAt) {
    const cc = c.coll[coll];
    const seen = new Set();
    let next = (c.maxPos[coll] ?? -1) + 1;
    for (const [id, text] of entries) {
      seen.add(id);
      const cur = cc.get(id);
      if (cur && cur.text === text) continue;
      if (cur) {
        q.recUpd.run(text, coll, id);
        cc.set(id, { text, pos: cur.pos });
      } else {
        q.recIns.run(coll, id, next, text);
        cc.set(id, { text, pos: next });
        c.maxPos[coll] = next++;
      }
      if (coll === 'generations') q.histPut.run(id, savedAt, text, 0);
    }
    if (cc.size > seen.size) {
      for (const id of [...cc.keys()]) {
        if (seen.has(id)) continue;
        q.recDel.run(coll, id);
        cc.delete(id);
        if (coll === 'generations') q.histPut.run(id, savedAt, '{}', 1);
      }
    }
  }

  /** Appends the spend entries after the last stored one (found by scanning from the end). Returns the window. */
  function writeSpend(c, texts) {
    let start = 0;
    if (c.spendLastText != null) {
      let i = texts.length - 1;
      while (i >= 0 && texts[i] !== c.spendLastText) i--;
      start = i + 1;
    }
    for (let i = start; i < texts.length; i++) {
      c.spendLast = Number(q.spendPut.run(texts[i]).lastInsertRowid);
      c.spendLastText = texts[i];
    }
    if (texts.length === 0) { c.spendLast = 0; c.spendLastText = null; }
    return { len: texts.length, last: c.spendLast };
  }

  /** A refused or kept payload goes to a file under backups/ (store-v2 does the same); returns the file name. */
  function keepCopy(kind, payload) {
    mkdirSync(backups, { recursive: true });
    const name = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    writeFileSync(join(backups, name), payload, { mode: 0o600 });
    return name;
  }

  function commitTx(body) {
    const { savedAt, baseAt, version, globals, order, sessions = {}, keep } = body;
    const c = cache ?? loadCache();
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
    if ((total && !totalOk) || losses.length) {
      const first = losses[0];
      const rejectedFile = first ? keepCopy(`rejected-session-${first.sessionId}`, first.text) : keepCopy('rejected', json(body));
      for (const l of losses.slice(1)) keepCopy(`rejected-session-${l.sessionId}`, l.text);
      return {
        status: 409, reason: 'possible-loss', ...(first ? { sessionId: first.sessionId, diskHash: first.diskHash } : {}),
        losses: losses.map(({ sessionId, diskHash }) => ({ sessionId, diskHash })), ...(total ? { total } : {}),
        rejectedFile, savedAt: current,
      };
    }
    if (totalOk) keepCopy('kept-before-order', json(head ?? {}));
    for (const [id, prev] of kept) keepCopy(`kept-before-${id}`, prev);

    for (const [id, text] of Object.entries(sessions)) {
      if (q.sessGet.get(id)?.json !== text) q.sessPut.run(id, text);
    }
    fault('sessions');

    let spend = { len: head?.spend_len ?? 0, last: head?.spend_last ?? 0 };
    if (globals !== c.globals) {
      const { top, mid } = locateChanges(c, globals);
      const rawOf = (name) => { const e = top.find((x) => x.name === name); return e ? globals.slice(e.vStart, e.end) : null; };
      const small = top.filter((e) => !(DICT.includes(e.name) || LIST.includes(e.name) || e.name === SPEND))
        .map((e) => `${e.rawKey}:${globals.slice(e.vStart, e.end)}`);
      const smallText = `{${small.join(',')}}`;
      if (smallText !== c.small) { q.smallPut.run(smallText); c.small = smallText; }
      const touched = new Set(mid.map((e) => e.name));
      for (const name of [...DICT, ...LIST]) {
        if (touched.has(name) || !top.some((e) => e.name === name)) writeCollection(c, name, entriesOf(name, rawOf(name)), savedAt);
      }
      fault('globals');
      if (touched.has(SPEND) || !top.some((e) => e.name === SPEND)) {
        spend = writeSpend(c, members(rawOf(SPEND) ?? '[]', 0, false).map((m) => m.v));
      }
      c.top = top;
      c.globals = globals;
    }

    // Sessions no longer in the order move to removed_sessions: nothing is deleted.
    const known = new Set(order);
    for (const { id } of q.sessIds.all()) {
      if (known.has(id)) continue;
      q.removedPut.run(id, Date.now(), q.sessGet.get(id).json);
      q.sessDel.run(id);
    }
    fault('head');
    q.headPut.run(savedAt, version, json(order), spend.len, spend.last);
    return { status: 204, savedAt };
  }

  /** One commit = one transaction. Returns { status, savedAt } like store-v2 commit(). */
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
      cache = null; // the mirror may differ from the disk now: reload it at the next commit
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

  /** Idle maintenance: moves the WAL back into the database and truncates the file. */
  function checkpoint() {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }

  /** Sizes in bytes: the database, its WAL and its shared memory file (0 when absent). */
  function sizes() {
    const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
    return { db: size(file), wal: size(`${file}-wal`), shm: size(`${file}-shm`) };
  }

  return { read, commit, checkpoint, sizes, close: () => db.close(), file, schemaVersion: () => db.prepare('PRAGMA user_version').get().user_version };
}
