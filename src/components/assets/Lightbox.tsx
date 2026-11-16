import { Model3DViewer } from './Model3DViewer';
import { useEffect, useState } from 'react';
import { ChevronsLeft, ChevronsRight, History, Info, Redo2, RotateCcw, Undo2, X } from '../ui/icons';
import { jumpToAssetRevision, normalizeAssetRevisions, redoAssetRevision, revertAssetToOriginal, undoAssetRevision } from '../../engine/assetRevisions';
import { formatDateTime } from '../../lib/format';
import { loadAssetUrl, peekAssetUrl } from '../../lib/idb';
import { setUi, useStore } from '../../store/store';
import { AssetMedia } from '../ui/AssetMedia';
import { Button, IconButton } from '../ui/primitives';
import { AssetActions, AttachButton, DownloadButton, FavoriteButton, SendToMenu } from './AssetActions';
import { GenerationInfo } from './GenerationInfo';
import { Viewer3DControls, Viewer3DDock } from './Viewer3DControls';

function VersionThumb({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState<string | null>(() => peekAssetUrl(assetId) ?? null);
  useEffect(() => {
    let alive = true;
    const hit = peekAssetUrl(assetId);
    if (hit) {
      setUrl(hit);
      return;
    }
    void loadAssetUrl(assetId).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [assetId]);
  return <span className="lb-history-thumb">{url ? <img src={url} alt="" /> : null}</span>;
}

export function Lightbox() {
  const lb = useStore((s) => s.ui.lightbox);
  const infoOpen = useStore((s) => Boolean(s.ui.lightboxInfo));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revBusy, setRevBusy] = useState(false);
  const ids = lb?.assetIds ?? [];
  const index = lb ? Math.min(lb.index, ids.length - 1) : 0;
  const assetId = ids[index];
  const asset = useStore((s) => (assetId ? s.assets[assetId] : undefined));
  const generation = useStore((s) => (asset?.generationId ? s.generations[asset.generationId] : undefined));

  useEffect(() => {
    setHistoryOpen(false);
  }, [assetId]);

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
  const { versions, index: revIndex } = normalizeAssetRevisions(asset);
  const hasHistory = versions.length > 1;
  const close = () => setUi({ lightbox: lb.back ?? null });
  const toggleInfo = () => {
    const next = !infoOpen;
    if (next) setHistoryOpen(false);
    setUi({ lightboxInfo: next });
  };
  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && infoOpen) setUi({ lightboxInfo: false });
  };
  const runRev = async (fn: () => Promise<boolean>) => {
    if (revBusy) return;
    setRevBusy(true);
    try {
      await fn();
    } finally {
      setRevBusy(false);
    }
  };

  return (
    <div className="lightbox" role="dialog" aria-label="Viewer">
      <div className="lb-stage" onClick={(e) => e.target === e.currentTarget && close()}>
        {/* The frame is as big as the picture, so « » sit right beside it. */}
        <div className={`lb-frame ${asset.kind === 'model3d' ? 'is-3d' : ''}`} onClick={(e) => e.target === e.currentTarget && close()}>
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
        <div className="lb-top-actions">
          {hasHistory ? (
            <>
              <IconButton icon={Undo2} label="Deshacer versión" size="sm" disabled={revIndex <= 0 || revBusy} onClick={() => void runRev(() => undoAssetRevision(assetId))} />
              <IconButton icon={Redo2} label="Rehacer versión" size="sm" disabled={revIndex >= versions.length - 1 || revBusy} onClick={() => void runRev(() => redoAssetRevision(assetId))} />
              <IconButton icon={History} label="Historial de versiones" size="sm" active={historyOpen} aria-pressed={historyOpen} onClick={toggleHistory} />
            </>
          ) : null}
          <DownloadButton assetId={assetId} />
          <FavoriteButton assetId={assetId} />
          <AttachButton assetId={assetId} />
          <SendToMenu assetId={assetId} />
          <IconButton icon={Info} label="Info" size="sm" active={infoOpen} aria-pressed={infoOpen} onClick={toggleInfo} />
          <IconButton icon={X} label="Close (Esc)" size="sm" onClick={close} />
        </div>
        {hasHistory && historyOpen ? (
          <aside className="lb-info-panel lb-history-panel" aria-label="Historial de versiones">
            <div className="info-sect-head">
              <span className="info-sect-title">
                <History size={13} />
                Historial
              </span>
              <span className="faint num">{versions.length}</span>
            </div>
            <div className="lb-history-list">
              {[...versions.entries()].reverse().map(([idx, v]) => {
                const current = idx === revIndex;
                return (
                  <button
                    key={`${v.assetId}-${idx}`}
                    type="button"
                    className={`lb-history-item ${current ? 'is-current' : ''}`}
                    aria-current={current ? 'true' : undefined}
                    disabled={revBusy}
                    onClick={() => void runRev(() => jumpToAssetRevision(assetId, idx))}
                  >
                    <VersionThumb assetId={v.assetId} />
                    <span className="lb-history-meta">
                      <span className="lb-history-label">{v.label ?? (idx === 0 ? 'Original' : 'Guardado')}</span>
                      <span className="lb-history-time">{formatDateTime(v.createdAt)}</span>
                    </span>
                    {current ? <span className="badge">Actual</span> : null}
                  </button>
                );
              })}
            </div>
            <div className="lb-history-foot">
              <Button size="sm" variant="secondary" icon={RotateCcw} disabled={revIndex === 0 || revBusy} onClick={() => void runRev(() => revertAssetToOriginal(assetId))}>
                Volver al original
              </Button>
            </div>
          </aside>
        ) : infoOpen ? (
          <aside className="lb-info-panel" aria-label="Details">
            {asset.kind === 'model3d' ? <Viewer3DControls /> : null}
            <GenerationInfo key={assetId} generation={generation} asset={asset} defaultDetailsOpen />
          </aside>
        ) : null}
        {/* Operations under the picture, as a floating bar. */}
        <div className="lb-dock">
          {asset.kind === 'model3d' ? <Viewer3DDock /> : null}
          <AssetActions assetId={assetId} parentId={generation?.id} />
        </div>
      </div>
    </div>
  );
}
