import { normalizeAssetRevisions } from '../assetRevisions';
import type { GraphEdge, GraphNode } from '../types';
import { digest } from './address';
import type { Delivery } from './descriptor';
import type { ResolveEnv } from './resolver';

/** What a node delivers on one edge (ADR 0031: the descriptor's `evaluate`): its value and the revision label of that value. */
export const NOTHING: Delivery = { value: null, revision: null };

/** A value with the revision label it carries: the one given, or a digest of the value itself. */
export function delivered(value: string | null | undefined, revision: string | null = null, edited?: true): Delivery {
  if (value == null) return NOTHING;
  return { value, revision: revision ?? digest(value), ...(edited ? { edited } : {}) };
}

/** A generation kind (and any kind without its own rule): the finished text, the Sketch, or the indexed result. */
export function deliverGenerated(src: GraphNode, edge: Pick<GraphEdge, 'outputIndex'>, env: ResolveEnv): Delivery {
  const data = src.data;
  const gen = 'generationId' in data && data.generationId ? env.generations[data.generationId] : undefined;
  const value = gen?.text ?? ('outputIndex' in data ? data.sketchAssetId ?? gen?.assetIds[edge.outputIndex ?? data.outputIndex] : null);
  const rev = value && env.assets?.[value] ? normalizeAssetRevisions(env.assets[value]) : undefined;
  const edited = rev && rev.versions.length > 1 ? true : undefined;
  return delivered(value, value && gen ? `${gen.id}:${value}${edited ? `@${rev!.index}/${rev!.versions.length}` : ''}` : null, edited);
}

/** An asset node: its Sketch or file, revised as `id@index/versions`; more than one version marks it edited. */
export function deliverAsset(src: GraphNode, env: ResolveEnv): Delivery {
  const data = src.data;
  if (data.kind !== 'asset') return NOTHING;
  const value = data.sketchAssetId ?? data.assetId;
  const rev = data.assetId ? normalizeAssetRevisions(env.assets?.[data.assetId]) : undefined;
  return delivered(value, value ? `${value}@${rev ? `${rev.index}/${rev.versions.length}` : '0'}` : null, rev && rev.versions.length > 1 ? true : undefined);
}
