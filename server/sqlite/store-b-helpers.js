import { generateNKeysBetween } from './fractional-index.mjs';

export const SCHEMA_VERSION = 1;
export const SAFE_ID = /^[A-Za-z0-9_-]+$/;
export const COLLS = ['generations', 'assets', 'library'];

export const JOURNAL_ALLOW = {
  generations: ['id', 'sessionId', 'kind', 'modelRef', 'modelName', 'provider', 'origin', 'status', 'createdAt', 'finishedAt', 'usd'],
  assets: ['id', 'kind', 'mime', 'width', 'height', 'duration', 'sessionId', 'generationId', 'origin', 'copiedFromAssetId', 'revertedAt', 'createdAt'],
  library: ['id', 'kind', 'frontalAssetId', 'videoAssetId', 'revertedAt'],
  spend: ['id', 'at', 'usd', 'estimated', 'category', 'provider', 'model', 'sessionId'],
  event: [
    'id', 'at', 'ts', 'kind', 'coll', 'sessionId', 'generationId', 'assetId', 'copiedFromAssetId',
    'frontalAssetId', 'videoAssetId', 'revertedAt', 'createdAt', 'finishedAt', 'mime', 'width', 'height',
    'duration', 'origin', 'status', 'provider', 'model', 'modelRef', 'modelName', 'category', 'usd',
    'estimated', 'generations', 'assets', 'library',
  ],
};

export function pickAllowedMeta(raw, keys) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return '{}'; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return '{}';
  const out = {};
  for (const k of keys) {
    if (!Object.hasOwn(obj, k)) continue;
    const v = obj[k];
    if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return JSON.stringify(out);
}

const MIGRATION_1 = `
CREATE TABLE head (id INTEGER PRIMARY KEY CHECK (id = 1), saved_at INTEGER NOT NULL, version INTEGER NOT NULL,
  order_json TEXT NOT NULL, spend_len INTEGER NOT NULL, spend_last INTEGER NOT NULL);
CREATE TABLE small (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE sessions (id TEXT PRIMARY KEY, pos TEXT NOT NULL DEFAULT '', json TEXT NOT NULL);
CREATE INDEX sessions_pos ON sessions (pos);
CREATE TABLE records (coll TEXT NOT NULL, id TEXT NOT NULL, pos TEXT NOT NULL, meta TEXT NOT NULL, fp TEXT NOT NULL, PRIMARY KEY (coll, id));
CREATE INDEX records_pos ON records (coll, pos);
CREATE TABLE gen_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, ts INTEGER NOT NULL, meta TEXT NOT NULL, deleted INTEGER NOT NULL);
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, meta TEXT NOT NULL);
CREATE TABLE removed_sessions (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, removed_at INTEGER NOT NULL, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS asset_revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, meta TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS asset_revisions_asset ON asset_revisions (asset_id, seq);
CREATE TABLE IF NOT EXISTS event_journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, meta TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_journal_kind ON event_journal (kind, seq);
CREATE TABLE IF NOT EXISTS commit_ack (id INTEGER PRIMARY KEY CHECK (id = 1), commit_id TEXT NOT NULL, saved_at INTEGER NOT NULL);
`;

const PHASE4_TABLES = `
CREATE TABLE IF NOT EXISTS asset_revisions (seq INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL, meta TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS asset_revisions_asset ON asset_revisions (asset_id, seq);
CREATE TABLE IF NOT EXISTS event_journal (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, meta TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_journal_kind ON event_journal (kind, seq);
CREATE TABLE IF NOT EXISTS commit_ack (id INTEGER PRIMARY KEY CHECK (id = 1), commit_id TEXT NOT NULL, saved_at INTEGER NOT NULL);
`;

export function migrateSchema(db) {
  const v = db.prepare('PRAGMA user_version').get().user_version;
  if (v > SCHEMA_VERSION) throw new Error(`store written by a newer version (${v})`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('PRAGMA user_version').get().user_version === 0) {
      db.exec(MIGRATION_1);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    } else {
      db.exec(PHASE4_TABLES);
      const sessCols = db.prepare("PRAGMA table_info('sessions')").all();
      if (!sessCols.some((c) => c.name === 'pos')) {
        db.exec("ALTER TABLE sessions ADD COLUMN pos TEXT NOT NULL DEFAULT ''");
        db.exec('CREATE INDEX IF NOT EXISTS sessions_pos ON sessions (pos)');
        const h = db.prepare('SELECT order_json FROM head WHERE id = 1').get();
        if (h?.order_json) {
          const order = JSON.parse(h.order_json);
          if (order.length) {
            const keys = generateNKeysBetween(null, null, order.length);
            const upd = db.prepare('UPDATE sessions SET pos = ? WHERE id = ?');
            for (let i = 0; i < order.length; i++) upd.run(keys[i], order[i]);
          }
        }
      } else {
        db.exec('CREATE INDEX IF NOT EXISTS sessions_pos ON sessions (pos)');
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function applyPosMoves(moves, label, getPos, setPos, onStat) {
  if (!Array.isArray(moves)) return;
  for (const m of moves) {
    const valid = [];
    for (const id of m.ids) if (getPos(id) != null) valid.push(id);
    if (!valid.length) continue;
    let afterPos = null;
    if (m.after != null) {
      afterPos = getPos(m.after);
      if (afterPos == null) throw new Error(`missing order anchor ${label}/${m.after}`);
    }
    let beforePos = null;
    if (m.before != null) {
      beforePos = getPos(m.before);
      if (beforePos == null) throw new Error(`missing order anchor ${label}/${m.before}`);
    }
    const keys = generateNKeysBetween(afterPos, beforePos, valid.length);
    for (let i = 0; i < valid.length; i++) { setPos(keys[i], valid[i]); onStat?.(); }
  }
}

export function buildCandidateOrder(prevOrder, sessions, delList, full, moves) {
  const delSet = new Set(delList);
  const base = full ? [] : prevOrder.filter((id) => !delSet.has(id));
  const baseSet = new Set(base);
  for (const id of Object.keys(sessions)) if (!baseSet.has(id)) { base.push(id); baseSet.add(id); }
  if (!Array.isArray(moves)) return base;
  const cur = [...base];
  for (const m of moves) {
    const moveSet = new Set(m.ids.filter((id) => baseSet.has(id)));
    if (!moveSet.size) continue;
    const ordered = m.ids.filter((id) => moveSet.has(id));
    for (let i = cur.length - 1; i >= 0; i--) if (moveSet.has(cur[i])) cur.splice(i, 1);
    let idx = cur.length;
    if (m.before != null) { const bi = cur.indexOf(m.before); if (bi !== -1) idx = bi; }
    else if (m.after != null) { const ai = cur.indexOf(m.after); if (ai !== -1) idx = ai + 1; }
    cur.splice(idx, 0, ...ordered);
  }
  return cur;
}

export function validateOrderMoves(moves, coll) {
  if (moves == null) return null;
  if (!Array.isArray(moves) || !moves.every((m) => m && typeof m === 'object' && Array.isArray(m.ids)
    && m.ids.every((id) => typeof id === 'string' && SAFE_ID.test(id))
    && (m.after == null || (typeof m.after === 'string' && SAFE_ID.test(m.after)))
    && (m.before == null || (typeof m.before === 'string' && SAFE_ID.test(m.before))))) {
    return `order for ${coll} must be an array of { after, before, ids }`;
  }
  return null;
}
