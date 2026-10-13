import { setDoc } from '../../store/store';
import { getDoc } from './actions';
import { translateLayer } from './doc';
import { record } from './history';

/*
 * Arrow keys move the picked layers by one document pixel (Shift: ten). A burst of presses is one undo step: the first
 * press of a burst records it, the presses that follow within BURST_MS share it, as a drag does (LayerGeometry).
 * Locked layers do not move; the caller says so.
 */
const BURST_MS = 600;
let last = { doc: '', at: 0 };

export function nudgeLayers(sessionId: string, docId: string, ids: readonly string[], dx: number, dy: number): { moved: number; locked: number } {
  const doc = getDoc(sessionId, docId);
  if (!doc) return { moved: 0, locked: 0 };
  const picked = doc.layers.filter((l) => ids.includes(l.id));
  const free = picked.filter((l) => !l.locked);
  const locked = picked.length - free.length;
  if (!free.length) return { moved: 0, locked };
  const now = Date.now();
  if (last.doc !== docId || now - last.at > BURST_MS) record(doc);
  last = { doc: docId, at: now };
  setDoc(sessionId, docId, (d) => ({ ...d, updatedAt: now, layers: d.layers.map((l) => (ids.includes(l.id) && !l.locked ? translateLayer(l, dx, dy) : l)) }));
  return { moved: free.length, locked };
}
