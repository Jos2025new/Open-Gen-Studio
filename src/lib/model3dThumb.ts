import { getAssetBlob, putAssetBlob } from './idb';
import { fetchBlob } from './media';
import { GLB_MIME, unpackModel, validateGlb } from './model3d';
import { addAssets, patchAsset, useStore } from '../store/store';
import { uid } from './id';
import { applyView, debug3d, setCamera } from './view3d';
import type { Asset } from '../engine/types';

/* The view image of a 3D asset: rendered off to the side with the view the viewer left it in, one model at a
   time. Kept as a hidden image asset (what image inputs receive) plus a small JPEG thumbnail for lists. */

/** Bump when the viewer's Front changes, so old 3D thumbnails are re-rendered. */
export const THUMB_VIEW = 2;
export const FRONT_ORBIT = '90deg 75deg auto';
const SIDE = 1024;

const keyOf = (a: Pick<Asset, 'view3d'>) => `${THUMB_VIEW}:${JSON.stringify(a.view3d ?? null)}`;
export const thumbStale = (a: Pick<Asset, 'kind' | 'thumbnailUrl' | 'thumbKey' | 'view3d' | 'viewImageId'>) =>
  a.kind === 'model3d' && (!a.thumbnailUrl || !a.viewImageId || a.thumbKey !== keyOf(a));

const tried = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export function ensureModelThumbnail(assetId: string): void {
  const asset = useStore.getState().assets[assetId];
  if (!asset) return;
  const k = `${assetId}|${keyOf(asset)}`;
  if (tried.has(k)) return;
  tried.add(k);
  queue = queue.then(() => render(assetId)).catch(() => undefined);
}

async function render(assetId: string): Promise<void> {
  const asset = useStore.getState().assets[assetId];
  if (!asset || !thumbStale(asset) || ![GLB_MIME, 'application/zip'].includes(asset.mime)) return;
  const started = performance.now();
  const key = keyOf(asset), v = asset.view3d;
  let blob = await getAssetBlob(assetId);
  if (!blob && asset.remoteUrl) blob = await fetchBlob(asset.remoteUrl);
  if (!blob) return;
  if (asset.mime === 'application/zip') blob = await unpackModel(blob);
  else await validateGlb(blob);
  const { ModelViewerElement } = await import('@google/model-viewer');
  ModelViewerElement.modelCacheSize = 0;
  const url = URL.createObjectURL(blob);
  const viewer = document.createElement('model-viewer') as HTMLElement & { toBlob(o?: { mimeType?: string; qualityArgument?: number }): Promise<Blob> };
  viewer.setAttribute('src', url);
  viewer.setAttribute('loading', 'eager');
  viewer.setAttribute('interaction-prompt', 'none');
  viewer.setAttribute('camera-orbit', v?.orbit ?? FRONT_ORBIT);
  // In the viewport (it only renders when visible) but invisible and inert.
  viewer.style.cssText = `position:fixed;left:0;top:0;width:${SIDE}px;height:${SIDE}px;opacity:0;pointer-events:none;z-index:-1;background:#1a1a1d;`;
  document.body.append(viewer);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('3D thumbnail timed out')), 20000);
      viewer.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      viewer.addEventListener('error', () => { clearTimeout(timer); reject(new Error('3D thumbnail failed')); }, { once: true });
    });
    if (v) {
      setCamera(viewer as never, v);
      applyView(viewer as never, { ...v, grid: false });
    }
    await new Promise((r) => setTimeout(r, 1200));
    const shot = await viewer.toBlob({ mimeType: 'image/jpeg', qualityArgument: 0.9 });
    const thumb = await smallDataUrl(shot);
    const now = useStore.getState().assets[assetId];
    if (!now || keyOf(now) !== key) return; // the view changed meanwhile; the next render takes it
    const id = uid('ast');
    await putAssetBlob(id, shot);
    addAssets([{ id, kind: 'image', mime: 'image/jpeg', width: SIDE, height: SIDE, sessionId: now.sessionId, origin: 'view3d', stored: true, favorite: false, createdAt: Date.now() }]);
    patchAsset(assetId, { thumbnailUrl: thumb, thumbKey: key, viewImageId: id });
    // The old view image stays: a finished generation may still point at it as its input.
  } finally {
    viewer.remove();
    URL.revokeObjectURL(url);
    debug3d(`view image ${assetId}`, performance.now() - started - 1200);
  }
}

async function smallDataUrl(blob: Blob): Promise<string> {
  const img = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = c.height = 320;
  c.getContext('2d')!.drawImage(img, 0, 0, 320, 320);
  img.close();
  return c.toDataURL('image/jpeg', 0.8);
}
