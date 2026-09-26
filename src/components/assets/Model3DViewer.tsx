import { useEffect, useRef, useState } from 'react';
import { getAssetBlob } from '../../lib/idb';
import { fetchBlob } from '../../lib/media';
import { GLB_MIME, unpackModel, validateGlb } from '../../lib/model3d';
import { useStore } from '../../store/store';

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
      viewer.setAttribute('interaction-prompt', 'none');
      viewer.setAttribute('loading', 'eager');
      viewer.style.cssText = 'width:100%;height:100%;min-height:320px;';
      viewer.addEventListener('load', () => live && setStatus(''));
      viewer.addEventListener('error', () => live && setStatus('Could not render this model. You can still download the original.'));
      host.current.append(viewer);
    })().catch((e: unknown) => { if (live) setStatus(e instanceof Error ? e.message : '3D preview unavailable.'); });
    return () => { live = false; abort.abort(); viewer?.removeAttribute('src'); viewer?.remove(); if (url) URL.revokeObjectURL(url); };
  }, [assetId, asset?.mime, asset?.remoteUrl]);
  return <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    <div ref={host} style={{ width: '100%', height: '100%' }} />
    {status && <p role="status" style={{ position: 'absolute', top: 16, left: 16, right: 16 }}>{status}</p>}
  </div>;
}
