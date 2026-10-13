import { createCanvas, ctx2d } from '../../lib/media';

/*
 * A raster layer's pixels are stored in a box: a canvas of the content's size, placed at (x0, y0) of the full buffer
 * (fw × fh, the layer's pixel size). Boxes are aligned to 64 px, so history tiles line up with the full grid. The
 * placement is kept on the canvas itself (a WeakMap), so every canvas knows where it sits; a canvas with no entry is
 * a full buffer at (0, 0). Saving assembles the full buffer; loading crops it back to its box (raster.ts).
 */

export const BOX_ALIGN = 64;

export interface Geometry { x0: number; y0: number; fw: number; fh: number; /** An empty layer's placeholder: its 1 × 1 pixel covers nothing. */ empty?: true }
export interface Region { x0: number; y0: number; x1: number; y1: number }
/** A stored canvas and where it sits in the full buffer. */
export interface RasterSurface extends Geometry { canvas: HTMLCanvasElement }

const placed = new WeakMap<HTMLCanvasElement, Geometry>();

export function geometryOf(c: HTMLCanvasElement): Geometry {
  return placed.get(c) ?? { x0: 0, y0: 0, fw: c.width, fh: c.height };
}
export function isPlaced(c: HTMLCanvasElement): boolean {
  return placed.has(c);
}
export function place<T extends HTMLCanvasElement>(c: T, g: Geometry): T {
  placed.set(c, g);
  return c;
}

/** A canvas placed at the origin with no pixels: an empty layer (1 × 1, transparent; createCanvas never makes 0 × 0). */
export function emptyBox(fw: number, fh: number): HTMLCanvasElement {
  return place(createCanvas(1, 1), { x0: 0, y0: 0, fw, fh, empty: true });
}

/** The union of the regions, aligned outward to the grid and kept inside the full buffer. Null when nothing is left. */
export function unionRegion(list: Array<Region | null | undefined>, fw: number, fh: number): Region | null {
  let r: Region | null = null;
  for (const b of list) {
    if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
    r = r ? { x0: Math.min(r.x0, b.x0), y0: Math.min(r.y0, b.y0), x1: Math.max(r.x1, b.x1), y1: Math.max(r.y1, b.y1) } : { ...b };
  }
  if (!r) return null;
  const x0 = Math.max(0, Math.floor(r.x0 / BOX_ALIGN) * BOX_ALIGN), y0 = Math.max(0, Math.floor(r.y0 / BOX_ALIGN) * BOX_ALIGN);
  const x1 = Math.min(fw, Math.ceil(r.x1 / BOX_ALIGN) * BOX_ALIGN), y1 = Math.min(fh, Math.ceil(r.y1 / BOX_ALIGN) * BOX_ALIGN);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

/** The full-buffer region a stored canvas covers; null for an empty layer's placeholder. */
export function regionOf(c: HTMLCanvasElement): Region | null {
  const g = geometryOf(c);
  return g.empty ? null : { x0: g.x0, y0: g.y0, x1: g.x0 + c.width, y1: g.y0 + c.height };
}

/** A new canvas covering `r` (or an empty box when null), placed at r. */
export function allocBox(r: Region | null, fw: number, fh: number): HTMLCanvasElement {
  if (!r) return emptyBox(fw, fh);
  return place(createCanvas(r.x1 - r.x0, r.y1 - r.y0), { x0: r.x0, y0: r.y0, fw, fh });
}

/** `c` re-placed on the box `r` (a copy with the same pixels at their places). `c` itself when it already sits there. */
export function regrid(c: HTMLCanvasElement, r: Region): HTMLCanvasElement {
  const g = geometryOf(c);
  if (g.x0 === r.x0 && g.y0 === r.y0 && c.width === r.x1 - r.x0 && c.height === r.y1 - r.y0) return c;
  const out = allocBox(r, g.fw, g.fh);
  if (c.width && c.height) ctx2d(out).drawImage(c, g.x0 - r.x0, g.y0 - r.y0);
  return out;
}

/** The canvas grown (copy) so that it also covers `need`; the same canvas when it already does. */
export function growTo(c: HTMLCanvasElement, need: Region): HTMLCanvasElement {
  const have = regionOf(c);
  if (have && need.x0 >= have.x0 && need.y0 >= have.y0 && need.x1 <= have.x1 && need.y1 <= have.y1) return c;
  const g = geometryOf(c);
  const r = unionRegion([have, need], g.fw, g.fh) ?? need;
  return regrid(c, r);
}

/** The full buffer as one canvas: the stored canvas itself when it is already full, otherwise a blank page with it drawn in. */
export function assembleFull(c: HTMLCanvasElement): HTMLCanvasElement {
  const g = geometryOf(c);
  if (g.x0 === 0 && g.y0 === 0 && c.width === g.fw && c.height === g.fh) return c;
  const out = createCanvas(g.fw, g.fh);
  if (c.width && c.height) ctx2d(out).drawImage(c, g.x0, g.y0);
  return out;
}

/** A full buffer reduced to its box: the pixels with any alpha, aligned to the grid. Empty buffers become an empty box. */
export function cropToContent(full: HTMLCanvasElement): HTMLCanvasElement {
  const w = full.width, h = full.height;
  // A canvas that cannot be read back is kept whole: the same pixels, only more memory.
  let data: Uint8ClampedArray | undefined;
  try { data = full.getContext('2d')?.getImageData(0, 0, w, h).data; } catch { data = undefined; }
  if (!data) return place(full, { x0: 0, y0: 0, fw: w, fh: h });
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (px[row + x] >>> 24 === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  if (x1 < 0) return emptyBox(w, h);
  const r = unionRegion([{ x0, y0, x1: x1 + 1, y1: y1 + 1 }], w, h)!;
  let out: HTMLCanvasElement;
  try { out = createCanvas(r.x1 - r.x0, r.y1 - r.y0); } catch { return place(full, { x0: 0, y0: 0, fw: w, fh: h }); }
  ctx2d(out).drawImage(full, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, 0, 0, r.x1 - r.x0, r.y1 - r.y0);
  return place(out, { x0: r.x0, y0: r.y0, fw: w, fh: h });
}

/** Two stored canvases with the same placement and size: their history tiles line up. */
export function sameBox(a: HTMLCanvasElement, b: HTMLCanvasElement): boolean {
  const ga = geometryOf(a), gb = geometryOf(b);
  return a.width === b.width && a.height === b.height && ga.x0 === gb.x0 && ga.y0 === gb.y0 && ga.fw === gb.fw && ga.fh === gb.fh;
}
