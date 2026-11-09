import { canvasToBlob, createCanvas, ctx2d } from '../../lib/media';
import { fxPlan } from '../fx/plan';
import type { DesignDoc } from '../types';
import type { Box } from './doc';
import { ExportError, exportError } from './exportErrors';
import { checkExportSize } from './exportLimits';
import { DEFAULT_JPEG_QUALITY } from './exportSettings';
import { drawDoc } from './render';

export const PREVIEW_MAX_SIDE = 512;

export type RasterMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface RasterExport {
  width: number;
  height: number;
  box: Box;
  scale: number;
  offsetX?: number;
  offsetY?: number;
  mask?: HTMLCanvasElement;
  /** Where the mask lies in page units (default: the whole page). */
  maskBox?: { x: number; y: number; w: number; h: number };
  clip?: (ctx: CanvasRenderingContext2D) => void;
  preview?: boolean;
  whiteBase?: boolean;
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
  const scale = options?.scale ?? 1;
  const exportScale = options?.preview ? Math.min(scale, PREVIEW_MAX_SIDE / Math.max(doc.width, doc.height)) : scale;
  checkRasterExport(doc, { width, height, scale: exportScale });
  try {
    options?.signal?.throwIfAborted();
    const canvas = createCanvas(width, height);
    const ctx = ctx2d(canvas);
    if (!doc.background && (type === 'image/jpeg' || options?.whiteBase)) {
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
      options.clip?.(ctx);
      drawDoc(ctx, doc, { origin: 'export', resolution: 'document', exportScale });
      if (options.mask) {
        ctx.globalCompositeOperation = 'destination-in';
        const mb = options.maskBox ?? { x: 0, y: 0, w: doc.width, h: doc.height };
        ctx.drawImage(options.mask, mb.x, mb.y, mb.w, mb.h);
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
    if (ctx.isContextLost?.()) throw new ExportError('The browser lost the canvas, so try a smaller size or reopen the design.');
    let quality = options?.quality ?? DEFAULT_JPEG_QUALITY;
    for (;;) {
      options?.signal?.throwIfAborted();
      const blob = await canvasToBlob(canvas, type, type === 'image/png' ? undefined : quality / 100);
      options?.signal?.throwIfAborted();
      if (options && blob.type !== type) {
        if (type !== 'image/webp' || !options?.webFallback) throw new ExportError('This browser cannot encode the chosen format, so choose PNG or JPG.');
        type = 'image/jpeg';
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = background ?? '#ffffff';
        ctx.fillRect(0, 0, width, height);
        continue;
      }
      if (!options?.maxKb || blob.size <= options.maxKb * 1024) return blob;
      if (quality === 0) throw new ExportError(`The image cannot fit in ${options.maxKb} KB, so increase the limit or choose a smaller size.`);
      quality = Math.max(0, quality - 10);
    }
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw exportError(error, `No file was created at ${width} × ${height}, so try a smaller size or fewer effects.`);
  }
}
