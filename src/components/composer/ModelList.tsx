import { useMemo, useState } from 'react';
import { Check, KeyRound, Search, Settings2 } from 'lucide-react';
import { connectedProviders } from '../../engine/catalog';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { recommendedRefs } from '../../engine/providers/registry';
import { formatUsd } from '../../lib/format';
import type { MediaKind, ModelSummary, ProviderId } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { Spinner } from '../ui/primitives';

export function priceHint(m: ModelSummary): string {
  if (m.provider === 'local') return 'Free';
  const sku = m.price?.skus[0];
  if (!sku) return '';
  const per = sku.unit === 'second' ? '/s' : sku.unit === 'megapixel' ? '/MP' : m.kind === 'image' ? '/img' : m.kind === 'audio' ? (m.textOutput ? '/text' : '/song') : m.kind === 'model3d' ? '/model' : '/clip';
  return `${formatUsd(sku.usd)}${per}`;
}

function badges(m: ModelSummary): string[] {
  const out: string[] = [];
  if (m.provider === 'local') out.push('Demo');
  if (m.tags.includes('upscale')) out.push('Upscale');
  if (m.tags.includes('background-removal')) out.push('Cutout');
  if (m.tags.includes('vector')) out.push('SVG');
  if (m.kind === 'image' && m.acceptsImage && !m.tags.length) out.push(m.acceptsText ? 'Edit' : 'Image in');
  if (m.kind === 'model3d') out.push(m.acceptsText && m.acceptsImage ? 'Text/Image' : m.acceptsImage ? 'Image in' : 'Text');
  if (m.kind === 'video' && m.needsVideo) out.push('Video in');
  else if (m.kind === 'video' && m.acceptsImage) out.push(m.acceptsText ? 'I2V' : 'I2V only');
  if (m.textOutput) out.push('Text out');
  return out;
}

