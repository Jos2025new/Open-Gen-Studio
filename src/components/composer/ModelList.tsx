import { useMemo, useState } from 'react';
import { Check, KeyRound, Search } from 'lucide-react';
import { connectedProviders } from '../../engine/catalog';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { formatUsd } from '../../lib/format';
import type { MediaKind, ModelSummary, ProviderId } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { Spinner } from '../ui/primitives';

export function priceHint(m: ModelSummary): string {
  if (m.provider === 'local') return 'Free';
  const sku = m.price?.skus[0];
  if (!sku) return '';
  const per = sku.unit === 'second' ? '/s' : sku.unit === 'megapixel' ? '/MP' : m.kind === 'image' ? '/img' : '/clip';
  return `${formatUsd(sku.usd)}${per}`;
}

function badges(m: ModelSummary): string[] {
  const out: string[] = [];
  if (m.provider === 'local') out.push('Demo');
  if (m.tags.includes('upscale')) out.push('Upscale');
  if (m.tags.includes('background-removal')) out.push('Cutout');
  if (m.tags.includes('vector')) out.push('SVG');
  if (m.kind === 'image' && m.acceptsImage && !m.tags.length) out.push(m.acceptsText ? 'Edit' : 'Image in');
  if (m.kind === 'video' && m.acceptsImage) out.push(m.acceptsText ? 'I2V' : 'I2V only');
  return out;
}

/** Searchable model list, grouped by provider. Popover content. */
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
  const providers = connectedProviders();

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return Object.values(models)
      .filter((m) => m.kind === kind && providers.includes(m.provider))
      .filter((m) => (filter ? filter(m) : true))
      .filter((m) => provider === 'all' || m.provider === provider)
      .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle))
      .sort((a, b) => (a.provider === b.provider ? a.name.localeCompare(b.name) : providers.indexOf(a.provider) - providers.indexOf(b.provider)));
  }, [models, kind, filter, provider, q, providers]);

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
      {remoteConnected ? (
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
      <button type="button" className="ml-connect" onClick={() => setUi({ settingsOpen: true })}>
        <KeyRound size={13} />
        {remoteConnected ? 'Manage providers' : 'Connect OpenRouter, fal.ai, NanoGPT or Atlas Cloud'}
      </button>
    </div>
  );
}
