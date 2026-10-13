import { canvasToBlob, createCanvas, ctx2d } from '../../../lib/media';
import { sanitizeSvg } from './sanitize';
import { pageSetup } from './transforms';

/** A whole SVG as one PNG (the node area takes images, not layers): sanitized first, then drawn by the browser. */
export async function flattenSvg(text: string, maxSide = 4096): Promise<Blob | string> {
  const clean = sanitizeSvg(text);
  if ('error' in clean) return clean.error;
  const { root } = clean, page = pageSetup(root);
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', `0 0 ${page.width} ${page.height}`);
  const k = Math.min(1, maxSide / Math.max(page.width, page.height));
  const w = Math.max(1, Math.round(page.width * k)), h = Math.max(1, Math.round(page.height * k));
  root.setAttribute('width', String(w));
  root.setAttribute('height', String(h));
  try {
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(root));
    await img.decode();
    const canvas = createCanvas(w, h);
    ctx2d(canvas).drawImage(img, 0, 0, w, h);
    return await canvasToBlob(canvas, 'image/png');
  } catch {
    return 'The browser could not draw this SVG.';
  }
}
