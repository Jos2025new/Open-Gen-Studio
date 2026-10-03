import { AgentAttachToggle } from './AgentAttachToggle';
import { useState } from 'react';
import { ChevronDown, Copy, Info, Sparkles, Wrench } from 'lucide-react';
import { OPS } from '../../engine/ops';
import { aspectLabel, durationLabel } from '../../engine/params';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { copyText } from '../../engine/actions';
import { formatDateTime, formatDuration, formatUsd } from '../../lib/format';
import { setUi, useStore } from '../../store/store';
import type { Asset, Generation } from '../../engine/types';
import { AssetMedia } from '../ui/AssetMedia';
import { Button, CostTag } from '../ui/primitives';

// Longer prompts start folded to a few lines ("See all").
const LONG_PROMPT = 280;

export function generationTitle(g: Generation): string {
  // A storyboard without a main prompt is named by its shots.
  if (!g.op) return g.prompt || (g.settings.shots?.length ? g.settings.shots.map((sh, i) => `${i + 1}. ${sh.prompt}`).join('  ') : '');
  const def = OPS[g.op.id];
  const detail = def.fields
    .filter((f) => f.type === 'choice')
    .map((f) => f.options?.find((o) => o.value === String(g.op!.params[f.key]))?.label)
    .filter(Boolean)
    .join(' · ');
  return detail ? `${def.label} · ${detail}` : def.label;
}

/** What went out to the provider, as one block of text to paste into an issue (T5): no key, no media. */
export function debugText(g: Generation): string {
  return [
    `generation: ${g.id}`,
    `model: ${g.modelName} (${g.modelRef})`,
    `status: ${g.status}${g.error ? ` · ${g.error}` : ''}`,
    g.sent ? JSON.stringify(g.sent, null, 2) : 'no request record',
  ].join('\n');
}

/** What went into a generation: the operation's source, the start/end frames and the references. */
export function generationInputs(g: Generation): string[] {
  return [...new Set([g.op?.sourceAssetId, g.inputs.firstFrame, g.inputs.lastFrame, ...g.inputs.refs].filter((id): id is string => Boolean(id)))];
}

/** Open these inputs in the viewer; from inside the viewer, closing comes back to where it was. */
export function openInputs(ids: string[], index: number): void {
  const lb = useStore.getState().ui.lightbox;
  setUi({ lightbox: { assetIds: ids, index, ...(lb ? { back: { assetIds: lb.assetIds, index: lb.index } } : {}) } });
}

export function GenerationInfo({ generation: g, asset }: { generation?: Generation; asset?: Asset }) {
  const session = useStore((s) => (g ? s.sessions[g.sessionId]?.title : asset ? s.sessions[asset.sessionId]?.title : undefined));
  const [open, setOpen] = useState(false);
  const rows: Array<[string, React.ReactNode]> = [];
  // What went in: the operation's source, the start frame and the references, shown above the prompt.
  const inputs = g ? generationInputs(g) : [];
  const text = g ? generationTitle(g) : '';
  if (g) {
    rows.push(['Model', `${g.modelName}${g.provider !== 'local' ? ` · ${PROVIDER_LABELS[g.provider]}` : ''}`]);
    const s = g.settings;
    const params = [
      s.aspect ? aspectLabel(s.aspect) : null,
      s.resolution ?? null,
      g.kind === 'video' && s.duration ? durationLabel(s.duration) : null,
      g.kind === 'image' && s.count > 1 ? `${s.count} images` : null,
      s.audio != null ? (s.audio ? 'audio on' : 'audio off') : null,
      ...Object.entries(s.advanced).map(([k, v]) => `${k}: ${String(v)}`),
    ].filter(Boolean);
    if (params.length) rows.push(['Settings', params.join(' · ')]);
    if (s.seed != null) rows.push(['Seed', <span className="num">{s.seed}</span>]);
    rows.push(['Estimate', <CostTag estimate={g.estimate} />]);
    if (g.actualUsd != null) rows.push(['Billed', <span className="num">{formatUsd(g.actualUsd)}</span>]);
    rows.push(['Created', formatDateTime(g.createdAt)]);
    if (g.startedAt && g.finishedAt) rows.push(['Took', formatDuration(g.finishedAt - g.startedAt)]);
    if (g.sent) rows.push(['Request', `${g.sent.url.replace(/^https?:\/\//, '')} · try ${g.sent.attempt}${g.sent.jobId ? ` · job ${g.sent.jobId}` : ''}`]);
    rows.push(['Origin', g.origin]);
  }
  if (asset) {
    const dims = asset.kind === 'audio' ? [] : [`${asset.width}×${asset.height}`];
    rows.push(['File', [...dims, asset.duration ? formatDuration(asset.duration * 1000) : '', asset.mime].filter(Boolean).join(' · ')]);
    if (!asset.stored) rows.push(['Storage', 'Provider URL only (may expire)']);
  }
  if (session) rows.push(['Session', session]);
  return (
    <div className="info">
      {g && (text || inputs.length) ? (
        <section className="info-sect">
          <div className="info-sect-head">
            <span className="info-sect-title">
              <Sparkles size={13} />
              {g.op ? 'Operation' : 'Prompt'}
            </span>
            {!g.op && g.prompt ? (
              <Button size="sm" variant="secondary" icon={Copy} onClick={() => void copyText(g.prompt)}>
                Copy
              </Button>
            ) : null}
          </div>
          <div className="info-box">
            {inputs.length ? (
              <div className="info-inputs">
                {inputs.map((id, i) => (
                  <span key={id} className="attach-host is-small">
                    <button type="button" className="info-thumb" onClick={() => openInputs(inputs, i)} data-tip={id === g.op?.sourceAssetId ? 'Source' : id === g.inputs.firstFrame ? 'Start frame' : id === g.inputs.lastFrame ? 'End frame' : 'Reference'}>
                      <AssetMedia assetId={id} hoverPlay={false} draggable={false} />
                    </button>
                    <AgentAttachToggle assetId={id} />
                  </span>
                ))}
              </div>
            ) : null}
            {text ? <p className={`info-text ${text.length > LONG_PROMPT && !open ? 'is-folded' : ''}`}>{text}</p> : null}
            {text.length > LONG_PROMPT ? (
              <button type="button" className="info-more" onClick={() => setOpen((v) => !v)}>
                {open ? 'Show less' : 'See all'}
                <ChevronDown size={13} className={open ? 'flip' : undefined} />
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="info-sect">
        <div className="info-sect-head">
          <span className="info-sect-title">
            <Info size={13} />
            Details
          </span>
          {g?.sent ? (
            <Button size="sm" variant="secondary" icon={Wrench} onClick={() => void copyText(debugText(g))}>
              Copy debug info
            </Button>
          ) : null}
        </div>
        <dl className="info-box info-rows">
          {rows.map(([k, v]) => (
            <div key={k} className="info-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
