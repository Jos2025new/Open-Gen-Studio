import { uid } from '../lib/id';
import { AbortedError, isAbort, JobFailedError } from '../lib/http';
import { getAssetBlob, putAssetBlob } from '../lib/idb';
import { blobToCanvas, blobToDataUrl, canvasToBlob, createCanvas, ctx2d, extractVideoFrame, fetchBlob, maskToAlpha, probeMedia, type MediaInfo } from '../lib/media';
import { randomSeed } from '../lib/rng';
import { apiKeyFor, isConnected, KLING_VOICE_REF, opModelFor, RECRAFT_STYLE_REF, resolveModel, transcriberFor } from './catalog';
import { estimateMedia, estimateOp, estimateTranscribe } from './costs';
import { InputError } from './errors';
import { model3dProblem, sourceVideoRule } from './modelRules';
import { modelMime, sniffModelMime } from '../lib/model3d';
import { OPS, opCount } from './ops';
import { audioInputProblem, songProblem, clipTrim, coerceSettings, mentionSubjects, shotsProblem, routeAudio, dimsFor, durationChoices, isAutoOption, longEdgeFor, placeKeyframes, maxCountPerRequest, nearestAspect, paramByRole, ratioOf, routeVideoInputs, videoInputProblem } from './params';
import { ADAPTERS } from './providers/registry';
import { PROVIDER_LABELS, parseModelRef, type GenOutput, type MediaInput } from './providers/types';
import type { AdvancedValue, Asset, AssetKind, Estimate, GenSettings, Generation, GenerationOrigin, MediaKind, OpId, RemoteJob } from './types';
import { addAssets, addSpend, patchAsset, patchGeneration, upsertGeneration, useStore } from '../store/store';

const get = useStore.getState;
const controllers = new Map<string, AbortController>();
const running = new Map<string, Promise<string[]>>();

export interface GenerationSpec {
  sessionId: string;
  kind: MediaKind | 'text';
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
  if (ref === 'local::frame') return 'Local tool';
  if (ref.startsWith('local::')) return ref === 'local::studio-video' ? 'Local Motion' : 'Local Sketch';
  return get().catalog.models[ref]?.name ?? get().catalog.transcribers?.[ref]?.name ?? parseModelRef(ref)?.id ?? ref;
}

