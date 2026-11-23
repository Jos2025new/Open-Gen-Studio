/* Operation specs: the generation an operation on an asset sends (moved out of jobs.ts, Opus #4). */
import { reusedOpChoice, transcriberForRun } from './opRunModel';
import { fxOpDetail } from './fx/op';
import { KLING_VOICE_PROVIDER, PICKABLE_VIDEO_OPS, videoOpFits, modelSummary, isConnected, KLING_VOICE_REF, opFollowsSource, opModelFor, opModelForAsset, opModelFromRef, resolveModel } from './catalog';
import { estimateOp, estimateTranscribe } from './costs';
import { OPS, opCount, isVideoOpEngine, type VideoOpEngine } from './ops';
import { coerceSettings, durationChoices, isAutoOption, matchInputOption, preferredResolution, nearestAspect, paramByRole } from './params';
import { operationProviderLabels, preferredProviderLabel } from './providers/registry';
import { PROVIDER_LABELS } from './providers/types';
import { opRolesLine } from './refRoles';
import type { AdvancedValue, GenSettings, Generation, GenerationOrigin, ModelSchema, OpId } from './types';
import { useStore } from '../store/store';

const get = useStore.getState;

import type { GenerationSpec } from './jobState';

export interface OpSpecInput {
  sessionId: string;
  sourceAssetId: string;
  op: OpId;
  params: Record<string, AdvancedValue>;
  origin: GenerationOrigin;
  place?: Generation['place'];
  mode?: Generation['mode'];
  parentId?: string;
  planId?: string;
  stepId?: string;
  batchToken?: symbol;
  /** Dimensions of the source when it is not an asset yet (designer layers). */
  sourceDims?: { width: number; height: number };
  /** Model picked for this run (replay, edit / video / transcribe engines); by default the source's model or the engine's. */
  modelRef?: string;
  /** Model and composer settings reviewed by the Node Run confirmation. */
  nodeChoice?: { ref: string; viaEdit: boolean; settings?: GenSettings };
}

/** Build the generation spec for an operation on an asset (model, instruction and settings). */
/** Settings a video operation runs with: the source's framing and, for edits and upscales, its length. */
export function videoOpSettings(engine: VideoOpEngine, schema: ModelSchema | undefined, params: Record<string, AdvancedValue> = {}): GenSettings {
  const { settings } = coerceSettings(schema, 'video', { count: 1, advanced: {} });
  const extend = engine === 'video_extend';
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
  if (mode && engine !== 'video_upscale') settings.advanced[mode.key] = extend ? 'video-extend' : 'video-edit';
  {
    for (const p of schema?.params ?? []) {
      const value = params[p.key];
      if (value === undefined || ['count', 'duration', 'aspect', 'audio', 'negative'].includes(p.role)) continue;
      if (p.role === 'other') settings.advanced[p.key] = value;
      else if (p.role === 'resolution') settings.resolution = String(value);
      else if (p.role === 'seed' && typeof value === 'number') settings.seed = value;
    }
  }
  return settings;
}

/** Per-second prices: an edit or upscale is billed on the source clip, an extension on the new seconds. */
export function videoOpSeconds(engine: VideoOpEngine, settings: GenSettings, clipSeconds: number | undefined): number | undefined {
  return engine === 'video_extend' ? settings.duration : clipSeconds;
}

export type OpChoiceInput = Pick<OpSpecInput, 'op' | 'params' | 'sourceAssetId' | 'nodeChoice' | 'modelRef' | 'parentId'> & {
  /** The model of the step that makes the source, while the source is a clip still to be made. */
  upstreamModelRef?: string;
};

/**
 * The one choice of the model an operation runs with, asked by the send (opSpec), the estimate (executor) and the
 * Nodes preview (flow/actions), so the approved price is the sent one. In order: the model picked in the op form
 * (`pinned`: the send checks it fits), the node's reviewed choice, the one the plan carries, a replay of the original
 * run, the model that made the source (or the step that will), then the Settings model of the engine.
 */
