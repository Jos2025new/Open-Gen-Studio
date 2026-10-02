import { useState } from 'react';
import { CircleAlert, CircleStop, Copy, CopyPlus, Expand, FileText, Info, Music, RefreshCw, Trash, Film, Image as ImageIcon } from 'lucide-react';
import { setComposer, setUi, toast, useStore } from '../../store/store';
import { formatUsd } from '../../lib/format';
import { applyLyrics, copyText, deleteGeneration, editInComposer, regenerate, regenerateEstimate } from '../../engine/actions';
import { cancelGeneration } from '../../engine/jobs';
import { aspectLabel, durationLabel, ratioOf } from '../../engine/params';
import { OPS } from '../../engine/ops';
import { canvasIndex } from '../../engine/canvas';
import { formatDuration } from '../../lib/format';
import type { Generation } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { useNow } from '../ui/hooks';
import { Popover, PopoverHeader, usePopover } from '../ui/Popover';
import { Button, CostTag, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import { AssetActions, AttachButton, DownloadButton, FavoriteButton, SendToMenu } from '../assets/AssetActions';
import { GenerationInfo, generationInputs, generationTitle, openInputs } from '../assets/GenerationInfo';
import { useShallow } from 'zustand/react/shallow';
import { GenerationRecovery } from './RecoveryActions';

function metaLine(g: Generation): string {
  const s = g.settings;
  return [
    g.modelName,
    s.aspect && s.aspect !== 'auto' ? aspectLabel(s.aspect) : null,
    s.resolution ?? null,
    g.kind === 'video' && s.duration ? durationLabel(s.duration) : null,
    g.kind === 'image' && s.count > 1 ? `×${s.count}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Results of this chat's generations, oldest first (not those of the node canvas or the designer). */
function chatResults(sessionId: string): string[] {
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  const canvas = session ? canvasIndex(session, st.generations) : undefined;
  return Object.values(st.generations)
    .filter((x) => x.sessionId === sessionId && x.assetIds.length && (!canvas || (canvas.generation(x) ?? 'chat') === 'chat'))
    .sort((a, b) => a.createdAt - b.createdAt)
    .flatMap((x) => x.assetIds.filter((id) => st.assets[id]));
}

function tileRatio(id: string): React.CSSProperties | undefined {
  const a = useStore.getState().assets[id];
  // Sound and 3D have no frame: a square tile.
  if (a?.kind === 'audio' || a?.kind === 'model3d') return { ['--ratio' as string]: 1 } as React.CSSProperties;
  return a?.width && a.height ? ({ ['--ratio' as string]: a.width / a.height } as React.CSSProperties) : undefined;
}

function Placeholder({ g, index }: { g: Generation; index: number }) {
  // Sound and text have no frame: a flat strip while they run.
  // With "Auto" (operations, image-to-video) the result keeps the input's shape: use it while waiting.
  const inputRatio = useStore((s) => {
    const a = s.assets[g.op?.sourceAssetId ?? g.inputs.firstFrame ?? g.inputs.refs[0] ?? ''];
    return a?.width && a.height ? a.width / a.height : undefined;
  });
  const asked = g.op?.id === 'reframe' ? ratioOf(String(g.op.params.aspect)) : ratioOf(g.settings.aspect);
  const ratio = g.kind === 'text' ? 4 : g.kind === 'audio' || g.kind === 'model3d' ? 1 : asked ?? inputRatio ?? (g.kind === 'video' ? 16 / 9 : 1);
  const now = useNow(1000, g.status === 'running' || g.status === 'queued');
  const elapsed = g.startedAt ? formatDuration(now - g.startedAt) : '';
  return (
    <div className="tile tile-pending" style={{ aspectRatio: `${ratio}`, ['--ratio' as string]: ratio }}>
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
  // Inputs still in the library (deleted ones are skipped).
  const inputs = useStore(useShallow((s) => (g ? generationInputs(g).filter((id) => s.assets[id]) : [])));
  const [selected, setSelected] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const regen = usePopover();
  const del = usePopover();
  const info = usePopover();
  // Text from a lyrics model (MiniMax Lyrics), as opposed to a transcription or an id.
  const lyrics = useStore((s) => Boolean(g && s.catalog.models[g.modelRef]?.textOutput));

  if (!g) {
    return <div className="gen-card is-deleted faint">This generation was deleted.</div>;
  }

  const busy = g.status === 'running' || g.status === 'queued';
  const outputs = g.assetIds;
  const pendingSlots = busy ? Math.max(0, (g.op ? 1 : g.settings.count) - outputs.length) : 0;
  const sel = outputs[Math.min(selected, outputs.length - 1)];
  const title = generationTitle(g);
  // The viewer steps through every result of this chat (« »), starting at the one clicked.
  const openLightbox = (i: number) => {
    const all = chatResults(g.sessionId);
    const at = all.indexOf(outputs[i]);
    setUi({ lightbox: at >= 0 ? { assetIds: all, index: at } : { assetIds: outputs, index: i } });
  };
  const regenEstimate = regenerateEstimate(g.id) ?? g.estimate;
  // Pictures and clips, one or several: each at its own shape and a shared height, the card as wide as they are
  // (audio and 3D keep the full-width strip). Several results use a lower height and wrap.
  const shown = outputs.length + pendingSlots;
  const single = shown >= 1 && (g.kind === 'image' || g.kind === 'video' || g.kind === 'audio' || g.kind === 'model3d');
  const cols = compact ? Math.min(2, Math.max(1, outputs.length + pendingSlots)) : Math.min(4, Math.max(1, outputs.length + pendingSlots));

  return (
    <article className={`gen-card status-${g.status} ${compact ? 'is-compact' : ''} ${single ? 'is-fit' : ''}`}>
      <header className="gen-head">
        {inputs.length ? (
          // What was sent: the first input, with a count when there were several; click to see them all.
          <button type="button" className="gen-source" onClick={() => openInputs(inputs, 0)} data-tip={inputs.length > 1 ? `${inputs.length} inputs` : g.op ? 'Source' : 'Reference'}>
            <AssetMedia assetId={inputs[0]} hoverPlay={false} draggable={false} />
            {inputs.length > 1 ? <span className="gen-source-count num">{inputs.length}</span> : null}
          </button>
        ) : (
          <span className={`kind-icon k-${g.kind}`}>{g.kind === 'video' ? <Film size={13} /> : g.kind === 'audio' ? <Music size={13} /> : g.kind === 'text' ? <FileText size={13} /> : <ImageIcon size={13} />}</span>
        )}
        <div className="gen-title">
          <p className={`gen-prompt ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpanded((v) => !v)} title={expanded ? undefined : title}>
            {title || <span className="faint">No prompt</span>}
          </p>
          {g.prompt ? <IconButton icon={Copy} label="Copy prompt" size="sm" className="gen-copy" onClick={() => void copyText(g.prompt)} /> : null}
        </div>
      </header>
      <div className="gen-meta faint">
        <span className="truncate">{metaLine(g)}</span>
        <CostTag estimate={g.actualUsd != null ? { usd: g.actualUsd, approximate: false } : g.estimate} />
      </div>
      {billedDiffers(g) ? (
        <div className="gen-billed faint num">
          est {formatUsd(g.estimate.usd)} · charged {formatUsd(g.actualUsd)}
        </div>
      ) : null}
      {g.status === 'done' && g.delivery?.length ? (
        <div className="gen-delivery" data-tip="What came back differs from what was asked">
          <CircleAlert size={12} />
          <span>{g.delivery.join(' · ')}</span>
        </div>
      ) : null}

      {g.status === 'error' || (g.status === 'canceled' && !outputs.length) ? (
        <div className={`gen-error ${g.status === 'canceled' ? 'is-canceled' : ''}`}>
          <CircleAlert size={15} />
          <span>{g.status === 'canceled' ? 'Canceled' : g.error}</span>
          <GenerationRecovery g={g} />
        </div>
      ) : g.kind === 'text' && g.status === 'done' ? (
        // Transcription or lyrics: the text, ready to copy, to use as a prompt or as the lyrics of a song.
        <div className="gen-text">
          <p>{g.text || <span className="faint">{lyrics ? 'No lyrics came back.' : 'No speech was found.'}</span>}</p>
          <div className="gen-text-actions">
            <Button size="sm" variant="ghost" icon={Copy} disabled={!g.text} onClick={() => void copyText(g.text ?? '')}>
              Copy
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!g.text}
              onClick={() => {
                setComposer({ text: g.text ?? '' });
                setUi((u) => ({ focusComposer: u.focusComposer + 1 }));
                toast(`${lyrics ? 'Lyrics' : 'Transcription'} placed in the composer.`, 'info');
              }}
            >
              Use as prompt
            </Button>
            {lyrics || g.op?.id === 'transcribe' ? (
              <Button size="sm" variant={lyrics ? 'primary' : 'secondary'} icon={Music} disabled={!g.text} data-tip="Put this text in the lyrics of a music model" onClick={() => void applyLyrics(g.text ?? '')}>
                Use as lyrics
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className={`tiles ${single ? 'is-single' : ''} ${single && shown > 1 ? 'is-multi' : ''}`} style={{ ['--cols' as string]: cols }}>
          {outputs.map((id, i) => (
            <div
              key={id}
              className={`tile ${outputs.length > 1 && i === selected ? 'is-selected' : ''}`}
              // Its own shape, so results are sized from the file's dimensions rather than the loaded picture.
              style={tileRatio(id)}
              role="button"
              tabIndex={0}
              onClick={(e) => ((e.target as HTMLElement).tagName === 'AUDIO' ? undefined : outputs.length > 1 ? setSelected(i) : openLightbox(i))}
              onDoubleClick={() => openLightbox(i)}
              onKeyDown={(e) => e.key === 'Enter' && openLightbox(i)}
            >
              <AssetMedia assetId={id} controls={g.kind === 'audio'} autoPlay={false} />
              {outputs.length > 1 ? <span className="tile-num">{i + 1}</span> : null}
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
              {id === sel && g.status === 'done' ? (
                // Operations on this result, over the picture; clicks and keys inside (its menu and forms too) stay out of the tile.
                <div className="tile-bar" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <AssetActions assetId={sel} parentId={g.id} menuOnly />
                </div>
              ) : null}
            </div>
          ))}
          {Array.from({ length: pendingSlots }, (_, i) => (
            <Placeholder key={`p${i}`} g={g} index={i} />
          ))}
        </div>
      )}


      <footer className="gen-foot">
        {!g.op ? <IconButton icon={CopyPlus} label="Reuse: prompt, inputs, model and settings in the composer" size="sm" onClick={() => void editInComposer(g.id)} /> : null}
        {!busy ? <IconButton ref={regen.ref} icon={RefreshCw} label="Regenerate" size="sm" active={regen.open} onClick={regen.toggle} /> : null}
        <IconButton ref={info.ref} icon={Info} label="Details" size="sm" active={info.open} onClick={info.toggle} />
        <span className="spacer" />
        {sel && g.status === 'done' ? (
          <>
            <AttachButton assetId={sel} />
            <SendToMenu assetId={sel} />
            <FavoriteButton assetId={sel} />
            <DownloadButton assetId={sel} />
          </>
        ) : null}
        {/* Stop while it runs; Delete once it is over. Both stand apart, at the far end. */}
        {busy ? (
          <IconButton icon={CircleStop} label="Stop" size="sm" tone="danger" className="gen-delete" onClick={() => cancelGeneration(g.id)} />
        ) : (
          <IconButton ref={del.ref} icon={Trash} label="Delete" size="sm" tone="danger" active={del.open} className="gen-delete" onClick={del.toggle} />
        )}
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

/** The provider charged something other than the estimate shown before running (NanoGPT, OpenRouter): show both. */
function billedDiffers(g: { estimate: { usd: number | null }; actualUsd?: number }): boolean {
  return g.actualUsd != null && g.estimate.usd != null && Math.abs(g.actualUsd - g.estimate.usd) > Math.max(0.0005, g.estimate.usd * 0.01);
}
