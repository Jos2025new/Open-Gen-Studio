import { expandPicks } from '../../engine/design/objectGroupTree';
import type { DesignDoc } from '../../engine/types';
import { layerBox } from '../../engine/design/render';
import { pixelTarget } from '../../engine/design/autoSelect';
import { objectAt } from '../../engine/design/objectOps';
import { marqueeBounds } from '../../engine/design/marquee';
import { marqueeFind } from '../../engine/design/marqueePick';
import { layerSelection, setLayerPicks } from '../../engine/design/selection';
import { objectPicks, pickedIn, setObjectPick, setObjectPicks } from '../../engine/design/objectSelection';
import { setActiveLayer, getDoc } from '../../engine/design/actions';

export interface EditMarqueeDrag {
  kind: 'editMarquee'; startX: number; startY: number; x: number; y: number;
  mode: 'objects' | 'layers'; combine: 'replace' | 'add' | 'subtract';
}

export function beginEditMarquee(args: {
  doc: DesignDoc; point: { x: number; y: number }; layersMode: boolean; shift: boolean; alt: boolean; autoSelect?: boolean;
}): EditMarqueeDrag | null {
  const mode = args.layersMode ? 'layers' : 'objects';
  if (editAreaOccupied(args.doc, args.point, mode, args.autoSelect)) return null;
  return {
    kind: 'editMarquee', startX: args.point.x, startY: args.point.y,
    x: args.point.x, y: args.point.y, mode,
    combine: args.alt ? 'subtract' : args.shift ? 'add' : 'replace',
  };
}

export function updateEditMarquee(drag: EditMarqueeDrag, point: { x: number; y: number }): { x0: number; y0: number; x1: number; y1: number } {
  drag.x = point.x;
  drag.y = point.y;
  return { x0: drag.startX, y0: drag.startY, x1: point.x, y1: point.y };
}

export function editAreaOccupied(doc: DesignDoc, p: { x: number; y: number }, mode: EditMarqueeDrag['mode'], autoSelect = false): boolean {
  if (mode === 'objects') {
    return doc.layers.some((l) => l.visible && !l.locked && objectAt(l, p.x, p.y) != null) || pixelTarget(doc, p.x, p.y, autoSelect) != null;
  }
  return doc.layers.some((l) => {
    if (!l.visible || l.type === 'fx') return false;
    const b = layerBox(l);
    return Boolean(b && p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h);
  });
}

export function drawEditMarquee(ctx: CanvasRenderingContext2D, draft: { x0: number; y0: number; x1: number; y1: number }, view: { x: number; y: number; zoom: number }): void {
  const b = marqueeBounds(draft.x0, draft.y0, draft.x1, draft.y1);
  ctx.save();
  ctx.fillStyle = 'rgba(212,242,90,0.08)';
  ctx.strokeStyle = '#d4f25a';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.fillRect(view.x + b.left * view.zoom, view.y + b.top * view.zoom, (b.right - b.left) * view.zoom, (b.bottom - b.top) * view.zoom);
  ctx.strokeRect(view.x + b.left * view.zoom + 0.5, view.y + b.top * view.zoom + 0.5, (b.right - b.left) * view.zoom, (b.bottom - b.top) * view.zoom);
  ctx.restore();
}

export function finishEditMarquee(args: {
  drag: EditMarqueeDrag; sessionId: string; doc: DesignDoc; zoom: number;
  release?: { x: number; y: number }; cancelled?: boolean;
}): void {
  const { drag, sessionId, doc, zoom } = args;
  if (args.cancelled) return;
  if (args.release) { drag.x = args.release.x; drag.y = args.release.y; }
  const moved = Math.abs(drag.x - drag.startX) * zoom >= 3 && Math.abs(drag.y - drag.startY) * zoom >= 3;
  if (!moved) {
    if (drag.combine === 'replace') {
      setObjectPick(doc.id, null);
      setLayerPicks(doc.id, []);
    }
    return;
  }
  const current = getDoc(sessionId, doc.id) ?? doc;
  const find = marqueeFind(current, drag.startX, drag.startY, drag.x, drag.y);
  const activeId = current.activeLayerId;
  // Objects mode: a rectangle that reaches only objects (of any layer) picks those objects; one that also reaches
  // painted pixels or a layer with no objects (a baked drawing, an image) picks whole layers, as Layers mode does.
  const onlyObjects = drag.mode === 'objects' && find.layers.length > 0 && find.layers.every((id) => find.objects.has(id));
  if (onlyObjects) {
    const cur = objectPicks(doc.id);
    const layerIds = [...new Set([...cur.map((p) => p.layerId), ...find.objects.keys()])];
    setLayerPicks(doc.id, []);
    setObjectPicks(doc.id, layerIds.map((layerId) => {
      const ids = combineSelection(pickedIn(cur, layerId), find.objects.get(layerId) ?? [], drag.combine);
      const l = current.layers.find((x) => x.id === layerId);
      // A rectangle touching part of a group picks the whole group, as a click does.
      return { layerId, ids: l?.type === 'vector' && drag.combine !== 'subtract' ? expandPicks(l, ids) : ids };
    }));
  } else if (find.layers.length === 0 && drag.combine !== 'replace') {
    return;
  } else {
    const cur = objectPicks(doc.id);
    const base = cur.length ? cur.map((p) => p.layerId) : layerSelection(doc.id, activeId, current.layers.map((l) => l.id));
    const ids = combineSelection(base, find.layers, drag.combine);
    setObjectPick(doc.id, null);
    setLayerPicks(doc.id, ids);
    const nextActive = ids.includes(activeId ?? '') ? activeId : ids.at(-1) ?? null;
    if (nextActive !== activeId) setActiveLayer(sessionId, doc.id, nextActive);
  }
}

function combineSelection(current: string[], found: string[], combine: EditMarqueeDrag['combine']): string[] {
  if (combine === 'replace') return found;
  if (combine === 'add') return [...new Set([...current, ...found])];
  return current.filter((id) => !found.includes(id));
}
