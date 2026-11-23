/* Single payload builder for approval fingerprinting and provider transport (model, final params, all asset slots). */
import { maskToAlpha } from '../lib/media';
import { assetRevisionIdentity } from './assetRevisions';
import { RECRAFT_STYLE_REF, sentModelRef } from './catalog';
import { InputError } from './errors';
import { model3dProblem, sourceVideoRule } from './modelRules';
import { buildDryRequest, dryMedia, stable } from './money/transport';
import { refsLimit } from './officialLimits';
import { syncOpSpec, type OpSpecInput } from './opSpec';
import { OPS, isVideoOpEngine } from './ops';
import {
  audioInputProblem, clipTrim, durationChoices, lyricsBody, lyricsParam, maxCountPerRequest, mentionSubjects,
  paramByRole, placeKeyframes, routeAudio, routeVideoInputs, shotsProblem, songProblem, videoInputProblem,
} from './params';
import { parseRef } from './planRef';
import { parseModelRef, type MediaInput } from './providers/types';
import { negFor, opRealism } from './realism';
import { withVariation } from './sentPrompt';
import { mapSubjectPrompts } from './subjectPrompts';
import type { AdvancedValue, Asset, GenSettings, Generation, MediaKind, ModelSchema, ModelSummary, OpId, PlanStep, Subject, TranscriberSummary } from './types';
import { useStore } from '../store/store';
import { mediaInput, frameInput } from './assetIO';

export { stable };
const get = useStore.getState;

export type SendSpec = Pick<Generation, 'kind' | 'modelRef' | 'prompt' | 'settings' | 'inputs' | 'op' | 'variants'>;
export type SendState = { assets: Record<string, Asset>; library: Subject[]; catalog: { models: Record<string, ModelSummary>; schemas: Record<string, ModelSchema>; transcribers?: Record<string, TranscriberSummary> } };

export interface SendSlots {
  refs: string[]; refVideos: string[]; audios: string[]; refAudios: string[];
  firstFrame?: string; firstFrameFromLast?: boolean; lastFrame?: string; video?: string; mask?: string; audio?: string;
  elements?: Array<{ name: string; description?: string; frontal?: string; refs: string[]; video?: string; voiceId?: string }>;
  keyframes?: Array<{ assetId: string; frame: number }>;
  clips?: Array<{ assetId: string; start: number; end: number }>;
}

export interface ResolvedSendPlan {
  kind: MediaKind | 'text'; modelRef: string; prompt: string; settings: GenSettings;
  op?: { id: OpId; params: Record<string, AdvancedValue> }; variants?: string[]; slots: SendSlots; assetIds: string[];
}

const collectAssets = (s: SendSlots, assets: Record<string, Asset>) => [...new Set([
  ...s.refs, ...s.refVideos, ...s.audios, ...s.refAudios, s.firstFrame, s.lastFrame, s.video, s.mask, s.audio,
  ...(s.elements ?? []).flatMap((e) => [e.frontal, ...e.refs, e.video]),
  ...(s.keyframes ?? []).map((k) => k.assetId), ...(s.clips ?? []).map((c) => c.assetId),
].filter((id): id is string => Boolean(id && assets[id])))].sort();

