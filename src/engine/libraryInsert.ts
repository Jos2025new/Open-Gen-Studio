import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { getDoc, mutateDoc } from './design/actions';
import * as D from './design/doc';
import { liveGroups } from './design/groups';
import { isKit } from './libraryTypes';
import { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion } from './libraryVersions';
import type { Layer, LayerGroup } from './types';

/* Copy-with-origin insertion of a Library component into a Designer document (single undo step, own pixels). */
function cloneMember(layer: Layer, newGroupId: string, pxMap: ReadonlyMap<string, string>): Layer {
  const remap = (id: string) => pxMap.get(id) ?? id, copy = structuredClone(layer);
  if (copy.type === 'raster') return { ...copy, id: remap(copy.id), groupId: newGroupId, ...(copy.paintBaseId ? { paintBaseId: remap(copy.paintBaseId) } : {}) };
  if (copy.type === 'vector') {
    const gids = new Map((copy.objectGroups ?? []).map((g) => [g.id, uid('og')]));
    const objectGroups = gids.size ? copy.objectGroups!.map((g) => ({ ...g, id: gids.get(g.id)!, parentId: g.parentId && gids.get(g.parentId) })) : copy.objectGroups;
    const shapes = copy.shapes.map((s) => ({ ...s, id: uid('shp'), ...(s.groupId && gids.has(s.groupId) ? { groupId: gids.get(s.groupId) } : {}) }));
    const pixelMask = copy.pixelMask ? { ...copy.pixelMask, id: remap(copy.pixelMask.id), ...(copy.pixelMask.paintBaseId ? { paintBaseId: remap(copy.pixelMask.paintBaseId) } : {}) } : undefined;
    return { ...copy, id: uid('lyr'), groupId: newGroupId, shapes, ...(objectGroups ? { objectGroups } : {}), ...(copy.strokes ? { strokes: copy.strokes.map((s) => ({ ...s, id: uid('stk') })) } : {}), ...(pixelMask ? { pixelMask } : {}) };
  }
  return { ...copy, id: uid('lyr'), groupId: newGroupId };
}

export async function insertComponent(sessionId: string, docId: string, subjectId: string, pieceId: string, at?: { x: number; y: number }): Promise<{ groupId: string; layerIds: string[] }> {
  if (!getDoc(sessionId, docId)) throw new Error(`No document "${docId}" in session "${sessionId}".`);
  const subject = useStore.getState().library.find((s) => s.id === subjectId);
  if (!subject || !isKit(subject)) throw new Error(`No Library item "${subjectId}".`);
  if (!subject.versionId) throw new Error(`Library item "${subjectId}" has no saved version.`);
  const snap = await readKitVersion(subject.versionId);
  if (!snap?.doc) throw new Error(`Item "${subjectId}" version "${subject.versionId}" has no document.`);
  const srcGroup = (snap.doc.groups ?? []).find((g) => g.id === pieceId), srcLayers = snap.doc.layers.filter((l) => l.groupId === pieceId);
  if (!srcGroup || !srcLayers.length) throw new Error(`No component group "${pieceId}" in "${subjectId}".`);
  const written: string[] = [];
  try {
    const copied = await copyDocPixels({ ...snap.doc, layers: srcLayers }, null, expectedRasterIds(snap), written);
    const groupId = uid('grp'), idMap = new Map<string, string>();
    let layers = srcLayers.map((l) => { const next = cloneMember(l, groupId, copied.map); idMap.set(l.id, next.id); return next; });
    if (at) {
      const box = D.unionBox(layers.map(D.approxLayerBox).filter((b): b is D.Box => b != null));
      if (box) layers = layers.map((l) => D.translateLayer(l, at.x - box.x, at.y - box.y));
    }
    if (!getDoc(sessionId, docId)) throw new Error(`Target document "${docId}" was deleted while inserting.`);
    const newGroup: LayerGroup = {
      id: groupId, name: srcGroup.name, from: { subjectId, pieceId, versionId: subject.versionId },
      ...(srcGroup.keptHidden ? { keptHidden: srcGroup.keptHidden.map((id) => idMap.get(id) ?? id) } : {}),
      ...(srcGroup.keptLocked ? { keptLocked: srcGroup.keptLocked.map((id) => idMap.get(id) ?? id) } : {}),
    };
    mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), groups: [...liveGroups(d), newGroup], layers: [...d.layers, ...layers], activeLayerId: layers[layers.length - 1].id }));
    return { groupId, layerIds: layers.map((l) => l.id) };
  } catch (err) { await cleanupKeys(written); throw err; }
}
