import type { DesignDoc } from '../types';
import { objectAt, pickableObjects } from './objectOps';
import { hitTestPixel } from './render';
import { setActiveLayer } from './actions';
import { objectPicks, setObjectPick, type ObjectPick } from './objectSelection';
import { setLayerPicks } from './selection';
import { vectorObjectHit } from './objectHit';

export type Under = { layerId: string; id: string };

/** Every object under a point, topmost first: layers top to bottom, and inside a layer its parts top to bottom. */
export function objectsUnder(doc: DesignDoc, x: number, y: number): Under[] {
  const out: Under[] = [];
  for (let li = doc.layers.length - 1; li >= 0; li--) {
    const layer = doc.layers[li];
    if (!layer.visible || layer.locked) continue;
    const top = objectAt(layer, x, y);
    if (!top) continue;
    const objs = pickableObjects(layer);
    const ids = [top];
    for (let i = objs.length - 1; i >= 0; i--) {
      const { id, box } = objs[i];
      if (ids.includes(id)) continue;
      // The image counts only where its pixels are; parts by their box.
      const inside = x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
      const hit = id === layer.id ? Boolean(hitTestPixel({ layers: [layer] } as DesignDoc, x, y)) : inside && (layer.type !== 'vector' || vectorObjectHit(layer, id, x, y));
      if (hit) ids.push(id);
    }
    for (const id of ids) out.push({ layerId: layer.id, id });
  }
  return out;
}

/** The object just below the current pick at this point (Illustrator's Ctrl+Alt+click); wraps to the top. */
export function objectBelow(doc: DesignDoc, x: number, y: number, picks: ObjectPick[]): Under | null {
  const under = objectsUnder(doc, x, y);
  if (!under.length) return null;
  let last = -1;
  under.forEach((u, i) => { if (picks.some((p) => p.layerId === u.layerId && p.ids.includes(u.id))) last = i; });
  return under[(last + 1) % under.length];
}

/** Ctrl+Alt+click in Object mode: pick the next object below. */
export function pickBelow(sessionId: string, doc: DesignDoc, x: number, y: number): void {
  const b = objectBelow(doc, x, y, objectPicks(doc.id));
  if (!b) return;
  setActiveLayer(sessionId, doc.id, b.layerId);
  setLayerPicks(doc.id, []);
  setObjectPick(doc.id, { layerId: b.layerId, ids: [b.id] });
}
