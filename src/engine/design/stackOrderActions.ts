import { getDoc, mutateDoc } from './actions';
import { objectPicks } from './objectSelection';
import { layerSelection } from './selection';
import { restackLayers, restackPicks, type StackOp } from './stackOrder';
import { useStore } from '../../store/store';

/** What the stacking buttons and Home / PageUp / PageDown / End act on: the picked objects, else the selected layers. */
export function stackTarget(docId: string, activeLayerId: string | null, layerIds: string[]): { mode: 'objects' | 'layers'; layerIds: string[] } | null {
  const mode = useStore.getState().ui.selectMode ?? 'objects';
  if (mode === 'objects' && objectPicks(docId).length) return { mode: 'objects', layerIds: [] };
  // Layers mode, or several layers picked in the panel with no object picked (the strip treats that as layers too).
  const ids = layerSelection(docId, activeLayerId, layerIds);
  return ids.length && (mode === 'layers' || ids.length > 1) ? { mode: 'layers', layerIds: ids } : null;
}

/** Move the selection in the stacking order. One undo step; false when nothing can move. */
export function restackSelection(sessionId: string, docId: string, op: StackOp): boolean {
  const doc = getDoc(sessionId, docId);
  const target = doc && stackTarget(docId, doc.activeLayerId, doc.layers.map((l) => l.id));
  if (!doc || !target) return false;
  const next = target.mode === 'objects' ? restackPicks(doc, objectPicks(docId), op) : restackLayers(doc, target.layerIds, op);
  if (!next) return false;
  mutateDoc(sessionId, docId, () => next);
  return true;
}