function buildPlan(spec: SendSpec, state: SendState = get(), over?: { model?: ModelSummary; schema?: ModelSchema; kind?: MediaKind }) {
  const { assets, catalog } = state;
  const slots: SendSlots = { refs: [], refVideos: [], audios: [], refAudios: [] };
  const opMeta = spec.op ? { id: spec.op.id, params: spec.op.params } : undefined;
  const finish = (kind: MediaKind | 'text', modelRef: string, prompt: string, settings: GenSettings) => ({
    plan: { kind, modelRef, prompt, settings, op: opMeta, variants: spec.variants, slots, assetIds: collectAssets(slots, assets) } as ResolvedSendPlan,
    rawImages: 0, preRefs: 0, preVideos: 0, subjects: [] as Subject[], mapped: undefined as ReturnType<typeof mapSubjectPrompts> | undefined,
  });

  if (spec.op && OPS[spec.op.id].engine === 'local') {
    if (spec.op.sourceAssetId) slots.refs.push(spec.op.sourceAssetId);
    if (spec.op.id === 'join_clips') {
      slots.refVideos.push(...String(spec.op.params.clips ?? '').split(',').filter(Boolean));
      if (String(spec.op.params.music ?? '')) slots.audio = String(spec.op.params.music);
    }
    return finish(spec.kind, spec.modelRef, spec.prompt, spec.settings);
  }
  if (spec.op && ['transcribe', 'voice'].includes(OPS[spec.op.id].engine)) {
    if (spec.op.sourceAssetId) slots.audio = spec.op.sourceAssetId;
    return finish(spec.kind, spec.modelRef, spec.prompt, spec.settings);
  }
  if (spec.kind === 'text' && spec.modelRef === RECRAFT_STYLE_REF) {
    slots.refs = spec.inputs.refs.filter((r) => !assets[r] || assets[r].kind === 'image');
    return finish(spec.kind, spec.modelRef, spec.prompt, spec.settings);
  }

  const modelRef = (spec.kind === 'image' || spec.kind === 'video') && !spec.op && (spec.inputs.refs.length || spec.inputs.firstFrame)
    ? sentModelRef(spec.modelRef, spec.kind, true) : spec.modelRef;
  const model = over?.model ?? catalog.models[modelRef], schema = over?.schema ?? catalog.schemas[modelRef];
  const kind: MediaKind | 'text' = over?.kind ?? (spec.kind === 'text' && model ? model.kind : spec.kind);

  if (spec.op) {
    const def = OPS[spec.op.id];
    if (isVideoOpEngine(def.engine)) {
      if (spec.op.sourceAssetId) slots.video = spec.op.sourceAssetId;
      if (schema && !schema.slots.video && (schema.slots.refVideos || schema.slots.mixedRefs) && slots.video) { slots.refVideos = [slots.video]; slots.video = undefined; }
    } else if (def.engine === 'video') {
      if (spec.op.sourceAssetId) slots.firstFrame = spec.op.sourceAssetId;
      if (spec.op.id === 'continue') slots.firstFrameFromLast = true;
    } else {
      if (spec.op.sourceAssetId) slots.refs.push(spec.op.sourceAssetId);
      slots.refs.push(...String(spec.op.params._refs ?? '').split(',').filter(Boolean));
    }
    if (spec.inputs.lastFrame) slots.lastFrame = spec.inputs.lastFrame;
    if ((def.engine === 'inpaint' || def.engine === 'remove_object') && String(spec.op.params.mask ?? '')) slots.mask = String(spec.op.params.mask);
  } else {
    for (const r of spec.inputs.refs) (assets[r]?.kind === 'video' ? slots.refVideos : assets[r]?.kind === 'audio' ? slots.audios : slots.refs).push(r);
    slots.firstFrame = spec.inputs.firstFrame;
    slots.lastFrame = spec.inputs.lastFrame;
  }

  if (schema && spec.kind === 'video' && !slots.video && !(spec.op && slots.refVideos.length)) {
    ({ firstFrame: slots.firstFrame, images: slots.refs, videos: slots.refVideos } = routeVideoInputs(schema.slots, slots.refs, slots.refVideos, slots.firstFrame));
  }
  if (schema) ({ audio: slots.audio, refAudios: slots.refAudios } = routeAudio(schema.slots, slots.audios));
  const rawImages = slots.refs.length;

  const local = spec.inputs.subjects ?? [];
  const subjects = [...local, ...(spec.inputs.nodeLibrary ?? state.library).filter((x) => !local.some((l) => l.name.toLowerCase() === x.name.toLowerCase()))];
  let prompt = spec.prompt, genSettings = spec.settings;
  let mapped: ReturnType<typeof mapSubjectPrompts> | undefined;
  if (schema && model) {
    mapped = mapSubjectPrompts(spec.prompt, spec.settings.shots, subjects, schema, model.id, slots.refs.length);
    prompt = mapped.prompt;
    if (mapped.shots) genSettings = { ...genSettings, shots: mapped.shots };
    const el = schema.slots.elements;
    if (el && mapped.ids.length) {
      slots.elements = mapped.ids.map((sid) => {
        const s = subjects.find((x) => x.id === sid)!;
        return { name: s.name, description: s.description, frontal: s.frontalAssetId, refs: s.refAssetIds.slice(0, el.refMax), video: el.video ? s.videoAssetId : undefined, voiceId: s.voiceId };
      });
    } else if (mapped.subjectImages && mapped.ids.length) {
      const chosen = mapped.ids.map((id) => subjects.find((x) => x.id === id)!);
      const room = Math.max(0, refsLimit(schema, spec.settings.count) - (schema.slots.mixedRefs ? slots.refs.length + slots.refVideos.length + slots.refAudios.length : slots.refs.length));
      slots.refs = [...slots.refs, ...chosen.map((s) => s.frontalAssetId).filter((id): id is string => Boolean(id)), ...chosen.flatMap((s) => s.refAssetIds).slice(0, Math.max(0, room - chosen.length))];
    }
  } else {
    const ids = mentionSubjects([spec.prompt, ...(spec.settings.shots ?? []).map((s) => s.prompt)].join('\n'), subjects).ids;
    if (ids.length) slots.elements = ids.map((sid) => { const s = subjects.find((x) => x.id === sid)!; return { name: s.name, description: s.description, frontal: s.frontalAssetId, refs: [...s.refAssetIds], video: s.videoAssetId, voiceId: s.voiceId }; });
  }

  const preRefs = slots.refs.length, preVideos = slots.refVideos.length;
  if (schema?.slots.shots?.exclusivePrompt && spec.settings.shots?.length) prompt = '';
  if (schema?.slots.keyframes && slots.refs.length) {
    const def = Number(paramByRole(schema, 'duration')?.default);
    const duration = genSettings.duration != null && genSettings.duration > 0 ? genSettings.duration : Number.isFinite(def) && def > 0 ? def : durationChoices(schema).find((d) => d > 0) ?? 5;
    genSettings = { ...genSettings, duration };
    const frames = placeKeyframes(slots.refs.length, duration, schema.slots.keyframes.fps, slots.refs.map((id) => spec.inputs.times?.[id]));
    slots.keyframes = slots.refs.map((assetId, i) => ({ assetId, frame: frames[i] }));
    slots.refs = [];
  }
  if (schema?.slots.clips && slots.refVideos.length) {
    slots.clips = slots.refVideos.map((assetId) => { const [start, end] = clipTrim(schema.slots.clips!, assets[assetId]?.duration, spec.inputs.trims?.[assetId]); return { assetId, start, end }; });
    slots.refVideos = [];
  }
  if (model && schema && kind !== 'text') {
    const shown = opRealism(spec, kind, prompt, model.id);
    genSettings = negFor(genSettings, shown !== prompt && paramByRole(schema, 'negative'));
    prompt = shown;
  }
  return { plan: { kind, modelRef, prompt, settings: genSettings, op: opMeta, variants: spec.variants, slots, assetIds: collectAssets(slots, assets) } as ResolvedSendPlan, rawImages, preRefs, preVideos, subjects, mapped };
}

