import type { ModelSummary, ProviderId } from './types';

/*
 * The same model variant is often served by several providers under different ids
 * (atlas "google/nano-banana-pro/edit", fal "fal-ai/nano-banana-pro/edit", nanogpt "nano-banana-pro-edit").
 * Model pickers show it once, say where it is served, and pick the cheapest provider.
 */

// Maker prefixes and words that name the host, not the model. "developer" is Atlas's cheaper tier of the same variant.
const NOISE = new Set(['fal', 'ai', 'google', 'openai', 'bytedance', 'xai', 'alibaba', 'black', 'forest', 'labs', 'blackforestlabs', 'bfl', 'pruna', 'developer', 'v']);

/** Stable, provider-neutral families shown by the compact Agent picker. This classifies; it does not route. */
const FAMILIES: Array<[RegExp, string, string]> = [
  [/nano[-_ .]?banana/i, 'nano-banana', 'Nano Banana'],
  [/gpt[-_ .]?image/i, 'gpt-image', 'GPT Image'],
  [/seedream/i, 'seedream', 'Seedream'],
  [/grok.*imagine.*image/i, 'grok-image', 'Grok Imagine Image'],
  [/recraft/i, 'recraft', 'Recraft'],
  [/ideogram/i, 'ideogram', 'Ideogram'],
  [/(?:p-image|prunaai)/i, 'p-image', 'P-Image'],
  [/z[-_ .]?image/i, 'z-image', 'Z-Image'],
  [/(?:\bwan\b|wan[-_ .]?3)/i, 'wan-3', 'Wan 3'],
  [/(?:minimax.*h3|\bh3[-_ .]?(?:max|developer|turbo))/i, 'minimax-h3', 'MiniMax H3'],
  [/seedance/i, 'seedance', 'Seedance'],
  [/flux[-_ .]?3/i, 'flux-3', 'FLUX 3'],
  [/veo[-_ .]?3/i, 'veo-3', 'Veo 3'],
  [/kling/i, 'kling', 'Kling'],
  [/grok.*imagine.*video/i, 'grok-video', 'Grok Imagine Video'],
  [/gemini.*omni/i, 'gemini-omni', 'Gemini Omni'],
  [/happy[-_ .]?horse/i, 'happyhorse', 'HappyHorse'],
  [/trellis/i, 'trellis', 'TRELLIS'],
  [/seed3d/i, 'seed3d', 'Seed3D'],
  [/meshy/i, 'meshy', 'Meshy'],
  [/tripo/i, 'tripo', 'Tripo'],
  [/minimax.*music/i, 'minimax-music', 'MiniMax Music'],
];

export interface ModelFamily {
  key: string;
  label: string;
}

/** Family above a variant. Unknown models remain their own family rather than being merged by guesswork. */
export function modelFamily(m: ModelSummary): ModelFamily {
  const text = `${m.id} ${m.name}`;
  const hit = FAMILIES.find(([re]) => re.test(text));
  return hit ? { key: `${m.kind}|${hit[1]}`, label: hit[2] } : { key: variantKey(m), label: m.name };
}

/** A provider-independent key for a model variant: same key = same variant (or an equivalent one). */
export function variantKey(m: Pick<ModelSummary, 'provider' | 'id' | 'kind' | 'ref'>): string {
  if (m.provider === 'local') return m.ref;
  const id = m.id
    .toLowerCase()
    .replace(/(\d)\.0(?!\d)/g, '$1') // v5.0 → v5
    .replace(/(\d)-0(?=-|\/|$)/g, '$1') // seedance-2-0-fast → seedance-2-fast
    .replace(/text-to-image/g, ' '); // the base variant: "x/text-to-image" = "x"
  const words = id
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w));
  return `${m.kind}|${[...new Set(words)].sort().join(' ')}`;
}

/** Listed price when two variants can be compared (same unit), else undefined. */
function comparable(a: ModelSummary, b: ModelSummary): [number, number] | undefined {
  const sa = a.price?.skus[0];
  const sb = b.price?.skus[0];
  if (!sa || !sb || sa.unit !== sb.unit) return undefined;
  return [sa.usd, sb.usd];
}

/** Cheapest first; a known price before an unknown one; otherwise the given provider order. */
export function byCost(order: ProviderId[]) {
  return (a: ModelSummary, b: ModelSummary): number => {
    const c = comparable(a, b);
    if (c && c[0] !== c[1]) return c[0] - c[1];
    const pa = a.price?.skus[0];
    const pb = b.price?.skus[0];
    if (Boolean(pa) !== Boolean(pb)) return pa ? -1 : 1;
    return order.indexOf(a.provider) - order.indexOf(b.provider) || a.id.length - b.id.length;
  };
}

export interface VariantGroup {
  key: string;
  /** Every provider's copy, cheapest first. */
  members: ModelSummary[];
  /** What the picker selects: the cheapest copy. */
  best: ModelSummary;
}

/** One group per variant, in the order of first appearance. */
export function groupVariants(models: ModelSummary[], order: ProviderId[]): VariantGroup[] {
  const map = new Map<string, ModelSummary[]>();
  for (const m of models) {
    const k = variantKey(m);
    const list = map.get(k);
    if (list) list.push(m);
    else map.set(k, [m]);
  }
  return [...map.entries()].map(([key, ms]) => {
    const members = [...ms].sort(byCost(order));
    return { key, members, best: members[0] };
  });
}
