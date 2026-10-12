import { drawDoc } from '../../src/engine/design/render';
import { composeRaster, setBuffer } from '../../src/engine/design/raster';
import type { DesignDoc } from '../../src/engine/types';
import type { Engine, View } from './types';
import type { Scene } from './scene';

/* Canvas2D: OGS's own renderer, unchanged. drawDoc is the function the Designer and the exports call. */
export function canvas2dEngine(): Engine {
  let canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, sceneBases: Scene['bases'], bytes = 0;
  return {
    name: 'canvas2d',
    async init(scene, cv) {
      canvas = cv; ctx = cv.getContext('2d')!;
      // The Stage's class turns on OGS's editor FX cache, as in the Designer.
      cv.classList.add('stage-canvas');
      sceneBases = scene.bases;
      for (const l of scene.doc.layers) {
        if (l.type !== 'raster') continue;
        const base = scene.bases.get(l.id)!;
        setBuffer(l.paintBaseId!, base, false);
        composeRaster(l, false);
        bytes += base.width * base.height * 4 * 2; // base + layer buffer
      }
    },
    layerChanged(doc, layerId) {
      const l = doc.layers.find((x) => x.id === layerId);
      if (l?.type === 'raster') composeRaster(l, false);
    },
    render(doc, view: View) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(view.zoom, 0, 0, view.zoom, view.x, view.y);
      drawDoc(ctx, doc);
    },
    sync() { ctx.getImageData(0, 0, 1, 1); },
    fullPage(doc) {
      const c = document.createElement('canvas');
      c.width = doc.width; c.height = doc.height;
      const x = c.getContext('2d')!;
      drawDoc(x, doc, { resolution: 'document' });
      return x.getImageData(0, 0, c.width, c.height).data;
    },
    textureBytes: () => { void sceneBases; return bytes; },
  };
}