export const resolveSendPlan = (spec: SendSpec, state: SendState = get(), over?: { model?: ModelSummary; schema?: ModelSchema; kind?: MediaKind }): ResolvedSendPlan =>
  buildPlan(spec, state, over).plan;

export function applyLyricsSettings(settings: GenSettings, text: string, schema: ModelSchema | undefined): { settings: GenSettings; key?: string } {
  const key = lyricsParam(schema)?.key;
  return key ? { key, settings: { ...settings, extras: { ...settings.extras, [key]: lyricsBody(text) } } } : { settings };
}

export function sendFingerprint(plan: ResolvedSendPlan, state: Pick<SendState, 'assets' | 'catalog'> = get(), opts: { ignoreSeed?: boolean } = {}): string {
  const source = { ...plan.settings, ...(opts.ignoreSeed ? { seed: undefined } : {}) }, engine = plan.op ? OPS[plan.op.id].engine : undefined;
  const fallback = () => stable([{ url: `model://${plan.modelRef}`, body: { kind: plan.kind, modelRef: plan.modelRef, prompt: plan.prompt, settings: source, op: plan.op, variants: plan.variants, slots: plan.slots, assets: plan.assetIds.map((id) => [id, assetRevisionIdentity(state.assets[id])]) } }]);
  const one = (p: Parameters<typeof buildDryRequest>[0] | undefined, req: Parameters<typeof buildDryRequest>[1]) => { const b = p ? buildDryRequest(p, req, state.assets, opts) : null; return b ? stable([b]) : fallback(); };
  if (engine === 'local') return fallback();
  if (engine === 'transcribe') {
    const model = state.catalog.transcribers?.[plan.modelRef];
    return model ? one(model.provider, { method: 'transcribe', input: { model, input: dryMedia(plan.slots.audio ?? ''), language: String(plan.op!.params.language ?? 'auto') } }) : fallback();
  }
  if (engine === 'voice') return one(parseModelRef(plan.modelRef)?.provider, { method: 'createVoice', input: { input: dryMedia(plan.slots.audio ?? '') } });
  if (plan.kind === 'text' && plan.modelRef === RECRAFT_STYLE_REF) return one(parseModelRef(plan.modelRef)?.provider, { method: 'createStyle', input: { images: plan.slots.refs.map(dryMedia) } });
  const model = state.catalog.models[plan.modelRef], schema = state.catalog.schemas[plan.modelRef];
  if (!model || !schema) return fallback();
  const kind: MediaKind = plan.kind === 'text' ? model.kind : plan.kind, variants = plan.variants?.length ? plan.variants : undefined;
  const total = variants ? variants.length : Math.max(0, plan.settings.count), perRequest = variants ? 1 : Math.max(1, Math.min(total || 1, maxCountPerRequest(schema)));
  const s = plan.slots, dryInputs = {
    refs: s.refs.map(dryMedia), refVideos: s.refVideos.map(dryMedia), refAudios: s.refAudios.map(dryMedia),
    firstFrame: s.firstFrame ? dryMedia(s.firstFrame) : undefined, lastFrame: s.lastFrame ? dryMedia(s.lastFrame) : undefined,
    video: s.video ? dryMedia(s.video) : undefined, audio: s.audio ? dryMedia(s.audio) : undefined, mask: s.mask ? dryMedia(s.mask) : undefined,
    elements: s.elements?.map((e) => ({ ...e, frontal: e.frontal ? dryMedia(e.frontal) : undefined, refs: e.refs.map(dryMedia), video: e.video ? dryMedia(e.video) : undefined })),
    keyframes: s.keyframes?.map((k) => ({ input: dryMedia(k.assetId), frame: k.frame })), clips: s.clips?.map((c) => ({ input: dryMedia(c.assetId), start: c.start, end: c.end })),
  };
  const requests = [];
  for (let done = 0; done < total;) {
    const n = Math.min(perRequest, total - done), settings = { ...source, seed: source.seed != null ? source.seed + done : undefined };
    const built = buildDryRequest(model.provider, { method: 'generate', input: { kind, model, schema, prompt: withVariation(plan.prompt, variants?.[done]), settings, count: n, ...dryInputs, op: plan.op } }, state.assets, opts);
    if (!built) return fallback();
    requests.push(built);
    done += n;
  }
  return stable(requests);
}

