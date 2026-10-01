import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownUp, Check, ChevronDown, KeyRound, Search, Settings2 } from 'lucide-react';
import { connectedProviders } from '../../engine/catalog';
import { PROVIDER_LABELS } from '../../engine/providers/types';
import { recommendedRefs } from '../../engine/providers/registry';
import { groupLines, groupVariants, modelFamily, variantLabel, type VariantGroup } from '../../engine/variants';
import { formatUsd } from '../../lib/format';
import type { MediaKind, ModelSummary, ProviderId } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { MenuItem, Spinner } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { usePref } from '../ui/hooks';

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

function vendorOf(m: ModelSummary) {
  const text = `${m.id} ${m.name}`.toLowerCase();
  return VENDORS.find(([re]) => re.test(text));
}

// Recommended image models (user, 2026-09-27): these families, in this order; tools last. The rest is under "Browse all".
const FAMILIES: Array<[string, RegExp]> = [
  ['Nano Banana', /nano-?banana/],
  ['GPT Image', /gpt-?image-?2/],
  ['Seedream', /seedream/],
  ['Grok Imagine', /grok-?imagine-?image/],
  ['Recraft', /recraft/],
  ['Ideogram', /ideogram/],
  ['P-Image', /p-image|prunaai/],
  ['Z-Image', /z-?image/],
];
const FAMILY_ORDER = ['Selected', ...FAMILIES.map(([f]) => f), 'Upscalers', 'Background removal', 'Local demo'];

function familyOf(m: ModelSummary): string | undefined {
  if (m.tags.includes('upscale')) return 'Upscalers';
  if (m.tags.includes('background-removal')) return 'Background removal';
  const text = `${m.id} ${m.name}`.toLowerCase();
  return FAMILIES.find(([, re]) => re.test(text))?.[0];
}

/** Where a variant is served: each provider once, with its price when there is more than one. */
function where(members: ModelSummary[]): string {
  const seen = new Map<ProviderId, ModelSummary>();
  for (const x of members) if (!seen.has(x.provider)) seen.set(x.provider, x);
  if (seen.size < 2) return PROVIDER_LABELS[members[0].provider];
  return [...seen.values()].map((x) => `${PROVIDER_LABELS[x.provider]}${x.price?.skus[0] ? ` ${formatUsd(x.price.skus[0].usd)}` : ''}`).join(' · ');
}

