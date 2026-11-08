import { canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import { fxPlan } from '../fx/plan';
import type { DesignDoc } from '../types';
import type { Box } from './doc';
import { checkExportSize } from './exportLimits';
import { DEFAULT_JPEG_QUALITY } from './exportSettings';
import { drawDoc } from './render';

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface RasterExport {
  width: number;
  height: number;
  box: Box;
  scale: number;
  offsetX?: number;
  offsetY?: number;
  mask?: HTMLCanvasElement;
  background?: string;
  quality?: number;
  maxKb?: number;
  signal?: AbortSignal;
  webFallback?: boolean;
}

export function checkRasterExport(doc: DesignDoc, { width, height, scale }: Pick<RasterExport, 'width' | 'height' | 'scale'>): void {
  const hasFx = fxPlan(doc.layers).some((step) => step.t !== 'draw');
  checkExportSize(width, height, hasFx);
  if (hasFx) checkExportSize(Math.max(1, Math.ceil(doc.width * scale)), Math.max(1, Math.ceil(doc.height * scale)), true);
}

export async function exportDoc(doc: DesignDoc, type: RasterMime = 'image/png', options?: RasterExport): Promise<Blob> {
  const width = options?.width ?? doc.width;
  const height = options?.height ?? doc.height;
  checkRasterExport(doc, { width, height, scale: options?.scale ?? 1 });
  try {
    options?.signal?.throwIfAborted();
    const canvas = createCanvas(width, height);
    const ctx = ctx2d(canvas);
    if (!doc.background && type === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    if (options) {
      const { box, scale, offsetX = 0, offsetY = 0 } = options;
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX, offsetY, box.w * scale, box.h * scale);
      ctx.clip();
      ctx.setTransform(scale, 0, 0, scale, offsetX - box.x * scale, offsetY - box.y * scale);
      drawDoc(ctx, doc, { origin: 'export', resolution: 'document', exportScale: scale });
      if (options.mask) {
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(options.mask, 0, 0);
      }
      ctx.restore();
    } else {
      drawDoc(ctx, doc, { origin: 'export', resolution: 'document' });
    }
    const background = options?.background ?? (type === 'image/jpeg' ? '#ffffff' : undefined);
    if (background) {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    if (ctx.isContextLost?.()) throw new Error('The browser lost the canvas context.');
    let quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
    for (;;) {
      options?.signal?.throwIfAborted();
      const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : quality / 100);
      options?.signal?.throwIfAborted();
      if (options && blob.type !== type) {
        if (type !== 'image/webp' || !options?.webFallback) throw new Error('This browser cannot encode the chosen format. Choose PNG or JPG.');
        type = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = background ?? '#ffffff';
        ctx.fillRect(0, 0, width, height);
        continue;
      }
      if (!options?.maxKb || blob.size <= options.maxKb * 1024) return blob;
      if (quality === 0) throw new Error(`Cannot fit in ${options.maxKb} KB. Increase the limit or choose a smaller size.`);
      quality = Math.max(0, quality - 10);
    }
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    const reason = error instanceof Error ? error.message : '';
    throw new Error(`Export failed at full resolution (${width} × ${height}). No file was created. ${reason || 'Try a smaller size or fewer FX layers.'}`);
  }
}
