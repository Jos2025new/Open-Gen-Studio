// SPIKE round 3: what the client would do for variants B and C. It keeps, for every record, the object it last sent
// (reference) and its text, and builds the delta by id. A record whose object is the same reference is not stringified
// (the app's state is immutable, so a changed record is always a new object). Used by the bench and the crash test.
import { computeOrderDiff } from './fractional-index.mjs';

const COLLS = ['generations', 'assets', 'library'];
const SMALL_SKIP = new Set([...COLLS, 'spendLog']);
const spendCache = new WeakMap();
function spendJson(e) {
  if (!e || typeof e !== 'object') return JSON.stringify(e);
  let t = spendCache.get(e);
  if (t === undefined) { t = JSON.stringify(e); spendCache.set(e, t); }
  return t;
}

function sameMapOrder(a, b) {
  if (a.size !== b.size) return false;
  const itA = a.keys();
  const itB = b.keys();
  for (let i = 0; i < a.size; i++) {
    if (itA.next().value !== itB.next().value) return false;
  }
  return true;
}

function sameSequence(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** The id each library item is stored under: its own, or its place when it has none; a repeated one gets a suffix. */
function libraryIds(list) {
  const ids = [], seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const baseId = String(list[i]?.id ?? `#${i}`);
    let id = baseId;
    for (let dup = 2; seen.has(id); dup++) id = `${baseId}#${dup}`;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** The records of a globals object by collection: id -> the session it belongs to (undefined for library items). */
export function recordIndex(g) {
  const owner = (o) => new Map(Object.keys(o ?? {}).map((id) => [id, o[id]?.sessionId]));
  return {
    generations: owner(g?.generations),
    assets: owner(g?.assets),
    library: new Map(libraryIds(Array.isArray(g?.library) ? g.library : []).map((id) => [id, undefined])),
  };
}

export function createDeltaClient() {
  const known = { generations: new Map(), assets: new Map(), library: new Map() };
  const unconfirmedUp = { generations: new Map(), assets: new Map(), library: new Map() };
  // Deleted in a commit whose outcome is unknown: a record that comes back is sent again, the disk may have dropped it.
  const unconfirmedDel = { generations: new Set(), assets: new Set(), library: new Set() };
  const unconfirmedOrder = { generations: null, assets: null, library: null };
  let knownSessions = null;
  const unconfirmedSessions = new Set();
  let unconfirmedSessionOrder = null;
  let small = null;
  let unconfirmedSmall = false;
  let knownSpend = [];
  let first = true;

  /** Delta between what was last acknowledged and `g` (the globals object). Call ack() when the server accepted it. */
  function diff(g, sessionOrder, sessionUpKeys = []) {
    const up = {}, del = {}, staged = {};
    let order = null;
    for (const coll of COLLS) {
      const prev = known[coll];
      const uncUp = unconfirmedUp[coll], uncDel = unconfirmedDel[coll];
      up[coll] = {}; del[coll] = []; staged[coll] = new Map();
      const present = new Set();
      if (coll === 'library') {
        const list = g.library ?? [];
        const ids = libraryIds(list);
        for (let i = 0; i < list.length; i++) {
          const item = list[i], id = ids[i];
          present.add(id);
          const p = prev.get(id);
          if (p && p.ref === item) {
            staged[coll].set(id, p);
            if (uncUp.has(id) && uncUp.get(id) !== p.text) up[coll][id] = p.text;
            continue;
          }
          const text = JSON.stringify(item);
          staged[coll].set(id, { ref: item, text });
          if (!p || p.text !== text || (uncUp.has(id) && uncUp.get(id) !== text)) up[coll][id] = text;
        }
      } else {
        const cur = g[coll] ?? {};
        for (const id of Object.keys(cur)) {
          present.add(id);
          const p = prev.get(id);
          if (p && p.ref === cur[id]) {
            staged[coll].set(id, p);
            if (uncUp.has(id) && uncUp.get(id) !== p.text) up[coll][id] = p.text;
            continue;
          }
          const text = JSON.stringify(cur[id]);
          staged[coll].set(id, { ref: cur[id], text });
          if (!p || p.text !== text || (uncUp.has(id) && uncUp.get(id) !== text)) up[coll][id] = text;
        }
      }
      for (const id of uncDel) if (present.has(id)) up[coll][id] = staged[coll].get(id).text;
      for (const id of prev.keys()) if (!present.has(id)) del[coll].push(id);
      for (const id of uncUp.keys()) if (!present.has(id) && !prev.has(id)) del[coll].push(id);
      const curOrder = [...staged[coll].keys()];
      if ([...uncDel].some((id) => present.has(id))) {
        // The disk may or may not have dropped what came back: its place is said outright, with the whole order.
        (order ??= {})[coll] = computeOrderDiff([], curOrder);
      } else if (!sameMapOrder(prev, staged[coll])) {
        const moves = computeOrderDiff([...prev.keys()], curOrder, Object.keys(up[coll]));
        if (moves) (order ??= {})[coll] = moves;
      } else if (unconfirmedOrder[coll] && !sameSequence(unconfirmedOrder[coll], curOrder)) {
        const moves = computeOrderDiff(unconfirmedOrder[coll], curOrder, Object.keys(up[coll]));
        if (moves) (order ??= {})[coll] = moves;
      }
    }
    let sessMoved = false;
    if (Array.isArray(sessionOrder)) {
      const prevSess = knownSessions ?? [];
      const presentSess = new Set(sessionOrder);
      const delSess = [];
      for (const id of prevSess) if (!presentSess.has(id)) delSess.push(id);
      for (const id of unconfirmedSessions) if (!presentSess.has(id) && !prevSess.includes(id)) delSess.push(id);
      if (delSess.length) del.sessions = delSess;
      let sessMoves = null;
      if (!sameSequence(prevSess, sessionOrder)) {
        sessMoves = computeOrderDiff(prevSess, sessionOrder, sessionUpKeys);
      } else if (unconfirmedSessionOrder && !sameSequence(unconfirmedSessionOrder, sessionOrder)) {
        sessMoves = computeOrderDiff(unconfirmedSessionOrder, sessionOrder, sessionUpKeys);
      }
      if (sessMoves) {
        (order ??= {}).sessions = sessMoves;
        sessMoved = true;
      }
    }
    const smallObj = Object.fromEntries(Object.entries(g).filter(([k]) => !SMALL_SKIP.has(k)));
    const smallText = JSON.stringify(smallObj);
    const log = g.spendLog ?? [];
    const texts = log.map(spendJson);
    let start = 0;
    for (let k = Math.min(knownSpend.length, texts.length); k > 0; k--) {
      let ok = true;
      const offset = knownSpend.length - k;
      for (let i = 0; i < k; i++) {
        if (knownSpend[offset + i] !== texts[i]) { ok = false; break; }
      }
      if (ok) { start = k; break; }
    }
    const delta = {
      ...(first ? { full: true } : {}),
      ...(smallText !== small || unconfirmedSmall ? { small: smallText } : {}),
      up,
      del,
      ...(order ? { order } : {}),
      spend: { append: texts.slice(start), len: texts.length, from: start },
    };
    pending = {
      staged, smallText, spend: texts, up, del, order,
      sessionOrder: Array.isArray(sessionOrder) ? [...sessionOrder] : null,
      sessUp: sessionUpKeys, sessMoved,
    };
    return delta;
  }
  let pending = null;
  function markUnconfirmed() {
    if (!pending) return;
    if (pending.smallText !== small) unconfirmedSmall = true;
    for (const coll of COLLS) {
      for (const [id, text] of Object.entries(pending.up[coll])) unconfirmedUp[coll].set(id, text);
      for (const id of pending.del[coll]) unconfirmedDel[coll].add(id);
      if (pending.order?.[coll] || pending.del[coll].length) unconfirmedOrder[coll] = [...pending.staged[coll].keys()];
    }
    if (pending.sessionOrder) {
      const prevSet = new Set(knownSessions ?? []);
      for (const id of pending.sessUp) if (!prevSet.has(id)) unconfirmedSessions.add(id);
      if (pending.sessMoved || (knownSessions && !sameSequence(knownSessions, pending.sessionOrder))) {
        unconfirmedSessionOrder = pending.sessionOrder;
      }
    }
  }
  function ack() {
    for (const coll of COLLS) {
      known[coll] = pending.staged[coll];
      unconfirmedUp[coll].clear();
      unconfirmedDel[coll].clear();
      unconfirmedOrder[coll] = null;
    }
    if (pending.sessionOrder) knownSessions = pending.sessionOrder;
    unconfirmedSessions.clear();
    unconfirmedSessionOrder = null;
    small = pending.smallText;
    unconfirmedSmall = false;
    knownSpend = pending.spend;
    first = false;
  }
  return { diff, ack, markUnconfirmed };
}
