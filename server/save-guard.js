// The per-session loss guard (save-protection plan, phase 1). It measures only what the user made: the session's
// `agent` field is a cache of the LLM context and legitimately shrinks (stripImages, trimReferenceResults, message cuts).
import { createHash } from 'node:crypto';

const SHRINK_CHECK_BYTES = 4096;

export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

/** User content of a session text: real UTF-8 bytes without `agent`, plus the counted elements. Null when not parseable. */
function measure(text) {
  let s;
  try { s = JSON.parse(text); } catch { return null; }
  if (!s || typeof s !== 'object') return null;
  const { agent: _agent, ...user } = s;
  const docs = Array.isArray(s.docs) ? s.docs : [];
  const layers = new Map(docs.map((d) => [d?.id, Array.isArray(d?.layers) ? d.layers.length : 0]));
  return {
    bytes: Buffer.byteLength(JSON.stringify(user)),
    // feed, graph.nodes and docs count as lists; layers are added per document, paired by id below.
    base: (Array.isArray(s.feed) ? s.feed.length : 0) + (Array.isArray(s.graph?.nodes) ? s.graph.nodes.length : 0) + docs.length,
    layers,
  };
}

/**
 * True when the new text of a session looks like a loss: its user bytes fall below half (the previous one over 4 KB)
 * AND more than half of its user elements are gone. Layers count only for documents present in both versions.
 */
export function looksLost(prevText, nextText) {
  const prev = measure(prevText);
  if (!prev || prev.bytes <= SHRINK_CHECK_BYTES) return false;
  const next = measure(nextText);
  // A new text that cannot be read is judged by bytes alone, as the guard did before.
  if (!next) return Buffer.byteLength(nextText) < Buffer.byteLength(prevText) / 2;
  if (!(next.bytes < prev.bytes / 2)) return false;
  let had = prev.base, has = next.base;
  for (const [id, n] of prev.layers) {
    if (next.layers.has(id)) { had += n; has += next.layers.get(id); }
  }
  return has < had / 2;
}

/**
 * Library loss guard (2026-11-24, the user's authorization): fewer records of a collection lost than this is never a loss.
 * A library entry is a document, like a session. Results come in batches, so deleting one batch must pass.
 */
const MIN_LOST = { library: 2, assets: 10, generations: 10 };
export const RECORD_COLLS = ['generations', 'assets', 'library'];

/** True when `lost` of the `had` records of a collection leave less than half of them. New records do not make up for lost ones. */
export const mostLost = (coll, had, lost) => lost >= MIN_LOST[coll] && had - lost < had / 2;

/** The hash both sides compute over the ids of a collection (any order). */
export const idsHash = (ids) => sha256(JSON.stringify([...ids].sort()));

/**
 * The collections that lose most of their records between two states. `prev` and `next` map id to the session it belongs
 * to. What goes away together with its session is not counted: the session rule already judges that removal.
 * Returns [{ coll, lost: ids, diskHash, candidateHash }].
 */
export function recordLosses(prev, next, removedSessions = new Set()) {
  const out = [];
  for (const coll of RECORD_COLLS) {
    const gone = [...prev[coll].keys()].filter((id) => !next[coll].has(id));
    const lost = coll === 'library' ? gone : gone.filter((id) => !removedSessions.has(prev[coll].get(id)));
    const had = prev[coll].size - (gone.length - lost.length);
    if (mostLost(coll, had, lost.length)) out.push({ coll, lost, diskHash: idsHash(prev[coll].keys()), candidateHash: idsHash(next[coll].keys()) });
  }
  return out;
}

/** The losses `keep` ("Keep this version") does not approve: each collection is bound to the ids on disk and the ids sent. */
export function unapprovedRecords(losses, keep) {
  const approved = new Map((Array.isArray(keep?.records) ? keep.records : []).map((k) => [k?.coll, k]));
  return losses.filter((l) => {
    const k = approved.get(l.coll);
    return !(k && k.diskHash === l.diskHash && k.candidateHash === l.candidateHash);
  });
}

/** What the 409 says of each refused collection. */
export const recordsBody = (losses) => losses.map(({ coll, lost, diskHash }) => ({ coll, lost: lost.length, diskHash }));
