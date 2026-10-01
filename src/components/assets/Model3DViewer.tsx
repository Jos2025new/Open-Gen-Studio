import { useEffect, useRef, useState } from 'react';
import { getAssetBlob } from '../../lib/idb';
import { fetchBlob } from '../../lib/media';
import { GLB_MIME, unpackModel, validateGlb } from '../../lib/model3d';
import { patchAsset, useStore } from '../../store/store';
import { ensureModelThumbnail, FRONT_ORBIT } from '../../lib/model3dThumb';
import { debug3d, readCamera, setCamera } from '../../lib/view3d';
import type { SavedView3D } from '../../engine/types';
import { applyView, panHandler, useViewer3d, VIEW3D_DEFAULT } from './viewer3d';

/** Only the open lightbox mounts this component; lists never allocate WebGL. */
export function Model3DViewer({ assetId }: { assetId: string }) {
  const asset = useStore((s) => s.assets[assetId]);
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('Loading 3D model…');
  useEffect(() => {
    let live = true, url: string | undefined, viewer: HTMLElement | undefined;
    const abort = new AbortController();
    if (!asset) return;
    void (async () => {
      if (![GLB_MIME, 'application/zip'].includes(asset.mime)) throw new Error('Preview supports GLB. Download this model to open its original format.');
      let blob = await getAssetBlob(assetId);
      if (!blob && asset.remoteUrl) blob = await fetchBlob(asset.remoteUrl, { signal: abort.signal });
      if (!live) return;
      if (!blob) throw new Error('3D file unavailable.');
      if (asset.mime === 'application/zip') blob = await unpackModel(blob);
      else await validateGlb(blob);
      const { ModelViewerElement } = await import('@google/model-viewer');
      ModelViewerElement.modelCacheSize = 0;
      if (!live || !host.current) return;
      url = URL.createObjectURL(blob);
      viewer = document.createElement('model-viewer');
      viewer.setAttribute('src', url);
      viewer.setAttribute('alt', 'Generated 3D model. Drag to orbit; scroll to zoom.');
      viewer.setAttribute('camera-controls', '');
      viewer.setAttribute('camera-orbit', FRONT_ORBIT);
      viewer.setAttribute('interaction-prompt', 'none');
      viewer.setAttribute('loading', 'eager');
      viewer.style.cssText = 'width:100%;height:100%;min-height:320px;';
      viewer.addEventListener('load', () => {
        if (!live) return;
        setStatus('');
        // The view this model was left in, if any.
        const saved = useStore.getState().assets[assetId]?.view3d;
        const view = saved ? { ...VIEW3D_DEFAULT, exposure: saved.exposure, environment: saved.environment, texture: saved.texture, roughness: saved.roughness, metalness: saved.metalness, grid: saved.grid } : VIEW3D_DEFAULT;
        if (saved) setCamera(viewer as never, saved);
        useViewer3d.setState({ el: viewer as never, view, touched: false });
        applyView(viewer as never, view);
      });
      viewer.addEventListener('error', () => live && setStatus('Could not render this model. You can still download the original.'));
      host.current.append(viewer);
    })().catch((e: unknown) => { if (live) setStatus(e instanceof Error ? e.message : '3D preview unavailable.'); });
    return () => { live = false; useViewer3d.setState({ el: null }); abort.abort(); viewer?.removeAttribute('src'); viewer?.remove(); if (url) URL.revokeObjectURL(url); };
  }, [assetId, asset?.mime, asset?.remoteUrl]);
  const view = useViewer3d((s) => s.view), el = useViewer3d((s) => s.el);
  useEffect(() => { if (el) applyView(el, view); }, [el, view]);
  useEffect(() => (el ? panHandler(el) : undefined), [el]);
  // Save the view 800 ms after the user's last change and on close; then the view image follows it.
  useEffect(() => {
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined, pending: SavedView3D | null = null;
    const flush = () => {
      clearTimeout(timer);
      if (!pending) return;
      const t = performance.now();
      patchAsset(assetId, { view3d: pending });
      pending = null;
      debug3d('save view', performance.now() - t);
    };
    const snap = () => {
      if (!useViewer3d.getState().touched) return;
      const { pan: _pan, ...look } = useViewer3d.getState().view;
      pending = { ...readCamera(el), ...look };
      clearTimeout(timer);
      timer = setTimeout(flush, 800);
    };
    const touch = () => useViewer3d.setState({ touched: true });
    el.addEventListener('pointerdown', touch);
    el.addEventListener('wheel', touch, { passive: true });
    el.addEventListener('camera-change', snap);
    const unsub = useViewer3d.subscribe((st, prev) => { if (st.view !== prev.view) snap(); });
    return () => {
      el.removeEventListener('pointerdown', touch);
      el.removeEventListener('wheel', touch);
      el.removeEventListener('camera-change', snap);
      unsub();
      flush();
      ensureModelThumbnail(assetId);
    };
  }, [el, assetId]);
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    <div ref={host} style={{ width: '100%', height: '100%' }} />
    {status && <p role="status" style={{ position: 'absolute', top: 16, left: 16, right: 16 }}>{status}</p>}
  </div>;
}
