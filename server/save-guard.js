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
