import type { DesignDoc, Layer, ShapeSpec } from '../types';
import { toast } from '../../store/store';
import { mutateDoc } from './actions';
import { alignBoxes, commitLayers, distributeBoxes, layerObjects, moveEach, pickIds, translateObjects, turnObjects, wholeLayerObject, withoutObjects } from './objectOps';
import { removeLayer } from './doc';
import { composeRaster } from './rasterCompose';
import { getRasterSurface } from './raster';
import { record } from './history';
import { pixelsNotReady } from './rasterMissing';
import type { ObjectPick } from './objectSelection';
import { looksUnchanged, noChangeNote } from './symmetry';
import type { AlignTo, Box, RelativeTo, Turn } from './transform';

/*
 * The object selection spans layers (objectSelection.ts): these apply one action to every picked object, each in its own
 * layer, as ONE undo step (commitLayers). A pick in a locked layer refuses the whole action, so nothing moves half-way.
 */

export interface PickGroup { layer: Layer; ids: string[] }

/** The picked objects that still exist, grouped by their layer (a layer that is gone or has none of them drops out). */
export function pickGroups(doc: DesignDoc, picks: readonly ObjectPick[]): PickGroup[] {
  const out: PickGroup[] = [];
  for (const pick of picks) {
    const layer = doc.layers.find((l) => l.id === pick.layerId);
    if (!layer) continue;
    const own = pickIds(layer);
    const ids = pick.ids.filter((id) => own.has(id));
    if (ids.length) out.push({ layer, ids });
  }
  return out;
}

/** Boxes of the picked objects in page coordinates; each id is paired with its layer. */
function keyed(groups: PickGroup[]): { items: Array<{ id: string; box: Box }>; owner: Map<string, { layerId: string; id: string }> } {
  const items: Array<{ id: string; box: Box }> = [], owner = new Map<string, { layerId: string; id: string }>();
  for (const g of groups) {
    const boxes = new Map(layerObjects(g.layer).map((o) => [o.id, o.box]));
    for (const id of g.ids) {
      const box = boxes.get(id);
      if (!box) continue;
      const key = `${g.layer.id}\u0000${id}`;
      items.push({ id: key, box });
      owner.set(key, { layerId: g.layer.id, id });
    }
  }
  return { items, owner };
}

function applyDeltas(sessionId: string, docId: string, groups: PickGroup[], owner: Map<string, { layerId: string; id: string }>, deltas: Map<string, { dx: number; dy: number }>): void {
  const byLayer = new Map<string, Map<string, { dx: number; dy: number }>>();
  for (const [key, delta] of deltas) {
    const o = owner.get(key);
    if (!o) continue;
    const m = byLayer.get(o.layerId) ?? new Map();
    m.set(o.id, delta);
    byLayer.set(o.layerId, m);
  }
  const next = groups.filter((g) => byLayer.has(g.layer.id)).map((g) => moveEach(g.layer, byLayer.get(g.layer.id)!));
  commitLayers(sessionId, docId, next);
}

export function alignPicks(sessionId: string, docId: string, doc: DesignDoc, picks: readonly ObjectPick[], to: AlignTo, rel: RelativeTo, asGroup = false): void {
  const groups = pickGroups(doc, picks), { items, owner } = keyed(groups);
  applyDeltas(sessionId, docId, groups, owner, alignBoxes(doc, items, to, rel, asGroup));
}

export function distributePicks(sessionId: string, docId: string, doc: DesignDoc, picks: readonly ObjectPick[], axis: 'h' | 'v'): void {
  const groups = pickGroups(doc, picks), { items, owner } = keyed(groups);
  applyDeltas(sessionId, docId, groups, owner, distributeBoxes(items, axis));
}

/** Flip or turn the picked objects; each layer's objects turn about the center of their own joint box. */
export function turnPicks(sessionId: string, docId: string, doc: DesignDoc, picks: readonly ObjectPick[], turn: Turn): void {
  const groups = pickGroups(doc, picks);
  const next = groups.map((g) => turnObjects(g.layer, g.ids, turn));
  commitLayers(sessionId, docId, next);
  if (groups.length && groups.every((g, i) => looksUnchanged(g.layer, next[i], g.ids))) {
    toast(noChangeNote(groups.length === 1 && groups[0].layer.type === 'vector' ? groups[0].layer.name : 'the selection', turn), 'info', 5000);
  }
}

/** Move the picked objects (pure): the layers as they would be. */
export function translatePicks(groups: PickGroup[], dx: number, dy: number): Layer[] {
  return groups.map((g) => translateObjects(g.layer, g.ids, dx, dy));
}

/** Delete the picked objects of every layer, one undo step. */
export function deletePicks(sessionId: string, docId: string, doc: DesignDoc, picks: readonly ObjectPick[]): void {
  const groups = pickGroups(doc, picks);
  const gone = groups.filter((g) => (wholeLayerObject(g.layer) || g.layer.type === 'raster') && g.ids.includes(g.layer.id));
  const parts = groups.filter((g) => !gone.includes(g));
  const next = parts.map((g) => withoutObjects(g.layer, g.ids)).filter((l, i) => l !== parts[i].layer);
  if (!gone.length) return commitLayers(sessionId, docId, next);
  const locked = groups.find((g) => g.layer.locked);
  if (locked) return void toast(`"${locked.layer.name}" is locked.`, 'error');
  for (const layer of next) if (layer.type === 'raster' && (!layer.paintBaseId || !getRasterSurface(layer.paintBaseId))) return void toast(pixelsNotReady([layer.id, layer.paintBaseId]), 'error');
  record(doc);
  for (const layer of next) if (layer.type === 'raster') composeRaster(layer);
  const byId = new Map(next.map((layer) => [layer.id, layer.type === 'raster' ? { ...layer, rev: layer.rev + 1 } : layer] as const));
  mutateDoc(sessionId, docId, (d) => gone.reduce((acc, g) => removeLayer(acc, g.layer.id), { ...d, layers: d.layers.map((l) => byId.get(l.id) ?? l) }), { record: false });
}

/** The first locked layer among the picks, if any. */
export function lockedPickLayer(doc: DesignDoc, picks: readonly ObjectPick[]): Layer | undefined {
  return pickGroups(doc, picks).find((g) => g.layer.locked)?.layer;
}

/**
 * Change the look of every picked vector shape (colour, stroke width, cap, join…) in its own layer, one undo step.
 * Locked and hidden layers are left alone. Returns how many shapes changed.
 */
export function patchPickedShapes(sessionId: string, docId: string, doc: DesignDoc, picks: readonly ObjectPick[], patch: Partial<ShapeSpec>, opts: { record?: boolean } = {}): number {
  const ids = new Map(picks.map((p) => [p.layerId, new Set(p.ids)] as const));
  let count = 0;
  for (const l of doc.layers) if (l.type === 'vector' && !l.locked && l.visible) count += l.shapes.filter((s) => ids.get(l.id)?.has(s.id)).length;
  if (!count) return 0;
  mutateDoc(sessionId, docId, (d) => ({ ...d, updatedAt: Date.now(), layers: d.layers.map((l) => {
    const set = ids.get(l.id);
    if (!set || l.type !== 'vector' || l.locked || !l.visible) return l;
    return { ...l, shapes: l.shapes.map((s) => (set.has(s.id) ? { ...s, ...patch } : s)) };
  }) }), opts);
  return count;
}
