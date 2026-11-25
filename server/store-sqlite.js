// Phase 1: the format-2 commit body (globals text, order, changed sessions) stored in SQLite.
// The HTTP body stays the one the app sends today. Rows change only where that body differs.
// save-guard.js judges the losses: store-b.js calls looksLost on the session texts and libraryLosses on the records.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { SAFE_ID, splitText } from './store-v2.js';
import { createStoreBA } from './sqlite/store-ba.js';
import { validateOrderMoves } from './sqlite/store-b-helpers.js';
import { createDeltaClient } from './sqlite/delta-client.mjs';
import { canonicalStateText, migrateFromV2, migrateToSqlite, stateSha } from './sqlite/migrate.js';

export { canonicalStateText, DatabaseSync, migrateFromV2, migrateToSqlite, stateSha };
const dbFile = (dir) => join(dir, 'ogs.sqlite');

/** Head row, or null when this folder has no SQLite file. A file that cannot be read, or has no head, throws:
 * that is not the same as "no store", and the caller must not serve another copy instead. */
export function sqliteHead(dir) {
  const file = dbFile(dir);
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const v = db.prepare('PRAGMA user_version').get().user_version;
    if (v === 0) {
      const anyTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
      if (!anyTable) return null;
      throw new Error('ogs.sqlite has no schema version');
    }
    const row = db.prepare('SELECT saved_at AS savedAt, version, order_json AS orderJson FROM head WHERE id = 1').get();
    if (!row) {
      const dataRows = db.prepare(
        'SELECT (SELECT COUNT(*) FROM small) + (SELECT COUNT(*) FROM sessions) + (SELECT COUNT(*) FROM records) + (SELECT COUNT(*) FROM spend) AS n',
      ).get().n;
      if (dataRows === 0) return null;
      throw new Error('ogs.sqlite has no head');
    }
    let order;
    if (row.orderJson) {
      order = JSON.parse(row.orderJson);
    } else {
      const hasPos = db.prepare("PRAGMA table_info('sessions')").all().some((c) => c.name === 'pos');
      order = db.prepare(hasPos ? 'SELECT id FROM sessions ORDER BY pos' : 'SELECT id FROM sessions').all().map((r) => r.id);
    }
    return { savedAt: row.savedAt, version: row.version, order };
  } finally {
    db.close();
  }
}

/** Wipes settings.keys in an exported copy of ogs.sqlite and compacts freelist pages so secrets never leave in a ZIP. */
export function stripSqliteKeys(file) {
  const db = new DatabaseSync(file);
  try {
    const row = db.prepare('SELECT json FROM small WHERE id = 1').get();
    if (row?.json) {
      const small = JSON.parse(row.json);
      const keys = small?.settings?.keys;
      if (keys && typeof keys === 'object') {
        for (const k of Object.keys(keys)) keys[k] = '';
        db.prepare('UPDATE small SET json = ? WHERE id = 1').run(JSON.stringify(small));
      }
    }
    db.exec('VACUUM');
  } finally {
    db.close();
  }
}

