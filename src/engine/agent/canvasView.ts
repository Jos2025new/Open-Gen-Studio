import { blobToDataUrl, canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import { activeDoc } from '../design/actions';
import { drawDoc, drawLayer } from '../design/render';
import type { LlmContentPart } from '../types';

/* What the agent sees of the Designer: the page (or one layer) reduced like an attachment, with the scale
   back to document px so its strokes land where it means. 480 px: enough to place marks, fewer image tokens than attachments. A mid-grey backdrop keeps light and dark marks visible. */

export const CANVAS_VIEW_SIDE = 480;

export async function canvasParts(sessionId: string, layerId?: string): Promise<LlmContentPart[] | string> {
  const doc = activeDoc(sessionId);
  if (!doc) return 'There is no design document yet.';
  const layer = layerId ? doc.layers.find((l) => l.id === layerId) : undefined;
  if (layerId && !layer) return `No layer "${layerId}" in this document.`;
  if (!doc.layers.length) return 'The document is empty.';
  const k = Math.min(1, CANVAS_VIEW_SIDE / Math.max(doc.width, doc.height));
  const c = createCanvas(Math.max(1, Math.round(doc.width * k)), Math.max(1, Math.round(doc.height * k)));
  const ctx = ctx2d(c);
  ctx.fillStyle = doc.background ?? '#808080';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.scale(k, k);
  if (layer) drawLayer(ctx, layer);
  else drawDoc(ctx, doc);
  const url = await blobToDataUrl(await canvasToBlob(c, 'image/jpeg', 0.85));
  const what = layer ? `layer ${layer.id} "${layer.name}"` : `designer page "${doc.name}"`;
  return [
    { type: 'text', text: `${what}, document ${doc.width}×${doc.height}px, shown at ${Math.round(k * 1000) / 1000}× on a grey backdrop; use document px (image px ÷ ${Math.round(k * 1000) / 1000}) in layer steps:` },
    { type: 'image_url', image_url: { url } },
  ];
}
