import { createCanvas, ctx2d } from '../../lib/media';
import type { DesignDoc } from '../types';
import { layerBox } from './render';

const SAMPLE = 64;
const TOLERANCE = 12;
const BLANK_SHARE = 0.995;

/** Does the design have anything visible to export (a visible layer with content)? */
export function hasVisibleContent(doc: DesignDoc): boolean {
  return doc.layers.some((l) => l.visible && l.type !== 'fx' && !!layerBox(l));
}

export function parseColor(color: string | null | undefined): [number, number, number] | null {
  const m = /^#([\da-f]{3}|[\da-f]{6})(?:[\da-f]{2})?$/i.exec(color?.trim() ?? '');
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * True when (nearly) every pixel of the rendered preview is the page colour, so the file would look empty.
 * `data` is RGBA. A see-through pixel shows the page, so it counts as page colour; with no page colour (transparent
 * output) only see-through pixels do.
 */
export function isNearUniform(data: ArrayLike<number>, page: [number, number, number] | null): boolean {
  let same = 0;
  const total = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= TOLERANCE || (page && Math.max(Math.abs(data[i] - page[0]), Math.abs(data[i + 1] - page[1]), Math.abs(data[i + 2] - page[2])) <= TOLERANCE)) same++;
  }
  return total > 0 && same / total >= BLANK_SHARE;
}

/** The preview bitmap shrunk to 64×64 RGBA, or null where the browser cannot decode it. */
export function samplePreview(frame: HTMLCanvasElement): Uint8ClampedArray | null {
  try {
    const ctx = ctx2d(createCanvas(SAMPLE, SAMPLE));
    ctx.drawImage(frame, 0, 0, SAMPLE, SAMPLE);
    return ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }
}

export function blankNotice(page: string | null): string {
  const rgb = parseColor(page);
  const white = rgb && Math.min(...rgb) > 235;
  return `Your design is ${white ? 'white on a white page' : 'the same color as the page'} and will not be visible. Change the background or the paper color.`;
}
