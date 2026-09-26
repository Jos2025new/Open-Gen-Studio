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
                <span className="ml-name">{m.name}</span>
                <span className="ml-badges">
                  {badges(m).map((b) => (
                    <span key={b} className="badge">
                      {b}
                    </span>
                  ))}
                </span>
                <span className="ml-price num">{priceHint(m)}</span>
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
