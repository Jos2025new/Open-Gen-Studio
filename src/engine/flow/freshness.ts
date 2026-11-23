import { incomingOf, resolveInputs, storeEnv } from '../nodecore/resolver';
import { composePrompt } from '../nodecore/evaluate';
import { descriptorOf } from '../nodecore/registry';
import { assetRevisionIdentity, normalizeAssetRevisions } from '../assetRevisions';
import { sentModelRef } from '../catalog';
import type { Asset, GenSettings, Generation, Graph, GraphNode, ModelSchema, Subject } from '../types';
import { lyricsBody, lyricsParam, mentionSubjects, wireParams } from '../params';

export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b))) : v);
}

export function comparableSettings(modelRef: string, settings: GenSettings, schemas: Record<string, ModelSchema> = {}, automaticSeed = false) {
  const schema = schemas[modelRef];
  const source = { ...settings, ...(automaticSeed ? { seed: undefined } : {}) };
  if (!schema) return source;
  const defaults = Object.fromEntries(schema.params.filter(p => !['seed', 'count', 'negative'].includes(p.role) && p.default !== undefined).map(p => [p.key, p.default]));
  return { count: settings.count, params: { ...defaults, ...wireParams(schema, source, settings.count) } };
}

/** The result a subject binding names (`node#2` → 1), or undefined for the node's chosen result. */
const pickOf = (from: string): number | undefined => { const m = /#(\d+)$/.exec(from); return m ? Math.max(0, Number(m[1]) - 1) : undefined; };

export interface RequestContext { schemas?: Record<string, ModelSchema>; assets?: Record<string, Asset>; operation?: (node: GraphNode) => unknown }

/** What a ref/control link brings: the referred thing's identity and content revision (an edited asset changes it). */
function linkTarget(graph: Graph, node: GraphNode, generations: Record<string, Generation>, assets: Record<string, Asset> = {}) {
  return graph.edges.filter(e => (e.kind ?? 'data') !== 'data' && (e.target === node.id || (e.both && e.source === node.id))).map(e => {
    const other = graph.nodes.find(n => n.id === (e.target === node.id ? e.source : e.target));
    const d = other?.data;
    const assetId = d?.kind === 'asset' ? d.assetId : undefined;
    const rev = assetId ? normalizeAssetRevisions(assets[assetId]) : undefined;
    const gen = d && 'generationId' in d && d.generationId ? generations[d.generationId] : undefined;
    return { kind: e.kind, port: e.targetHandle, from: other?.id ?? null, to: d?.kind === 'ref' ? d.ref : assetId ?? gen?.id ?? null, rev: rev ? `${rev.index}/${rev.versions.length}` : undefined };
  });
}

/** Compare the graph's logical request, before provider defaults, mention substitution and automatic seeds. */
export function nodeRequest(graph: Graph, node: GraphNode, generations: Record<string, Generation>, library: Subject[] = [], ctx: RequestContext = {}) {
  const d = node.data;
  const previous = 'generationId' in d && d.generationId ? generations[d.generationId] : undefined;
  // A port the descriptor declares as not affecting the result is not part of the request (same rule as the invalidation walk).
  const affects = descriptorOf(d.kind)?.affects ?? {};
  const incoming = incomingOf(resolveInputs(graph, node, { ...storeEnv(), generations, assets: ctx.assets })).filter(e => affects[e.port] !== false);
  const promptText = incoming.find(e => e.port === 'prompt')?.value;
  const prompt = composePrompt(d, promptText);
  const locals = [...(previous?.inputs?.subjects ?? [])];
  if ('subjects' in d) for (const binding of d.subjects ?? []) {
    const source = graph.nodes.find(n => n.id === binding.from.split('#')[0]);
    const data = source?.data;
    const gen = data && 'generationId' in data && data.generationId ? generations[data.generationId] : undefined;
    const asset = binding.from.startsWith('asset:') ? binding.from.slice(6) : data?.kind === 'asset' ? data.sketchAssetId ?? data.assetId
      : data && 'outputIndex' in data ? data.sketchAssetId ?? gen?.assetIds[pickOf(binding.from) ?? data.outputIndex] : undefined;
    const subject = { id: binding.name, name: binding.name, description: binding.description ?? '', kind: binding.kind ?? 'character', frontalAssetId: asset ?? undefined, refAssetIds: [] } as Subject;
    const index = locals.findIndex(s => s.name.toLowerCase() === subject.name.toLowerCase());
    if (index < 0) locals.push(subject); else locals[index] = subject;
  }
  const subjects = [...locals, ...library.filter(s => !locals.some(l => l.name.toLowerCase() === s.name.toLowerCase()))];
  const mentioned = mentionSubjects(prompt, subjects).ids.map(id => {
    const s = subjects.find(x => x.id === id)!;
    const assets = [s.frontalAssetId, ...s.refAssetIds, s.videoAssetId].flatMap(id => {
      const asset = id ? ctx.assets?.[id] : undefined;
      return asset && (asset.revisions?.length || asset.originalRevision) ? [assetRevisionIdentity(asset)] : [];
    });
    return { name: s.name, description: s.description, frontal: s.frontalAssetId, refs: s.refAssetIds, video: s.videoAssetId, voice: s.voiceId, ...(assets.length ? { assets } : {}) };
  });
  const links = linkTarget(graph, node, generations, ctx.assets);
  const extra = links.length ? { links } : {}; // absent when empty, so results saved before this stay current
  return d.kind === 'tool' ? { kind: d.kind, op: d.op, params: d.params, incoming, operation: ctx.operation?.(node), ...extra }
    : 'settings' in d ? { kind: d.kind, modelRef: d.modelRef, prompt, settings: comparableSettings(d.modelRef, d.settings, ctx.schemas), incoming, subjects: mentioned, ...extra } : { kind: d.kind, incoming, ...extra };
}

export function nodeIsCurrent(graph: Graph, node: GraphNode, generations: Record<string, Generation>, library: Subject[] = [], ctx: RequestContext = {}): boolean {
  const d = node.data;
  if (!('generationId' in d) || !d.generationId) return false;
  const g = generations[d.generationId];
  if (!g || g.status !== 'done' || (!g.assetIds.length && g.text == null)) return false;
  const request = nodeRequest(graph, node, generations, library, ctx);
  if (g.prompt == null || g.settings == null) return true; // Old/incomplete metadata alone does not invalidate an output.
  if (g.nodeRequest) return stable(request) === g.nodeRequest;
  if (g.inputs.nodeLibrary) {
    const previousSubjects = nodeRequest(graph, { ...node, data: { ...node.data, ...('prompt' in d ? { prompt: g.prompt } : {}) } } as GraphNode, generations, g.inputs.nodeLibrary, ctx);
    if ('subjects' in request && 'subjects' in previousSubjects && stable(request.subjects) !== stable(previousSubjects.subjects)) return false;
  }
  // Legacy results retain the pre-provider request. Missing historical subject images cannot be reconstructed.
  if (d.kind === 'tool') return g.op?.id === d.op && stable(g.op.params) === stable(d.params)
    && g.op.sourceAssetId === request.incoming.find(e => e.port === 'input')?.value;
  if (!('settings' in d)) return false;
  const settings: GenSettings = { ...g.settings, extras: { ...g.settings.extras }, seed: d.settings.seed == null ? undefined : g.settings.seed };
  const lyrics = request.incoming.find(e => e.port === 'lyrics')?.value;
  if (typeof lyrics === 'string') {
    const key = lyricsParam(ctx.schemas?.[d.modelRef])?.key;
    if (key) {
      if (settings.extras?.[key] !== lyricsBody(lyrics)) return false;
      if (settings.extras) delete settings.extras[key];
    }
  }
  if (!Object.keys(settings.extras ?? {}).length) delete settings.extras;
  const ownPrompt = 'prompt' in request ? request.prompt : '';
  // With a prompt cable that does not affect the result, the text it brought is not compared: the node's own prompt must still be in it.
  const promptSame = g.prompt === ownPrompt || (descriptorOf(d.kind)?.affects.prompt === false && typeof g.prompt === 'string' && g.prompt.includes(composePrompt(d, undefined)));
  const hasImageInput = request.incoming.some(e => (e.port === 'ref' || e.port === 'first') && e.value != null);
  const modelMatches = g.modelRef === d.modelRef
    || (hasImageInput && (d.kind === 'image' || d.kind === 'video') && g.modelRef === sentModelRef(d.modelRef, d.kind, true));
  if (!modelMatches || !promptSame || stable(comparableSettings(d.modelRef, settings, ctx.schemas)) !== stable(comparableSettings(d.modelRef, d.settings, ctx.schemas))) return false;
  const refs = request.incoming.filter(e => ['ref', 'clip', 'refVideo', 'audio'].includes(e.port)).map(e => e.value);
  return stable(refs) === stable(g.inputs.refs) && (request.incoming.find(e => e.port === 'first')?.value ?? undefined) === g.inputs.firstFrame
    && (request.incoming.find(e => e.port === 'last')?.value ?? undefined) === g.inputs.lastFrame;
}