export function opChoice(input: OpChoiceInput): { ref: string; viaEdit: boolean; pinned?: boolean } {
  const engine = OPS[input.op].engine;
  const carried = typeof input.params._modelRef === 'string' ? input.params._modelRef : undefined;
  const pinned = (PICKABLE_VIDEO_OPS.includes(engine) ? carried : undefined) ?? (engine === 'video_upscale' ? input.modelRef ?? input.nodeChoice?.ref : undefined);
  if (pinned) return { ref: pinned, viaEdit: false, pinned: true };
  if (input.nodeChoice) return { ref: input.nodeChoice.ref, viaEdit: input.nodeChoice.viaEdit };
  if (opFollowsSource(engine) && carried) return { ref: carried, viaEdit: false };
  const reused = reusedOpChoice(input);
  if (reused) return reused;
  if (opFollowsSource(engine)) {
    if (input.modelRef) return { ref: input.modelRef, viaEdit: false };
    const upstream = !useStore.getState().assets[input.sourceAssetId] && input.upstreamModelRef ? opModelFromRef(input.upstreamModelRef, engine === 'edit' ? 'image' : 'video') : null;
    if (upstream) return { ref: upstream, viaEdit: false };
  }
  return input.sourceAssetId ? opModelForAsset(engine, input.sourceAssetId) : opModelFor(engine);
}

/** Single synchronous spec builder for non-model and in-memory-schema operations (shared by opSpec, preview and review). */
export function syncOpSpec(input: OpSpecInput, opts: { schema?: ModelSchema; upstreamModelRef?: string; sourceForChoice?: string } = {}): GenerationSpec | null {
  const def = OPS[input.op];
  const base = { sessionId: input.sessionId, origin: input.origin, place: input.place, mode: input.mode, parentId: input.parentId, planId: input.planId, stepId: input.stepId, batchToken: input.batchToken };
  const op = { id: input.op, params: input.params, sourceAssetId: input.sourceAssetId };
  if (input.op === 'join_clips') {
    const n = 1 + String(input.params.clips ?? '').split(',').filter(Boolean).length;
    return { ...base, kind: 'video', prompt: `${def.label} (${n} clips)`, modelRef: 'local::join', settings: { count: 1, advanced: {} }, op, estimate: { usd: 0, approximate: false } };
  }
  if (def.engine === 'local') {
    const detail = input.op === 'extract_frame' ? (input.params.which === 'time' ? `${input.params.seconds}s` : input.params.which) : input.op === 'fx' ? fxOpDetail(input.params) : (input.params.grid === 'row3' ? '1×3' : `${input.params.grid}×${input.params.grid}`);
    return { ...base, kind: 'image', prompt: `${def.label} (${detail})`, modelRef: 'local::frame', settings: { count: opCount(def, input.params), advanced: {} }, op, estimate: { usd: 0, approximate: false } };
  }
  if (def.engine === 'voice') {
    return { ...base, kind: 'text', prompt: 'Create Kling voice', modelRef: KLING_VOICE_REF, settings: { count: 1, advanced: {} }, op, estimate: { usd: null, approximate: true, note: `${PROVIDER_LABELS[KLING_VOICE_PROVIDER]} bills the voice when it is created` } };
  }
  if (def.engine === 'transcribe') {
    const t = transcriberForRun(input.modelRef);
    const clip = get().assets[input.sourceAssetId];
    const language = String(input.params.language ?? 'auto');
    return { ...base, kind: 'text', prompt: `Transcribe (${language === 'auto' ? 'detect language' : language})`, modelRef: t?.ref ?? input.modelRef ?? '', settings: { count: 1, advanced: {} }, op, estimate: estimateTranscribe(t?.usdPerMinute, clip?.duration) };
  }
  const choice = opChoice({ ...input, sourceAssetId: opts.sourceForChoice ?? input.sourceAssetId, upstreamModelRef: opts.upstreamModelRef });
  if (!choice.ref) return null;
  return opSpecForModel(input, choice.ref, choice.viaEdit, opts.schema ?? get().catalog.schemas[choice.ref]);
}

