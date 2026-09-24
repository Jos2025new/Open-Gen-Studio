import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, Star, X } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { downloadAsset, toggleFavorite } from '../../engine/actions';
import { AssetMedia } from '../ui/AssetMedia';
import { IconButton } from '../ui/primitives';
import { AssetActions } from './AssetActions';
import { GenerationInfo } from './GenerationInfo';

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
      if (e.key === 'Escape') setUi({ lightbox: null });
      if (e.key === 'ArrowRight' && index < ids.length - 1) setUi({ lightbox: { assetIds: ids, index: index + 1 } });
      if (e.key === 'ArrowLeft' && index > 0) setUi({ lightbox: { assetIds: ids, index: index - 1 } });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lb, index, ids]);

  if (!lb || !assetId || !asset) return null;
  return (
    <div className="lightbox" role="dialog" aria-label="Viewer">
      <div className="lb-stage" onClick={(e) => e.target === e.currentTarget && setUi({ lightbox: null })}>
        <AssetMedia key={assetId} assetId={assetId} fit="contain" controls={asset.kind === 'video'} className="lb-media" />
        {index > 0 ? (
          <button type="button" className="lb-nav lb-prev" aria-label="Previous" onClick={() => setUi({ lightbox: { assetIds: ids, index: index - 1 } })}>
            <ChevronLeft size={20} />
          </button>
        ) : null}
        {index < ids.length - 1 ? (
          <button type="button" className="lb-nav lb-next" aria-label="Next" onClick={() => setUi({ lightbox: { assetIds: ids, index: index + 1 } })}>
            <ChevronRight size={20} />
          </button>
        ) : null}
        <span className="lb-count num">
          {index + 1} / {ids.length}
        </span>
      </div>
      <aside className="lb-side">
        <div className="lb-head">
          <IconButton icon={Star} label={asset.favorite ? 'Remove favorite' : 'Favorite'} size="sm" active={asset.favorite} onClick={() => toggleFavorite(assetId)} />
          <IconButton icon={Download} label="Download" size="sm" onClick={() => void downloadAsset(assetId)} />
          <span className="spacer" />
          <IconButton icon={X} label="Close (Esc)" size="sm" onClick={() => setUi({ lightbox: null })} />
        </div>
        <div className="lb-body">
          <GenerationInfo generation={generation} asset={asset} />
        </div>
        <div className="lb-actions">
          <AssetActions assetId={assetId} parentId={generation?.id} />
        </div>
      </aside>
    </div>
  );
}
