import type { DesignDoc, RasterLayer } from '../types';
import { setDoc } from '../../store/store';
import { ctx2d } from '../../lib/media';
import { getDoc } from './actions';
import { cloneCanvas, getBuffer, setBuffer } from './raster';

export function uniformOpaqueColor(pixels: Uint8ClampedArray): string | null {
  if (!pixels.length || pixels[3] !== 255) return null;
  for (let i = 4; i < pixels.length; i += 4) {
    if (pixels[i] !== pixels[0] || pixels[i + 1] !== pixels[1] || pixels[i + 2] !== pixels[2] || pixels[i + 3] !== 255) return null;
  }
  return '#' + [...pixels.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** Only uniform, opaque, full-page fills grow as a background. Artwork and placed images retain their pixels. */
export function solidPageFills(doc: DesignDoc): Map<string, string> {
  const fills = new Map<string, string>();
  for (const layer of doc.layers) {
    if (layer.type !== 'raster' || layer.sourceAssetId || layer.paintBaseId || layer.paintStrokes?.length || layer.transform || layer.opacity !== 1 || layer.blend !== 'normal') continue;
    if (layer.x > 0 || layer.y > 0 || layer.x + layer.width < doc.width || layer.y + layer.height < doc.height) continue;
    const buf = getBuffer(layer.id);
    if (!buf) continue;
    const color = layer.pageFill?.rev === layer.rev ? layer.pageFill.color : uniformOpaqueColor(ctx2d(buf).getImageData(0, 0, buf.width, buf.height).data);
    if (color) fills.set(layer.id, color);
  }
  return fills;
}

export function extendSolidPageFills(sessionId: string, docId: string, fills: Map<string, string>): void {
  const doc = getDoc(sessionId, docId);
  for (const [id, color] of fills) {
    const layer = doc?.layers.find(l => l.id === id) as RasterLayer | undefined;
    const buf = getBuffer(id);
    if (!layer || !buf) continue;
    const out = cloneCanvas(buf), ctx = ctx2d(out);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, out.width, out.height);
    setBuffer(id, out);
    setDoc(sessionId, docId, d => ({ ...d, layers: d.layers.map(l => l.id === id ? { ...l, pageFill: { color, rev: layer.rev } } : l) }));
  }
}
