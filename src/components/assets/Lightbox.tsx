import { Model3DViewer } from './Model3DViewer';
import { useEffect } from 'react';
import { ChevronsLeft, ChevronsRight, Download, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { downloadAsset } from '../../engine/actions';
import { AssetMedia } from '../ui/AssetMedia';
import { Button, IconButton } from '../ui/primitives';
import { AssetActions, FavoriteButton, SendToMenu } from './AssetActions';
import { GenerationInfo } from './GenerationInfo';
import { Viewer3DControls, Viewer3DDock } from './Viewer3DControls';

export function Lightbox() {
  const lb = useStore((s) => s.ui.lightbox);
  const ids = lb?.assetIds ?? [];
  const index = lb ? Math.min(lb.index, ids.length - 1) : 0;
  const assetId = ids[index];
  const asset = useStore((s) => (assetId ? s.assets[assetId] : undefined));
  const generation = useStore((s) => (asset?.generationId ? s.generations[asset.generationId] : undefined));

  useEffect(() => {
    if (!lb) return;
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('.popover')) return;
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Escape') setUi({ lightbox: lb.back ?? null });
      if (e.key === 'ArrowRight' && index < ids.length - 1) setUi({ lightbox: { ...lb, index: index + 1 } });
      if (e.key === 'ArrowLeft' && index > 0) setUi({ lightbox: { ...lb, index: index - 1 } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, index, ids]);

  if (!lb || !assetId || !asset) return null;
  const close = () => setUi({ lightbox: lb.back ?? null });
  return (
    <div className="lightbox" role="dialog" aria-label="Viewer">
      <div className="lb-stage" onClick={(e) => e.target === e.currentTarget && close()}>
        {/* The frame is as big as the picture, so « » sit right beside it. */}
        <div className={`lb-frame ${asset.kind === 'model3d' ? 'is-3d' : ''}`}>
          {asset.kind === 'model3d' ? <Model3DViewer key={assetId} assetId={assetId} /> : <AssetMedia key={assetId} assetId={assetId} fit="contain" controls={asset.kind !== 'image'} className="lb-media" />}
          {index > 0 ? (
            <button type="button" className="lb-nav lb-prev" aria-label="Previous" onClick={() => setUi({ lightbox: { ...lb, index: index - 1 } })}>
              <ChevronsLeft size={20} />
            </button>
          ) : null}
          {index < ids.length - 1 ? (
            <button type="button" className="lb-nav lb-next" aria-label="Next" onClick={() => setUi({ lightbox: { ...lb, index: index + 1 } })}>
              <ChevronsRight size={20} />
            </button>
          ) : null}
        </div>
        {ids.length > 1 ? (
          <span className="lb-count num">
            {index + 1} / {ids.length}
          </span>
        ) : null}
        {/* Operations under the picture, as a floating bar. */}
        <div className="lb-dock">
          {asset.kind === 'model3d' ? <Viewer3DDock /> : null}
          <AssetActions assetId={assetId} parentId={generation?.id} />
        </div>
      </div>
      <aside className="lb-side">
        <div className="lb-head">
          <Button size="sm" icon={Download} onClick={() => void downloadAsset(assetId)}>
            Download
          </Button>
          <FavoriteButton assetId={assetId} />
          <SendToMenu assetId={assetId} />
          <span className="spacer" />
          <IconButton icon={X} label="Close (Esc)" size="sm" onClick={close} />
        </div>
        <div className="lb-body">
          {asset.kind === 'model3d' ? <Viewer3DControls /> : null}
          <GenerationInfo key={assetId} generation={generation} asset={asset} />
        </div>
      </aside>
    </div>
  );
}
