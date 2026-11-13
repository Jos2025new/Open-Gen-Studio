import type { DesignDoc } from '../../engine/types';
import { toast } from '../../store/store';
import { objectPicks, setObjectPicks } from '../../engine/design/objectSelection';
import { groupPicks, ungroupPicked } from '../../engine/design/objectGroups';

/** Ctrl+G / Ctrl+Shift+G on picked shapes, of one vector layer or several. False when it does not apply (layers get Ctrl+G). */
export function objectGroupKey(sessionId: string, doc: DesignDoc, ungroup: boolean): boolean {
  const picks = objectPicks(doc.id).filter((p) => { const l = doc.layers.find((x) => x.id === p.layerId); return l?.type === 'vector' && p.ids.some((id) => l.shapes.some((s) => s.id === id)); });
  if (!picks.length) return false;
  if (ungroup) return picks.map((p) => ungroupPicked(sessionId, doc.id, p.layerId, p.ids)).some(Boolean);
  const done = groupPicks(sessionId, doc.id, picks);
  if (!done) return false;
  // Never silent: what stops the group is said (no change was made).
  if ('error' in done) { toast(done.error, 'info'); return true; }
  setObjectPicks(doc.id, [{ layerId: done.layerId, ids: done.ids }]);
  return true;
}
