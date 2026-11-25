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
import { looksLost, recordsBody, sha256, unapprovedRecords } from '../save-guard.js';
import { assembleText } from '../store-v2.js';
import { sanitizeKeysInText } from '../keys.js';
import { computeOrderDiff, generateKeyBetween } from './fractional-index.mjs';
import {
  applyPosMoves,
  buildCandidateOrder,
  COLLS,
  JOURNAL_ALLOW,
  libraryLosses,
  migrateSchema,
  pickAllowedMeta,
  SAFE_ID,
  SCHEMA_VERSION,
  validateOrderMoves,
} from './store-b-helpers.js';

export { SCHEMA_VERSION };
const KEPT = 20;
const SNAPSHOT_EVERY_MS = 10 * 60_000;
const JOURNAL_LIMIT = 64 * 1024 * 1024;
const json = (v) => JSON.stringify(v);
const fpOf = (text) => createHash('md5').update(text).digest('base64url').slice(0, 11);

export function createStoreB(dir, opts = {}) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'ogs.sqlite');
  const backups = join(dir, 'backups');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = ${opts.synchronous ?? 'FULL'}; PRAGMA busy_timeout = 5000; PRAGMA journal_size_limit = ${JOURNAL_LIMIT};`);
  migrateSchema(db);
  const q = {
    headGet: db.prepare('SELECT saved_at, version, order_json, spend_len, spend_last FROM head WHERE id = 1'),
    headPut: db.prepare('INSERT OR REPLACE INTO head (id, saved_at, version, order_json, spend_len, spend_last) VALUES (1, ?, ?, ?, ?, ?)'),
    ackGet: db.prepare('SELECT commit_id, saved_at FROM commit_ack WHERE id = 1'),
    ackPut: db.prepare('INSERT OR REPLACE INTO commit_ack (id, commit_id, saved_at) VALUES (1, ?, ?)'),
    smallGet: db.prepare('SELECT json FROM small WHERE id = 1'),
    smallPut: db.prepare('INSERT OR REPLACE INTO small (id, json) VALUES (1, ?)'),
    sessGet: db.prepare('SELECT json FROM sessions WHERE id = ?'),
    sessPos: db.prepare('SELECT pos FROM sessions WHERE id = ?'),
    sessMax: db.prepare('SELECT pos FROM sessions ORDER BY pos DESC LIMIT 1'),
    sessCount: db.prepare('SELECT COUNT(*) AS n FROM sessions'),
    sessOrder: db.prepare('SELECT id FROM sessions ORDER BY pos'),
    sessAll: db.prepare('SELECT id, json FROM sessions ORDER BY pos'),
    sessIds: db.prepare('SELECT id FROM sessions'),
    sessIns: db.prepare('INSERT INTO sessions (id, pos, json) VALUES (?, ?, ?)'),
    sessUpd: db.prepare('UPDATE sessions SET json = ? WHERE id = ?'),
    sessPosUpd: db.prepare('UPDATE sessions SET pos = ? WHERE id = ?'),
    sessDel: db.prepare('DELETE FROM sessions WHERE id = ?'),
    removedPut: db.prepare('INSERT INTO removed_sessions (id, removed_at, json) VALUES (?, ?, ?)'),
    bodies: db.prepare(`SELECT coll, group_concat(piece, ',') AS body FROM
      (SELECT coll, CASE WHEN coll IN ('generations', 'assets') THEN json_quote(id) || ':' || meta ELSE meta END AS piece
       FROM records ORDER BY coll, pos) GROUP BY coll`),
    recFp: db.prepare('SELECT pos, fp FROM records WHERE coll = ? AND id = ?'),
    recMeta: db.prepare('SELECT meta FROM records WHERE coll = ? AND id = ?'),
    recMax: db.prepare('SELECT pos FROM records WHERE coll = ? ORDER BY pos DESC LIMIT 1'),
    recIds: db.prepare('SELECT id FROM records WHERE coll = ?'),
    recOwners: db.prepare("SELECT id, json_extract(meta, '$.sessionId') AS owner FROM records WHERE coll = ?"),
    recIns: db.prepare('INSERT INTO records (coll, id, pos, meta, fp) VALUES (?, ?, ?, ?, ?)'),
    recUpd: db.prepare('UPDATE records SET meta = ?, fp = ? WHERE coll = ? AND id = ?'),
    recPos: db.prepare('UPDATE records SET pos = ? WHERE coll = ? AND id = ?'),
    recDel: db.prepare('DELETE FROM records WHERE coll = ? AND id = ?'),
    histPut: db.prepare('INSERT INTO gen_history (id, ts, meta, deleted) VALUES (?, ?, ?, ?)'),
    spendPut: db.prepare('INSERT INTO spend (meta) VALUES (?)'),
    spendTail: db.prepare('SELECT meta FROM spend WHERE seq <= ? ORDER BY seq DESC LIMIT ?'),
    revPut: db.prepare('INSERT INTO asset_revisions (asset_id, ts, kind, meta) VALUES (?, ?, ?, ?)'),
    revByAsset: db.prepare('SELECT seq, asset_id, ts, kind, meta FROM asset_revisions WHERE asset_id = ? ORDER BY seq ASC'),
    journalPut: db.prepare('INSERT INTO event_journal (ts, kind, id, meta) VALUES (?, ?, ?, ?)'),
    journalAll: db.prepare('SELECT seq, ts, kind, id, meta FROM event_journal ORDER BY seq ASC'),
    journalByKind: db.prepare('SELECT seq, ts, kind, id, meta FROM event_journal WHERE kind = ? ORDER BY seq ASC'),
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
    const sessRows = q.sessAll.all();
    const order = [];
    const sessions = {};
    for (const r of sessRows) { order.push(r.id); sessions[r.id] = r.json; }
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
    const sessRows = q.sessAll.all();
    const order = [];
    const sessions = {};
    for (const r of sessRows) { order.push(r.id); sessions[r.id] = r.json; }
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

  function removeSession(id) {
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

  /** Applies the delta. Returns the new spend window. */
  function applyDelta(delta, head, savedAt, stats, retriedHead = false) {
    if (delta.small != null) q.smallPut.run(sanitizeKeysInText(delta.small));
    const bulkImport = Boolean(delta.full && (Object.keys(delta.up?.generations ?? {}).length + Object.keys(delta.up?.assets ?? {}).length > 500));
    if (delta.full && !retriedHead) {
      q.journalPut.run(savedAt, 'import', 'store', json({
        generations: Object.keys(delta.up?.generations ?? {}).length,
        assets: Object.keys(delta.up?.assets ?? {}).length,
        library: Object.keys(delta.up?.library ?? {}).length,
      }));
    }
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
        if (coll === 'generations') {
          q.histPut.run(id, savedAt, text, 0);
          if (!bulkImport) q.journalPut.run(savedAt, cur ? 'edit' : 'generation', id, pickAllowedMeta(text, JOURNAL_ALLOW.generations));
        } else if (coll === 'assets') {
          if (!bulkImport || cur || text.includes('"originalRevision":') || text.includes('"revisions":') || text.includes('"copiedFromAssetId":') || text.includes('"revertedAt":')) {
            const isRevert = Boolean(cur && text.includes('"revertedAt":') && !text.includes('"originalRevision":'));
            const revKind = !cur ? 'create' : isRevert ? 'revert' : 'edit';
            q.revPut.run(id, savedAt, revKind, text);
            const jKind = !cur ? (text.includes('"origin":"upload"') ? 'import' : 'edit') : revKind;
            q.journalPut.run(savedAt, jKind, id, pickAllowedMeta(text, JOURNAL_ALLOW.assets));
          }
        } else if (coll === 'library' && !bulkImport) {
          const jKind = text.includes('"revertedAt":') ? 'revert' : 'edit';
          q.journalPut.run(savedAt, jKind, id, pickAllowedMeta(text, JOURNAL_ALLOW.library));
        }
      }
      const gone = new Set(delta.del?.[coll] ?? []);
      if (delta.full) for (const { id } of q.recIds.all(coll)) if (!(id in up)) gone.add(id);
      for (const id of gone) {
        stats.recGets++;
        const prevMeta = q.recMeta.get(coll, id)?.meta;
        if (prevMeta == null) continue;
        q.recDel.run(coll, id);
        stats.recWrites++;
        if (coll === 'generations') q.histPut.run(id, savedAt, '{}', 1);
        if (coll === 'assets') q.revPut.run(id, savedAt, 'delete', prevMeta);
        q.journalPut.run(savedAt, 'delete', id, pickAllowedMeta(prevMeta, JOURNAL_ALLOW[coll]));
      }
      applyPosMoves(
        delta.order?.[coll],
        coll,
        (id) => { stats.recGets++; return q.recFp.get(coll, id)?.pos ?? null; },
        (pos, id) => q.recPos.run(pos, coll, id),
        () => { stats.posUpdates++; },
      );
    }
    let spend = { len: head?.spend_len ?? 0, last: head?.spend_last ?? 0 };
    if (delta.spend) {
      const app = delta.spend.append ?? [];
      let skip = 0;
      if (retriedHead && head && Number.isInteger(delta.spend.from) && head.spend_len > delta.spend.from) {
        const extra = head.spend_len - delta.spend.from;
        if (extra <= app.length) {
          const tail = q.spendTail.all(head.spend_last, extra).reverse().map((r) => r.meta);
          if (tail.length === extra && tail.every((m, i) => m === app[i])) skip = extra;
        }
      } else if (head && head.spend_len === delta.spend.len && app.length > 0) {
        const tail = q.spendTail.all(head.spend_last, app.length).reverse().map((r) => r.meta);
        if (tail.length === app.length && tail.every((m, i) => m === app[i])) skip = app.length;
      }
      for (let i = skip; i < app.length; i++) {
        const t = app[i];
        spend.last = Number(q.spendPut.run(t).lastInsertRowid);
        if (!bulkImport) q.journalPut.run(savedAt, 'spend', String(spend.last), pickAllowedMeta(t, JOURNAL_ALLOW.spend));
      }
      spend.len = delta.spend.len;
    }
    if (Array.isArray(delta.events)) {
      for (const ev of delta.events) {
        if (ev && typeof ev.kind === 'string') {
          q.journalPut.run(ev.ts ?? savedAt, ev.kind, String(ev.id ?? ''), pickAllowedMeta(ev.meta ?? {}, JOURNAL_ALLOW.event));
        }
      }
    }
    return spend;
  }

  function commitTx(body) {
    const { savedAt, baseAt, version, order, sessions = {}, keep, delta, commitId, retryOf } = body;
    const head = q.headGet.get();
    const ack = q.ackGet.get();
    const current = head ? head.saved_at : 0;
    if (commitId && ack && ack.commit_id === commitId) {
      if (ack.saved_at === savedAt) return { status: 204, savedAt: current };
      return { status: 409, reason: 'conflict', savedAt: current };
    }
    const retriedHead = Boolean(current && current !== baseAt && ack?.commit_id && Array.isArray(retryOf) && retryOf.includes(ack.commit_id));
    if (current && current !== baseAt && !retriedHead) return { status: 409, reason: 'conflict', savedAt: current };
    if (!head && !(delta && delta.full)) return { status: 400, reason: 'the first commit must carry the whole state (delta.full)' };

    const hasOrder = Array.isArray(order);
    const delList = Array.isArray(delta?.del?.sessions) ? delta.del.sessions : [];
    const delSet = new Set(delList);
    if (hasOrder) {
      for (const id of order) {
        if (!Object.hasOwn(sessions, id) && !q.sessGet.get(id)) return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
      }
    } else if (Array.isArray(delta?.order?.sessions)) {
      for (const m of delta.order.sessions) {
        for (const id of [...m.ids, ...(m.after != null ? [m.after] : []), ...(m.before != null ? [m.before] : [])]) {
          if (delSet.has(id) || (!Object.hasOwn(sessions, id) && !q.sessGet.get(id))) {
            return { status: 400, reason: `missing session ${id}: send every session (no copy of it stored yet)` };
          }
        }
      }
    }
    const had = head ? q.sessCount.get().n : 0;
    let has;
    if (hasOrder) {
      has = order.length;
    } else if (delta?.full) {
      has = Object.keys(sessions).length;
    } else {
      let existingDel = 0, newCount = 0;
      for (const id of delSet) if (!Object.hasOwn(sessions, id) && q.sessGet.get(id)) existingDel++;
      for (const id of Object.keys(sessions)) if (!q.sessGet.get(id)) newCount++;
      has = had - existingDel + newCount;
    }
    const prevOrder = had >= 2 && has < had / 2 ? q.sessOrder.all().map((r) => r.id) : null;
    const total = prevOrder ? { diskOrderHash: sha256(json(prevOrder)) } : null;
    const candidateOrder = total && keep?.total
      ? (hasOrder ? order : buildCandidateOrder(prevOrder, sessions, delList, Boolean(delta?.full), delta?.order?.sessions))
      : null;
    const totalOk = Boolean(total && keep?.total?.diskOrderHash === total.diskOrderHash && keep.total.candidateOrderHash === sha256(json(candidateOrder)));
    const recLosses = head ? libraryLosses(q, delta ?? {}, () => {
      const all = q.sessIds.all().map((r) => r.id), sent = (id) => Object.hasOwn(sessions, id);
      return new Set(hasOrder ? all.filter((id) => !order.includes(id)) : delta?.full ? all.filter((id) => !sent(id)) : all.filter((id) => delSet.has(id) && !sent(id)));
    }) : [];
    const records = unapprovedRecords(recLosses, keep);
    const approved = new Map((Array.isArray(keep?.sessions) ? keep.sessions : []).map((k) => [k.sessionId, k]));
    const losses = [], kept = [];
    for (const [id, text] of Object.entries(sessions)) {
      const prev = q.sessGet.get(id)?.json;
      if (prev == null || !looksLost(prev, text)) continue;
      const diskHash = sha256(prev), k = approved.get(id);
      if (k && k.diskHash === diskHash && k.candidateHash === sha256(text)) kept.push([id, prev]);
      else losses.push({ sessionId: id, diskHash, text });
    }
    if ((total && !totalOk) || losses.length || records.length) {
      // All of them, also those this send approved: the next approval is built from this list alone.
      const listed = [...losses, ...kept.map(([sessionId, prev]) => ({ sessionId, diskHash: sha256(prev) }))];
      const first = losses[0];
      const rejectedFile = first ? keepCopy(`rejected-session-${first.sessionId}`, first.text) : keepCopy('rejected', json(body));
      for (const l of losses.slice(1)) keepCopy(`rejected-session-${l.sessionId}`, l.text);
      return {
        status: 409, reason: 'possible-loss', ...(first ? { sessionId: first.sessionId, diskHash: first.diskHash } : {}),
        losses: listed.map(({ sessionId, diskHash }) => ({ sessionId, diskHash })), ...(total ? { total } : {}),
        ...(recLosses.length ? { records: recordsBody(recLosses) } : {}), rejectedFile, savedAt: current,
      };
    }
    if (totalOk) keepCopy('kept-before-order', json({ ...(head ?? {}), order: prevOrder }));
    for (const [id, prev] of kept) keepCopy(`kept-before-${id}`, prev);
    if (recLosses.length) keepCopy('kept-before-records', json(Object.fromEntries(recLosses.map(({ coll, lost }) => [coll, Object.fromEntries(lost.map((id) => [id, q.recMeta.get(coll, id).meta]))]))));

    const sessionKeys = Object.keys(sessions);
    let maxSessPos = sessionKeys.length ? (q.sessMax.get()?.pos ?? null) : null;
    for (const [id, text] of Object.entries(sessions)) {
      const cur = q.sessGet.get(id);
      if (!cur) {
        maxSessPos = generateKeyBetween(maxSessPos, null);
        q.sessIns.run(id, maxSessPos, text);
      } else if (cur.json !== text) {
        q.sessUpd.run(text, id);
      }
    }
    fault('sessions');
    const stats = { recGets: 0, recWrites: 0, posUpdates: 0 };
    const spend = applyDelta(delta ?? {}, head, savedAt, stats, retriedHead);
    fault('globals');

    if (hasOrder) {
      const known = new Set(order);
      for (const { id } of q.sessIds.all()) if (!known.has(id)) removeSession(id);
    } else if (delta?.full) {
      for (const { id } of q.sessIds.all()) if (!Object.hasOwn(sessions, id)) removeSession(id);
    } else {
      for (const id of delList) if (!Object.hasOwn(sessions, id) && q.sessGet.get(id)) removeSession(id);
    }
    if (hasOrder) {
      const curOrder = q.sessOrder.all().map((r) => r.id);
      const sessMoves = computeOrderDiff(curOrder, order, sessionKeys);
      applyPosMoves(sessMoves, 'sessions', (id) => q.sessPos.get(id)?.pos ?? null, (pos, id) => q.sessPosUpd.run(pos, id));
    } else if (Array.isArray(delta?.order?.sessions)) {
      applyPosMoves(delta.order.sessions, 'sessions', (id) => q.sessPos.get(id)?.pos ?? null, (pos, id) => q.sessPosUpd.run(pos, id));
    }
    fault('head');
    q.headPut.run(savedAt, version, '', spend.len, spend.last);
    q.ackPut.run(commitId ?? '', savedAt);
    lastStats = stats;
    return { status: 204, savedAt };
  }

  function commit(body) {
    const { savedAt, version, order, sessions = {}, delta, commitId, retryOf } = body;
    const hasDelta = delta != null && typeof delta === 'object' && !Array.isArray(delta);
    if (!Number.isFinite(savedAt) || (order != null && !Array.isArray(order)) || (order == null && !hasDelta)) return { status: 400, reason: 'savedAt and order are required' };
    if (!Number.isInteger(version) || version < 1) return { status: 400, reason: 'version is required (a positive integer)' };
    if (commitId != null && (typeof commitId !== 'string' || commitId.length > 128)) return { status: 400, reason: 'invalid commitId' };
    if (retryOf != null && (!Array.isArray(retryOf) || retryOf.some((x) => typeof x !== 'string' || x.length > 128))) return { status: 400, reason: 'invalid retryOf' };
    if (delta != null && (!hasDelta || (delta.small != null && typeof delta.small !== 'string'))) return { status: 400, reason: 'delta must be an object' };
    if (order != null && (new Set(order).size !== order.length || !order.every((id) => typeof id === 'string' && SAFE_ID.test(id)))) return { status: 400, reason: 'order has a duplicate or unsafe id' };
    for (const [id, text] of Object.entries(sessions)) {
      if (!SAFE_ID.test(id) || typeof text !== 'string' || !text.startsWith('{') || !text.endsWith('}')) return { status: 400, reason: `session ${id} must be a JSON text (a string)` };
      if (order != null && !order.includes(id)) return { status: 400, reason: `session ${id} is not in the order` };
    }
    for (const coll of [...COLLS, 'sessions']) {
      if (coll !== 'sessions') {
        const del = delta?.del?.[coll];
        if (del != null && (!Array.isArray(del) || !del.every((id) => typeof id === 'string'))) return { status: 400, reason: `del.${coll} must be an array of ids` };
        for (const [id, text] of Object.entries(delta?.up?.[coll] ?? {})) {
          if (typeof text !== 'string' || !(text.startsWith('{') || text.startsWith('['))) return { status: 400, reason: `record ${coll}/${id} must be a JSON text` };
        }
      } else if (delta?.del?.sessions != null) {
        if (!Array.isArray(delta.del.sessions) || !delta.del.sessions.every((id) => typeof id === 'string' && SAFE_ID.test(id))) {
          return { status: 400, reason: 'del.sessions must be an array of safe ids' };
        }
      }
      const ordErr = validateOrderMoves(delta?.order?.[coll], coll);
      if (ordErr) return { status: 400, reason: ordErr };
    }
    const safeSmall = delta?.small != null ? sanitizeKeysInText(delta.small) : delta?.small;
    const safeBody = delta?.small != null && safeSmall !== delta.small
      ? { ...body, delta: { ...delta, small: safeSmall } }
      : body;
    db.exec('BEGIN IMMEDIATE');
    let r;
    try {
      r = commitTx(safeBody);
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

  function readAssetRevisions(assetId) {
    return q.revByAsset.all(assetId).map((r) => ({ seq: r.seq, assetId: r.asset_id, ts: r.ts, kind: r.kind, meta: JSON.parse(r.meta) }));
  }

  function readJournal(kind) {
    const rows = kind ? q.journalByKind.all(kind) : q.journalAll.all();
    return rows.map((r) => ({ seq: r.seq, ts: r.ts, kind: r.kind, id: r.id, meta: JSON.parse(r.meta) }));
  }

  function recordEvent(kind, id, meta = {}, ts = Date.now()) {
    q.journalPut.run(ts, String(kind), String(id ?? ''), pickAllowedMeta(meta, JOURNAL_ALLOW.event));
  }

  const checkpoint = () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  function sizes() {
    const size = (f) => { try { return statSync(f).size; } catch { return 0; } };
    return { db: size(file), wal: size(`${file}-wal`), shm: size(`${file}-shm`) };
  }
  return { read, readPartial, readPage, readAssetRevisions, readJournal, recordEvent, commit, checkpoint, idle: () => { checkpoint(); return 0; }, sizes, lastStats: () => lastStats, close: () => db.close(), file };
}