/** Build the dry-run SendSpec for a PlanStep using the same opSpec/lyrics rules as execution. */
export function stepSendSpec(s: PlanStep, steps: readonly PlanStep[], nodeOperations?: Record<string, OpSpecInput['nodeChoice']>, state: SendState = get()): { spec?: SendSpec; dynamic: boolean } {
  if (s.kind === 'text' || s.kind === 'layer') return { dynamic: false };
  const textById = new Map(steps.filter((x) => x.kind === 'text').map((x) => [x.id, x.text]));
  let dynamic = false;
  const take = (ref: string | undefined) => { if (!ref) return undefined; const p = parseRef(ref); if (p?.type === 'asset') return p.id; dynamic = true; return `step:${ref}`; };
  const textOf = (ref: string | undefined) => { const p = ref ? parseRef(ref) : null; const t = p?.type === 'step' ? textById.get(p.id) : undefined; if (ref && t == null) dynamic = true; return t; };
  const promptFor = (step: { prompt: string; promptFrom?: string }) => step.promptFrom ? [(textOf(step.promptFrom) ?? `step:${step.promptFrom}`).trim(), step.prompt.trim()].filter(Boolean).join('\n') : step.prompt;
  const subjects: Subject[] = (s.nodeSubjects ?? []).map((b) => ({ id: b.name, name: b.name, description: b.description ?? '', kind: b.kind ?? 'character', frontalAssetId: take(b.from), refAssetIds: [] }));
  const inputsBase = { ...(subjects.length ? { subjects } : {}), nodeLibrary: state.library };
  if (s.kind === 'op') {
    const source = take(s.input) ?? '';
    let params = s.params;
    if (s.more?.length) params = { ...params, clips: s.more.map((r) => take(r) ?? '').join(','), ...(typeof params.music === 'string' && params.music ? { music: take(params.music) ?? '' } : {}) };
    if (s.refs?.length) { const got = s.refs.map((r) => ({ asset: take(r.ref) ?? '', role: r.role, note: r.note })); params = { ...params, _refs: got.map((x) => x.asset).join(','), _refRoles: JSON.stringify(got) }; }
    const p = parseRef(s.input), upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
    const built = syncOpSpec(
      { sessionId: '', origin: 'node', op: s.op, params, sourceAssetId: source, nodeChoice: nodeOperations?.[s.id] },
      { sourceForChoice: dynamic ? '' : source, upstreamModelRef: upstream && 'modelRef' in upstream ? upstream.modelRef : undefined },
    );
    return { spec: built ? { ...built, inputs: built.inputs ?? { refs: [] } } : { kind: 'image', prompt: OPS[s.op].label, modelRef: '', settings: { count: 1, advanced: {} }, inputs: { refs: [] }, op: { id: s.op, params, sourceAssetId: source } }, dynamic };
  }
  if (s.kind === 'audio') {
    let settings = s.settings;
    if (s.lyricsFrom) {
      const text = textOf(s.lyricsFrom);
      const applied = applyLyricsSettings(settings, text ?? `step:${s.lyricsFrom}`, state.catalog.schemas[s.modelRef]);
      if (!applied.key) dynamic = true;
      settings = applied.settings;
    }
    return { spec: { kind: s.textOutput ? 'text' : 'audio', prompt: promptFor(s), modelRef: s.modelRef, settings, inputs: { refs: [], ...inputsBase } }, dynamic };
  }
  if (s.kind === 'video') {
    const refs = (s.refs ?? []).map((r) => take(r) ?? '');
    const times = Object.fromEntries(refs.flatMap((a, i) => (s.times?.[i] != null ? [[a, s.times[i]]] : [])));
    return { spec: { kind: 'video', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs, firstFrame: take(s.firstFrame), lastFrame: take(s.lastFrame), ...(Object.keys(times).length ? { times } : {}), ...inputsBase } }, dynamic };
  }
  return { spec: { kind: s.kind, prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs: s.refs.map((r) => take(r) ?? ''), ...inputsBase }, ...(s.kind === 'image' && s.variations?.length ? { variants: s.variations } : {}) }, dynamic };
}

