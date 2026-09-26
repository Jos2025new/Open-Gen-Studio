import families from '../../../scripts/model-families.json';
import { formatUsd } from '../../lib/format';
import { isConnected } from '../catalog';
import type { MediaKind, ModelSchema, ModelSummary } from '../types';
import { useStore } from '../../store/store';

/*
 * The models the agent may route to on request: only the app's refined catalog (the priority families in
 * scripts/model-families.json, plus the chosen 3D models), from connected providers, never one whose schema
 * needs inputs the app cannot send. Searched by words ("seedance 2.0 fast"), locally: no LLM call, no text
 * added to every message. The agent reaches it through the find_models tool; the plan validator uses it to
 * suggest the closest ref when a model id is wrong.
 */

const FAMILY: Partial<Record<MediaKind, RegExp>> = {
  video: new RegExp(families.video, 'i'),
  image: new RegExp(families.image, 'i'),
  audio: new RegExp(families.audio, 'i'),
};

export function inIndex(m: ModelSummary, schema: ModelSchema | undefined): boolean {
  if (m.provider === 'local') return false;
  if (schema?.missing?.length) return false;
  // 3D models are already limited to the chosen ones by the adapters.
  if (m.kind === 'model3d') return true;
  const re = FAMILY[m.kind];
  return Boolean(re && (re.test(m.id) || re.test(m.name)));
}

/** "Seedance 2.0 Fast", "bytedance-seedance-2-0-fast" → ["seedance", "2", "0", "fast"]. */
export function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const GENERIC = new Set(['video', 'image', 'audio', 'music', 'model', 'models', 'to', 'text', 'the', 'a', 'de', 'modelo', 'v', '3d']);

export interface SearchOptions {
  kind?: MediaKind;
  /** Prefer variants that take an input image (image-to-video) when the step has one. */
  needsImage?: boolean;
  limit?: number;
}

/** Best matches for the words of `query`: most query words found first, then the closest (fewest extra words). */
export function searchIndex(models: ModelSummary[], query: string, opts: SearchOptions = {}): ModelSummary[] {
  const all = [...new Set(tokens(query.replace(/^[a-z]+::/, '')))];
  // Generic words ("video", "to") match half the catalog; they only count when nothing else was given.
  const q = all.some((t) => !GENERIC.has(t)) ? all.filter((t) => !GENERIC.has(t)) : all;
  if (!q.length) return [];
  const scored: Array<{ m: ModelSummary; hits: number; extra: number; fit: number }> = [];
  for (const m of models) {
    if (opts.kind && m.kind !== opts.kind) continue;
    const have = new Set([...tokens(m.id), ...tokens(m.name)]);
    const hits = q.filter((t) => have.has(t)).length;
    if (!hits) continue;
    const fit = opts.needsImage == null ? 0 : opts.needsImage === Boolean(m.acceptsImage) ? 0 : 1;
    scored.push({ m, hits, extra: tokens(m.id).filter((t) => !q.includes(t)).length, fit });
  }
  const best = Math.max(0, ...scored.map((s) => s.hits));
  // With several words, a single stray match ("2") is noise: at least half of them must match.
  const floor = Math.max(1, best - 1, Math.ceil(q.length / 2));
  return scored
    .filter((s) => s.hits >= floor)
    .sort((a, b) => b.hits - a.hits || a.fit - b.fit || a.extra - b.extra || a.m.ref.localeCompare(b.m.ref))
    .slice(0, opts.limit ?? 8)
    .map((s) => s.m);
}

/** The refined catalog from the store: indexed models of connected providers. */
export function indexedModels(): ModelSummary[] {
  const { models, schemas } = useStore.getState().catalog;
  return Object.values(models).filter((m) => isConnected(m.provider) && inIndex(m, schemas[m.ref]));
}

export function describeIndexed(m: ModelSummary): string {
  const inputs = [m.acceptsText ? 'text' : '', m.acceptsImage ? 'image' : '', m.needsVideo ? 'needs a source video' : m.acceptsVideo ? 'video' : ''].filter(Boolean).join('+') || 'none';
  const sku = m.price?.skus[0];
  const price = sku ? `${m.price?.lowerBound ? '≥' : ''}${formatUsd(sku.usd)}/${sku.unit === 'output' ? 'run' : sku.unit}` : 'price not published';
  return `${m.ref} — ${m.kind} — ${m.name} — inputs: ${inputs} — ${price}`;
}

/** find_models tool result: one line per match, or a short "nothing found" the agent can act on. */
export function findModelsResult(query: string, kind: MediaKind | undefined): string {
  const found = searchIndex(indexedModels(), query, { kind });
  if (!found.length) return `No supported model matches "${query}". Tell the user it is not available in the app and offer the closest listed model.`;
  return found.map(describeIndexed).join('\n');
}

/** Closest indexed ref for a wrong model id, for the validator's "did you mean" (same kind, fitting inputs). */
export function suggestModel(ref: string, kind: MediaKind, needsImage: boolean): string | undefined {
  return searchIndex(indexedModels(), ref, { kind, needsImage, limit: 1 })[0]?.ref;
}