export async function opSpec(input: OpSpecInput): Promise<GenerationSpec> {
  const def = OPS[input.op];
  if (def.engine === 'voice' && !isConnected(KLING_VOICE_PROVIDER)) throw new Error(`Creating Kling voices needs ${PROVIDER_LABELS[KLING_VOICE_PROVIDER]}. Connect it in Settings.`);
  if (def.engine === 'transcribe' && !transcriberForRun(input.modelRef)) throw new Error(`No connected provider offers Transcribe. Connect ${preferredProviderLabel('transcribe')}.`);
  if (['local', 'voice', 'transcribe'].includes(def.engine)) return syncOpSpec(input)!;
  const choice = opChoice(input);
  const upscaleRef = choice.pinned ? choice.ref : undefined;
  if (upscaleRef && (!modelSummary(upscaleRef) || !videoOpFits(def.engine, modelSummary(upscaleRef)!) || !isConnected(modelSummary(upscaleRef)!.provider))) throw new Error(def.engine === 'video_upscale' ? 'Choose a dedicated video upscaler, not a video generation/edit model.' : `Choose a connected model that can ${def.label.toLowerCase()}.`);
  if (!choice.ref) throw new Error(`No connected provider offers “${def.label}”. Connect ${operationProviderLabels()}.`);
  const resolved = await resolveModel(choice.ref);
  const schema = resolved?.schema;
  if (def.engine === 'video_upscale' && (!schema || schema.source === 'derived')) throw new Error('The video upscaler parameter schema is unavailable. Choose another model or reload its provider.');
  return opSpecForModel(input, choice.ref, choice.viaEdit, schema);
}

