import { getAssetBlob } from './idb';
import { fetchBlob } from './media';
import { GLB_MIME, unpackModel, validateGlb } from './model3d';
import { patchAsset, useStore } from '../store/store';

/* A front-view picture of a 3D result when the provider sent none: rendered once, off to the side,
   one model at a time, and kept in the asset as a small JPEG. Lists still never keep WebGL alive. */

/** Bump when the viewer's Front changes, so old 3D thumbnails are re-rendered. */
export const THUMB_VIEW = 1;
export const FRONT_ORBIT = '90deg 75deg auto';

export const thumbStale = (a: { kind: string; thumbnailUrl?: string; thumbView?: number }) => a.kind === 'model3d' && (!a.thumbnailUrl || a.thumbView !== THUMB_VIEW);

const tried = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export function ensureModelThumbnail(assetId: string): void {
  if (tried.has(assetId)) return;
  tried.add(assetId);
  queue = queue.then(() => render(assetId)).catch(() => undefined);
}

async function render(assetId: string): Promise<void> {
  const asset = useStore.getState().assets[assetId];
  if (!asset || !thumbStale(asset) || ![GLB_MIME, 'application/zip'].includes(asset.mime)) return;
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
  viewer.setAttribute('camera-orbit', FRONT_ORBIT);
  // In the viewport (it only renders when visible) but invisible and inert.
  viewer.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:320px;opacity:0;pointer-events:none;z-index:-1;background:#1a1a1d;';
  document.body.append(viewer);
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('3D thumbnail timed out')), 20000);
      viewer.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
      viewer.addEventListener('error', () => { clearTimeout(timer); reject(new Error('3D thumbnail failed')); }, { once: true });
    });
    await new Promise((r) => setTimeout(r, 1200));
    const shot = await viewer.toBlob({ mimeType: 'image/jpeg', qualityArgument: 0.8 });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(shot);
    });
    if (useStore.getState().assets[assetId]) patchAsset(assetId, { thumbnailUrl: dataUrl, thumbView: THUMB_VIEW });
  } finally {
    viewer.remove();
    URL.revokeObjectURL(url);
  }
}
