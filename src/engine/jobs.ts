import { uid } from '../lib/id';
import { AbortedError, isAbort } from '../lib/http';
import { getAssetBlob, loadAssetUrl, putAssetBlob } from '../lib/idb';
import { extractVideoFrame, fetchBlob, probeMedia, type MediaInfo } from '../lib/media';
import { randomSeed } from '../lib/rng';
import { apiKeyFor, isConnected, opModelFor, resolveModel } from './catalog';
import { estimateMedia, estimateOp } from './costs';
import { OPS, opCount } from './ops';
import { coerceSettings, dimsFor, longEdgeFor, maxCountPerRequest, nearestAspect, paramByRole, ratioOf } from './params';
import { ADAPTERS } from './providers/registry';
import { PROVIDER_LABELS, parseModelRef, type GenOutput, type MediaInput } from './providers/types';
import type { AdvancedValue, Asset, Estimate, GenSettings, Generation, GenerationOrigin, MediaKind, OpId } from './types';
import { addAssets, addSpend, patchGeneration, upsertGeneration, useStore } from '../store/store';

const get = useStore.getState;
const controllers = new Map<string, AbortController>();
const running = new Map<string, Promise<string[]>>();

export interface GenerationSpec {
  sessionId: string;
  kind: MediaKind;
  prompt: string;
  modelRef: string;
  settings: GenSettings;
  inputs?: Generation['inputs'];
  op?: Generation['op'];
  origin: GenerationOrigin;
  parentId?: string;
  planId?: string;
  stepId?: string;
  estimate?: Estimate;
}

export function modelName(ref: string): string {
  if (ref === 'local::frame') return 'Frame extractor';
  if (ref.startsWith('local::')) return ref === 'local::studio-video' ? 'Local Motion' : 'Local Sketch';
  return get().catalog.models[ref]?.name ?? parseModelRef(ref)?.id ?? ref;
}

export function estimateSpec(spec: GenerationSpec): Estimate {
  if (spec.op) {
    const src = get().assets[spec.op.sourceAssetId];
    return estimateOp(spec.op.id, spec.op.params, src, spec.settings);
  }
  const withImage = Boolean(spec.inputs?.refs.length || spec.inputs?.firstFrame);
  return estimateMedia(spec.modelRef, spec.kind, spec.settings, withImage);
}

export function createGeneration(spec: GenerationSpec): Generation {
  const parsed = parseModelRef(spec.modelRef);
  const g: Generation = {
    id: uid('gen'),
    sessionId: spec.sessionId,
    kind: spec.kind,
    prompt: spec.prompt,
    modelRef: spec.modelRef,
    modelName: modelName(spec.modelRef),
    provider: parsed?.provider ?? 'local',
    settings: { ...spec.settings, seed: spec.settings.seed ?? randomSeed() },
    inputs: spec.inputs ?? { refs: [] },
    op: spec.op,
    origin: spec.origin,
    status: 'queued',
    assetIds: [],
    estimate: spec.estimate ?? estimateSpec(spec),
    parentId: spec.parentId,
    planId: spec.planId,
    stepId: spec.stepId,
    createdAt: Date.now(),
  };
  upsertGeneration(g);
  return g;
}

async function mediaInput(assetId: string): Promise<MediaInput> {
  const asset = get().assets[assetId];
  if (!asset) throw new Error('An input asset was deleted.');
  let blob = await getAssetBlob(assetId);
  if (!blob && asset.remoteUrl) blob = await fetchBlob(asset.remoteUrl);
  if (!blob) throw new Error('An input asset is not available offline.');
  return { assetId, blob, mime: blob.type || asset.mime, width: asset.width, height: asset.height };
}

async function frameInput(assetId: string, which: 'first' | 'last'): Promise<MediaInput> {
  const url = (await loadAssetUrl(assetId)) ?? get().assets[assetId]?.remoteUrl;
  if (!url) throw new Error('The source video is not available.');
  const f = await extractVideoFrame(url, which);
  return { assetId, blob: f.blob, mime: 'image/png', width: f.width, height: f.height };
}

