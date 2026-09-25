import { Copy } from 'lucide-react';
import { OPS } from '../../engine/ops';
import { aspectLabel, durationLabel } from '../../engine/params';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { copyText } from '../../engine/actions';
import { formatDateTime, formatDuration, formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import type { Asset, Generation } from '../../engine/types';
import { CostTag, IconButton } from '../ui/primitives';

export function generationTitle(g: Generation): string {
  if (!g.op) return g.prompt;
  const def = OPS[g.op.id];
  const detail = def.fields
    .filter((f) => f.type === 'choice')
    .map((f) => f.options?.find((o) => o.value === String(g.op!.params[f.key]))?.label)
    .filter(Boolean)
    .join(' · ');
  return detail ? `${def.label} · ${detail}` : def.label;
}

export function GenerationInfo({ generation: g, asset }: { generation?: Generation; asset?: Asset }) {
  const session = useStore((s) => (g ? s.sessions[g.sessionId]?.title : asset ? s.sessions[asset.sessionId]?.title : undefined));
  const rows: Array<[string, React.ReactNode]> = [];
  if (g) {
    rows.push(['Model', `${g.modelName}${g.provider !== 'local' ? ` · ${PROVIDER_LABELS[g.provider]}` : ''}`]);
    if (g.op) rows.push(['Operation', generationTitle(g)]);
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
    if (g.inputs.refs.length) rows.push(['References', `${g.inputs.refs.length}`]);
    if (g.inputs.firstFrame) rows.push(['Start frame', 'yes']);
    rows.push(['Estimate', <CostTag estimate={g.estimate} />]);
    if (g.actualUsd != null) rows.push(['Billed', <span className="num">{formatUsd(g.actualUsd)}</span>]);
    rows.push(['Created', formatDateTime(g.createdAt)]);
    if (g.startedAt && g.finishedAt) rows.push(['Took', formatDuration(g.finishedAt - g.startedAt)]);
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
      {g && !g.op && g.prompt ? (
        <div className="info-prompt">
          <p>{g.prompt}</p>
          <IconButton icon={Copy} label="Copy prompt" size="sm" onClick={() => void copyText(g.prompt)} />
        </div>
      ) : null}
      <dl className="info-rows">
        {rows.map(([k, v]) => (
          <div key={k} className="info-row">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {g ? <div className="info-id faint num">{g.id}</div> : null}
    </div>
  );
}
