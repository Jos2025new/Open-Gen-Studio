// SPIKE round 3, variants B and C: the client sends CHANGES by record id instead of the whole globals text.
// Commit body = { savedAt, baseAt, version, order, sessions, keep?, delta }, delta =
//   { full?: true,                       // the delta is the whole state (first import / migration): records not in `up` are deleted
//     small?: '<json text>',             // the scalar part of globals (settings, ui, composer, ...), only when it changed
//     up?:  { generations: {id: text}, assets: {id: text}, library: {id: text} },   // records created or changed
//     del?: { generations: [id], assets: [id], library: [id] },                     // records removed
//     order?: { generations: [{ after, before, ids }], ... },             // moved/inserted-in-place ids only; fractional pos keys
//     spend?: { append: [text], len: n } } // spendLog entries added at the end; len = length of the log after the commit
// baseAt makes the delta sound: the server applies it to exactly the state the client last saw (a stale baseAt is a 409).
// The server keeps NO mirror: each record row carries a small fingerprint (fp, 11 chars of md5) used to skip a record
// resent unchanged (no write, no history row). Nothing but the open database lives in memory.
// Variant C adds readPartial() (sessions + scalars + the most recent records) and readPage() (history by pages).
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLost, sha256 } from '../save-guard.js';
import { assembleText } from '../store-v2.js';
import { generateKeyBetween, generateNKeysBetween } from './fractional-index.mjs';

export const SCHEMA_VERSION = 1;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const KEPT = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const JOURNAL_LIMIT = 64 * 1024 * 1024;
const COLLS = ['generations', 'assets', 'library'];
const json = (v) => JSON.stringify(v);
const fpOf = (text) => createHash('md5').update(text).digest('base64url').slice(0, 11);

