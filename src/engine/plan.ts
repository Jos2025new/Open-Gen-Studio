import { model3dProblem } from './modelRules';
import { OPS } from './ops';
import { aspectLabel, audioInputProblem, coerceSettings, isAutoOption, nearestAspect, paramByRole, lyricsParam, routeVideoInputs, shotsProblem, songProblem, videoInputProblem } from './params';
import type {
  AdvancedValue,
  AssetKind,
  AudioStep,
  GenSettings,
  ImageStep,
  LayerStep,
  LayerType,
  MediaKind,
  ModelSchema,
  Model3dStep,
  ModelSummary,
  OpId,
  OpStep,
  Plan,
  PlanStep,
  ShapeSpec,
  StepRef,
  TextStep,
  TextStyle,
  VideoStep,
  Workspace,
} from './types';

/** Largest plan the agent may propose (tool schema, zod and normalizer share it). */
export const MAX_PLAN_STEPS = 16;

/* Plans are DAGs of steps proposed by the agent. This module validates them. */

export interface RawStep {
  id?: string;
  kind?: string;
  title?: string;
  prompt?: string;
  prompt_from?: string;
  /** Audio steps: the text of an earlier step used as song lyrics. */
  lyrics_from?: string;
  model?: string;
  aspect?: string;
  resolution?: string;
  count?: number;
  duration?: number;
  audio?: boolean;
  seed?: number;
  refs?: string[];
  times?: Array<number | null>;
  shots?: Array<{ prompt: string; duration: number }>;
  first_frame?: string;
  last_frame?: string;
  op?: string;
  input?: string;
  params?: Record<string, unknown>;
  text?: string;
  layer_type?: string;
  source?: string;
  target?: string;
  style?: Record<string, unknown>;
  box?: { x?: number; y?: number; width?: number };
  shapes?: Array<Record<string, unknown>>;
}

export interface RawPlan {
  title?: string;
  summary?: string;
  steps?: RawStep[];
}

export type OutputKind = AssetKind | 'text' | 'layer';

/**
 * A family name instead of a ref ("Wan 3", "Seedance 2.5") resolves to the closest supported model, locally:
 * the agent can follow the default route without a find_models round. Full refs ("provider::id") pass as given.
 */
function familyRef(ctx: PlanContext, model: string | undefined, kind: MediaKind, needsImage: boolean, stepId: string, adjustments: string[]): string | undefined {
  const raw = model?.trim();
  if (!raw || raw.includes('::')) return raw;
  const ref = ctx.suggestModel?.(raw, kind, needsImage);
  if (!ref) return raw;
  adjustments.push(`${stepId}: model "${raw}" → ${ref}`);
  return ref;
}

function didYouMean(ctx: PlanContext, ref: string, kind: MediaKind, needsImage: boolean): string {
  const near = ctx.suggestModel?.(ref, kind, needsImage);
  return near ? ` Did you mean "${near}"?` : ' Use a listed model ref, one returned by find_models, or omit "model".';
}

