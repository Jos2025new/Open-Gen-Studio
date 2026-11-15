// Phase 1: the format-2 commit body (globals text, order, changed sessions) stored in SQLite.
// The HTTP body stays the one the app sends today. Rows change only where that body differs.
// save-guard.js is not modified: store-b.js calls looksLost on the session texts.
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { SAFE_ID, splitText } from './store-v2.js';
import { createStoreBA } from './sqlite/store-ba.js';
import { createDeltaClient } from './sqlite/delta-client.mjs';

const dbFile = (dir) => join(dir, 'ogs.sqlite');

/** Head row, or null when this folder has no SQLite file. A file that cannot be read, or has no head, throws:
 * that is not the same as "no store", and the caller must not serve another copy instead. */
export function sqliteHead(dir) {
  const file = dbFile(dir);
  if (!existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT saved_at AS savedAt, version, order_json AS orderJson FROM head WHERE id = 1').get();
    if (!row) throw new Error('ogs.sqlite has no head');
    return { savedAt: row.savedAt, version: row.version, order: JSON.parse(row.orderJson) };
  } finally {
    db.close();
  }
}

/** Same commit contract as createStoreV2, with one SQLite transaction per commit. */
export function createSqliteStore(dir) {
  const ba = createStoreBA(dir);
  const delta = createDeltaClient();
  const existing = ba.read();
  if (existing) {
    delta.diff(JSON.parse(splitText(existing).globals));
    delta.ack();
  }
  let lastDelta = null;

  function commit(body) {
    const { savedAt, baseAt, version, globals, order, sessions = {}, keep } = body;
    if (!Number.isFinite(savedAt) || !Array.isArray(order)) return { status: 400, reason: 'savedAt and order are required' };
    if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
    if (typeof globals !== 'string' || !globals.startsWith('{') || !globals.endsWith('}')) return { status: 400, reason: 'globals must be a JSON text (a string), not an object' };
    if (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
    for (const [id, text] of Object.entries(sessions)) {
      if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
      if (!order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
    }
    let parsed;
    try { parsed = JSON.parse(globals); } catch { return { status: 400, reason: 'globals must be a JSON text (a string), not an object' }; }
    const diff = delta.diff(parsed);
    lastDelta = diff;
    const result = ba.commit({ savedAt, baseAt, version, order, sessions, keep, delta: diff });
    if (result.status === 204) delta.ack();
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
    read: () => ba.read(),
    readHead: async () => sqliteHead(dir),
    commit,
    commitLegacy,
    lastStats: () => ba.lastStats(),
    lastDelta: () => lastDelta,
    sizes: () => ba.sizes(),
    idle: () => ba.idle(),
    close: () => ba.close(),
    file: ba.file,
  };
}