// Who makes a model, read from its id or name: the maker's logo (LobeHub icons, MIT; see NOTICE), else a monogram.
const logos = import.meta.glob('../../assets/brands/*.svg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const logo = (name: string) => logos[`../../assets/brands/${name}.svg`];
const VENDORS: Array<[RegExp, string, string]> = [
  [/gpt|openai|dall-?e|sora|whisper/, 'openai', 'OpenAI'],
  [/nano-?banana|gemini/, 'gemini-color', 'Google Gemini'],
  [/imagen|veo|google/, 'google-color', 'Google'],
  [/seedream|seedance|seed3d|seedvr|bytedance|omnihuman|dreamina/, 'bytedance-color', 'ByteDance'],
  [/flux|black-?forest|bfl/, 'bfl', 'Black Forest Labs'],
  [/recraft/, 'recraft', 'Recraft'],
  [/ideogram/, 'ideogram', 'Ideogram'],
  [/kling/, 'kling-color', 'Kling'],
  [/qwen/, 'qwen-color', 'Qwen'],
  [/\bwan\b|wan-?\d|wan2|alibaba|z-?image|tongyi/, 'alibaba-color', 'Alibaba'],
  [/hailuo/, 'hailuo-color', 'Hailuo'],
  [/minimax/, 'minimax-color', 'MiniMax'],
  [/grok|xai/, 'xai', 'xAI'],
  [/hunyuan|tencent/, 'hunyuan-color', 'Hunyuan'],
  [/runway|gen-?4/, 'runway', 'Runway'],
  [/luma|ray-?2|photon/, 'luma-color', 'Luma'],
  [/pixverse/, 'pixverse-color', 'PixVerse'],
  [/meshy/, 'meshy-color', 'Meshy'],
  [/tripo/, 'tripo-color', 'Tripo'],
  [/elevenlabs/, 'elevenlabs', 'ElevenLabs'],
  [/stable-?diffusion|stability|sdxl|sd3/, 'stability-color', 'Stability AI'],
  [/vidu/, 'vidu-color', 'Vidu'],
];

function Monogram({ m }: { m: ModelSummary }) {
  const text = `${m.id} ${m.name}`.toLowerCase();
  const hit = VENDORS.find(([re]) => re.test(text));
  const src = hit ? logo(hit[1]) : undefined;
  if (src) {
    return (
      <span className="ml-mono" title={hit![2]}>
        <img src={src} alt="" draggable={false} />
      </span>
    );
  }
  return (
    <span className="ml-mono" aria-hidden>
      {m.provider === 'local' ? '⌂' : m.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** One quiet line under the name: the provider's short description, else what goes in and out. */
function subtitle(m: ModelSummary): string {
  const d = m.description?.replace(/\s+/g, ' ').trim();
  if (d) return d;
  const input = m.acceptsImage ? (m.acceptsText ? 'Text or image' : 'Image') : m.acceptsVideo ? 'Video' : 'Text';
  return `${input} to ${m.textOutput ? 'text' : m.kind === 'model3d' ? '3D' : m.kind}`;
}

/** Model list grouped by provider: recommended models first, the full catalog on demand or when searching. Popover content. */
export function ModelList({
  kind,
  value,
  onSelect,
  filter,
  autoOption,
}: {
  kind: MediaKind;
  value: string | null;
  onSelect: (ref: string | null) => void;
  filter?: (m: ModelSummary) => boolean;
  autoOption?: string;
}) {
  const models = useStore((s) => s.catalog.models);
  const status = useStore((s) => s.catalog.status);
  const errors = useStore((s) => s.catalog.errors);
  useStore((s) => s.settings.keys);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const [browseAll, setBrowseAll] = useState(false);
  const providers = connectedProviders();

  const all = useMemo(
    () =>
      Object.values(models)
        .filter((m) => m.kind === kind && providers.includes(m.provider))
        // Models that need a source video only appear where a picker asks for them (operations).
        .filter((m) => (filter ? filter(m) : !m.needsVideo))
        .sort((a, b) => (a.provider === b.provider ? a.name.localeCompare(b.name) : providers.indexOf(a.provider) - providers.indexOf(b.provider))),
    [models, kind, filter, providers],
  );
  const recommended = useMemo(() => {
    const rec = recommendedRefs();
    return all.filter((m) => m.provider === 'local' || rec.has(m.ref) || m.ref === value);
  }, [all, value]);
  const needle = q.trim().toLowerCase();
  // Searching always covers the whole catalog; with no recommendations there is nothing to curate.
  const full = browseAll || Boolean(needle) || !recommended.length;
  const list = useMemo(
    () =>
      (full ? all : recommended)
        .filter((m) => !full || provider === 'all' || m.provider === provider)
        .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle)),
    [full, all, recommended, provider, needle],
  );

  const groups = useMemo(() => {
    const g = new Map<ProviderId, ModelSummary[]>();
    for (const m of list.slice(0, 400)) g.set(m.provider, [...(g.get(m.provider) ?? []), m]);
    return [...g.entries()];
  }, [list]);

  const remoteConnected = providers.length > 1;

  return (
    <div className="model-list">
      <div className="ml-search">
        <Search size={14} />
        <input autoFocus placeholder={`Search ${kind} models`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
      </div>
      {remoteConnected && full ? (
        <div className="ml-providers">
          {(['all', ...providers] as Array<ProviderId | 'all'>).map((p) => (
            <button key={p} type="button" className={`ml-prov ${provider === p ? 'is-active' : ''}`} onClick={() => setProvider(p)}>
              {p === 'all' ? 'All' : PROVIDER_LABELS[p]}
              {p !== 'all' && status[p] === 'loading' ? <Spinner size={11} /> : null}
            </button>
          ))}
        </div>
      ) : null}
      <div className="ml-scroll">
        {autoOption ? (
          <button type="button" className={`ml-row ${value == null ? 'is-selected' : ''}`} onClick={() => onSelect(null)}>
            <span className="ml-name">Auto</span>
            <span className="ml-meta">{autoOption}</span>
            {value == null ? <Check size={14} className="ml-check" /> : null}
          </button>
        ) : null}
        {groups.map(([p, ms]) => (
          <div key={p} className="ml-group">
            <div className="ml-group-head">
              {PROVIDER_LABELS[p]}
              <span className="faint num">{ms.length}</span>
            </div>
            {ms.map((m) => (
              <button key={m.ref} type="button" className={`ml-row ${value === m.ref ? 'is-selected' : ''}`} onClick={() => onSelect(m.ref)} title={m.description}>
                <Monogram m={m} />
                <span className="ml-main">
                  <span className="ml-name">{m.name}</span>
                  <span className="ml-sub">{subtitle(m)}</span>
                </span>
                <span className="ml-side">
                  {badges(m).map((b) => (
                    <span key={b} className="badge">
                      {b}
                    </span>
                  ))}
                  <span className="ml-price num">{priceHint(m)}</span>
                </span>
                {value === m.ref ? <Check size={14} className="ml-check" /> : null}
              </button>
            ))}
          </div>
        ))}
        {!list.length ? (
          <div className="ml-empty">
            {providers.some((p) => status[p] === 'loading') ? (
              <>
                <Spinner /> Loading catalogs…
              </>
            ) : (
              'No models match.'
            )}
          </div>
        ) : null}
        {providers.filter((p) => status[p] === 'error').map((p) => (
          <div key={p} className="ml-error">
            {PROVIDER_LABELS[p]}: {errors[p]}
          </div>
        ))}
      </div>
      {remoteConnected ? (
        <div className="ml-foot">
          {recommended.length && !needle ? (
            <button type="button" className="ml-foot-main" onClick={() => setBrowseAll((v) => !v)}>
              {browseAll ? 'Show recommended' : `Browse all models (${all.length})`}
            </button>
          ) : (
            <span className="ml-foot-main faint">{needle ? `${list.length} of ${all.length}` : `${all.length} models`}</span>
          )}
          <button type="button" className="ml-foot-icon" aria-label="Manage providers" data-tip="Manage providers" onClick={() => setUi({ settingsOpen: true })}>
            <Settings2 size={14} />
          </button>
        </div>
      ) : (
        <button type="button" className="ml-connect" onClick={() => setUi({ settingsOpen: true })}>
          <KeyRound size={13} />
          Connect OpenRouter, fal.ai, NanoGPT or Atlas Cloud
        </button>
      )}
    </div>
  );
}