export interface PlanContext {
  workspace: Workspace;
  getModel: (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;
  defaultModel: (kind: MediaKind, needsImage: boolean) => string | null;
  defaultSettings: (kind: MediaKind) => Partial<GenSettings>;
  asset: (id: string) => { kind: AssetKind; width?: number; height?: number } | undefined;
  layer: (id: string) => { type: LayerType } | undefined;
  maxSteps?: number;
  /** Closest supported ref for a wrong model id ("did you mean"); no LLM call. */
  suggestModel?: (ref: string, kind: MediaKind, needsImage: boolean) => string | undefined;
}

export interface ParsedRef {
  type: 'step' | 'asset' | 'layer';
  id: string;
  index: number;
}

export function parseRef(ref: string): ParsedRef | null {
  const r = ref.trim();
  if (r.startsWith('asset:')) return { type: 'asset', id: r.slice(6), index: 0 };
  if (r.startsWith('layer:')) return { type: 'layer', id: r.slice(6), index: 0 };
  const m = /^([A-Za-z][\w-]*)(?:#(\d+))?$/.exec(r);
  if (!m) return null;
  return { type: 'step', id: m[1], index: m[2] ? Math.max(0, Number(m[2]) - 1) : 0 };
}

export function stepOutputKind(step: PlanStep): OutputKind {
  switch (step.kind) {
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'model3d':
      return 'model3d';
    case 'video':
      return 'video';
    case 'audio':
      return step.textOutput ? 'text' : 'audio';
    case 'op':
      return OPS[step.op].output;
    case 'layer':
      return 'layer';
  }
}

export function stepDeps(step: PlanStep): StepRef[] {
  switch (step.kind) {
    case 'text':
      return [];
    case 'image':
    case 'model3d':
      return [...(step.promptFrom ? [step.promptFrom] : []), ...step.refs];
    case 'video':
      return [step.promptFrom, step.firstFrame, step.lastFrame, ...(step.refs ?? [])].filter((r): r is string => Boolean(r));
    case 'audio':
      return [step.promptFrom, step.lyricsFrom].filter((r): r is string => Boolean(r));
    case 'op':
      return [step.input];
    case 'layer':
      return step.source ? [step.source] : [];
  }
}

/**
 * Plan card checkboxes: unchecking a step also unchecks every step that needs its output; checking a step
 * also checks what it needs. Returns the new list of unchecked step ids (in plan order).
 */
export function toggleStep(steps: PlanStep[], skipped: string[], id: string): string[] {
  const ids = new Set(steps.map((s) => s.id));
  const deps = new Map(steps.map((s) => [s.id, stepDeps(s).map((r) => r.split('#')[0]).filter((r) => ids.has(r))]));
  const off = new Set(skipped);
  const walk = (start: string, next: (id: string) => string[], apply: (id: string) => void) => {
    const stack = [start];
    const seen = new Set<string>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      apply(cur);
      stack.push(...next(cur));
    }
  };
  if (off.has(id)) walk(id, (cur) => deps.get(cur) ?? [], (cur) => off.delete(cur));
  else walk(id, (cur) => steps.filter((s) => deps.get(s.id)?.includes(cur)).map((s) => s.id), (cur) => off.add(cur));
  return steps.map((s) => s.id).filter((sid) => off.has(sid));
}

/** Topological order of step ids; throws on cycles or unknown step references. */
export function topoOrder(steps: PlanStep[]): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const state = new Map<string, 'visiting' | 'done'>();
  const order: string[] = [];
  const visit = (id: string, trail: string[]) => {
    const st = state.get(id);
    if (st === 'done') return;
    if (st === 'visiting') throw new Error(`Cycle between steps: ${[...trail, id].join(' → ')}`);
    state.set(id, 'visiting');
    const step = byId.get(id);
    if (!step) throw new Error(`Unknown step "${id}"`);
    for (const ref of stepDeps(step)) {
      const p = parseRef(ref);
      if (p?.type === 'step') visit(p.id, [...trail, id]);
    }
    state.set(id, 'done');
    order.push(id);
  };
  for (const s of steps) visit(s.id, []);
  return order;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function color(v: unknown, fallback: string | null): string | null {
  if (v === null || v === 'none' || v === 'transparent') return null;
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeTextStyle(s: Record<string, unknown> | undefined): Partial<TextStyle> {
  if (!s) return {};
  const out: Partial<TextStyle> = {};
  const g = (a: string, b: string) => s[a] ?? s[b];
  if (g('font_family', 'fontFamily') != null) out.fontFamily = String(g('font_family', 'fontFamily'));
  if (g('font_size', 'fontSize') != null) out.fontSize = Math.max(6, Math.min(800, num(g('font_size', 'fontSize'), 64)));
  if (g('font_weight', 'fontWeight') != null) out.fontWeight = Math.max(100, Math.min(900, Math.round(num(g('font_weight', 'fontWeight'), 600) / 100) * 100));
  const c = color(s.color, null);
  if (c) out.color = c;
  if (s.align === 'left' || s.align === 'center' || s.align === 'right') out.align = s.align;
  if (g('line_height', 'lineHeight') != null) out.lineHeight = Math.max(0.7, Math.min(3, num(g('line_height', 'lineHeight'), 1.15)));
  if (g('letter_spacing', 'letterSpacing') != null) out.letterSpacing = Math.max(-20, Math.min(80, num(g('letter_spacing', 'letterSpacing'), 0)));
  return out;
}

export function normalizeShapes(raw: Array<Record<string, unknown>> | undefined): ShapeSpec[] {
  return (raw ?? []).slice(0, 40).map((s) => {
    const type = s.type === 'ellipse' || s.type === 'line' ? s.type : 'rect';
    return {
      type,
      x: num(s.x, 0),
      y: num(s.y, 0),
      w: num(s.w ?? s.width, 100),
      h: num(s.h ?? s.height, type === 'line' ? 0 : 100),
      fill: type === 'line' ? null : color(s.fill, '#ffffff'),
      stroke: color(s.stroke, type === 'line' ? '#ffffff' : null),
      strokeWidth: Math.max(0, num(s.stroke_width ?? s.strokeWidth, type === 'line' ? 4 : 0)),
      radius: Math.max(0, num(s.radius, 0)),
    };
  });
}

function cleanParams(p: Record<string, unknown> | undefined): Record<string, AdvancedValue> {
  const out: Record<string, AdvancedValue> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * Turn a raw plan (from the agent tool call) into a validated Plan.
 * Returns human-readable errors for the agent when the plan cannot be used.
 */
export async function normalizePlan(raw: RawPlan, ctx: PlanContext, planId: string): Promise<{ plan: Plan | null; errors: string[] }> {
  const errors: string[] = [];
  const adjustments: string[] = [];
  const rawSteps = Array.isArray(raw.steps) ? raw.steps : [];
  const maxSteps = ctx.maxSteps ?? MAX_PLAN_STEPS;
  if (!rawSteps.length) return { plan: null, errors: ['The plan has no steps.'] };
  if (rawSteps.length > maxSteps) errors.push(`Too many steps (${rawSteps.length}); the limit is ${maxSteps}.`);

  const ids = new Set<string>();
  rawSteps.forEach((s, i) => {
    if (!s.id || !/^[A-Za-z][\w-]*$/.test(s.id)) s.id = `s${i + 1}`;
    if (ids.has(s.id)) errors.push(`Duplicate step id "${s.id}".`);
    ids.add(s.id);
  });

  const kindById = new Map<string, OutputKind>();
  for (const s of rawSteps) {
    const k = s.kind;
    if (k === 'text') kindById.set(s.id!, 'text');
    else if (k === 'image' || k === 'video' || k === 'model3d') kindById.set(s.id!, k);
    else if (k === 'audio') {
      // A lyrics model answers with text: later steps read it through prompt_from / lyrics_from.
      const ref = s.model?.trim() || ctx.defaultModel('audio', false);
      kindById.set(s.id!, ref && (await ctx.getModel(ref))?.model.textOutput ? 'text' : 'audio');
    }
    else if (k === 'op' && s.op && s.op in OPS) kindById.set(s.id!, OPS[s.op as OpId].output);
    else if (k === 'layer') kindById.set(s.id!, 'layer');
  }

  const refKind = (ref: string | undefined, where: string): OutputKind | 'raster' | null => {
    if (!ref) return null;
    const p = parseRef(ref);
    if (!p) {
      errors.push(`${where}: invalid reference "${ref}".`);
      return null;
    }
    if (p.type === 'step') {
      const k = kindById.get(p.id);
      if (!k) errors.push(`${where}: unknown step "${p.id}".`);
      return k ?? null;
    }
    if (p.type === 'asset') {
      const a = ctx.asset(p.id);
      if (!a) errors.push(`${where}: asset "${p.id}" does not exist.`);
      return a?.kind ?? null;
    }
    const l = ctx.layer(p.id);
    if (!l) {
      errors.push(`${where}: layer "${p.id}" does not exist in the active document.`);
      return null;
    }
    if (l.type !== 'raster') {
      errors.push(`${where}: layer "${p.id}" is a ${l.type} layer; only raster layers hold image pixels.`);
      return null;
    }
    return 'raster';
  };
  const expectImage = (ref: string | undefined, where: string) => {
    const k = refKind(ref, where);
    if (k && k !== 'image' && k !== 'raster') errors.push(`${where}: "${ref}" produces ${k}, an image is required.`);
  };

  const steps: PlanStep[] = [];
  /** Shape of an input image: an asset's pixels, or the aspect of the image step that makes it. */
  const inputAspect = (ref: string | undefined): string | undefined => {
    const p = ref ? parseRef(ref) : null;
    if (p?.type === 'asset') {
      const a = ctx.asset(p.id);
      return a?.kind === 'image' && a.width && a.height ? `${a.width}:${a.height}` : undefined;
    }
    if (p?.type === 'step') {
      const st = steps.find((x) => x.id === p.id);
      return st?.kind === 'image' ? st.settings.aspect : undefined;
    }
    return undefined;
  };
  for (const s of rawSteps) {
    const where = `Step ${s.id}`;
    const title = (s.title ?? '').trim() || s.id!;
    switch (s.kind) {
      case 'text': {
        if (!s.text?.trim()) errors.push(`${where}: text steps need "text".`);
        steps.push({ id: s.id!, kind: 'text', title, text: s.text?.trim() ?? '' } satisfies TextStep);
        break;
      }
      case 'image':
      case 'model3d':
      case 'video': {
        const kind: MediaKind = s.kind;
        const refs = (s.refs ?? []).filter(Boolean);
        if (s.prompt_from) {
          const k = refKind(s.prompt_from, where);
          if (k && k !== 'text') errors.push(`${where}: prompt_from must reference a text step.`);
        }
        // References are images, videos (reference-video / clip models) or audio (lip-sync, soundtrack, reference audio).
        const refKinds = refs.map((r) => refKind(r, where));
        refKinds.forEach((k, i) => {
          if (k && k !== 'image' && k !== 'raster' && k !== 'video' && k !== 'audio') errors.push(`${where}: ref "${refs[i]}" produces ${k}; refs must be images, videos or audio.`);
        });
        const imageRefs = refs.filter((_, i) => refKinds[i] !== 'video' && refKinds[i] !== 'audio');
        const videoRefs = refs.filter((_, i) => refKinds[i] === 'video');
        const audioRefs = refs.filter((_, i) => refKinds[i] === 'audio');
        if (kind === 'video') {
          expectImage(s.first_frame, `${where} first_frame`);
          expectImage(s.last_frame, `${where} last_frame`);
        }
        const needsImage = refs.length > 0 || Boolean(s.first_frame);
        const modelRef = familyRef(ctx, s.model, kind, needsImage, s.id!, adjustments) || ctx.defaultModel(kind, needsImage);
        if (!modelRef) {
          errors.push(`${where}: no ${kind} model is available. Ask the user to connect a provider.`);
          continue;
        }
        const resolved = await ctx.getModel(modelRef);
        if (!resolved) {
          errors.push(`${where}: model "${modelRef}" was not found in the catalog.${didYouMean(ctx, modelRef, kind, needsImage)}`);
          continue;
        }
        if (resolved.model.kind !== kind) {
          errors.push(`${where}: model "${modelRef}" generates ${resolved.model.kind}, not ${kind}.`);
          continue;
        }
        const { schema } = resolved;
        if (schema.missing?.length) errors.push(`${where}: model "${modelRef}" needs ${schema.missing.join(', ')}, which the app cannot send yet. Pick another model.`);
        if (kind === 'image' || kind === 'model3d') {
          const slot = schema.slots.images;
          const extra = schema.slots.source ? 1 : 0;
          if (imageRefs.length && !slot) errors.push(`${where}: model "${modelRef}" does not accept reference images.`);
          else if (slot && imageRefs.length > slot.max + extra) errors.push(`${where}: model "${modelRef}" accepts at most ${slot.max + extra} reference image(s).`);
          if (imageRefs.length < (slot?.min ?? 0) + extra) errors.push(`${where}: model "${modelRef}" requires ${extra ? 'a source image first, then reference images' : 'an input image'} (refs).`);
          const clips = schema.slots.clips;
          if (videoRefs.length && !clips) errors.push(`${where}: model "${modelRef}" does not take video refs.`);
          else if (clips && (videoRefs.length > clips.max || videoRefs.length < clips.min)) errors.push(`${where}: model "${modelRef}" takes ${clips.min}–${clips.max} video clip ref(s).`);
          const audioProblem = audioInputProblem(schema.slots, audioRefs.length);
          if (audioProblem) errors.push(`${where}: model "${modelRef}" ${audioProblem}`);
        } else {
          // Same routing as the composer and the job runner (params.routeVideoInputs).
          const routed = routeVideoInputs(schema.slots, imageRefs, videoRefs, s.first_frame);
          const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), images: routed.images.length, videos: routed.videos.length, audios: audioRefs.length });
          if (problem) errors.push(`${where}: model "${modelRef}" ${problem}`);
          if (s.last_frame && !schema.slots.lastFrame) errors.push(`${where}: model "${modelRef}" does not support last_frame.`);
          if (!s.first_frame && !refs.length && schema.slots.promptRequired === false && !resolved.model.acceptsText) errors.push(`${where}: model "${modelRef}" needs first_frame.`);
          if (s.times?.some((t) => t != null) && !schema.slots.keyframes) adjustments.push(`${s.id}: times ignored, "${modelRef}" has no keyframes`);
        }
        const prompt = (s.prompt ?? '').trim();
        if (!prompt && !s.prompt_from && schema.slots.promptRequired) errors.push(`${where}: a prompt is required.`);
        if (schema.slots.promptMax && prompt.length > schema.slots.promptMax) errors.push(`${where}: model "${modelRef}" takes prompts up to ${schema.slots.promptMax} characters (this one has ${prompt.length}). Shorten it. [PROMPT_TOO_LONG]`);
        if (kind === 'model3d') {
          if (videoRefs.length || audioRefs.length) errors.push(`${where}: 3D models take only images in refs.`);
          // Sizes are checked by the job runner once the images exist.
          const problem = model3dProblem(resolved.model.id, resolved.model, prompt || (s.prompt_from ? '…' : ''), imageRefs.map(() => ({ size: 0, width: 0, height: 0 })));
          if (problem) errors.push(`${where}: model "${modelRef}" ${problem.message}`);
        }
        const defaults = ctx.defaultSettings(kind);
        // R7: a clip made from an image keeps the image's shape unless the step sets one.
        const shape = kind === 'video' && !s.aspect ? inputAspect(s.first_frame ?? imageRefs[0]) : undefined;
        const aspectOptions = paramByRole(schema, 'aspect')?.options?.filter((o) => !isAutoOption(o)) ?? [];
        const inherited = shape && aspectOptions.length ? nearestAspect(aspectOptions, shape) : undefined;
        if (inherited) adjustments.push(`${s.id}: aspect ${aspectLabel(inherited)} from the input image`);
        const { settings, changes } = coerceSettings(schema, kind, {
          ...defaults,
          aspect: s.aspect ?? inherited ?? defaults.aspect,
          resolution: s.resolution ?? defaults.resolution,
          duration: s.duration ?? defaults.duration,
          audio: s.audio ?? defaults.audio,
          count: kind === 'model3d' ? 1 : s.count ?? (kind === 'video' ? 1 : defaults.count ?? 1),
          seed: s.seed,
          shots: kind === 'video' ? s.shots : undefined,
          // Structured params (colors as hex, palettes, style codes, ids): coerceSettings keeps only what the model takes.
          extras: s.params,
          advanced: s.model ? cleanParams(s.params) : { ...(defaults.advanced ?? {}), ...cleanParams(s.params) },
        });
        changes.forEach((c) => adjustments.push(`${s.id}: ${c}`));
        const shotProblem = kind === 'video' && schema.slots.shots ? shotsProblem(settings.shots, settings.duration) : null;
        if (shotProblem) errors.push(`${where}: ${shotProblem}`);
        if (kind === 'image' || kind === 'model3d') {
          steps.push({ id: s.id!, kind, title, prompt, promptFrom: s.prompt_from, modelRef, settings, refs } satisfies ImageStep | Model3dStep);
        } else {
          steps.push({
            id: s.id!,
            kind,
            title,
            prompt,
            promptFrom: s.prompt_from,
            modelRef,
            settings: { ...settings, count: Math.min(settings.count, 2) },
            firstFrame: s.first_frame,
            lastFrame: s.last_frame,
            refs: refs.length ? refs : undefined,
            times: s.times?.length ? s.times : undefined,
          } satisfies VideoStep);
        }
        break;
      }
      case 'audio': {
        const modelRef = familyRef(ctx, s.model, 'audio', false, s.id!, adjustments) || ctx.defaultModel('audio', false);
        if (!modelRef) {
          errors.push(`${where}: no audio model is available. Ask the user to connect Atlas Cloud.`);
          continue;
        }
        const resolved = await ctx.getModel(modelRef);
        if (!resolved) {
          errors.push(`${where}: model "${modelRef}" was not found in the catalog.${didYouMean(ctx, modelRef, 'audio', false)}`);
          continue;
        }
        if (resolved.model.kind !== 'audio') {
          errors.push(`${where}: model "${modelRef}" generates ${resolved.model.kind}, not audio.`);
          continue;
        }
        const { schema } = resolved;
        for (const [key, ref] of [['prompt_from', s.prompt_from], ['lyrics_from', s.lyrics_from]] as const) {
          const k = refKind(ref, where);
          if (k && k !== 'text') errors.push(`${where}: ${key} must reference a text step (a text step, a lyrics step or a transcription).`);
        }
        if (s.refs?.length) errors.push(`${where}: audio steps take no refs.`);
        const lyricsDef = lyricsParam(schema);
        if (s.lyrics_from && !lyricsDef) errors.push(`${where}: model "${modelRef}" takes no lyrics.`);
        const prompt = (s.prompt ?? '').trim();
        if (!prompt && !s.prompt_from && schema.slots.promptRequired) errors.push(`${where}: a prompt is required.`);
        if (schema.slots.promptMax && prompt.length > schema.slots.promptMax) errors.push(`${where}: model "${modelRef}" takes prompts up to ${schema.slots.promptMax} characters (this one has ${prompt.length}). Shorten it. [PROMPT_TOO_LONG]`);
        const { settings, changes } = coerceSettings(schema, 'audio', { count: 1, extras: s.params, advanced: cleanParams(s.params) });
        changes.forEach((c) => adjustments.push(`${s.id}: ${c}`));
        // Lyrics arriving from another step are only known at run time; the same rules then run in the job.
        const song = s.lyrics_from || s.prompt_from ? null : songProblem(schema, prompt, settings);
        if (song) errors.push(`${where}: model "${modelRef}" ${song.message} [${song.code}]`);
        steps.push({
          id: s.id!,
          kind: 'audio',
          title,
          prompt,
          promptFrom: s.prompt_from,
          lyricsFrom: s.lyrics_from,
          modelRef,
          settings: { ...settings, count: 1 },
          ...(resolved.model.textOutput ? { textOutput: true } : {}),
        } satisfies AudioStep);
        break;
      }
      case 'op': {
        const opId = s.op as OpId;
        const def = OPS[opId];
        if (!def) {
          errors.push(`${where}: unknown op "${s.op}". Valid: ${Object.keys(OPS).join(', ')}.`);
          continue;
        }
        if (def.viaSketch) {
          errors.push(`${where}: "${s.op}" needs a mask the user paints in Sketch; use an edit op with an instruction instead.`);
          continue;
        }
        const k = refKind(s.input, where);
        if (!s.input) errors.push(`${where}: "input" is required.`);
        else if (k) {
          const inputKind = k === 'raster' ? 'image' : k;
          if (inputKind !== def.input) errors.push(`${where}: op "${opId}" needs a${def.input === 'image' ? 'n image' : ' video'} input, "${s.input}" is ${inputKind}.`);
        }
        const params: Record<string, AdvancedValue> = {};
        for (const f of def.fields) {
          const v = s.params?.[f.key];
          if (f.type === 'choice') {
            const ok = f.options?.some((o) => o.value === String(v));
            params[f.key] = ok ? String(v) : f.default;
            if (v != null && !ok) adjustments.push(`${s.id}: ${f.key} "${String(v)}" → ${f.default}`);
          } else {
            params[f.key] = typeof v === 'string' ? v : f.default;
          }
        }
        if (opId === 'edit' && !String(params.instruction ?? '').trim()) {
          if (s.prompt?.trim()) params.instruction = s.prompt.trim();
          else errors.push(`${where}: op "edit" needs params.instruction.`);
        }
        if ((opId === 'animate' || opId === 'continue') && !String(params.motion ?? '').trim() && s.prompt?.trim()) params.motion = s.prompt.trim();
        steps.push({ id: s.id!, kind: 'op', title, op: opId, input: s.input ?? '', params } satisfies OpStep);
        break;
      }
      case 'layer': {
        if (ctx.workspace !== 'designer') {
          errors.push(`${where}: layer steps are only valid in the Designer workspace.`);
          continue;
        }
        const layerType = s.layer_type as LayerType;
        if (layerType !== 'raster' && layerType !== 'vector' && layerType !== 'text') {
          errors.push(`${where}: layer_type must be raster, vector or text.`);
          continue;
        }
        const target = s.target?.trim() || (layerType === 'raster' ? 'base' : 'new');
        if (layerType === 'raster') {
          if (!s.source) errors.push(`${where}: raster layers need "source" (an image step, asset:<id> or layer:<id>).`);
          else expectImage(s.source, where);
          if (target !== 'base' && target !== 'new') {
            const l = ctx.layer(target);
            if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
            else if (l.type !== 'raster') errors.push(`${where}: target layer "${target}" is ${l.type}; images can only be placed on raster layers.`);
          }
        } else {
          if (s.source) errors.push(`${where}: ${layerType} layers cannot take an image source; use a raster layer.`);
          if (target !== 'new') {
            const l = ctx.layer(target);
            if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
            else if (l.type !== layerType) errors.push(`${where}: target layer "${target}" is ${l.type}, not ${layerType}.`);
          }
          if (layerType === 'text' && !s.text?.trim()) errors.push(`${where}: text layers need "text".`);
          if (layerType === 'vector' && !s.shapes?.length) errors.push(`${where}: vector layers need "shapes".`);
        }
        const step: LayerStep = {
          id: s.id!,
          kind: 'layer',
          title,
          layerType,
          source: layerType === 'raster' ? s.source : undefined,
          target,
          text: layerType === 'text' ? s.text?.trim() : undefined,
          style: layerType === 'text' ? normalizeTextStyle(s.style) : undefined,
          box: s.box ? { x: num(s.box.x, 0), y: num(s.box.y, 0), width: num(s.box.width, 0) } : undefined,
          shapes: layerType === 'vector' ? normalizeShapes(s.shapes) : undefined,
        };
        steps.push(step);
        break;
      }
      default:
        errors.push(`${where}: unknown kind "${s.kind}". Use text, image, video, audio, op or layer.`);
    }
  }

  if (ctx.workspace === 'node' && steps.some((s) => s.kind === 'layer')) errors.push('Layer steps are not valid in the Node workspace.');
  if (!errors.length) {
    try {
      topoOrder(steps);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (errors.length) return { plan: null, errors };
  return {
    plan: {
      id: planId,
      title: (raw.title ?? '').trim() || 'Plan',
      summary: (raw.summary ?? '').trim(),
      workspace: ctx.workspace,
      steps,
      adjustments,
    },
    errors: [],
  };
}