/** Build the same operation parameters using an already chosen model and in-memory schema. No selection or I/O. */
export function opSpecForModel(input: OpSpecInput, modelRef: string, viaEdit: boolean, schema: ModelSchema | undefined): GenerationSpec {
  const def = OPS[input.op];
  const source = get().assets[input.sourceAssetId] ?? input.sourceDims;
  const prompt = def.instruction ? opRolesLine(input.params, input.sourceAssetId, modelRef, schema) + def.instruction(input.params) : def.label;
  const base = { sessionId: input.sessionId, origin: input.origin, place: input.place, mode: input.mode, parentId: input.parentId, planId: input.planId, stepId: input.stepId, batchToken: input.batchToken };
  const op = { id: input.op, params: input.params, sourceAssetId: input.sourceAssetId };
  const picked = PICKABLE_VIDEO_OPS.includes(def.engine) && typeof input.params._modelRef === 'string';
  if (isVideoOpEngine(def.engine)) {
    const settings = videoOpSettings(def.engine, schema, input.params);
    // No "auto": keep the source shape with the nearest ratio, or the model picks 16:9 and reframes.
    const aspectOpts = paramByRole(schema, 'aspect')?.options;
    if (settings.aspect == null && aspectOpts?.length && source?.width && source.height) settings.aspect = matchInputOption(aspectOpts) ?? nearestAspect(aspectOpts, source.width / source.height, undefined) ?? undefined;
    const spec: GenerationSpec = { ...base, kind: 'video', prompt: def.engine === 'video_upscale' ? '' : prompt, modelRef: modelRef, settings, op };
    const clip = get().assets[input.sourceAssetId];
    return { ...spec, estimate: estimateOp(input.op, input.params, source, { ...settings, duration: videoOpSeconds(def.engine, settings, clip?.duration) }, modelRef) };
  }
  if (def.engine === 'video') {
    const video = input.nodeChoice?.settings ?? get().composer.video.settings;
    const { settings } = coerceSettings(schema, 'video', { ...video, count: 1, advanced: {} });
    // Parameters the user set in the op form for the picked model (Continue shot).
    if (picked) for (const p of schema?.params ?? []) {
      const value = input.params[p.key];
      if (value === undefined || ['count', 'aspect', 'negative'].includes(p.role)) continue;
      if (p.role === 'resolution') settings.resolution = String(value);
      else if (p.role === 'duration' && typeof value === 'number') settings.duration = value;
      else if (p.role === 'seed' && typeof value === 'number') settings.seed = value;
      else if (p.role === 'other') settings.advanced[p.key] = value;
    }
    if (source && paramByRole(schema, 'aspect')?.options) {
      const opts = paramByRole(schema, 'aspect')!.options!;
      // Keep the source's shape: an explicit "match input" option, else the nearest ratio ("auto" may pick another).
      const auto = opts.find(isAutoOption);
      settings.aspect = matchInputOption(opts) ?? nearestAspect(opts, source.width / source.height, settings.aspect) ?? (auto != null ? String(auto) : settings.aspect);
    }
    const spec: GenerationSpec = { ...base, kind: 'video', prompt, modelRef: modelRef, settings, op };
    return { ...spec, estimate: estimateOp(input.op, input.params, source, settings, modelRef) };
  }
  const count = opCount(def, input.params);
  const dedicated = !viaEdit && (def.engine === 'upscale' || def.engine === 'remove_bg');
  const { settings } = coerceSettings(schema, 'image', { count, advanced: {} });
  const aspectParam = paramByRole(schema, 'aspect');
  if (aspectParam?.options?.length) {
    // Reframe and a reference sheet take their own format; every other op keeps the source's shape.
    const ownFormat = input.op === 'reframe' || input.op === 'reference_sheet';
    const target = ownFormat ? String(input.params.aspect) : source ? source.width / source.height : undefined;
    // Keep the source shape (Reframe: the chosen format). "auto" lets some models pick another (GPT Image turned a
    // portrait into a landscape), so only an explicit "match input" option is used, else the nearest ratio.
    const auto = aspectParam.options.find(isAutoOption);
    const keep = !ownFormat ? matchInputOption(aspectParam.options) : undefined;
    settings.aspect = keep ?? nearestAspect(aspectParam.options, target, settings.aspect) ?? (auto != null ? String(auto) : settings.aspect);
  }
  if (input.op === 'upscale') {
    const res = paramByRole(schema, 'resolution');
    if (res?.options?.length && viaEdit) settings.resolution = String(res.options[res.options.length - 1]);
    const factorParam = schema?.params.find((p) => p.role === 'other' && /upscale_factor|^scale$|factor/i.test(p.key));
    if (factorParam) {
      const f = Number(input.params.factor) || 2;
      settings.advanced[factorParam.key] = factorParam.type === 'enum' ? (factorParam.options?.find((o) => Number(o) === f) ?? f) : f;
    }
  }
  let sheetNote: string | undefined;
  if (input.op === 'reference_sheet') {
    // 2K preferred (a reference is paid once and reused); the nearest size below when the model has no 2K.
    const res = paramByRole(schema, 'resolution');
    const pick = res?.options?.length ? preferredResolution(res.options, '2K') : undefined;
    if (pick) {
      settings.resolution = pick;
      if (pick.toUpperCase() !== '2K') sheetNote = `sheet at ${pick}: the model has no 2K`;
    }
  }
  const spec: GenerationSpec = { ...base, kind: 'image', prompt: dedicated ? '' : prompt, modelRef: modelRef, settings, op };
  const estimate = estimateOp(input.op, input.params, source, settings, modelRef);
  return { ...spec, estimate: sheetNote ? { ...estimate, note: [estimate.note, sheetNote].filter(Boolean).join('; ') } : estimate };
}
