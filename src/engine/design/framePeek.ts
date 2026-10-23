import type { DesignDoc } from '../types';
import { ctx2d } from '../../lib/media';

/*
 * The editor's last composed page, kept so a single pixel (the eyedropper) can be read from it instead of composing the
 * whole document again. It is trusted only for the very document object it was composed for (any edit makes a new
 * one) and at 1:1 or finer, where one document pixel is a real composed pixel and not an average. render.ts sets it
 * after each retained frame and clears it whenever the frame is not the exact current page.
 */

let last: { doc: DesignDoc; page: HTMLCanvasElement; scale: number } | null = null;

export function rememberFrame(doc: DesignDoc, page: HTMLCanvasElement, scale: number): void { last = { doc, page, scale }; }
export function forgetFrame(): void { last = null; }

/** RGBA of the page at a document point, or undefined when no trusted frame exists for this document. */
export function peekPixel(doc: DesignDoc, x: number, y: number): [number, number, number, number] | undefined {
  if (!last || last.doc !== doc || last.scale < 1) return undefined;
  const px = Math.min(last.page.width - 1, Math.floor(x * last.scale)), py = Math.min(last.page.height - 1, Math.floor(y * last.scale));
  const [r, g, b, a] = ctx2d(last.page).getImageData(px, py, 1, 1).data;
  return [r, g, b, a];
}
