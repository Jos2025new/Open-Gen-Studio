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

export function createDeltaClient() {
  const known = { generations: new Map(), assets: new Map(), library: new Map() };
  let small = null;
  let knownSpend = [];
  let first = true;

  /** Delta between what was last acknowledged and `g` (the globals object). Call ack() when the server accepted it. */
  function diff(g) {
    const up = {}, del = {}, staged = {};
    let order = null;
    for (const coll of COLLS) {
      const prev = known[coll];
      up[coll] = {}; del[coll] = []; staged[coll] = new Map();
      const present = new Set();
      if (coll === 'library') {
        const list = g.library ?? [];
        for (let i = 0; i < list.length; i++) {
          const item = list[i];
          const baseId = String(item.id ?? `#${i}`);
          let id = baseId;
          for (let dup = 2; present.has(id); dup++) id = `${baseId}#${dup}`;
          present.add(id);
          const p = prev.get(id);
          if (p && p.ref === item) { staged[coll].set(id, p); continue; }
          const text = JSON.stringify(item);
          staged[coll].set(id, { ref: item, text });
          if (!p || p.text !== text) up[coll][id] = text;
        }
      } else {
        const cur = g[coll] ?? {};
        for (const id of Object.keys(cur)) {
          present.add(id);
          const p = prev.get(id);
          if (p && p.ref === cur[id]) { staged[coll].set(id, p); continue; }
          const text = JSON.stringify(cur[id]);
          staged[coll].set(id, { ref: cur[id], text });
          if (!p || p.text !== text) up[coll][id] = text;
        }
      }
      for (const id of prev.keys()) if (!present.has(id)) del[coll].push(id);
      if (!sameMapOrder(prev, staged[coll])) {
        const moves = computeOrderDiff([...prev.keys()], [...staged[coll].keys()], Object.keys(up[coll]));
        if (moves) (order ??= {})[coll] = moves;
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
    const delta = { ...(first ? { full: true } : {}), ...(smallText !== small ? { small: smallText } : {}), up, del, ...(order ? { order } : {}), spend: { append: texts.slice(start), len: texts.length } };
    pending = { staged, smallText, spend: texts };
    return delta;
  }
  let pending = null;
  function ack() {
    for (const coll of COLLS) known[coll] = pending.staged[coll];
    small = pending.smallText;
    knownSpend = pending.spend;
    first = false;
  }
  return { diff, ack };
}