export function estimateSpec(spec: GenerationSpec): Estimate {
  if (spec.op) {
    const src = get().assets[spec.op.sourceAssetId];
    return estimateOp(spec.op.id, spec.op.params, src, spec.settings);
  }
  if (spec.kind === 'text') {
    // Text from a model (MiniMax Lyrics) is priced like its media kind; other text results are not predictable.
    const m = get().catalog.models[spec.modelRef];
    return m?.textOutput ? estimateMedia(spec.modelRef, m.kind, spec.settings, false) : { usd: null, approximate: true };
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

/** An asset's bytes. A result that still lives only at the provider is downloaded and kept, since provider links expire. */
async function ensureAssetBlob(assetId: string): Promise<Blob> {
  const asset = get().assets[assetId];
  if (!asset) throw new Error('An input asset was deleted.');
  const stored = await getAssetBlob(assetId);
  if (stored) return stored;
  if (!asset.remoteUrl) throw new Error('An input asset is not available offline.');
  const blob = await fetchBlob(asset.remoteUrl);
  await putAssetBlob(assetId, blob);
  patchAsset(assetId, { stored: true, remoteUrl: undefined });
  return blob;
}

/** Keep results that are still only at the provider (e.g. after a download was blocked). Best effort. */
export async function adoptRemoteAssets(): Promise<void> {
  for (const a of Object.values(get().assets)) {
    if (!a.stored && a.remoteUrl) await ensureAssetBlob(a.id).catch(() => undefined);
  }
}

async function mediaInput(assetId: string): Promise<MediaInput> {
  const asset = get().assets[assetId];
  const blob = await ensureAssetBlob(assetId);
  return { assetId, blob, mime: blob.type || asset.mime, width: asset.width, height: asset.height };
}

async function frameInput(assetId: string, which: 'first' | 'last' | number): Promise<MediaInput> {
  // Read frames from local bytes: a remote video without CORS cannot be drawn to a canvas.
  const url = URL.createObjectURL(await ensureAssetBlob(assetId));
  try {
    const f = await extractVideoFrame(url, which);
    return { assetId, blob: f.blob, mime: 'image/png', width: f.width, height: f.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function storeOutput(o: GenOutput, g: Generation, kind: MediaKind, fallback: MediaInfo, thumbnailUrl?: string): Promise<Asset> {
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
    // A 3D file is never decoded here: probing would load the mesh into an image/video element.
    if (kind !== 'model3d') info = await probeMedia(blob).catch(() => fallback);
  }
  return {
    id,
    kind,
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    mime: blob?.type || o.mime || (kind === 'image' ? 'image/png' : kind === 'audio' ? 'audio/mpeg' : kind === 'model3d' ? 'model/gltf-binary' : 'video/mp4'),
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

/**
 * A 3D result is a set of files: the model (GLB, a ZIP with it, FBX with quads…) and often a preview render.
 * The bytes are downloaded right away (Atlas links expire in 24 h) and typed by content; each model file
 * becomes an asset and the render becomes their small thumbnail, never a separate model or image.
 */
export async function storeModelOutputs(outputs: GenOutput[], g: Generation): Promise<Asset[]> {
  const files = await Promise.all(
    outputs.map(async (o) => {
      let blob = o.blob;
      if (!blob && o.url) blob = await fetchBlob(o.url).catch(() => undefined);
      const mime = blob ? await sniffModelMime(blob, o.mime) : (o.mime ?? modelMime(o.url ?? '') ?? 'application/octet-stream');
      return { o, blob: blob && blob.type !== mime ? new Blob([blob], { type: mime }) : blob, mime };
    }),
  );
  const isImage = (f: { mime: string }) => f.mime.startsWith('image/');
  // A turntable/preview clip is not the model either; it is dropped.
  const models = files.filter((f) => !isImage(f) && !f.mime.startsWith('video/'));
  if (!models.length) throw new JobFailedError('The provider finished without a 3D file (only a preview image).');
  const thumb = files.find(isImage);
  const thumbnailUrl = thumb?.blob ? await thumbnailDataUrl(thumb.blob).catch(() => undefined) : undefined;
  return Promise.all(models.map((f) => storeOutput({ blob: f.blob, url: f.o.url, mime: f.mime }, g, 'model3d', { width: 0, height: 0 }, thumbnailUrl)));
}

/** A small JPEG kept in the asset itself: the provider's render link expires, and lists never load the mesh. */
async function thumbnailDataUrl(blob: Blob): Promise<string> {
  const src = await blobToCanvas(blob);
  const scale = Math.min(1, 320 / Math.max(src.width, src.height));
  const c = createCanvas(Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale)));
  ctx2d(c).drawImage(src, 0, 0, c.width, c.height);
  return blobToDataUrl(await canvasToBlob(c, 'image/jpeg', 0.8));
}

function expectedDims(kind: MediaKind, s: GenSettings): MediaInfo {
  if (kind === 'audio' || kind === 'model3d') return { width: 0, height: 0 };
  const ratio = ratioOf(s.aspect) ?? (kind === 'video' ? 16 / 9 : 1);
  return { ...dimsFor(ratio, longEdgeFor(s.resolution ?? s.aspect)), duration: kind === 'video' && s.duration != null && s.duration > 0 ? s.duration : undefined };
}

/** Local operations (frames, grid split) run in the browser for free; they never reach a provider. */
async function runLocalOp(g: Generation, signal: AbortSignal): Promise<string[]> {
  const { id, sourceAssetId, params } = g.op!;
  const images: Array<{ blob: Blob; width: number; height: number }> = [];
  if (id === 'extract_frame') {
    const seconds = parseFloat(String(params.seconds ?? ''));
    const which = params.which === 'first' ? 'first' : params.which === 'time' && Number.isFinite(seconds) ? seconds : 'last';
    images.push(await frameInput(sourceAssetId, which));
  } else if (id === 'grid_split') {
    const n = Number(params.grid) === 2 ? 2 : 3;
    const src = await blobToCanvas((await mediaInput(sourceAssetId)).blob);
    const w = Math.floor(src.width / n);
    const h = Math.floor(src.height / n);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const c = createCanvas(w, h);
        ctx2d(c).drawImage(src, col * w, row * h, w, h, 0, 0, w, h);
        images.push({ blob: await canvasToBlob(c, 'image/png'), width: w, height: h });
      }
    }
  } else {
    throw new Error(`${id} is not a local operation`);
  }
  if (signal.aborted) throw new AbortedError();
  const assets = await Promise.all(images.map((f) => storeOutput({ blob: f.blob, mime: 'image/png' }, g, 'image', { width: f.width, height: f.height })));
  assets.forEach((a) => (a.origin = 'frame'));
  addAssets(assets);
  return assets.map((a) => a.id);
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
  patchGeneration(id, { status: 'running', startedAt: Date.now(), error: undefined, statusText: 'Starting', progress: undefined, assetIds: [], remoteJob: undefined });
  const g = get().generations[id];
  try {
    if (g.op && OPS[g.op.id].engine === 'local') {
      const assetIds = await runLocalOp(g, signal);
      finish(id, assetIds, 0);
      return assetIds;
    }
    if (g.op && OPS[g.op.id].engine === 'transcribe') {
      await runTranscribe(g, signal);
      return [];
    }
    if (g.op && OPS[g.op.id].engine === 'voice') {
      await runCreateVoice(g, signal);
      return [];
    }
    if (g.kind === 'text' && g.modelRef === RECRAFT_STYLE_REF) {
      await runCreateStyle(g, signal);
      return [];
    }
    const resolved = await resolveModel(g.modelRef);
    if (!resolved) {
      const parsed = parseModelRef(g.modelRef);
      const prov = parsed ? PROVIDER_LABELS[parsed.provider] : 'its provider';
      throw new Error(parsed && !isConnected(parsed.provider) ? `Connect ${prov} in Settings to use ${g.modelName}.` : `Model ${g.modelName} is not available.`);
    }
    const { model, schema } = resolved;
    if (g.kind === 'text' && !model.textOutput) throw new Error(`${model.name} makes ${model.kind}, not text.`);
    // What the provider is asked for: a text-output model (lyrics) runs as its media kind.
    const kind: MediaKind = g.kind === 'text' ? model.kind : g.kind;
    if (schema.missing?.length) throw new Error(`${model.name} needs ${schema.missing.join(', ')}, which the app cannot send yet. Pick another model.`);
    const apiKey = apiKeyFor(model.provider);
    if (model.provider !== 'local' && !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[model.provider]} key in Settings.`);

    // Inputs
    let refs: MediaInput[] = [];
    let refVideos: MediaInput[] = [];
    let audios: MediaInput[] = [];
    let firstFrame: MediaInput | undefined;
    let lastFrame: MediaInput | undefined;
    let video: MediaInput | undefined;
    if (g.op) {
      const def = OPS[g.op.id];
      if (def.engine === 'video_upscale' || def.engine === 'video_edit' || def.engine === 'video_extend') {
        video = await mediaInput(g.op.sourceAssetId);
        const rule = sourceVideoRule(model.id);
        const range = def.engine === 'video_edit' ? rule?.seconds.edit : def.engine === 'video_extend' ? rule?.seconds.extend : undefined;
        const seconds = get().assets[g.op.sourceAssetId]?.duration;
        if (range && seconds != null && (seconds < range[0] || seconds > range[1])) {
          throw new InputError('VIDEO_DURATION', `${model.name} takes clips of ${range[0]}–${range[1]} s for this; this one is ${seconds.toFixed(1)} s.`);
        }
        // No source-video field (Seedance 2.5 omni reference): the clip goes in as the one reference video.
        if (!schema.slots.video && (schema.slots.refVideos || schema.slots.mixedRefs)) {
          refVideos = [video];
          video = undefined;
        }
      } else if (def.engine === 'video') {
        firstFrame = g.op.id === 'continue' ? await frameInput(g.op.sourceAssetId, 'last') : await mediaInput(g.op.sourceAssetId);
      } else {
        refs.push(await mediaInput(g.op.sourceAssetId));
      }
    } else {
      for (const r of g.inputs.refs) {
        const kind = get().assets[r]?.kind;
        (kind === 'video' ? refVideos : kind === 'audio' ? audios : refs).push(await mediaInput(r));
      }
      if (g.inputs.firstFrame) firstFrame = await mediaInput(g.inputs.firstFrame);
      if (g.inputs.lastFrame) lastFrame = await mediaInput(g.inputs.lastFrame);
    }
    // Mask operations (Edit region, Remove object): only models that declare a mask, in their convention.
    let mask: MediaInput | undefined;
    const engine = g.op ? OPS[g.op.id].engine : undefined;
    if (g.op && (engine === 'inpaint' || engine === 'remove_object')) {
      const def = OPS[g.op.id];
      const maskId = String(g.op.params.mask ?? '');
      const maskAsset = get().assets[maskId];
      if (!maskAsset) throw new InputError('MASK_MISSING', `${def.label} needs a mask: paint the area in Sketch.`);
      if (!schema.slots.mask) throw new InputError('MASK_UNSUPPORTED', `${model.name} cannot take a mask. Pick a model for ${def.label} in Settings → Operations.`);
      const src = get().assets[g.op.sourceAssetId];
      if (src && (maskAsset.width !== src.width || maskAsset.height !== src.height)) {
        throw new InputError('MASK_SIZE', `The mask is ${maskAsset.width}×${maskAsset.height} but the image is ${src.width}×${src.height}.`);
      }
      const input = await mediaInput(maskId);
      mask = schema.slots.mask.convention === 'alpha' ? { ...input, blob: await maskToAlpha(input.blob), mime: 'image/png' } : input;
    }
    if (g.kind === 'image' && (schema.slots.images?.min ?? 0) + (schema.slots.source ? 1 : 0) > refs.length) {
      throw new Error(`${model.name} needs ${schema.slots.source ? 'a source image plus reference images' : 'an input image'}.`);
    }
    if (kind === 'model3d') {
      if (refVideos.length || audios.length || firstFrame || lastFrame) throw new InputError('MODEL3D_MEDIA_INPUT', `${model.name} takes only images.`);
      if (refs.length && !schema.slots.images) throw new InputError('MODEL3D_NO_IMAGE_INPUT', `${model.name} takes text only.`);
      const problem = model3dProblem(model.id, model, g.prompt, refs.map((r) => ({ size: r.blob.size, width: r.width, height: r.height })));
      if (problem) throw new InputError(problem.code, `${model.name} ${problem.message}`);
    }
    if (g.kind === 'image' && refs.length && !schema.slots.images) throw new Error(`${model.name} does not accept input images.`);
    if (g.kind === 'video' && !video && !(g.op && refVideos.length)) {
      // A reference-to-video model has no start frame: an image given as one becomes a reference.
      const routed = routeVideoInputs(schema.slots, refs, refVideos, firstFrame);
      ({ firstFrame, images: refs, videos: refVideos } = routed);
      const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(firstFrame), images: refs.length, videos: refVideos.length, audios: audios.length });
      if (problem) throw new Error(`${model.name} ${problem}`);
    }
    if (video && !schema.slots.video) throw new Error(`${model.name} does not take a source video. Pick a video-to-video model in Settings → Operations.`);
    if (g.kind === 'image' && refVideos.length && !schema.slots.clips) throw new InputError('VIDEO_REF_UNSUPPORTED', `${model.name} does not take video references.`);
    if (g.kind === 'image' && refVideos.length < (schema.slots.clips?.min ?? 0)) throw new InputError('VIDEO_REF_REQUIRED', `${model.name} needs a reference video clip.`);
    if (kind === 'image' || kind === 'audio') {
      const problem = audioInputProblem(schema.slots, audios.length);
      if (problem) throw new InputError('AUDIO_INPUT', `${model.name} ${problem}`);
    }
    if (kind === 'audio') {
      if (refs.length || refVideos.length || firstFrame || lastFrame) throw new InputError('AUDIO_MEDIA_INPUT', `${model.name} takes no images or videos.`);
      const song = songProblem(schema, g.prompt, g.settings);
      if (song) throw new InputError(song.code, `${model.name}: ${song.message}`);
    }
    // Audio: the first track to a single-track field (lip-sync, soundtrack), the rest as references.
    const { audio, refAudios } = routeAudio(schema.slots, audios);

    // Subjects: "@Name" mentions become the provider's elements (Kling); elsewhere just the name.
    const subjects = get().sessions[g.sessionId]?.subjects ?? [];
    const elSlot = schema.slots.elements;
    const mentioned = mentionSubjects(g.prompt, subjects, elSlot?.mention);
    let prompt = mentioned.prompt;
    let elements: Array<{ name: string; description?: string; frontal?: MediaInput; refs: MediaInput[]; video?: MediaInput; voiceId?: string }> | undefined;
    if (elSlot && mentioned.ids.length) {
      if (mentioned.ids.length > elSlot.max) throw new InputError('SUBJECTS_MAX', `${model.name} takes up to ${elSlot.max} subjects; the prompt mentions ${mentioned.ids.length}.`);
      elements = [];
      for (const sid of mentioned.ids) {
        const s = subjects.find((x) => x.id === sid)!;
        const video = elSlot.video && s.videoAssetId ? await mediaInput(s.videoAssetId) : undefined;
        if (!s.frontalAssetId && !video) throw new InputError('SUBJECT_INCOMPLETE', `Subject "${s.name}" needs a frontal image${elSlot.video ? ' or a video' : ''}.`);
        elements.push({
          name: s.name,
          description: s.description,
          frontal: s.frontalAssetId ? await mediaInput(s.frontalAssetId) : undefined,
          refs: await Promise.all(s.refAssetIds.slice(0, elSlot.refMax).map((r) => mediaInput(r))),
          video,
          voiceId: s.voiceId,
        });
      }
    }
    // Multi-shot storyboard: shots must add up to the clip; some providers take shots instead of the prompt.
    const shotProblem = schema.slots.shots ? shotsProblem(g.settings.shots, g.settings.duration) : null;
    if (shotProblem) throw new InputError('SHOTS_DURATION', `${model.name}: ${shotProblem}`);
    if (schema.slots.shots?.exclusivePrompt && g.settings.shots?.length) prompt = '';

    // Structured inputs: keyframe images at frame positions, reference videos as trimmed clips.
    let genSettings = g.settings;
    let keyframes: Array<{ input: MediaInput; frame: number }> | undefined;
    let clips: Array<{ input: MediaInput; start: number; end: number }> | undefined;
    if (schema.slots.keyframes && refs.length) {
      // Positions need an explicit length (BFL): the chosen one, else the model's default, else its shortest.
      const choices = durationChoices(schema).filter((d) => d > 0);
      const def = Number(paramByRole(schema, 'duration')?.default);
      const duration = genSettings.duration != null && genSettings.duration > 0 ? genSettings.duration : Number.isFinite(def) && def > 0 ? def : choices[0] ?? 5;
      genSettings = { ...genSettings, duration };
      const frames = placeKeyframes(refs.length, duration, schema.slots.keyframes.fps, refs.map((r) => g.inputs.times?.[r.assetId]));
      keyframes = refs.map((input, i) => ({ input, frame: frames[i] }));
      refs = [];
    }
    if (schema.slots.clips && refVideos.length) {
      const slot = schema.slots.clips;
      clips = refVideos.map((input) => {
        const [start, end] = clipTrim(slot, get().assets[input.assetId]?.duration, g.inputs.trims?.[input.assetId]);
        return { input, start, end };
      });
      refVideos = [];
    }

    const total = Math.max(1, g.settings.count);
    const perRequest = Math.max(1, Math.min(total, maxCountPerRequest(schema)));
    const fallback = expectedDims(kind, g.settings);
    const assetIds: string[] = [];
    let cost = 0;
    let costKnown = true;
    let done = 0;
    while (done < total) {
      const n = Math.min(perRequest, total - done);
      const settings = { ...genSettings, seed: genSettings.seed != null ? genSettings.seed + done : undefined };
      const result = await ADAPTERS[model.provider].generate({
        kind,
        model,
        schema,
        prompt,
        settings,
        count: n,
        refs,
        refVideos,
        keyframes,
        clips,
        audio,
        refAudios,
        elements,
        mask,
        firstFrame,
        lastFrame,
        video,
        op: g.op ? { id: g.op.id, params: g.op.params } : undefined,
        apiKey,
        signal,
        onStatus: (text, progress) => patchGeneration(id, { statusText: total > 1 ? `${text} · ${done + 1}/${total}` : text, progress }),
        onRemoteJob: (job) => patchGeneration(id, { remoteJob: total === perRequest ? job : undefined }),
      });
      if (result.costUsd != null) cost += result.costUsd;
      else costKnown = false;
      if (g.kind === 'text') {
        finishText(id, result.text ?? '', result.costUsd);
        return [];
      }
      const assets = kind === 'model3d' ? await storeModelOutputs(result.outputs, g) : await Promise.all(result.outputs.slice(0, n).map((o) => storeOutput(o, g, kind, fallback)));
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
    const remoteJob = keptJob(err, cur?.remoteJob);
    if (isAbort(err) || signal.aborted) {
      patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob });
      if (cur?.assetIds.length) chargePartial(cur);
      throw new AbortedError();
    }
    patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob });
    throw err;
  }
}

/**
 * A submitted job ends only when the provider says it failed. A failed status check, the local time limit
 * or a local cancel just stop waiting: the job may still finish (and be charged), so keep it for "Check again".
 */
function keptJob(err: unknown, job: RemoteJob | undefined): RemoteJob | undefined {
  return err instanceof JobFailedError ? undefined : job;
}

/** Audio → text with the transcriber recorded on the generation. */
async function runTranscribe(g: Generation, signal: AbortSignal): Promise<void> {
  const model = get().catalog.transcribers?.[g.modelRef];
  if (!model) throw new Error(`${g.modelName} is not available. Connect NanoGPT or pick another model in Settings → Operations.`);
  const adapter = ADAPTERS[model.provider];
  const apiKey = apiKeyFor(model.provider);
  if (!adapter.transcribe || !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[model.provider]} key in Settings.`);
  const input = await mediaInput(g.op!.sourceAssetId);
  if (input.blob.size > model.maxDirectBytes) {
    const mb = (n: number) => (n / 1048576).toFixed(1);
    throw new InputError('AUDIO_TOO_LARGE', `${model.name} takes files up to ${mb(model.maxDirectBytes)} MB from the app; this one is ${mb(input.blob.size)} MB. Use a shorter or compressed (MP3) clip.`);
  }
  const result = await adapter.transcribe({
    model,
    input,
    language: String(g.op!.params.language ?? 'auto'),
    apiKey,
    signal,
    onStatus: (text) => patchGeneration(g.id, { statusText: text }),
    onRemoteJob: (job) => patchGeneration(g.id, { remoteJob: job }),
  });
  finishText(g.id, result.text ?? '', result.costUsd);
}

/** Kling custom voice (fal): 5–30 s of speech → voice_id. */
async function runCreateVoice(g: Generation, signal: AbortSignal): Promise<void> {
  const apiKey = apiKeyFor('fal');
  if (!apiKey || !ADAPTERS.fal.createVoice) throw new Error('Add your fal.ai key in Settings to create Kling voices.');
  const seconds = get().assets[g.op!.sourceAssetId]?.duration;
  if (seconds != null && (seconds < 5 || seconds > 30)) throw new InputError('VOICE_DURATION', `Kling voices need 5–30 s of speech; this clip is ${seconds.toFixed(1)} s.`);
  const result = await ADAPTERS.fal.createVoice({
    input: await mediaInput(g.op!.sourceAssetId),
    apiKey,
    signal,
    onStatus: (text) => patchGeneration(g.id, { statusText: text }),
    onRemoteJob: (job) => patchGeneration(g.id, { remoteJob: job }),
  });
  finishText(g.id, result.text ?? '', result.costUsd);
}

/** Recraft V4 style (fal): the generation's reference images → style_id. */
async function runCreateStyle(g: Generation, signal: AbortSignal): Promise<void> {
  const apiKey = apiKeyFor('fal');
  if (!apiKey || !ADAPTERS.fal.createStyle) throw new Error('Add your fal.ai key in Settings to create Recraft styles.');
  const images = g.inputs.refs.filter((r) => get().assets[r]?.kind === 'image');
  if (!images.length || images.length > 10) throw new InputError('STYLE_IMAGES', `A Recraft style needs 1–10 reference images; ${images.length} given.`);
  const result = await ADAPTERS.fal.createStyle({
    images: await Promise.all(images.map((r) => mediaInput(r))),
    apiKey,
    signal,
    onStatus: (text) => patchGeneration(g.id, { statusText: text }),
    onRemoteJob: (job) => patchGeneration(g.id, { remoteJob: job }),
  });
  finishText(g.id, result.text ?? '', result.costUsd);
}

function finishText(id: string, text: string, actualUsd: number | undefined): void {
  const g = get().generations[id];
  if (!g) return;
  patchGeneration(id, { status: 'done', text, statusText: undefined, progress: undefined, finishedAt: Date.now(), actualUsd, remoteJob: undefined });
  addSpend(actualUsd ?? g.estimate.usd ?? 0);
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
    if (!job || !ADAPTERS[job.provider]?.resume || !isConnected(job.provider)) {
      const error = job ? `Interrupted by a page reload. Connect ${PROVIDER_LABELS[job.provider]} and use Check again.` : 'Interrupted by a page reload. Regenerate to try again.';
      patchGeneration(g.id, { status: 'error', error, statusText: undefined, finishedAt: Date.now() });
      continue;
    }
    patchGeneration(g.id, { statusText: 'Resuming' });
    followRemote(g.id, job);
  }
}

/** True when a stopped generation still has a submitted job whose result can be fetched. */
export function canRecheck(g: Generation): boolean {
  return Boolean(g.remoteJob && ADAPTERS[g.remoteJob.provider]?.resume && g.status !== 'running' && g.status !== 'queued' && g.status !== 'done');
}

/** Ask the provider again about a job we stopped waiting for (connection problem, time limit, cancel, reload). */
export function recheckGeneration(id: string): Promise<string[]> {
  const pending = running.get(id);
  if (pending) return pending;
  const g = get().generations[id];
  const job = g?.remoteJob;
  if (!g || !job || !canRecheck(g)) return Promise.resolve([]);
  if (!isConnected(job.provider)) {
    patchGeneration(id, { status: 'error', error: `Connect ${PROVIDER_LABELS[job.provider]} in Settings to check this job.` });
    return Promise.resolve([]);
  }
  patchGeneration(id, { status: 'running', error: undefined, statusText: 'Checking', progress: undefined, finishedAt: undefined });
  return followRemote(id, job);
}

function followRemote(id: string, job: RemoteJob): Promise<string[]> {
  const controller = new AbortController();
  controllers.set(id, controller);
  const p = (async () => {
    try {
      const g = get().generations[id];
      const result = await ADAPTERS[job.provider].resume!(job, {
        kind: g.kind,
        apiKey: apiKeyFor(job.provider),
        signal: controller.signal,
        onStatus: (text, progress) => patchGeneration(id, { statusText: text, progress }),
      });
      if (g.kind === 'text') {
        finishText(id, result.text ?? '', result.costUsd);
        return [];
      }
      const kind = g.kind;
      const fallback = expectedDims(kind, g.settings);
      const assets = kind === 'model3d' ? await storeModelOutputs(result.outputs, g) : await Promise.all(result.outputs.map((o) => storeOutput(o, g, kind, fallback)));
      addAssets(assets);
      finish(id, assets.map((a) => a.id), result.costUsd);
      return assets.map((a) => a.id);
    } catch (err) {
      const remoteJob = keptJob(err, job);
      if (isAbort(err)) patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob });
      else patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob });
      return [];
    } finally {
      running.delete(id);
      controllers.delete(id);
    }
  })();
  running.set(id, p);
  return p;
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
  if (def.engine === 'local') {
    const detail = input.op === 'extract_frame' ? (input.params.which === 'time' ? `${input.params.seconds}s` : input.params.which) : `${input.params.grid}×${input.params.grid}`;
    return { ...base, kind: 'image', prompt: `${def.label} (${detail})`, modelRef: 'local::frame', settings: { count: opCount(def, input.params), advanced: {} }, op, estimate: { usd: 0, approximate: false } };
  }
  if (def.engine === 'voice') {
    if (!isConnected('fal')) throw new Error('Creating Kling voices needs fal.ai. Connect it in Settings.');
    return { ...base, kind: 'text', prompt: 'Create Kling voice', modelRef: KLING_VOICE_REF, settings: { count: 1, advanced: {} }, op, estimate: { usd: null, approximate: true, note: 'fal bills the voice when it is created' } };
  }
  if (def.engine === 'transcribe') {
    const t = transcriberFor();
    if (!t) throw new Error('No connected provider offers Transcribe. Connect NanoGPT.');
    const clip = get().assets[input.sourceAssetId];
    const language = String(input.params.language ?? 'auto');
    return { ...base, kind: 'text', prompt: `Transcribe (${language === 'auto' ? 'detect language' : language})`, modelRef: t.ref, settings: { count: 1, advanced: {} }, op, estimate: estimateTranscribe(t.usdPerMinute, clip?.duration) };
  }
  const choice = opModelFor(def.engine);
  if (!choice.ref) throw new Error(`No connected provider offers “${def.label}”. Connect Atlas Cloud, NanoGPT or fal.ai.`);
  const resolved = await resolveModel(choice.ref);
  const schema = resolved?.schema;
  if (def.engine === 'video_upscale' || def.engine === 'video_edit' || def.engine === 'video_extend') {
    const { settings } = coerceSettings(schema, 'video', { count: 1, advanced: {} });
    const extend = def.engine === 'video_extend';
    // Keep the source's framing: the model's "auto"/"adaptive" option, else nothing.
    const auto = paramByRole(schema, 'aspect')?.options?.find(isAutoOption);
    settings.aspect = auto != null ? String(auto) : undefined;
    if (!extend) {
      // Edits follow the source's length: -1 where the model has it (Seedance 2.5 edit requires it), else nothing.
      settings.duration = durationChoices(schema).includes(-1) ? -1 : undefined;
      settings.audio = undefined;
    }
    // Multi-mode models (NanoGPT Seedance 2.5) need the operation named when a clip is given.
    const mode = schema?.params.find((p) => p.key === 'mode' && p.options?.some((o) => String(o) === (extend ? 'video-extend' : 'video-edit')));
    if (mode && def.engine !== 'video_upscale') settings.advanced[mode.key] = extend ? 'video-extend' : 'video-edit';
    const spec: GenerationSpec = { ...base, kind: 'video', prompt: def.engine === 'video_upscale' ? '' : prompt, modelRef: choice.ref, settings, op };
    const clip = get().assets[input.sourceAssetId];
    // Per-second prices: an edit or upscale is billed on the clip, an extension on the new seconds.
    const seconds = extend ? settings.duration : clip?.duration;
    return { ...spec, estimate: estimateOp(input.op, input.params, source, { ...settings, duration: seconds }) };
  }
  if (def.engine === 'video') {
    const video = get().composer.video.settings;
    const { settings } = coerceSettings(schema, 'video', { ...video, count: 1, advanced: {} });
    if (source && paramByRole(schema, 'aspect')?.options) {
      const opts = paramByRole(schema, 'aspect')!.options!;
      const auto = opts.find(isAutoOption);
      settings.aspect = auto != null ? String(auto) : nearestAspect(opts, source.width / source.height, settings.aspect) ?? settings.aspect;
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
    const auto = aspectParam.options.find(isAutoOption);
    settings.aspect = input.op !== 'reframe' && auto != null ? String(auto) : nearestAspect(aspectParam.options, target, settings.aspect) ?? settings.aspect;
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

export function inputKindOf(assetId: string): AssetKind | undefined {
  return get().assets[assetId]?.kind;
}
