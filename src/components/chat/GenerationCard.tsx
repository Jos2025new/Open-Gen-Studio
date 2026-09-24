import { useState } from 'react';
import { CircleAlert, CircleStop, Copy, Expand, Info, Pencil, RefreshCw, Trash, Film, Image as ImageIcon } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { copyText, deleteGeneration, editInComposer, regenerate, regenerateEstimate } from '../../engine/actions';
import { cancelGeneration } from '../../engine/jobs';
import { aspectLabel, ratioOf } from '../../engine/params';
import { OPS } from '../../engine/ops';
import { formatDuration } from '../../lib/format';
import type { Generation } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { useNow } from '../ui/hooks';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, CostTag, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { AssetActions } from '../assets/AssetActions';
import { GenerationInfo, generationTitle } from '../assets/GenerationInfo';

function metaLine(g: Generation): string {
  const s = g.settings;
  return [
    g.modelName,
    s.aspect && s.aspect !== 'auto' ? aspectLabel(s.aspect) : null,
    s.resolution ?? null,
    g.kind === 'video' && s.duration ? `${s.duration}s` : null,
    g.kind === 'image' && s.count > 1 ? `×${s.count}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Placeholder({ g, index }: { g: Generation; index: number }) {
  const ratio = ratioOf(g.settings.aspect) ?? (g.kind === 'video' ? 16 / 9 : 1);
  const now = useNow(1000, g.status === 'running' || g.status === 'queued');
  const elapsed = g.startedAt ? formatDuration(now - g.startedAt) : '';
  return (
    <div className="tile tile-pending" style={{ aspectRatio: `${ratio}` }}>
      <div className="shimmer" />
      {index === 0 ? (
        <div className="tile-status">
          <span>{g.status === 'queued' ? 'Queued' : g.statusText ?? 'Working'}</span>
          {elapsed ? <span className="num faint">{elapsed}</span> : null}
          {g.progress != null ? (
            <span className="progress">
              <span style={{ width: `${Math.round(g.progress * 100)}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function GenerationCard({ generationId, compact = false }: { generationId: string; compact?: boolean }) {
  const g = useStore((s) => s.generations[generationId]);
  const source = useStore((s) => (g?.op ? s.assets[g.op.sourceAssetId] : undefined));
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const regen = usePopover();
  const del = usePopover();
  const info = usePopover();

  if (!g) {
    return <div className="gen-card is-deleted faint">This generation was deleted.</div>;
  }

  const busy = g.status === 'running' || g.status === 'queued';
  const outputs = g.assetIds;
  const pendingSlots = busy ? Math.max(0, (g.op ? 1 : g.settings.count) - outputs.length) : 0;
  const sel = outputs[Math.min(selected, outputs.length - 1)];
  const title = generationTitle(g);
  const openLightbox = (i: number) => setUi({ lightbox: { assetIds: outputs, index: i } });
  const regenEstimate = regenerateEstimate(g.id) ?? g.estimate;
  const cols = compact ? Math.min(2, Math.max(1, outputs.length + pendingSlots)) : Math.min(4, Math.max(1, outputs.length + pendingSlots));

  return (
    <article className={`gen-card status-${g.status} ${compact ? 'is-compact' : ''}`}>
      <header className="gen-head">
        <span className={`kind-icon k-${g.kind}`}>{g.kind === 'video' ? <Film size={13} /> : <ImageIcon size={13} />}</span>
        <div className="gen-title">
          {g.op && source ? (
            <button type="button" className="gen-source" onClick={() => setUi({ lightbox: { assetIds: [source.id], index: 0 } })} data-tip="Source">
              <AssetMedia assetId={source.id} hoverPlay={false} draggable={false} />
            </button>
          ) : null}
          <p className={`gen-prompt ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpanded((v) => !v)} title={expanded ? undefined : title}>
            {title || <span className="faint">No prompt</span>}
          </p>
        </div>
      </header>
      <div className="gen-meta faint">
        <span className="truncate">{metaLine(g)}</span>
        <CostTag estimate={g.actualUsd != null ? { usd: g.actualUsd, approximate: false } : g.estimate} />
      </div>

      {g.status === 'error' || (g.status === 'canceled' && !outputs.length) ? (
        <div className={`gen-error ${g.status === 'canceled' ? 'is-canceled' : ''}`}>
          <CircleAlert size={15} />
          <span>{g.status === 'canceled' ? 'Canceled' : g.error}</span>
        </div>
      ) : (
        <div className="tiles" style={{ ['--cols' as string]: cols }}>
          {outputs.map((id, i) => (
            <div
              key={id}
              className={`tile ${outputs.length > 1 && i === selected ? 'is-selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => (outputs.length > 1 ? setSelected(i) : openLightbox(i))}
              onDoubleClick={() => openLightbox(i)}
              onKeyDown={(e) => e.key === 'Enter' && openLightbox(i)}
            >
              <AssetMedia assetId={id} />
              <button
                type="button"
                className="tile-expand"
                aria-label="Open"
                data-tip="Open"
                onClick={(e) => {
                  e.stopPropagation();
                  openLightbox(i);
                }}
              >
                <Expand size={13} />
              </button>
            </div>
          ))}
          {Array.from({ length: pendingSlots }, (_, i) => (
            <Placeholder key={`p${i}`} g={g} index={i} />
          ))}
        </div>
      )}

      <footer className="gen-actions">
        <div className="gen-actions-main">
          <IconButton icon={Copy} label="Copy prompt" size="sm" disabled={!g.prompt} onClick={() => void copyText(g.prompt)} />
          <IconButton icon={Pencil} label="Edit in composer" size="sm" disabled={Boolean(g.op)} onClick={() => void editInComposer(g.id)} />
          {busy ? (
            <IconButton icon={CircleStop} label="Cancel" size="sm" onClick={() => cancelGeneration(g.id)} />
          ) : (
            <IconButton ref={regen.ref} icon={RefreshCw} label="Regenerate" size="sm" active={regen.open} onClick={regen.toggle} />
          )}
          <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" active={del.open} onClick={del.toggle} />
          <IconButton ref={info.ref} icon={Info} label="Details" size="sm" active={info.open} onClick={info.toggle} />
        </div>
        {sel && g.status === 'done' ? (
          <div className="gen-actions-ops">
            {outputs.length > 1 ? <span className="sel-label num faint">#{selected + 1}</span> : null}
            <AssetActions assetId={sel} parentId={g.id} compact={compact} />
          </div>
        ) : null}
      </footer>

      <Popover open={regen.open} anchor={regen.ref} onClose={regen.close} width={300} label="Regenerate">
        <SpendConfirm
          title={g.op ? `Run ${OPS[g.op.id].label} again` : 'Regenerate with a new seed'}
          lines={[metaLine(g)]}
          estimate={regenEstimate}
          confirmLabel="Regenerate"
          onConfirm={() => {
            regen.close();
            void regenerate(g.id);
          }}
          onCancel={regen.close}
        />
      </Popover>
      <Popover open={del.open} anchor={del.ref} onClose={del.close} width={280} label="Delete generation">
        <div className="confirm">
          <p>
            Delete this generation{outputs.length ? ` and its ${outputs.length} file${outputs.length === 1 ? '' : 's'}` : ''}? {busy ? 'It will be canceled.' : ''}
          </p>
          <div className="spend-actions">
            <Button variant="ghost" onClick={del.close}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                del.close();
                if (busy) cancelGeneration(g.id);
                deleteGeneration(g.id);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </Popover>
      <Popover open={info.open} anchor={info.ref} onClose={info.close} width={340} label="Details" className="pop-scroll">
        <PopoverHeader title="Details" sub={g.kind === 'video' ? 'Video' : 'Image'} />
        <GenerationInfo generation={g} asset={sel ? useStore.getState().assets[sel] : undefined} />
      </Popover>
    </article>
  );
}