async function storeOutput(o: GenOutput, g: Generation, kind: MediaKind, fallback: MediaInfo): Promise<Asset> {
  const id = uid('ast');
  let blob = o.blob;
  if (!blob && o.url) {
    try {
      blob = await fetchBlob(o.url);
    } catch {
      /* keep the remote URL */
    }
  }
  let info: MediaInfo = fallback;
  if (blob) {
    await putAssetBlob(id, blob);
    info = await probeMedia(blob).catch(() => fallback);
  }
  return {
    id,
    kind,
    mime: blob?.type || o.mime || (kind === 'image' ? 'image/png' : 'video/mp4'),
    width: info.width || fallback.width,
    height: info.height || fallback.height,
    duration: info.duration ?? fallback.duration,
    sessionId: g.sessionId,
    generationId: g.id,
    origin: 'generated',
    remoteUrl: blob ? undefined : o.url,
    stored: Boolean(blob),
    favorite: false,
    createdAt: Date.now(),
  };
}

function expectedDims(kind: MediaKind, s: GenSettings): MediaInfo {
  const ratio = ratioOf(s.aspect) ?? (kind === 'video' ? 16 / 9 : 1);
  return { ...dimsFor(ratio, longEdgeFor(s.resolution ?? s.aspect)), duration: kind === 'video' ? s.duration : undefined };
}

/** Frame extraction is local and free; it never reaches a provider. */
async function runExtractFrame(g: Generation, signal: AbortSignal): Promise<string[]> {
  const src = g.op!.sourceAssetId;
  const which = g.op!.params.which === 'first' ? 'first' : 'last';
  const f = await frameInput(src, which);
  if (signal.aborted) throw new AbortedError();
  const asset = await storeOutput({ blob: f.blob, mime: 'image/png' }, g, 'image', { width: f.width, height: f.height });
  asset.origin = 'frame';
  addAssets([asset]);
  return [asset.id];
}

/** Execute a queued generation. Resolves with the created asset ids. */
export function runGeneration(id: string): Promise<string[]> {
  const existing = running.get(id);
  if (existing) return existing;
  const p = execute(id).finally(() => {
    running.delete(id);
    controllers.delete(id);
  });
  running.set(id, p);
  return p;
}