export function validateSqliteCommit(body, fresh = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, reason: 'not a commit' };
  const { savedAt, version, globals, order, sessions = {}, delta, commitId, retryOf } = body;
  const hasDelta = delta != null && typeof delta === 'object' && !Array.isArray(delta);
  if (!Number.isFinite(savedAt) || (order != null && !Array.isArray(order)) || (order == null && !hasDelta)) return { status: 400, reason: 'savedAt and order are required' };
  if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
  if (commitId != null && (typeof commitId !== 'string' || commitId.length > 128)) return { status: 400, reason: 'invalid commitId' };
  if (retryOf != null && (!Array.isArray(retryOf) || retryOf.some((x) => typeof x !== 'string' || x.length > 128))) return { status: 400, reason: 'invalid retryOf' };
  if (!hasDelta && (typeof globals !== 'string' || !globals.startsWith('{') || !globals.endsWith('}'))) {
    return { status: 400, reason: 'globals must be a JSON text (a string), not an object' };
  }
  if (hasDelta && delta.small != null && (typeof delta.small !== 'string' || !delta.small.startsWith('{') || !delta.small.endsWith('}'))) {
    return { status: 400, reason: 'delta.small must be a JSON text' };
  }
  if (order != null && (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id)))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) return { status: 400, reason: 'invalid sessions' };
  if (body.keep?.sessions != null && (!Array.isArray(body.keep.sessions) || body.keep.sessions.some((k) => !k || typeof k !== 'object'))) return { status: 400, reason: 'invalid keep sessions' };
  if (body.keep?.records != null && (!Array.isArray(body.keep.records) || body.keep.records.some((k) => !k || typeof k !== 'object'))) return { status: 400, reason: 'invalid keep records' };
  for (const [id, text] of Object.entries(sessions)) {
    if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
    if (order != null && !order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
  }
  if (hasDelta) {
    for (const coll of ['generations', 'assets', 'library']) {
      const del = delta.del?.[coll];
      if (del != null && (!Array.isArray(del) || !del.every((id) => typeof id === 'string'))) return { status: 400, reason: `invalid del.${coll}` };
      for (const text of Object.values(delta.up?.[coll] ?? {})) {
        if (typeof text !== 'string' || !(text.startsWith('{') || text.startsWith('['))) return { status: 400, reason: 'invalid record' };
      }
    }
    if (delta.del?.sessions != null && (!Array.isArray(delta.del.sessions) || !delta.del.sessions.every((id) => typeof id === 'string' && SAFE_ID.test(id)))) {
      return { status: 400, reason: 'invalid del.sessions' };
    }
    for (const coll of ['generations', 'assets', 'library', 'sessions']) {
      const ordErr = validateOrderMoves(delta.order?.[coll], coll);
      if (ordErr) return { status: 400, reason: ordErr };
    }
  }
  if (fresh) {
    if (order != null) {
      for (const id of order) {
        if (!Object.hasOwn(sessions, id)) return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
      }
    } else if (Array.isArray(delta?.order?.sessions)) {
      const delSet = new Set(Array.isArray(delta.del?.sessions) ? delta.del.sessions : []);
      for (const m of delta.order.sessions) {
        for (const id of [...m.ids, ...(m.after != null ? [m.after] : []), ...(m.before != null ? [m.before] : [])]) {
          if (delSet.has(id) || !Object.hasOwn(sessions, id)) {
            return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
          }
        }
      }
    }
    if (hasDelta) {
      if (!delta.full) return { status: 400, reason: 'the first commit must carry the whole state (delta.full)' };
    } else {
      try {
        const candidate = createDeltaClient().diff(JSON.parse(globals));
        for (const coll of ['generations', 'assets', 'library']) {
          for (const text of Object.values(candidate.up[coll])) {
            if (typeof text !== 'string' || !(text.startsWith('{') || text.startsWith('['))) return { status: 400, reason: 'invalid record' };
          }
        }
      } catch { return { status: 400, reason: 'invalid globals' }; }
    }
  }
  return null;
}

/** Same commit contract as createStoreV2, with one SQLite transaction per commit. */
export function createSqliteStore(dir, opts = {}) {
  const ba = createStoreBA(dir, opts);
  const delta = createDeltaClient();
  let existing = ba.read();
  if (existing) {
    delta.diff(JSON.parse(splitText(existing).globals));
    delta.ack();
  }
  let deltaStale = false;
  let lastDelta = null;

  function commit(body) {
    const invalid = validateSqliteCommit(body);
    if (invalid) return invalid;
    const { savedAt, baseAt, version, globals, order, sessions = {}, keep, delta: bodyDelta, commitId, retryOf } = body;
    let diff = bodyDelta;
    const usedLocalDelta = !diff;
    if (!diff) {
      if (deltaStale) {
        const cur = ba.read();
        if (cur) { delta.diff(JSON.parse(splitText(cur).globals)); delta.ack(); }
        deltaStale = false;
      }
      let parsed;
      try { parsed = JSON.parse(globals); } catch { return { status: 400, reason: 'globals must be a JSON text (a string), not an object' }; }
      diff = delta.diff(parsed);
    }
    lastDelta = diff;
    const result = ba.commit({ savedAt, baseAt, version, order, sessions, keep, delta: diff, commitId, retryOf });
    if (result.status === 204) {
      if (usedLocalDelta) delta.ack();
      else deltaStale = true;
      existing = null;
    }
    return result;
  }

  function commitLegacy(text) {
    if (!text.startsWith('{"savedAt":')) return { status: 400 };
    const parts = splitText(text);
    const current = ba.read();
    const sessions = {};
    if (!current) Object.assign(sessions, parts.sessions);
    else {
      const prev = splitText(current).sessions;
      for (const [id, session] of Object.entries(parts.sessions)) if (prev[id] !== session) sessions[id] = session;
    }
    return commit({ savedAt: parts.savedAt, baseAt: parts.baseAt, version: parts.version, globals: parts.globals, order: parts.order, sessions });
  }

  return {
    read: () => {
      if (existing !== null) { const first = existing; existing = null; return first; }
      return ba.read();
    },
    readHead: async () => sqliteHead(dir),
    commit,
    commitLegacy,
    lastStats: () => ba.lastStats(),
    lastDelta: () => lastDelta,
    readAssetRevisions: (assetId) => ba.readAssetRevisions(assetId),
    readJournal: (kind) => ba.readJournal(kind),
    recordEvent: (kind, id, meta, ts) => ba.recordEvent(kind, id, meta, ts),
    sizes: () => ba.sizes(),
    idle: () => ba.idle(),
    close: () => ba.close(),
    file: ba.file,
  };
}
