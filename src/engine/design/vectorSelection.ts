import type { DesignDoc, VectorLayer } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { cloneLayer, newRasterLayer, unionBox } from './doc';
import { layerBox } from './render';
import { getSelection, selectionMask } from './pixelSelection';
import { getBuffer, setBuffer } from './raster';
import { maskFrame } from './vectorMask';

/** Split coverage rather than geometry: shapes and editable strokes survive on both sides. */
export function splitVectorSelection(doc: DesignDoc, source: VectorLayer, cutSource = true): { original: VectorLayer; lifted: VectorLayer } | null {
  const sel = getSelection(doc.id);
  if (!sel) return null;
  const old = source.pixelMask;
  if (old && !getBuffer(old.id)) return null;
  const content = layerBox(source);
  const b = unionBox([{ x: 0, y: 0, w: doc.width, h: doc.height }, ...(content ? [content] : [])])!;
  const x = Math.floor(b.x), y = Math.floor(b.y), width = Math.ceil(b.x + b.w) - x, height = Math.ceil(b.y + b.h) - y;
  const coverage = createCanvas(width, height), c = ctx2d(coverage);
  if (old) {
    const frame = maskFrame(old);
    c.setTransform(frame[0], frame[1], frame[2], frame[3], frame[4] - x, frame[5] - y);
    c.drawImage(getBuffer(old.id)!, 0, 0);
  } else { c.fillStyle = '#ffffff'; c.fillRect(0, 0, width, height); }
  const selection = createCanvas(width, height);
  ctx2d(selection).drawImage(selectionMask(doc, sel), -x, -y);
  const make = (operation: 'destination-in' | 'destination-out') => {
    const pixels = createCanvas(width, height), ctx = ctx2d(pixels);
    ctx.drawImage(coverage, 0, 0);
    ctx.globalCompositeOperation = operation;
    ctx.drawImage(selection, 0, 0);
    const mask = newRasterLayer('Selection coverage', { x, y, width, height }, { width, height });
    setBuffer(mask.id, pixels);
    return mask;
  };
  const lifted = cloneLayer(source) as VectorLayer;
  return { original: cutSource ? { ...source, pixelMask: make('destination-out') } : source, lifted: { ...lifted, name: `${source.name} · selection`, pixelMask: make('destination-in') } };
}