async function execute(id: string): Promise<string[]> {
  const g0 = get().generations[id];
  if (!g0) throw new Error('Generation not found');
  const controller = new AbortController();
  controllers.set(id, controller);
  const signal = controller.signal;
  patchGeneration(id, { status: 'running', startedAt: Date.now(), error: undefined, statusText: 'Starting', progress: undefined, assetIds: [] });
  const g = get().generations[id];
  try {
    if (g.op?.id === 'extract_frame') {
      const assetIds = await runExtractFrame(g, signal);
      finish(id, assetIds, 0);
      return assetIds;
    }
    const resolved = await resolveModel(g.modelRef);
    if (!resolved) {
      const parsed = parseModelRef(g.modelRef);
      const prov = parsed ? PROVIDER_LABELS[parsed.provider] : 'its provider';
      throw new Error(parsed && !isConnected(parsed.provider) ? `Connect ${prov} in Settings to use ${g.modelName}.` : `Model ${g.modelName} is not available.`);
    }
    const { model, schema } = resolved;
    const apiKey = apiKeyFor(model.provider);
    if (model.provider !== 'local' && !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[model.provider]} key in Settings.`);

    // Inputs
    const refs: MediaInput[] = [];
    let firstFrame: MediaInput | undefined;
    let lastFrame: MediaInput | undefined;
    if (g.op) {
      const def = OPS[g.op.id];
      if (def.engine === 'video') {
        firstFrame = g.op.id === 'continue' ? await frameInput(g.op.sourceAssetId, 'last') : await mediaInput(g.op.sourceAssetId);
      } else {
        refs.push(await mediaInput(g.op.sourceAssetId));
      }
    } else {
      for (const r of g.inputs.refs) refs.push(await mediaInput(r));
      if (g.inputs.firstFrame) firstFrame = await mediaInput(g.inputs.firstFrame);
      if (g.inputs.lastFrame) lastFrame = await mediaInput(g.inputs.lastFrame);
    }
    if (g.kind === 'image' && (schema.slots.images?.min ?? 0) > refs.length) throw new Error(`${model.name} needs an input image.`);
    if (g.kind === 'image' && refs.length && !schema.slots.images) throw new Error(`${model.name} does not accept input images.`);
    if (g.kind === 'video' && firstFrame && !schema.slots.firstFrame) throw new Error(`${model.name} cannot start from an image. Pick an image-to-video model.`);

    const total = Math.max(1, g.settings.count);
    const perRequest = Math.max(1, Math.min(total, maxCountPerRequest(schema)));
    const fallback = expectedDims(g.kind, g.settings);
    const assetIds: string[] = [];
    let cost = 0;
    let costKnown = true;
    let done = 0;
    while (done < total) {
      const n = Math.min(perRequest, total - done);
      const settings = { ...g.settings, seed: g.settings.seed != null ? g.settings.seed + done : undefined };
      const result = await ADAPTERS[model.provider].generate({
        kind: g.kind,
        model,
        schema,
        prompt: g.prompt,
        settings,
        count: n,
        refs,
        firstFrame,
        lastFrame,
        op: g.op ? { id: g.op.id, params: g.op.params } : undefined,
        apiKey,
        signal,
        onStatus: (text, progress) => patchGeneration(id, { statusText: total > 1 ? `${text} · ${done + 1}/${total}` : text, progress }),
        onRemoteJob: (job) => patchGeneration(id, { remoteJob: total === perRequest ? job : undefined }),
      });
      if (result.costUsd != null) cost += result.costUsd;
      else costKnown = false;
      const assets = await Promise.all(result.outputs.slice(0, n).map((o) => storeOutput(o, g, g.kind, fallback)));
      addAssets(assets);
      assetIds.push(...assets.map((a) => a.id));
      patchGeneration(id, { assetIds: [...assetIds] });
      done += Math.max(1, Math.min(n, result.outputs.length));
      if (!result.outputs.length) break;
    }
    finish(id, assetIds, costKnown ? cost : undefined);
    return assetIds;
  } catch (err) {
    const cur = get().generations[id];
    if (isAbort(err) || signal.aborted) {
      patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob: undefined });
      if (cur?.assetIds.length) chargePartial(cur);
      throw new AbortedError();
    }
    patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob: undefined });
    throw err;
  }
}

function finish(id: string, assetIds: string[], actualUsd: number | undefined): void {
  const g = get().generations[id];
  if (!g) return;
  patchGeneration(id, {
    status: 'done',
    assetIds,
    statusText: undefined,
    progress: undefined,
    finishedAt: Date.now(),
    actualUsd,
    remoteJob: undefined,
  });
  addSpend(actualUsd ?? g.estimate.usd ?? 0);
}

function chargePartial(g: Generation): void {
  const per = g.estimate.usd != null ? g.estimate.usd / Math.max(1, g.settings.count) : 0;
  addSpend(per * g.assetIds.length);
}

export function cancelGeneration(id: string): void {
  controllers.get(id)?.abort();
  const g = get().generations[id];
  if (g && g.status === 'queued') patchGeneration(id, { status: 'canceled', finishedAt: Date.now() });
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

/** After a reload: resume polling remote jobs; mark other in-flight generations as interrupted. */
export async function resumeInterrupted(): Promise<void> {
  const gens = Object.values(get().generations).filter((g) => g.status === 'running' || g.status === 'queued');
  for (const g of gens) {
    const job = g.remoteJob;
    const adapter = job ? ADAPTERS[job.provider] : undefined;
    if (!job || !adapter?.resume || !isConnected(job.provider)) {
      patchGeneration(g.id, { status: 'error', error: 'Interrupted by a page reload. Regenerate to try again.', statusText: undefined, finishedAt: Date.now() });
      continue;
    }
    const controller = new AbortController();
    controllers.set(g.id, controller);
    const p = (async () => {
      try {
        patchGeneration(g.id, { statusText: 'Resuming' });
        const result = await adapter.resume!(job, {
          kind: g.kind,
          apiKey: apiKeyFor(job.provider),
          signal: controller.signal,
          onStatus: (text, progress) => patchGeneration(g.id, { statusText: text, progress }),
        });
        const fallback = expectedDims(g.kind, g.settings);
        const assets = await Promise.all(result.outputs.map((o) => storeOutput(o, g, g.kind, fallback)));
        addAssets(assets);
        finish(g.id, assets.map((a) => a.id), result.costUsd);
        return assets.map((a) => a.id);
      } catch (err) {
        if (isAbort(err)) {
          patchGeneration(g.id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob: undefined });
        } else {
          patchGeneration(g.id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob: undefined });
        }
        return [];
      } finally {
        running.delete(g.id);
        controllers.delete(g.id);
      }
    })();
    running.set(g.id, p);
  }
}

// ---------------------------------------------------------------------------
// Operation specs

export interface OpSpecInput {
  sessionId: string;
  sourceAssetId: string;
  op: OpId;
  params: Record<string, AdvancedValue>;
  origin: GenerationOrigin;
  parentId?: string;
  planId?: string;
  stepId?: string;
  /** Dimensions of the source when it is not an asset yet (designer layers). */
  sourceDims?: { width: number; height: number };
}

/** Build the generation spec for an operation on an asset (model, instruction and settings). */
export async function opSpec(input: OpSpecInput): Promise<GenerationSpec> {
  const def = OPS[input.op];
  const source: { width: number; height: number } | undefined = get().assets[input.sourceAssetId] ?? input.sourceDims;
  const prompt = def.instruction ? def.instruction(input.params) : def.label;
  const base = { sessionId: input.sessionId, origin: input.origin, parentId: input.parentId, planId: input.planId, stepId: input.stepId };
  const op = { id: input.op, params: input.params, sourceAssetId: input.sourceAssetId };
  if (def.engine === 'frame') {
    return { ...base, kind: 'image', prompt: `${def.label} (${input.params.which})`, modelRef: 'local::frame', settings: { count: 1, advanced: {} }, op, estimate: { usd: 0, approximate: false } };
  }
  const choice = opModelFor(def.engine);
  const resolved = await resolveModel(choice.ref);
  const schema = resolved?.schema;
  if (def.engine === 'video') {
    const video = get().composer.video.settings;
    const { settings } = coerceSettings(schema, 'video', { ...video, count: 1, advanced: {} });
    if (source && paramByRole(schema, 'aspect')?.options) {
      const opts = paramByRole(schema, 'aspect')!.options!;
      settings.aspect = opts.some((o) => String(o) === 'auto') ? 'auto' : nearestAspect(opts, source.width / source.height) ?? settings.aspect;
    }
    const spec: GenerationSpec = { ...base, kind: 'video', prompt, modelRef: choice.ref, settings, op };
    return { ...spec, estimate: estimateOp(input.op, input.params, source, settings) };
  }
  const count = opCount(def, input.params);
  const dedicated = !choice.viaEdit && (def.engine === 'upscale' || def.engine === 'remove_bg');
  const { settings } = coerceSettings(schema, 'image', { count, advanced: {} });
  const aspectParam = paramByRole(schema, 'aspect');
  if (aspectParam?.options?.length) {
    const target = input.op === 'reframe' ? String(input.params.aspect) : source ? source.width / source.height : undefined;
    const hasAuto = aspectParam.options.some((o) => String(o) === 'auto');
    settings.aspect = input.op !== 'reframe' && hasAuto ? 'auto' : nearestAspect(aspectParam.options, target) ?? settings.aspect;
  }
  if (input.op === 'upscale') {
    const res = paramByRole(schema, 'resolution');
    if (res?.options?.length && choice.viaEdit) settings.resolution = String(res.options[res.options.length - 1]);
    const factorParam = schema?.params.find((p) => p.role === 'other' && /upscale_factor|^scale$|factor/i.test(p.key));
    if (factorParam) {
      const f = Number(input.params.factor) || 2;
      settings.advanced[factorParam.key] = factorParam.type === 'enum' ? (factorParam.options?.find((o) => Number(o) === f) ?? f) : f;
    }
  }
  const spec: GenerationSpec = { ...base, kind: 'image', prompt: dedicated ? '' : prompt, modelRef: choice.ref, settings, op };
  return { ...spec, estimate: estimateOp(input.op, input.params, source, settings) };
}

export function inputKindOf(assetId: string): MediaKind | undefined {
  return get().assets[assetId]?.kind;
}
