// SPIKE round 3: what the client would do for variants B and C. It keeps, for every record, the object it last sent
// (reference) and its text, and builds the delta by id. A record whose object is the same reference is not stringified
// (the app's state is immutable, so a changed record is always a new object). Used by the bench and the crash test.
const COLLS = ['generations', 'assets', 'library'];
const SMALL_SKIP = new Set([...COLLS, 'spendLog']);

export function createDeltaClient() {
  const known = { generations: new Map(), assets: new Map(), library: new Map() };
  let small = null;
  let lastSpendText = null;
  let first = true;

  /** Delta between what was last acknowledged and `g` (the globals object). Call ack() when the server accepted it. */
  function diff(g) {
    const up = {}, del = {}, staged = {};
    for (const coll of COLLS) {
      const cur = coll === 'library' ? Object.fromEntries((g.library ?? []).map((r, i) => [String(r.id ?? `#${i}`), r])) : (g[coll] ?? {});
      const prev = known[coll];
      up[coll] = {}; del[coll] = []; staged[coll] = new Map();
      for (const id of Object.keys(cur)) {
        const p = prev.get(id);
        if (p && p.ref === cur[id]) { staged[coll].set(id, p); continue; }
        const text = JSON.stringify(cur[id]);
        staged[coll].set(id, { ref: cur[id], text });
        if (!p || p.text !== text) up[coll][id] = text;
      }
      for (const id of prev.keys()) if (!(id in cur)) del[coll].push(id);
    }
    const smallObj = Object.fromEntries(Object.entries(g).filter(([k]) => !SMALL_SKIP.has(k)));
    const smallText = JSON.stringify(smallObj);
    const log = g.spendLog ?? [];
    const texts = log.map((e) => JSON.stringify(e));
    let start = 0;
    if (lastSpendText != null) { let i = texts.length - 1; while (i >= 0 && texts[i] !== lastSpendText) i--; start = i + 1; }
    const order = {};
    for (const coll of COLLS) order[coll] = [...staged[coll].keys()];
    const delta = { ...(first ? { full: true } : {}), ...(smallText !== small ? { small: smallText } : {}), up, del, order, spend: { append: texts.slice(start), len: texts.length } };
    pending = { staged, smallText, lastSpend: texts.length ? texts[texts.length - 1] : null };
    return delta;
  }
  let pending = null;
  function ack() {
    for (const coll of COLLS) known[coll] = pending.staged[coll];
    small = pending.smallText;
    lastSpendText = pending.lastSpend;
    first = false;
  }
  return { diff, ack };
}
