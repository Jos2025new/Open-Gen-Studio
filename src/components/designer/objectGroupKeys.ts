import type { DesignDoc } from '../../engine/types';
import { objectPicks, setObjectPicks } from '../../engine/design/objectSelection';
import { groupPicked, ungroupPicked } from '../../engine/design/objectGroups';
import { getDoc } from '../../engine/design/actions';
import { clickPick } from '../../engine/design/objectGroupTree';

/** Ctrl+G / Ctrl+Shift+G on shapes picked in one vector layer. False when it does not apply (layers get Ctrl+G). */
export function objectGroupKey(sessionId: string, doc: DesignDoc, ungroup: boolean): boolean {
  const picks = objectPicks(doc.id);
  if (picks.length !== 1) return false;
  const { layerId, ids } = picks[0];
  const layer = doc.layers.find((l) => l.id === layerId);
  if (layer?.type !== 'vector' || !ids.some((id) => layer.shapes.some((s) => s.id === id))) return false;
  if (ungroup) return ungroupPicked(sessionId, doc.id, layerId, ids);
  if (!groupPicked(sessionId, doc.id, layerId, ids)) return false;
  const next = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === layerId);
  if (next?.type === 'vector') setObjectPicks(doc.id, [{ layerId, ids: clickPick(next, ids[0]) }]);
  return true;
}
