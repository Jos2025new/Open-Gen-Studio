import { drawDoc } from '../../src/engine/design/render';
import { composeRaster, setBuffer } from '../../src/engine/design/raster';
import type { DesignDoc } from '../../src/engine/types';
import { PARITY_SIZE, parityDocument } from './parity-docs';

/*
 * Parity oracle (Paso 2). Two paths over the same document, compared pixel by pixel:
 *  - export: drawDoc at document resolution, no editor caches (the reference: what exports produce);
 *  - editor: drawDoc on a Stage canvas at zoom 1 with the editor caches on, drawn twice so the second frame reads them.
 * Every optimized path added later is compared with the export path. Runs in the browser (Canvas2D pixels).
 */

export interface ParityResult { pass: boolean; size: number; maxChannelDiff: number; differingChannels: number; totalChannels: number; features: string[]; runs: number }

const FEATURES = ['blend modes (multiply, screen, overlay, difference)', 'opacity', 'layer FX (shadow, glow)', 'below FX (blur, curves, hue)', 'tip strokes (hardness, multiply, keep opacity)', 'eraser', 'hidden folder', 'vector shapes (rect with stroke, ellipse)'];

function blank(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = PARITY_SIZE; c.height = PARITY_SIZE; return c;
}

function composeAll(doc: DesignDoc, rasters: ReturnType<typeof parityDocument>['rasters']) {
  for (const l of rasters) {
    setBuffer(l.paintBaseId!, blank(), false);
    composeRaster(l, false);
  }
  void doc;
}

export function compareArrays(a: Uint8ClampedArray, b: Uint8ClampedArray): { maxChannelDiff: number; differingChannels: number; totalChannels: number } {
  let max = 0, diff = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    if (d !== 0) diff++;
  }
  return { maxChannelDiff: max, differingChannels: diff, totalChannels: a.length };
}

export async function runParity(): Promise<ParityResult> {
  const { doc, rasters } = parityDocument();
  composeAll(doc, rasters);
  // Export path: no Stage class, document resolution.
  const ex = document.createElement('canvas'); ex.width = doc.width; ex.height = doc.height;
  const exCtx = ex.getContext('2d')!;
  drawDoc(exCtx, doc, { resolution: 'document' });
  const reference = exCtx.getImageData(0, 0, doc.width, doc.height).data;
  // Editor path: Stage canvas, identity transform (zoom 1), caches on; two frames, the second reads the caches.
  const ed = document.createElement('canvas'); ed.width = doc.width; ed.height = doc.height; ed.className = 'stage-canvas';
  const edCtx = ed.getContext('2d')!;
  let last: Uint8ClampedArray = new Uint8ClampedArray(0);
  for (let frame = 0; frame < 2; frame++) {
    edCtx.setTransform(1, 0, 0, 1, 0, 0);
    edCtx.clearRect(0, 0, ed.width, ed.height);
    drawDoc(edCtx, doc);
    last = edCtx.getImageData(0, 0, doc.width, doc.height).data;
  }
  const cmp = compareArrays(new Uint8ClampedArray(reference), new Uint8ClampedArray(last));
  return { pass: cmp.maxChannelDiff === 0, size: doc.width, ...cmp, features: FEATURES, runs: 2 };
}