function Monogram({ m }: { m: ModelSummary }) {
  const hit = vendorOf(m);
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

type SortId = 'az' | 'za' | 'price-asc' | 'price-desc';
const SORTS: Array<[SortId, string]> = [
  ['az', 'Name A–Z'],
  ['za', 'Name Z–A'],
  ['price-asc', 'Price: low to high'],
  ['price-desc', 'Price: high to low'],
];

/** Listed price for sorting; local models are free, unknown prices go last. */
function priceOf(m: ModelSummary): number | undefined {
  return m.provider === 'local' ? 0 : m.price?.skus[0]?.usd;
}

/** A small "Label ▾" chip in the filter row that opens a menu of choices. */
function FilterMenu<T extends string>({ label, icon, value, options, onChange, active }: { label: string; icon?: ReactNode; value: T; options: Array<[T, ReactNode]>; onChange: (v: T) => void; active?: boolean }) {
  const pop = usePopover();
  return (
    <>
      <button ref={pop.ref} type="button" className={`ml-filter ${active ? 'is-active' : ''} ${pop.open ? 'is-open' : ''}`} onClick={pop.toggle} aria-haspopup="menu" aria-expanded={pop.open}>
        {icon}
        <span className="ml-filter-label">{label}</span>
        <ChevronDown size={12} />
      </button>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={200} label={label}>
        <div className="menu">
          {options.map(([id, text]) => (
            <MenuItem key={id} label={text} active={id === value} right={id === value ? <Check size={13} /> : null} onClick={() => { onChange(id); pop.close(); }} />
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Model list: recommended models first, the full catalog on demand or when searching; one row per variant across providers. Popover content. */
export function ModelList({
  kind,
  value,
  onSelect,
  filter,
  autoOption,
  familyTree = false,
}: {
  kind: MediaKind;
  value: string | null;
  onSelect: (ref: string | null) => void;
  filter?: (m: ModelSummary) => boolean;
  autoOption?: string;
  /** Compact Agent picker: families are collapsible; variants stay as the existing rows. */
  familyTree?: boolean;
}) {
  const models = useStore((s) => s.catalog.models);
  const status = useStore((s) => s.catalog.status);
  const errors = useStore((s) => s.catalog.errors);
  useStore((s) => s.settings.keys);
  const [q, setQ] = useState('');
  const [provider, setProvider] = useState<ProviderId | 'all'>('all');
  const [feature, setFeature] = useState('all');
  const [sort, setSort] = usePref<SortId>('ogs.modelSort', 'az');
  const [browseAll, setBrowseAll] = useState(false);
  const [openFamilies, setOpenFamilies] = useState<string[]>([]);
  const [openLines, setOpenLines] = useState<string[]>([]);
  const providers = connectedProviders();

  const all = useMemo(
    () =>
      Object.values(models)
        .filter((m) => m.kind === kind && providers.includes(m.provider))
        // Models that need a source video only appear where a picker asks for them (operations).
        .filter((m) => (filter ? filter(m) : !m.needsVideo)),
    [models, kind, filter, providers],
  );
  const recommended = useMemo(() => {
    // An operation picker (filter) is already the curated list: show every model that does the operation.
    if (filter) return all;
    if (kind === 'image') return all.filter((m) => m.provider === 'local' || familyOf(m) || m.ref === value);
    const rec = recommendedRefs();
    return all.filter((m) => m.provider === 'local' || rec.has(m.ref) || m.ref === value);
  }, [all, value, kind, filter]);
  const needle = q.trim().toLowerCase();
  // Searching always covers the whole catalog; with no recommendations there is nothing to curate.
  const full = browseAll || Boolean(needle) || !recommended.length;
  const features = useMemo(() => [...new Set(all.flatMap(badges))].sort(), [all]);
  const allCount = useMemo(() => groupVariants(all, providers).length, [all, providers]);
  // One entry per variant: every provider's copy of it, the cheapest selected on click.
  const entries = useMemo(() => {
    const out = groupVariants(
      (full ? all : recommended)
        .filter((m) => provider === 'all' || m.provider === provider)
        .filter((m) => feature === 'all' || badges(m).includes(feature))
        .filter((m) => !needle || m.name.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle)),
      providers,
    );
    const byName = (a: VariantGroup, b: VariantGroup) => a.best.name.localeCompare(b.best.name);
    if (sort === 'za') return out.sort((a, b) => byName(b, a));
    if (sort === 'price-asc' || sort === 'price-desc') {
      const dir = sort === 'price-asc' ? 1 : -1;
      return out.sort((a, b) => {
        const pa = priceOf(a.best);
        const pb = priceOf(b.best);
        if (pa == null || pb == null) return pa == null ? (pb == null ? byName(a, b) : 1) : -1;
        return (pa - pb) * dir || byName(a, b);
      });
    }
    return out.sort(byName);
  }, [full, all, recommended, provider, feature, needle, sort, providers]);

  // Price sorts: one flat list. Recommended images: by family, in the chosen order. Otherwise: by maker.
  const byPrice = !familyTree && (sort === 'price-asc' || sort === 'price-desc');
  const groups = useMemo(() => {
    const byFamily = kind === 'image' && !full;
    const g = new Map<string, VariantGroup[]>();
    for (const e of entries.slice(0, 400)) {
      const m = e.best;
      const key = familyTree ? modelFamily(m).label : byPrice ? 'By price' : m.provider === 'local' ? 'Local demo' : byFamily ? (familyOf(m) ?? 'Selected') : (vendorOf(m)?.[2] ?? 'Other');
      g.set(key, [...(g.get(key) ?? []), e]);
    }
    const rank = (k: string) => (byFamily ? FAMILY_ORDER.indexOf(k) : k === 'Other' || k === 'Local demo' ? 1 : 0);
    const dir = sort === 'za' ? -1 : 1;
    return [...g.entries()].sort(([a], [b]) => (familyTree ? a.localeCompare(b) * dir : byFamily ? rank(a) - rank(b) : rank(a) - rank(b) || a.localeCompare(b) * dir));
  }, [entries, byPrice, kind, full, sort, familyTree]);

  const remoteConnected = providers.length > 1;

  return (
    <div className="model-list">
      <div className="ml-search">
        <Search size={14} />
        <input autoFocus placeholder={`Search ${kind} models`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search models" />
      </div>
      <div className="ml-filters">
        {remoteConnected ? (
          <FilterMenu
            label={provider === 'all' ? 'All providers' : PROVIDER_LABELS[provider]}
            value={provider}
            active={provider !== 'all'}
            onChange={setProvider}
            options={(['all', ...providers] as Array<ProviderId | 'all'>).map((p) => [
              p,
              p === 'all' ? 'All providers' : (
                <span className="ml-filter-opt">
                  {PROVIDER_LABELS[p]}
                  {status[p] === 'loading' ? <Spinner size={11} /> : null}
                </span>
              ),
            ])}
          />
        ) : null}
        {features.length ? (
          <FilterMenu label={feature === 'all' ? 'All features' : feature} value={feature} active={feature !== 'all'} onChange={setFeature} options={[['all', 'All features'], ...features.map((f): [string, string] => [f, f])]} />
        ) : null}
        <span className="ml-filters-gap" />
        <FilterMenu label={SORTS.find(([id]) => id === sort)?.[1] ?? 'Sort'} icon={<ArrowDownUp size={12} />} value={sort} onChange={setSort} options={SORTS} />
      </div>
      <div className="ml-scroll">
        {autoOption ? (
          <button type="button" className={`ml-row ${value == null ? 'is-selected' : ''}`} onClick={() => onSelect(null)}>
            <span className="ml-name">Auto</span>
            <span className="ml-meta">{autoOption}</span>
            {value == null ? <Check size={14} className="ml-check" /> : null}
          </button>
        ) : null}
        {groups.map(([label, es]) => {
          const selectedFamily = es.some((e) => e.members.some((x) => x.ref === value));
          const open = !familyTree || Boolean(needle) || selectedFamily || openFamilies.includes(label);
          return (
          <div key={label} className={`ml-group ${familyTree ? 'is-family' : ''}`}>
            {familyTree ? (
              <button
                type="button"
                className={`ml-family ${open ? 'is-open' : ''}`}
                onClick={() => setOpenFamilies((xs) => (xs.includes(label) ? xs.filter((x) => x !== label) : [...xs, label]))}
                aria-expanded={open}
              >
                <ChevronDown size={13} />
                <span>{label}</span>
                <span className="faint num">{groupLines(es).length}</span>
              </button>
            ) : (
              <div className="ml-group-head">
                {label}
                <span className="faint num">{groupLines(es).length}</span>
              </div>
            )}
            {open ? groupLines(es).map(({ key: lineId, head, rest }) => {
              // One row per model line; its other routes (edit, reference, image to video…) fold under it.
              const lineOpen = Boolean(needle) || openLines.includes(lineId) || rest.some((r) => r.members.some((x) => x.ref === value));
              const row = (g: VariantGroup, sub: boolean) => {
                const { key, members, best: m } = g;
                const selected = members.some((x) => x.ref === value);
                return (
                  <button key={key} type="button" className={`ml-row ${sub ? 'is-variant' : ''} ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(m.ref)} title={m.description}>
                    {sub ? <span className="ml-variant-dot" /> : <Monogram m={m} />}
                    <span className="ml-main">
                      <span className="ml-name">{sub ? variantLabel(head.best, m) : m.name}</span>
                      <span className="ml-sub">
                        {m.provider !== 'local' ? <span className="ml-where">{where(members)}</span> : null}
                        {sub ? null : subtitle(m)}
                      </span>
                    </span>
                    <span className="ml-side">
                      {badges(m).map((b) => (
                        <span key={b} className="badge">
                          {b}
                        </span>
                      ))}
                      <span className="ml-price num">{priceHint(m)}</span>
                    </span>
                    {selected ? <Check size={14} className="ml-check" /> : null}
                  </button>
                );
              };
              return (
                <div key={lineId} className="ml-line">
                  <div className="ml-line-head">
                    {row(head, false)}
                    {rest.length ? (
                      <button
                        type="button"
                        className={`ml-line-toggle ${lineOpen ? 'is-open' : ''}`}
                        aria-expanded={lineOpen}
                        data-tip={`${rest.length} more variant${rest.length > 1 ? 's' : ''}`}
                        onClick={() => setOpenLines((xs) => (xs.includes(lineId) ? xs.filter((x) => x !== lineId) : [...xs, lineId]))}
                      >
                        <span className="num">+{rest.length}</span>
                        <ChevronDown size={13} />
                      </button>
                    ) : null}
                  </div>
                  {lineOpen ? rest.map((g) => row(g, true)) : null}
                </div>
              );
            }) : null}
          </div>
        )})}
        {!entries.length ? (
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
              {browseAll ? 'Show recommended' : `Browse all models (${allCount})`}
            </button>
          ) : (
            <span className="ml-foot-main faint">{needle ? `${entries.length} of ${allCount}` : `${allCount} models`}</span>
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