/** Validate and load blobs strictly from the exact asset IDs resolved by `resolveSendPlan`. */
export async function materializeSendInputs(g: Generation, model: ModelSummary, schema: ModelSchema, kind: MediaKind) {
  const state = get();
  const { plan, rawImages, preRefs, preVideos, subjects, mapped } = buildPlan(g, state, { model, schema, kind });
  const cache = new Map<string, Promise<MediaInput>>();
  const load = (id: string, last = false) => cache.get(`${last}:${id}`) ?? (cache.set(`${last}:${id}`, last ? frameInput(id, 'last') : mediaInput(id)), cache.get(`${last}:${id}`)!);

  if (g.op) {
    const def = OPS[g.op.id];
    if (isVideoOpEngine(def.engine)) {
      const range = def.engine === 'video_edit' ? sourceVideoRule(model.id)?.seconds.edit : def.engine === 'video_extend' ? sourceVideoRule(model.id)?.seconds.extend : undefined;
      const seconds = state.assets[g.op.sourceAssetId]?.duration;
      if (range && seconds != null && (seconds < range[0] || seconds > range[1])) throw new InputError('VIDEO_DURATION', `${model.name} takes clips of ${range[0]}–${range[1]} s for this; this one is ${seconds.toFixed(1)} s.`);
    }
    if (def.engine === 'inpaint' || def.engine === 'remove_object') {
      const maskAsset = state.assets[plan.slots.mask ?? ''], src = state.assets[g.op.sourceAssetId];
      if (!maskAsset) throw new InputError('MASK_MISSING', `${def.label} needs a mask: paint the area in Sketch.`);
      if (!schema.slots.mask) throw new InputError('MASK_UNSUPPORTED', `${model.name} cannot take a mask. Pick a model for ${def.label} in Settings → Operations.`);
      if (src && (maskAsset.width !== src.width || maskAsset.height !== src.height)) throw new InputError('MASK_SIZE', `The mask is ${maskAsset.width}×${maskAsset.height} but the image is ${src.width}×${src.height}.`);
    }
  }
  if (g.kind === 'image' && (schema.slots.images?.min ?? 0) + (schema.slots.source ? 1 : 0) > rawImages) throw new Error(`${model.name} needs ${schema.slots.source ? 'a source image plus reference images' : 'an input image'}.`);
  if (kind === 'model3d') {
    if (preVideos || plan.slots.audios.length || plan.slots.firstFrame || plan.slots.lastFrame) throw new InputError('MODEL3D_MEDIA_INPUT', `${model.name} takes only images.`);
    if (preRefs && !schema.slots.images) throw new InputError('MODEL3D_NO_IMAGE_INPUT', `${model.name} takes text only.`);
  }
  if (g.kind === 'image' && rawImages && !schema.slots.images) throw new Error(`${model.name} does not accept input images.`);
  if (g.kind === 'video' && !plan.slots.video && !(g.op && preVideos)) {
    const p = videoInputProblem(schema.slots, { firstFrame: Boolean(plan.slots.firstFrame), lastFrame: Boolean(plan.slots.lastFrame), sourceVideo: Boolean(plan.slots.video), images: rawImages, videos: preVideos, audios: plan.slots.audios.length, resolution: g.settings.resolution });
    if (p) throw new Error(`${model.name} ${p}`);
  }
  if (plan.slots.video && !schema.slots.video) throw new Error(`${model.name} does not take a source video. Pick a video-to-video model in Settings → Operations.`);
  if (g.kind === 'image' && preVideos && !schema.slots.clips) throw new InputError('VIDEO_REF_UNSUPPORTED', `${model.name} does not take video references.`);
  if (g.kind === 'image' && preVideos < (schema.slots.clips?.min ?? 0)) throw new InputError('VIDEO_REF_REQUIRED', `${model.name} needs a reference video clip.`);
  if (kind === 'image' || kind === 'audio') { const p = audioInputProblem(schema.slots, plan.slots.audios.length); if (p) throw new InputError('AUDIO_INPUT', `${model.name} ${p}`); }
  if (kind === 'audio') {
    if (preRefs || preVideos || plan.slots.firstFrame || plan.slots.lastFrame) throw new InputError('AUDIO_MEDIA_INPUT', `${model.name} takes no images or videos.`);
    const song = songProblem(schema, g.prompt, g.settings);
    if (song) throw new InputError(song.code, `${model.name}: ${song.message}`);
  }
  if (schema.slots.elements && mapped?.ids.length) {
    if (mapped.ids.length > schema.slots.elements.max) throw new InputError('SUBJECTS_MAX', `${model.name} takes up to ${schema.slots.elements.max} subjects; the prompt mentions ${mapped.ids.length}.`);
    for (const sid of mapped.ids) { const s = subjects.find((x) => x.id === sid)!; if (!s.frontalAssetId && !(schema.slots.elements.video && s.videoAssetId)) throw new InputError('SUBJECT_INCOMPLETE', `Subject "${s.name}" needs a frontal image${schema.slots.elements.video ? ' or a video' : ''}.`); }
  } else if (mapped?.subjectImages && mapped.ids.length) {
    const chosen = mapped.ids.map((id) => subjects.find((x) => x.id === id)!);
    const inc = chosen.find((s) => !s.frontalAssetId);
    if (inc) throw new InputError('SUBJECT_INCOMPLETE', `Subject "${inc.name}" needs a frontal image to be used with ${model.name}.`);
    const used = schema.slots.mixedRefs ? rawImages + preVideos + plan.slots.refAudios.length : rawImages, max = refsLimit(schema, g.settings.count);
    if (chosen.length > max - used) throw new InputError('SUBJECTS_MAX', `${model.name} takes ${max} reference image${max === 1 ? '' : 's'}; the step already has ${used}, so ${chosen.length} subject${chosen.length === 1 ? '' : 's'} do not fit.`);
  }
  if (kind === 'video' && schema.slots.frameRules) {
    const p = videoInputProblem(schema.slots, { firstFrame: Boolean(plan.slots.firstFrame), lastFrame: Boolean(plan.slots.lastFrame), sourceVideo: Boolean(plan.slots.video), images: preRefs, videos: preVideos, audios: plan.slots.audios.length, resolution: g.settings.resolution });
    if (p) throw new Error(`${model.name} ${p}`);
  }
  if (schema.slots.promptMax && (mapped?.prompt.length ?? 0) > schema.slots.promptMax) throw new InputError('PROMPT_TOO_LONG', `${model.name} takes prompts up to ${schema.slots.promptMax} characters (this one has ${mapped!.prompt.length}).`);
  const shotP = schema.slots.shots ? shotsProblem(g.settings.shots, g.settings.duration) : null;
  if (shotP) throw new InputError('SHOTS_DURATION', `${model.name}: ${shotP}`);
  void (schema.slots.shots?.exclusivePrompt && g.settings.shots?.length);

  const [refs, refVideos, refAudios, firstFrame, lastFrame, video, audio] = await Promise.all([
    Promise.all(plan.slots.refs.map((id) => load(id))), Promise.all(plan.slots.refVideos.map((id) => load(id))), Promise.all(plan.slots.refAudios.map((id) => load(id))),
    plan.slots.firstFrame ? load(plan.slots.firstFrame, Boolean(plan.slots.firstFrameFromLast)) : undefined,
    plan.slots.lastFrame ? load(plan.slots.lastFrame) : undefined, plan.slots.video ? load(plan.slots.video) : undefined, plan.slots.audio ? load(plan.slots.audio) : undefined,
  ]);
  const rawMask = plan.slots.mask ? await load(plan.slots.mask) : undefined;
  const mask = rawMask && schema.slots.mask?.convention === 'alpha' ? { ...rawMask, blob: await maskToAlpha(rawMask.blob), mime: 'image/png' } : rawMask;
  const elements = plan.slots.elements ? await Promise.all(plan.slots.elements.map(async (e) => ({ name: e.name, description: e.description, voiceId: e.voiceId, frontal: e.frontal ? await load(e.frontal) : undefined, refs: await Promise.all(e.refs.map((id) => load(id))), video: e.video ? await load(e.video) : undefined }))) : undefined;
  const keyframes = plan.slots.keyframes ? await Promise.all(plan.slots.keyframes.map(async (k) => ({ input: await load(k.assetId), frame: k.frame }))) : undefined;
  const clips = plan.slots.clips ? await Promise.all(plan.slots.clips.map(async (c) => ({ input: await load(c.assetId), start: c.start, end: c.end }))) : undefined;
  if (kind === 'model3d') {
    const p = model3dProblem(model.id, model, g.prompt, refs.map((r) => ({ size: r.blob.size, width: r.width, height: r.height })));
    if (p) throw new InputError(p.code, `${model.name} ${p.message}`);
  }
  return { plan, prompt: plan.prompt, genSettings: plan.settings, refs, refVideos, keyframes, clips, audio, refAudios, elements, mask, firstFrame, lastFrame, video };
}