const MIGRATION_1 = `
CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, version INTEGER NOT NULL,
  order_json TEXT NOT NULL, spend_len INTEGER NOT NULL, spend_last INTEGER NOT NULL);
CREATE TABLE small (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE records (coll TEXT NOT NULL, id TEXT NOT NULL, pos TEXT NOT NULL, meta TEXT NOT NULL, fp TEXT NOT NULL, PRIMARY KEY (coll, id));
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

export function createStoreB(dir, opts = {}) {
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
    bodies: db.prepare(`SELECT coll, group_concat(piece, ',') AS body FROM
      (SELECT coll, CASE WHEN coll IN ('generations', 'assets') THEN json_quote(id) || ':' || meta ELSE meta END AS piece
       FROM records ORDER BY coll, pos) GROUP BY coll`),
    recFp: db.prepare('SELECT pos, fp FROM records WHERE coll = ? AND id = ?'),
    recMax: db.prepare('SELECT pos FROM records WHERE coll = ? ORDER BY pos DESC LIMIT 1'),
    recIds: db.prepare('SELECT id FROM records WHERE coll = ?'),
    recIns: db.prepare('INSERT INTO records (coll, id, pos, meta, fp) VALUES (?, ?, ?, ?, ?)'),
    recUpd: db.prepare('UPDATE records SET meta = ?, fp = ? WHERE coll = ? AND id = ?'),
    recPos: db.prepare('UPDATE records SET pos = ? WHERE coll = ? AND id = ?'),
    recDel: db.prepare('DELETE FROM records WHERE coll = ? AND id = ?'),
    histPut: db.prepare('INSERT INTO gen_history (id, ts, meta, deleted) VALUES (?, ?, ?, ?)'),
    spendPut: db.prepare('INSERT INTO spend (meta) VALUES (?)'),
    spendTail: db.prepare('SELECT meta FROM spend WHERE seq <= ? ORDER BY seq DESC LIMIT ?'),
    // C: most recent records of a collection, and pages of history older than a position.
    recRecent: db.prepare('SELECT id, pos, meta FROM records WHERE coll = ? ORDER BY pos DESC LIMIT ?'),
    recPage: db.prepare('SELECT id, pos, meta FROM records WHERE coll = ? AND pos < ? ORDER BY pos DESC LIMIT ?'),
    recCount: db.prepare('SELECT COUNT(*) AS n FROM records WHERE coll = ?'),
    recAll: db.prepare('SELECT coll, id, pos, meta FROM records ORDER BY coll, pos'),
  };
  const fault = (point) => opts.fault?.(point);
  let lastSnapshot = 0;
  let lastStats = { recGets: 0, recWrites: 0, posUpdates: 0 };

  const spendText = (h) => (h.spend_len ? q.spendTail.all(h.spend_last, h.spend_len).reverse().map((r) => r.meta).join(',') : '');

  /** Whole state as format-1 text (same text as the base store read()), or null when no commit has happened yet. */
  function read() {
    const h = q.headGet.get();
    if (!h) return null;
    const smallText = q.smallGet.get()?.json;
    if (smallText == null) throw new Error('store corrupt: head without the small row');
    const bodies = Object.fromEntries(q.bodies.all().map((r) => [r.coll, r.body ?? '']));
    const inner = smallText.slice(1, -1);
    const globals = `{${inner}${inner ? ',' : ''}"generations":{${bodies.generations ?? ''}},"assets":{${bodies.assets ?? ''}},"library":[${bodies.library ?? ''}],"spendLog":[${spendText(h)}]}`;
    const order = JSON.parse(h.order_json);
    const sessions = {};
    for (const id of order) {
      const row = q.sessGet.get(id);
      if (!row) throw new Error(`store corrupt: session ${id} is in the order but not in the table`);
      sessions[id] = row.json;
    }
    return assembleText({ savedAt: h.saved_at, version: h.version, globals, order, sessions });
  }

  /**
   * C startup: sessions, scalars, library, the last `spend` spend entries and the most recent `gens` / `assets`
   * records. `partial` tells the client how many records each collection holds and the position to page from.
   * Same text shape as read(), with a `partial` member and shorter collections.
   */
  function readPartial({ gens = 2000, assets = 1000, spend = 500 } = {}) {
    const h = q.headGet.get();
    if (!h) return null;
    const smallText = q.smallGet.get()?.json;
    if (smallText == null) throw new Error('store corrupt: head without the small row');
    const part = {};
    for (const [coll, n] of [['generations', gens], ['assets', assets], ['library', 1e9]]) {
      const rows = q.recRecent.all(coll, n).reverse();
      part[coll] = { total: q.recCount.get(coll).n, from: rows.length ? rows[0].pos : '', text: rows.map((r) => (coll === 'library' ? r.meta : `${json(r.id)}:${r.meta}`)).join(',') };
    }
    const spendTail = h.spend_len ? q.spendTail.all(h.spend_last, Math.min(spend, h.spend_len)).reverse().map((r) => r.meta).join(',') : '';
    const inner = smallText.slice(1, -1);
    const globals = `{${inner}${inner ? ',' : ''}"generations":{${part.generations.text}},"assets":{${part.assets.text}},"library":[${part.library.text}],"spendLog":[${spendTail}]}`;
    const order = JSON.parse(h.order_json);
    const sessions = {};
    for (const id of order) {
      const row = q.sessGet.get(id);
      if (!row) throw new Error(`store corrupt: session ${id} is in the order but not in the table`);
      sessions[id] = row.json;
    }
    const text = assembleText({ savedAt: h.saved_at, version: h.version, globals, order, sessions });
    const meta = json({ spendLen: h.spend_len, spendLoaded: Math.min(spend, h.spend_len), generations: { total: part.generations.total, from: part.generations.from }, assets: { total: part.assets.total, from: part.assets.from } });
    return `${text.slice(0, -1)},"partial":${meta}}`;
  }

  /** History by pages: records of `coll` older than position `before`, newest first. */
  function readPage(coll, before, limit = 500) {
    if (!COLLS.includes(coll)) throw new Error(`unknown collection ${coll}`);
    const rows = q.recPage.all(coll, before, limit);
    return { items: rows.map((r) => [r.id, r.meta]), next: rows.length === limit ? rows[rows.length - 1].pos : null };
  }

  // Same name the format-2 store puts in the 409 body: one file per kind, reused for a minute
  // so a refused autosave does not fill backups/ (server/store-v2.js keepRejected).
  const lastRejected = new Map();
  const REJECTED_EVERY_MS = 60_000;
  function keepCopy(kind, payload) {
    mkdirSync(backups, { recursive: true });
    const recent = kind.startsWith('rejected') ? lastRejected.get(kind) : undefined;
    const name = recent && Date.now() - recent.at < REJECTED_EVERY_MS ? recent.file : `${kind}-${Date.now()}.json`;
    writeFileSync(join(backups, name), payload, { mode: 0o600 });
    if (kind.startsWith('rejected') && recent?.file !== name) lastRejected.set(kind, { file: name, at: Date.now() });
    return name;
  }

  /** Applies the delta. Returns the new spend window. */
  function applyDelta(delta, head, savedAt, stats) {
    if (delta.small != null) q.smallPut.run(delta.small);
    for (const coll of COLLS) {
      const up = delta.up?.[coll] ?? {};
      const upEntries = Object.entries(up);
      let maxPos = upEntries.length ? (q.recMax.get(coll)?.pos ?? null) : null;
      for (const [id, text] of upEntries) {
        const fp = fpOf(text);
        stats.recGets++;
        const cur = q.recFp.get(coll, id);
        if (cur && cur.fp === fp) continue;
        if (cur) {
          q.recUpd.run(text, fp, coll, id);
          stats.recWrites++;
        } else {
          maxPos = generateKeyBetween(maxPos, null);
          q.recIns.run(coll, id, maxPos, text, fp);
          stats.recWrites++;
        }
        if (coll === 'generations') q.histPut.run(id, savedAt, text, 0);
      }
      const gone = new Set(delta.del?.[coll] ?? []);
      if (delta.full) for (const { id } of q.recIds.all(coll)) if (!(id in up)) gone.add(id);
      for (const id of gone) {
        stats.recGets++;
        if (!q.recFp.get(coll, id)) continue;
        q.recDel.run(coll, id);
        stats.recWrites++;
        if (coll === 'generations') q.histPut.run(id, savedAt, '{}', 1);
      }
      const moves = delta.order?.[coll];
      if (Array.isArray(moves)) {
        for (const m of moves) {
          const valid = [];
          for (const id of m.ids) {
            stats.recGets++;
            if (q.recFp.get(coll, id)) valid.push(id);
          }
          if (!valid.length) continue;
          let afterPos = null;
          if (m.after != null) {
            stats.recGets++;
            afterPos = q.recFp.get(coll, m.after)?.pos ?? null;
            if (afterPos == null) throw new Error(`missing order anchor ${coll}/${m.after}`);
          }
          let beforePos = null;
          if (m.before != null) {
            stats.recGets++;
            beforePos = q.recFp.get(coll, m.before)?.pos ?? null;
            if (beforePos == null) throw new Error(`missing order anchor ${coll}/${m.before}`);
          }
          const keys = generateNKeysBetween(afterPos, beforePos, valid.length);
          for (let i = 0; i < valid.length; i++) {
            q.recPos.run(keys[i], coll, valid[i]);
            stats.posUpdates++;
          }
        }
      }
    }
    let spend = { len: head?.spend_len ?? 0, last: head?.spend_last ?? 0 };
    if (delta.spend) {
      for (const t of delta.spend.append ?? []) spend.last = Number(q.spendPut.run(t).lastInsertRowid);
      spend.len = delta.spend.len;
    }
    return spend;
  }

  function commitTx(body) {
    const { savedAt, baseAt, version, order, sessions = {}, keep, delta } = body;
    const head = q.headGet.get();
    const current = head ? head.saved_at : 0;
    if (current && current !== baseAt) return { status: 409, reason: 'conflict', savedAt: current };
    if (!head && !(delta && delta.full)) return { status: 400, reason: 'the first commit must carry the whole state (delta.full)' };

    for (const id of order) {
      if (!Object.hasOwn(sessions, id) && !q.sessGet.get(id)) return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
    }
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
    const stats = { recGets: 0, recWrites: 0, posUpdates: 0 };
    const spend = applyDelta(delta ?? {}, head, savedAt, stats);
    fault('globals');

    const known = new Set(order);
    for (const { id } of q.sessIds.all()) {
      if (known.has(id)) continue;
      const text = q.sessGet.get(id).json;
      const removed = join(backups, 'removed-sessions');
      mkdirSync(removed, { recursive: true });
      const nameId = id.length > 160 ? sha256(id) : id;
      const backup = join(removed, `${Date.now()}-${randomUUID()}-${nameId}.json`);
      const fd = openSync(backup, 'wx', 0o600);
      try { writeFileSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
      for (const directory of [removed, backups, dir]) {
        const folder = openSync(directory, 'r');
        try { fsyncSync(folder); } finally { closeSync(folder); }
      }
      q.removedPut.run(id, Date.now(), text);
      q.sessDel.run(id);
    }
    fault('head');
    q.headPut.run(savedAt, version, json(order), spend.len, spend.last);
    lastStats = stats;
    return { status: 204, savedAt };
  }

  function commit(body) {
    const { savedAt, version, order, sessions = {}, delta } = body;
    if (!Number.isFinite(savedAt) || !Array.isArray(order)) return { status: 400, reason: 'savedAt and order are required' };
    if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
    if (delta != null && (typeof delta !== 'object' || (delta.small != null && typeof delta.small !== 'string'))) return { status: 400, reason: 'delta must be an object' };
    if (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
    for (const [id, text] of Object.entries(sessions)) {
      if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
      if (!order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
    }
    for (const coll of COLLS) {
      for (const [id, text] of Object.entries(delta?.up?.[coll] ?? {})) {
        if (typeof text !== 'string' || !(text.startsWith('{') || text.startsWith('['))) return { status: 400, reason: `record ${coll}/${id} must be a JSON text` };
      }
      const moves = delta?.order?.[coll];
      if (moves != null) {
        if (!Array.isArray(moves) || !moves.every((m) => m && typeof m === 'object' && Array.isArray(m.ids)
          && (m.after == null || typeof m.after === 'string') && (m.before == null || typeof m.before === 'string'))) {
          return { status: 400, reason: `order for ${coll} must be an array of { after, before, ids }` };
        }
      }
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
    if (r.status === 204) {
      try { snapshot(); }
      catch (e) { r = { ...r, snapshotError: e instanceof Error ? e.message : String(e) }; }
    }
    return r;
  }

  function snapshot() {
    if (Date.now() - lastSnapshot < SNAPSHOT_EVERY_MS) return;
    mkdirSync(backups, { recursive: true });
    const dest = join(backups, `v2sqlite-${Date.now()}.db`).replaceAll("'", "''");
    db.exec(`VACUUM INTO '${dest}'`);
    lastSnapshot = Date.now();
    const kept = readdirSync(backups).filter((f) => f.startsWith('v2sqlite-')).sort();
    for (const f of kept.slice(0, -KEPT)) rmSync(join(backups, f), { force: true });
  }

  const checkpoint = () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  function sizes() {
    const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
    return { db: size(file), wal: size(`${file}-wal`), shm: size(`${file}-shm`) };
  }
  return { read, readPartial, readPage, commit, checkpoint, idle: () => { checkpoint(); return 0; }, sizes, lastStats: () => lastStats, close: () => db.close(), file };
}
