import { uid } from '../lib/id';
import { useStore } from '../store/store';
import { getDoc, mutateDoc } from './design/actions';
import * as D from './design/doc';
import { liveGroups } from './design/groups';
import { isKit } from './libraryTypes';
import { cleanupKeys, copyDocPixels, expectedRasterIds, readKitVersion } from './libraryVersions';
import type { Layer, LayerGroup } from './types';

/* Copy-with-origin insertion of a Library kit component into a Designer document (single undo step, own pixels). */

function pureBox(l: Layer): D.Box | null {
  if (l.type === 'raster') return { x: l.x, y: l.y, w: l.width, h: l.height };
  if (l.type === 'text') return { x: l.x, y: l.y, w: l.width, h: Math.round(l.fontSize * l.lineHeight) };
  if (l.type === 'vector') return D.unionBox(l.shapes.map(D.shapeBox));
  return null;
}

function cloneMember(layer: Layer, newGroupId: string, pxMap: ReadonlyMap<string, string>): Layer {
  const remap = (id: string) => pxMap.get(id) ?? id;
  const copy = structuredClone(layer);
  if (copy.type === 'raster') {
    return { ...copy, id: remap(copy.id), groupId: newGroupId, ...(copy.paintBaseId ? { paintBaseId: remap(copy.paintBaseId) } : {}) };
  }
  if (copy.type === 'vector') {
    const gids = new Map((copy.objectGroups ?? []).map((g) => [g.id, uid('og')]));
    const objectGroups = gids.size ? copy.objectGroups!.map((g) => ({ ...g, id: gids.get(g.id)!, parentId: g.parentId && gids.get(g.parentId) })) : copy.objectGroups;
    const shapes = copy.shapes.map((s) => ({ ...s, id: uid('shp'), ...(s.groupId && gids.has(s.groupId) ? { groupId: gids.get(s.groupId) } : {}) }));
    const strokes = copy.strokes?.map((s) => ({ ...s, id: uid('stk') }));
    const pixelMask = copy.pixelMask ? { ...copy.pixelMask, id: remap(copy.pixelMask.id), ...(copy.pixelMask.paintBaseId ? { paintBaseId: remap(copy.pixelMask.paintBaseId) } : {}) } : undefined;
    return { ...copy, id: uid('lyr'), groupId: newGroupId, shapes, ...(objectGroups ? { objectGroups } : {}), ...(strokes ? { strokes } : {}), ...(pixelMask ? { pixelMask } : {}) };
  }
  return { ...copy, id: uid('lyr'), groupId: newGroupId };
}

export async function insertComponent(
  sessionId: string, docId: string, subjectId: string, pieceId: string, at?: { x: number; y: number },
): Promise<{ groupId: string; layerIds: string[] }> {
  if (!getDoc(sessionId, docId)) throw new Error(`No document "${docId}" in session "${sessionId}".`);
  const subject = useStore.getState().library.find((s) => s.id === subjectId);
  if (!subject || !isKit(subject)) throw new Error(`No kit "${subjectId}".`);
  if (!subject.versionId) throw new Error(`Kit "${subjectId}" has no saved version to insert from.`);
  const piece = (subject.pieces ?? []).find((p) => p.id === pieceId);
  if (!piece) throw new Error(`No piece "${pieceId}" in kit "${subjectId}".`);
  if (piece.kind !== 'component' || !piece.groupId) throw new Error(`Piece "${pieceId}" is not a component.`);
  const snap = await readKitVersion(subject.versionId);
  if (!snap?.doc) throw new Error(`Kit "${subjectId}" version "${subject.versionId}" has no document.`);
  const srcGroup = (snap.doc.groups ?? []).find((g) => g.id === piece.groupId);
  const srcLayers = snap.doc.layers.filter((l) => l.groupId === piece.groupId);
  if (!srcGroup || !srcLayers.length) throw new Error(`Component group "${piece.groupId}" is missing in version "${subject.versionId}".`);

  const written: string[] = [];
  try {
    const copied = await copyDocPixels({ ...snap.doc, layers: srcLayers }, null, expectedRasterIds(snap), written);
    const groupId = uid('grp');
    const idMap = new Map<string, string>();
    let layers = srcLayers.map((l) => {
      const next = cloneMember(l, groupId, copied.map);
      idMap.set(l.id, next.id);
      return next;
    });
    if (at) {
      const box = D.unionBox(layers.map(pureBox).filter((b): b is D.Box => b != null));
      if (box) {
        const dx = at.x - box.x, dy = at.y - box.y;
        layers = layers.map((l) => D.translateLayer(l, dx, dy));
      }
    }
    if (!getDoc(sessionId, docId)) throw new Error(`Target document "${docId}" was deleted while inserting.`);
    const newGroup: LayerGroup = {
      id: groupId, name: piece.name || srcGroup.name,
      ...(srcGroup.keptHidden ? { keptHidden: srcGroup.keptHidden.map((id) => idMap.get(id) ?? id) } : {}),
      ...(srcGroup.keptLocked ? { keptLocked: srcGroup.keptLocked.map((id) => idMap.get(id) ?? id) } : {}),
      from: { subjectId, pieceId, versionId: subject.versionId },
    };
    mutateDoc(sessionId, docId, (d) => ({
      ...d, updatedAt: Date.now(),
      groups: [...liveGroups(d), newGroup],
      layers: [...d.layers, ...layers],
      activeLayerId: layers[layers.length - 1].id,
    }));
    return { groupId, layerIds: layers.map((l) => l.id) };
  } catch (err) {
    await cleanupKeys(written);
    throw err;
  }
}
