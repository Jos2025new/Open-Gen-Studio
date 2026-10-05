import { splitVectorSelection } from './vectorSelection';
import type { DesignDoc, Layer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { setDoc, toast } from '../../store/store';
import { insertLayer, newRasterLayer, translateLayer } from './doc';
import { getDoc } from './actions';
import { editableRaster, getSelection, selectionClipFor, selectionMask, setSelection } from './pixelSelection';
import { getBuffer, setBuffer } from './raster';
import { pickLayer } from './selection';
import { setObjectPick } from './objectSelection';
import { record } from './history';

type Point = { x: number; y: number };
export interface PixelMove { update(point: Point): void }

/** null: ordinary move; true: refused pixel move; object: pending extraction after the drag threshold. */
export function startPixelMove(sessionId: string, doc: DesignDoc, start: Point, threshold: number): PixelMove | true | null {
  const sel = getSelection(doc.id);
  if (!sel || start.x < 0 || start.y < 0 || start.x >= doc.width || start.y >= doc.height) return null;
  if (!ctx2d(selectionMask(doc, sel)).getImageData(Math.floor(start.x), Math.floor(start.y), 1, 1).data[3]) return null;
  const active = doc.layers.find(l => l.id === doc.activeLayerId);
  const source = active?.type === 'vector' ? active.locked ? `"${active.name}" is locked.` : !active.visible ? 'The active layer is hidden.' : active.pixelMask && !getBuffer(active.pixelMask.id) ? 'Layer pixels are still loading.' : active : editableRaster(doc);
  if (typeof source === 'string') { toast(source, 'error'); return true; }
  let lifted: Layer | null = null;
  return { update(point) {
    const dx = point.x - start.x, dy = point.y - start.y;
    if (!lifted) {
      if (Math.hypot(dx, dy) <= threshold) return;
      // A concurrent layer change must not be overwritten by the captured pointer-down state.
      if (getDoc(sessionId, doc.id) !== doc) return;
      if (source.type === 'vector') {
        const split = splitVectorSelection(doc, source);
        if (!split) return;
        record(doc);
        lifted = split.lifted;
        setDoc(sessionId, doc.id, () => insertLayer({ ...doc, layers: doc.layers.map(l => l.id === source.id ? split.original : l) }, split.lifted, 'above'));
      } else {
        const pixels = getBuffer(source.id)!;
        const clip = selectionClipFor(doc, source)!;
        const remainder = createCanvas(pixels.width, pixels.height), cut = createCanvas(pixels.width, pixels.height);
        for (const [canvas, operation] of [[remainder, 'destination-out'], [cut, 'destination-in']] as const) {
          const ctx = ctx2d(canvas);
          ctx.drawImage(pixels, 0, 0);
          ctx.globalCompositeOperation = operation;
          ctx.drawImage(clip, 0, 0);
        }
        lifted = { ...newRasterLayer(`${source.name} · selection`, source, { width: pixels.width, height: pixels.height }),
          opacity: source.opacity, blend: source.blend, transform: source.transform };
        record(doc);
        setBuffer(source.id, remainder);
        setBuffer(lifted.id, cut);
        const original = { ...source, paintBaseId: undefined, paintStrokes: undefined, rev: source.rev + 1 };
        setDoc(sessionId, doc.id, () => insertLayer({ ...doc, layers: doc.layers.map(l => l.id === source.id ? original : l) }, lifted!, 'above'));
      }
      pickLayer(doc.id, lifted.id, false, []);
      setObjectPick(doc.id, null);
      setSelection(doc.id, null);
    }
    const layer = lifted;
    // translateLayer also handles affine transforms of placed images.
    setDoc(sessionId, doc.id, d => ({ ...d, updatedAt: Date.now(), layers: d.layers.map(l => l.id === layer.id ? translateLayer(layer, dx, dy) : l) }));
  } };
}
