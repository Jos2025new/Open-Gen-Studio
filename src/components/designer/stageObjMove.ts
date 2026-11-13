import type { DesignDoc, Layer, RasterLayer } from '../../engine/types';
import { composeMoving } from '../../engine/design/rasterCompose';
import { layerObjects, objectAt, objectsBox, pickIds, translateObjects, wholeLayerObject } from '../../engine/design/objectOps';
import { unionBox } from '../../engine/design/doc';
import type { ObjectPick } from '../../engine/design/objectSelection';
import { setDoc } from '../../store/store';
import { commitEdit } from '../../engine/design/raster';

/*
 * Dragging picked objects (Edit, Objects mode) when the pick spans layers: every layer's objects move together. The
 * dragged layer is the drag itself; the others are `ObjGroup`s that carry their own incremental compose (painted layers).
 */
export interface ObjGroup { layerId: string; ids: string[]; base: Layer; compose?: (moved: RasterLayer) => void }

/** The picked objects of the other layers (visible, unlocked, still there) that move with the one being dragged. */
export function otherGroups(doc: DesignDoc, picks: readonly ObjectPick[], layerId: string): ObjGroup[] {
  const out: ObjGroup[] = [];
  for (const pick of picks) {
    if (pick.layerId === layerId) continue;
    const base = doc.layers.find((l) => l.id === pick.layerId);
    if (!base || !base.visible || base.locked) continue;
    const own = pickIds(base);
    const ids = pick.ids.filter((id) => own.has(id));
    if (ids.length) out.push({ layerId: base.id, ids, base });
  }
  return out;
}

/** The layers with their picked objects moved by (dx, dy); null when a painted layer's pixels are not ready. */
export function moveGroups(groups: ObjGroup[], dx: number, dy: number): Map<string, Layer> | null {
  const out = new Map<string, Layer>();
  for (const g of groups) {
    const moved = translateObjects(g.base, g.ids, dx, dy);
    if (moved.type === 'raster' && g.base.type === 'raster' && !(wholeLayerObject(g.base) || g.ids.includes(g.base.id))) {
      if (!(g.compose ??= composeMoving(g.base, g.ids) ?? undefined)) return null;
      g.compose(moved);
    }
    out.set(g.layerId, moved);
  }
  return out;
}

/** Joint box of the groups' objects that snap (painted strokes are never snapped). */
export function snapBox(groups: ObjGroup[]) {
  return unionBox(groups.filter((g) => g.base.type !== 'raster' || (wholeLayerObject(g.base) || g.ids.includes(g.base.id))).map((g) => objectsBox(g.base, g.ids)).filter((b): b is NonNullable<typeof b> => Boolean(b)));
}

/** The topmost visible, unlocked layer with an object under the point (Ctrl-click picks from any layer). */
export function topObjectLayer(doc: DesignDoc, x: number, y: number): Layer | null {
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i];
    if (l.visible && !l.locked && objectAt(l, x, y)) return l;
  }
  return null;
}

/** Outline the picked objects of the layers other than `exceptId` (the active layer draws its own); `rect` maps a page box to screen. */
export function outlinePicked(ctx: CanvasRenderingContext2D, doc: DesignDoc, picks: readonly ObjectPick[] | undefined, exceptId: string | undefined, color: string, rect: (b: { x: number; y: number; w: number; h: number }) => [number, number, number, number]): void {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  for (const pick of picks ?? []) {
    const layer = pick.layerId === exceptId ? undefined : doc.layers.find((l) => l.id === pick.layerId);
    if (layer?.visible) for (const o of layerObjects(layer)) if (pick.ids.includes(o.id)) ctx.strokeRect(...rect(o.box));
  }
  ctx.restore();
}

/** Every layer a drag moves: the dragged one and the others picked along. */
export const dragGroups = (d: ObjGroup & { others?: ObjGroup[] }): ObjGroup[] => [d, ...(d.others ?? [])];

/** After the drag: painted layers close their edit and bump their revision. */
export function commitPaintedMove(sessionId: string, docId: string, groups: ObjGroup[]): void {
  const painted = groups.filter((g) => g.base.type === 'raster' && !(wholeLayerObject(g.base) || g.ids.includes(g.base.id))).map((g) => g.layerId);
  if (!painted.length) return;
  painted.forEach((id) => commitEdit(id));
  setDoc(sessionId, docId, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (painted.includes(l.id) && l.type === 'raster' ? { ...l, rev: l.rev + 1 } : l)) }));
}

/** What the transform handles act on for an object pick: each layer's picked objects (layers that `ok` refuses drop out). */
export function pickedTargets(doc: DesignDoc, picks: readonly ObjectPick[], ok: (l: Layer | undefined) => boolean): Array<{ layer: Layer; ids: string[] }> {
  return picks.flatMap((pk) => { const layer = doc.layers.find((l) => l.id === pk.layerId); return layer && ok(layer) && pk.ids.length ? [{ layer, ids: pk.ids }] : []; });
}
