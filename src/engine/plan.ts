import { lineKey } from './variants';
import { parsePath } from './design/path';
import { model3dProblem } from './modelRules';
import { OPS } from './ops';
import { routeFits, routeMode, routeVideo, VIDEO_PURPOSES, type RouteMode, type VideoPurpose } from './routing';
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
  PlanSubject,
  ShapeSpec,
  StrokeSpec,
  StepRef,
  TextStep,
  TextStyle,
  VideoStep,
  Workspace,
  SubjectKind,
  SettingsChoice,
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
  /** Video steps: what the clip is for; the app picks the model by price (routing.ts). */
  purpose?: string;
  aspect?: string;
  resolution?: string;
  count?: number;
  /** Image: one short variation per result (candidates that differ). */
  variations?: string[];
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
  /** join_clips: the clips after `input`, in order. */
  more?: string[];
  params?: Record<string, unknown>;
  text?: string;
  layer_type?: string;
  source?: string;
  target?: string;
  style?: Record<string, unknown>;
  box?: { x?: number; y?: number; width?: number };
  shapes?: Array<Record<string, unknown>>;
  strokes?: Array<Record<string, unknown>>;
}

export interface RawPlan {
  title?: string;
  summary?: string;
  /** Seconds the video steps add up to; split over the video steps without their own duration. */
  total_duration?: number;
  steps?: RawStep[];
  /** Subjects to save: { name, from: an image step or asset:<id>, description? }. */
  subjects?: Array<{ name?: string; kind?: SubjectKind; from?: string; description?: string }>;
  /** One style block the app appends to every image and video prompt. */
  style?: string;
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

/** The exact change that makes a video step's inputs fit its model (O2: constructive errors, one round). */
function videoFix(slots: ModelSchema['slots'], n: { firstFrame?: string; images: string[]; videos: string[] }, named: boolean): string {
  const other = named ? ' Or leave "model" out: the app picks a model for these inputs.' : '';
  if (n.firstFrame && !slots.firstFrame) return `move first_frame "${n.firstFrame}" into refs, or drop it.${other}`;
  const imageMax = slots.mixedRefs?.max ?? slots.keyframes?.max ?? slots.images?.max ?? 0;
  if (n.images.length > imageMax) {
    if (!imageMax && slots.firstFrame && !n.firstFrame) return `first_frame: "${n.images[0]}" and drop refs.${other}`;
    return imageMax ? `refs: [${n.images.slice(0, imageMax).map((r) => `"${r}"`).join(', ')}] (drop ${n.images.slice(imageMax).join(', ')}).${other}` : `drop ${n.images.join(', ')} from refs (this model takes only first_frame).${other}`;
  }
  const videoMax = slots.mixedRefs?.max ?? (slots.clips ?? slots.refVideos)?.max ?? 0;
  if (n.videos.length > videoMax) return `keep ${videoMax} video(s) in refs (drop ${n.videos.slice(videoMax).join(', ')}).${other}`;
  if (slots.firstFrame?.required && !n.firstFrame) return `set first_frame to an image step or asset:<id>.${other}`;
  return `add the missing input (an image step or asset:<id> in refs).${other}`;
}

/** Words that name a route or tier, not a model family ("image to video", "pro", "developer"). */
const ROUTE_WORDS = new Set(['video', 'image', 'text', 'to', 'edit', 'reference', 'references', 'developer', 'dev', 'pro', 'fast', 'lite', 'max', 'turbo', 'mini', 'standard', 'std', 'preview', 'ultra', 'plus', 'model', 'atlas', 'nanogpt', 'fal', 'ai', 'spicy']);
function nameTokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9.]+/).map((t) => t.replace(/\.0$/, '').replace(/\.$/, '')).filter((t) => t.length >= 2 && !ROUTE_WORDS.has(t));
}
/** Whether the user's words name this model's family ("wan", "seedance", "nano banana", "h3"). */
function userNamed(names: string[], said: string): boolean {
  const words = new Set(nameTokens(said));
  const flat = said.toLowerCase().replace(/[^a-z0-9]/g, '');
  return names.some((n) => nameTokens(n).some((t) => words.has(t) || (t.length >= 4 && flat.includes(t.replace(/[^a-z0-9]/g, '')))));
}

export interface PlanContext {
  workspace: Workspace;
  getModel: (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;
  defaultModel: (kind: MediaKind, needsImage: boolean) => string | null;
  defaultSettings: (kind: MediaKind) => Partial<GenSettings>;
  asset: (id: string) => { kind: AssetKind; width?: number; height?: number } | undefined;
  layer: (id: string) => { type: LayerType } | undefined;
  maxSteps?: number;
  /**
   * Whether the user picked the composer's model by hand (C2). When false, video steps without a model follow
   * the purpose table; when true, or when not given, the composer's model is the default as before.
   */
  composerChosen?: (kind: MediaKind) => boolean;
  /** Optional Agent-composer override for one exact video input route. */
  routeModel?: (mode: RouteMode) => string | undefined;
  /** Closest supported ref for a wrong model id ("did you mean"); no LLM call. */
  suggestModel?: (ref: string, kind: MediaKind, needsImage: boolean) => string | undefined;
  /** True when the user picked this kind's model by hand but it has no variant for these inputs and a stand-in is used. */
  defaultIsFallback?: (kind: MediaKind, needsImage: boolean) => boolean;
  /** What the user wrote (messages, answers): a model the plan names wins over the composer's pick only if it is named here. */
  userText?: () => string;
  /** Images attached to the current request: the start frame a model needs when the plan forgot it. */
  requestImages?: () => string[];
  /** Names of the session's subjects: a plan subject with one of these names reuses it. */
  subjectNames?: () => string[];
  /** Settings the user confirmed (phase 2): model, resolution, duration and aspect for every step of that kind. */
  confirmed?: (kind: MediaKind) => SettingsChoice | undefined;
}

/** "@Name" in a prompt, as the app reads mentions (params.mentionSubjects). */
export function mentions(prompt: string | undefined, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(prompt) && new RegExp(`@${esc}(?![\\p{L}\\p{N}_-])`, 'iu').test(prompt!);
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
  const own = ownDeps(step);
  return step.kind === 'layer' ? own : [...own, ...(step.after ?? [])];
}

function ownDeps(step: PlanStep): StepRef[] {
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
      return [step.input, ...(step.more ?? []), ...(typeof step.params?.music === 'string' && step.params.music ? [step.params.music] : [])];
    case 'layer':
      return [...(step.source ? [step.source] : []), ...(step.after ?? [])];
  }
}

/**
 * Plan card checkboxes: unchecking a step also unchecks every step that needs its output; checking a step
 * also checks what it needs. Returns the new list of unchecked step ids (in plan order).
 */
export function toggleStep(steps: PlanStep[], skipped: string[], id: string): string[] {
  const ids = new Set(steps.map((s) => s.id));
  // Joining clips never forces a clip on or off: it joins whichever clips run (pruneJoins).
  const deps = new Map(steps.map((s) => [s.id, isJoin(s) ? [] : stepDeps(s).map((r) => r.split('#')[0]).filter((r) => ids.has(r))]));
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

export const MAX_AGENT_STROKES = 200;
export const MAX_STROKE_POINTS = 2000;

/** Freehand strokes from the agent: points in document px, optional pressure 0–1. Invalid points are dropped. */
export function normalizeStrokes(raw: Array<Record<string, unknown>> | undefined, errors: string[] = [], where = 'layer'): StrokeSpec[] {
  const list = raw ?? [];
  if (list.length > MAX_AGENT_STROKES) errors.push(`${where}: at most ${MAX_AGENT_STROKES} strokes.`);
  return list.slice(0, MAX_AGENT_STROKES).flatMap((s, i) => {
    const pts = Array.isArray(s.points) ? s.points : [];
    if (pts.length > MAX_STROKE_POINTS) errors.push(`${where}: stroke ${i + 1} has more than ${MAX_STROKE_POINTS} points.`);
    const points = pts
      .slice(0, MAX_STROKE_POINTS)
      .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => [Number(p[0]), Number(p[1]), p.length > 2 && Number.isFinite(Number(p[2])) ? Math.min(1, Math.max(0, Number(p[2]))) : 0.5] as [number, number, number]);
    if (!points.length) {
      errors.push(`${where}: stroke ${i + 1} needs "points" as [[x, y], …] or [[x, y, pressure], …].`);
      return [];
    }
    const pressure = pts.some((p) => Array.isArray(p) && p.length > 2);
    return [{ points, pressure, color: color(s.color, '#ffffff') ?? '#ffffff', size: Math.min(400, Math.max(0.5, num(s.size ?? s.width, 8))) }];
  });
}

export function normalizeShapes(raw: Array<Record<string, unknown>> | undefined, errors: string[] = [], where = 'layer'): ShapeSpec[] {
  return (raw ?? []).slice(0, 40).flatMap((s, i): ShapeSpec[] => {
    if (s.type === 'path') {
      const d = typeof s.d === 'string' ? s.d.trim() : '';
      const parsed = parsePath(d);
      if ('error' in parsed) {
        errors.push(`${where}: shape ${i + 1} path is invalid: ${parsed.error}.`);
        return [];
      }
      const b = parsed.box;
      return [{ type: 'path', d, box0: b, x: b.x, y: b.y, w: b.w, h: b.h, fill: color(s.fill, null), stroke: color(s.stroke, s.fill ? null : '#ffffff'), strokeWidth: Math.max(0, num(s.stroke_width ?? s.strokeWidth, s.fill ? 0 : 4)), radius: 0 }];
    }
    const type = s.type === 'ellipse' || s.type === 'line' ? s.type : 'rect';
    return [{
      type,
      x: num(s.x, 0),
      y: num(s.y, 0),
      w: num(s.w ?? s.width, 100),
      h: num(s.h ?? s.height, type === 'line' ? 0 : 100),
      fill: type === 'line' ? null : color(s.fill, '#ffffff'),
      stroke: color(s.stroke, type === 'line' ? '#ffffff' : null),
      strokeWidth: Math.max(0, num(s.stroke_width ?? s.strokeWidth, type === 'line' ? 4 : 0)),
      radius: Math.max(0, num(s.radius, 0)),
    }];
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
  // A total length is split evenly over the video steps that set none (each share then snaps to the model's lengths).
  const total = Number(raw.total_duration);
  const unset = rawSteps.filter((s) => s.kind === 'video' && s.duration == null);
  const setSecs = rawSteps.reduce((sum, s) => sum + (s.kind === 'video' && s.duration != null ? Number(s.duration) || 0 : 0), 0);
  const share = Number.isFinite(total) && total > 0 && unset.length ? Math.max(1, Math.round((total - setSecs) / unset.length)) : undefined;
  if (share) adjustments.push(`total ${total}s: about ${share}s for each of ${unset.map((s) => s.id).join(', ')}`);
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
      if (!k) errors.push(`${where}: unknown step "${p.id}". Fix: use one of the plan's step ids (${[...kindById.keys()].join(', ')}) or asset:<id> from the context.`);
      return k ?? null;
    }
    if (p.type === 'asset') {
      const a = ctx.asset(p.id);
      if (!a) errors.push(`${where}: asset "${p.id}" does not exist. Fix: use an asset:<id> listed in the context, or the step that makes it.`);
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
    if (k && k !== 'image' && k !== 'raster') errors.push(`${where}: "${ref}" produces ${k}, an image is required.${k === 'video' ? ` Fix: add a step { kind: "op", op: "extract_frame", input: "${ref}", params: { which: "last" } } and use that step here.` : ' Fix: use an image step or an image asset.'}`);
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
  /**
   * O1 (OpenMontage: repair, log, do not block): a video where an image is needed becomes one of its frames, a
   * free local extract_frame step. One step per clip and frame, shared by every step that needs it.
   */
  const frames = new Map<string, string>();
  const isVideo = (ref: string | undefined): boolean => {
    const p = ref ? parseRef(ref) : null;
    return p?.type === 'step' ? kindById.get(p.id) === 'video' : p?.type === 'asset' ? ctx.asset(p.id)?.kind === 'video' : false;
  };
  const frameOf = (ref: string, which: 'first' | 'last', forId: string): string => {
    const known = frames.get(`${ref}|${which}`);
    if (known) return known;
    let id = `${forId}_${which}`;
    for (let n = 2; ids.has(id); n++) id = `${forId}_${which}${n}`;
    ids.add(id);
    kindById.set(id, 'image');
    const src = parseRef(ref);
    steps.push({ id, kind: 'op', title: `${which === 'last' ? 'Last' : 'First'} frame of ${src?.type === 'step' ? src.id : 'the clip'}`, op: 'extract_frame', input: ref, params: { which, seconds: '' } } satisfies OpStep);
    frames.set(`${ref}|${which}`, id);
    return id;
  };
  // A clip chained to a clip starts where the previous one ends (its last frame) and ends where the next one
  // starts (its first frame).
  for (const s of rawSteps) {
    if (s.kind !== 'video') continue;
    if (isVideo(s.first_frame)) {
      adjustments.push(`${s.id}: first_frame ${s.first_frame} is a clip → its last frame`);
      s.first_frame = frameOf(s.first_frame!, 'last', s.id!);
    }
    if (isVideo(s.last_frame)) {
      adjustments.push(`${s.id}: last_frame ${s.last_frame} is a clip → its first frame`);
      s.last_frame = frameOf(s.last_frame!, 'first', s.id!);
    }
  }
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
        // An asset id written in the prompt is an input the plan forgot to wire: it becomes the step's image (no rejection).
        for (const token of new Set((s.prompt ?? '').match(/asset:[A-Za-z0-9_-]+/g) ?? [])) {
          const a = ctx.asset(token.slice(6));
          if (!a) continue;
          s.prompt = (s.prompt ?? '').split(token).join('').replace(/\s{2,}/g, ' ').trim();
          if (s.first_frame === token || s.refs?.includes(token)) continue;
          const asStart = kind === 'video' && a.kind === 'image' && !s.first_frame && !s.refs?.length;
          if (asStart) s.first_frame = token;
          else s.refs = [...(s.refs ?? []), token];
          adjustments.push(`${s.id}: ${token} moved from the prompt to the step's ${asStart ? 'start frame' : 'references'}`);
        }
        // The start frame listed again in refs is the same input twice: keep it as the start frame only.
        if (s.first_frame && s.refs?.includes(s.first_frame)) s.refs = s.refs.filter((r) => r !== s.first_frame);
        const refs = (s.refs ?? []).filter(Boolean);
        if (s.prompt_from) {
          const k = refKind(s.prompt_from, where);
          if (k && k !== 'text') errors.push(`${where}: prompt_from must reference a text step. Fix: write the text in "prompt" and drop prompt_from (an image or clip goes in refs or first_frame).`);
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
        // Phase 2: what the user confirmed wins over what the plan wrote (the prompts were written for it).
        const conf = kind === 'video' || kind === 'image' ? ctx.confirmed?.(kind) : undefined;
        if (conf) {
          const confName = (await ctx.getModel(conf.modelRef))?.model.name ?? conf.modelRef;
          const stepNeedsImage = refs.length > 0 || Boolean(s.first_frame);
          const wrote = s.model?.trim();
          // The same model line in the variant these inputs need (the card was made for other inputs).
          s.model = stepNeedsImage === conf.needsImage ? conf.modelRef : confName;
          // A family name (e.g. Nano Banana 2) is the same choice written loosely: not worth a note.
          if (wrote && wrote.includes('::') && wrote !== conf.modelRef) adjustments.push(`${s.id}: model ${wrote} → ${confName} (confirmed)`);
          const keep = (field: 'resolution' | 'aspect' | 'duration' | 'count', value: string | number | undefined) => {
            if (value == null) return;
            const had = (s as Record<string, unknown>)[field];
            if (had != null && String(had) !== String(value)) adjustments.push(`${s.id}: ${field} ${String(had)} → ${String(value)} (confirmed)`);
            (s as Record<string, unknown>)[field] = value;
          };
          keep('resolution', conf.resolution);
          keep('aspect', conf.aspect);
          if (kind === 'video') keep('duration', conf.duration);
          // The confirmed number is the candidates of the one image being explored: forced only on a single image step
          // (variations are checked below); separate image steps (options written apart, a sheet + a product) keep theirs.
          if (kind === 'image' && rawSteps.filter((x) => x.kind === 'image').length === 1 && !(Array.isArray(s.variations) && s.variations.length > 1)) keep('count', conf.count);
        }
        // The user's own model pick (composer, or a video route) wins over a model only the plan names.
        const named = conf ? undefined : s.model?.trim();
        const userPicked = ctx.composerChosen?.(kind) || (kind === 'video' && Boolean(ctx.routeModel?.(routeMode({ firstFrame: Boolean(s.first_frame), refs: imageRefs.length }))));
        if (named && userPicked && ctx.userText) {
          const found = await ctx.getModel(named);
          if (!userNamed([named, found?.model.name ?? ''], ctx.userText())) {
            // Noted only when the plan named another real model: a name that matches nothing, or the user's own line, changes nothing.
            const mine = ctx.defaultModel(kind, imageRefs.length > 0 || Boolean(s.first_frame));
            const mineModel = mine ? (await ctx.getModel(mine))?.model : undefined;
            if (found && (!mineModel || lineKey(found.model) !== lineKey(mineModel))) adjustments.push(`${s.id}: kept your ${kind} model (the plan had named ${found.model.name})`);
            s.model = undefined;
          }
        }
        // Model choice depends on the image inputs; it runs again if video refs become frames (O1).
        const pickModel = async (pickNotes: string[], skipOverride = false) => {
          const needsImage = refs.length > 0 || Boolean(s.first_frame);
          let modelRef = familyRef(ctx, s.model, kind, needsImage, s.id!, pickNotes);
          let pickedRoute: RouteMode | undefined;
          let routeParams: Record<string, string> | undefined;
          const routeRefs = imageRefs.length + (imageRefs.length && s.first_frame ? 1 : 0);
          if (!modelRef && kind === 'video') {
            const route = routeMode({ firstFrame: Boolean(s.first_frame), refs: imageRefs.length });
            const override = skipOverride ? undefined : ctx.routeModel?.(route);
            if (override) {
              modelRef = override;
              pickedRoute = route;
              pickNotes.push(`${s.id}: ${route} video → user model (${override.split('::')[0]})`);
            // No exact override: preserve C2. A global composer pick still wins; otherwise use the purpose table.
            } else if (ctx.composerChosen && !ctx.composerChosen('video')) {
              const purpose: VideoPurpose = VIDEO_PURPOSES.includes(s.purpose as VideoPurpose) ? (s.purpose as VideoPurpose) : 'normal';
              const routed = await routeVideo(purpose, { firstFrame: Boolean(s.first_frame), refs: routeRefs, duration: s.duration }, ctx.getModel);
              if (routed) {
                modelRef = routed.ref;
                routeParams = routed.entry.params;
                pickNotes.push(`${s.id}: ${purpose} video → ${routed.entry.name} (${routed.ref.split('::')[0]})`);
              }
            }
          }
          if (!modelRef && ctx.composerChosen?.(kind) && ctx.defaultIsFallback?.(kind, needsImage)) {
            const fallback = ctx.defaultModel(kind, needsImage);
            if (fallback) pickNotes.push(`${s.id}: your ${kind} model has no variant that takes ${kind === 'video' ? 'a start image' : 'an input image'}, so ${(await ctx.getModel(fallback))?.model.name ?? fallback.split('::')[1]} is used — pick one in Models to choose it yourself`);
          }
          modelRef ||= ctx.defaultModel(kind, needsImage) ?? undefined;
          return { modelRef, pickedRoute, routeParams, routeRefs, needsImage, resolved: modelRef ? await ctx.getModel(modelRef) : null };
        };
        let pickNotes: string[] = [];
        let pick = await pickModel(pickNotes);
        // O1: a model without video inputs gets each video ref's last frame (free, local) instead of a rejection.
        const takesVideo = (sl: ModelSchema['slots']) => Boolean(sl.clips ?? sl.refVideos ?? sl.mixedRefs);
        if (kind === 'video' && videoRefs.length && pick.resolved?.model.kind === 'video' && !takesVideo(pick.resolved.schema.slots)) {
          const frames = videoRefs.map((r) => frameOf(r, 'last', s.id!));
          refs.splice(0, refs.length, ...refs.map((r) => (videoRefs.includes(r) ? frames[videoRefs.indexOf(r)] : r)));
          imageRefs.push(...frames);
          videoRefs.length = 0;
          adjustments.push(`${s.id}: ${frames.length > 1 ? `${frames.length} reference videos → their last frames` : 'reference video → its last frame'} (${pick.resolved.model.name} takes no videos)`);
          if (!s.model) {
            pickNotes = [];
            pick = await pickModel(pickNotes);
          }
        }
        // A route model the user picked that cannot take this step (e.g. no reference input): the default takes over, noted.
        if (pick.pickedRoute && pick.resolved && !routeFits(pick.resolved.model, pick.resolved.schema, { mode: pick.pickedRoute, refs: pick.routeRefs, duration: s.duration })) {
          pickNotes = [`${s.id}: your ${pick.pickedRoute}-to-video model (${pick.resolved.model.name}) cannot take this step; the default model is used`];
          pick = await pickModel(pickNotes, true);
        }
        adjustments.push(...pickNotes);
        // A routed entry's own settings (FLUX 3 Draft: quality "draft"); the step's params win.
        if (pick.routeParams) s.params = { ...pick.routeParams, ...(s.params ?? {}) };
        const { modelRef, needsImage, resolved } = pick;
        if (!modelRef) {
          errors.push(`${where}: no ${kind} model is available. Ask the user to connect a provider.`);
          continue;
        }
        if (!resolved) {
          errors.push(`${where}: model "${modelRef}" was not found in the catalog.${didYouMean(ctx, modelRef, kind, needsImage)}`);
          continue;
        }
        if (resolved.model.kind !== kind) {
          errors.push(`${where}: model "${modelRef}" generates ${resolved.model.kind}, not ${kind}. Fix: set kind "${resolved.model.kind}", or leave "model" out for the default ${kind} model.`);
          continue;
        }
        const { schema } = resolved;
        if (schema.missing?.length) errors.push(`${where}: model "${modelRef}" needs ${schema.missing.join(', ')}, which the app cannot send yet. Pick another model.`);
        if (kind === 'image' || kind === 'model3d') {
          const slot = schema.slots.images;
          const extra = schema.slots.source ? 1 : 0;
          if (imageRefs.length && !slot) errors.push(`${where}: model "${modelRef}" does not accept reference images. Fix: ${s.model ? 'leave "model" out (the app switches to a variant that takes images) or ' : ''}drop refs.`);
          else if (slot && imageRefs.length > slot.max + extra) errors.push(`${where}: model "${modelRef}" accepts at most ${slot.max + extra} reference image(s). Fix: refs: [${imageRefs.slice(0, slot.max + extra).map((r) => `"${r}"`).join(', ')}] (drop ${imageRefs.slice(slot.max + extra).join(', ')}), or merge them first in one image step.`);
          if (imageRefs.length < (slot?.min ?? 0) + extra) errors.push(`${where}: model "${modelRef}" requires ${extra ? 'a source image first, then reference images' : 'an input image'} (refs). Fix: ${!imageRefs.length ? `if this step makes a new image from text, ${s.model ? 'name the text-to-image variant or leave "model" out' : 'leave refs empty and name a text-to-image model'}; add refs only when it really edits or uses an image — never an unrelated image just to satisfy the model.` : `put the image it edits (an image step or asset:<id>) in refs.`}`);
          const clips = schema.slots.clips;
          if (videoRefs.length && !clips) errors.push(`${where}: model "${modelRef}" does not take video refs. Fix: add a step { kind: "op", op: "extract_frame", input: "${videoRefs[0]}", params: { which: "last" } } and put that step in refs instead.`);
          else if (clips && (videoRefs.length > clips.max || videoRefs.length < clips.min)) errors.push(`${where}: model "${modelRef}" takes ${clips.min}–${clips.max} video clip ref(s).`);
          const audioProblem = audioInputProblem(schema.slots, audioRefs.length);
          if (audioProblem) errors.push(`${where}: model "${modelRef}" ${audioProblem}`);
        } else {
          // A model that needs a start image, with none wired: the one image attached to this request is it.
          const needsStart = Boolean(schema.slots.firstFrame?.required) || (!resolved.model.acceptsText && Boolean(schema.slots.firstFrame));
          const attached = ctx.requestImages?.() ?? [];
          if (needsStart && !s.first_frame && !refs.length && attached.length === 1) {
            s.first_frame = `asset:${attached[0]}`;
            adjustments.push(`${s.id}: start frame = your attached image (the model needs one)`);
          }
          // Same routing as the composer and the job runner (params.routeVideoInputs).
          const routed = routeVideoInputs(schema.slots, imageRefs, videoRefs, s.first_frame);
          const problem = videoInputProblem(schema.slots, { firstFrame: Boolean(routed.firstFrame), images: routed.images.length, videos: routed.videos.length, audios: audioRefs.length });
          if (problem) errors.push(`${where}: model "${modelRef}" ${problem} Fix: ${videoFix(schema.slots, routed, Boolean(s.model))}`);
          if (s.last_frame && !schema.slots.lastFrame) errors.push(`${where}: model "${modelRef}" does not support last_frame. Fix: drop last_frame and describe the ending in the prompt${s.model ? ', or name a model with a last-frame input' : ''}.`);
          if (!s.first_frame && !refs.length && schema.slots.promptRequired === false && !resolved.model.acceptsText) errors.push(`${where}: model "${modelRef}" needs first_frame. Fix: set first_frame to an image step or asset:<id>${s.model ? ', or leave "model" out for a text-to-video model' : ''}.`);
          if (s.times?.some((t) => t != null) && !schema.slots.keyframes) adjustments.push(`${s.id}: times ignored, "${modelRef}" has no keyframes`);
        }
        const prompt = (s.prompt ?? '').trim();
        if (!prompt && !s.prompt_from && schema.slots.promptRequired) errors.push(`${where}: a prompt is required. Fix: write "prompt" (what happens and how it looks).`);
        if (schema.slots.promptMax && prompt.length > schema.slots.promptMax) errors.push(`${where}: model "${modelRef}" takes prompts up to ${schema.slots.promptMax} characters (this one has ${prompt.length}). Shorten it. [PROMPT_TOO_LONG]`);
        if (kind === 'model3d') {
          if (videoRefs.length || audioRefs.length) errors.push(`${where}: 3D models take only images in refs.`);
          // Sizes are checked by the job runner once the images exist.
          const problem = model3dProblem(resolved.model.id, resolved.model, prompt || (s.prompt_from ? '…' : ''), imageRefs.map(() => ({ size: 0, width: 0, height: 0 })));
          if (problem) errors.push(`${where}: model "${modelRef}" ${problem.message}`);
        }
        const defaults = ctx.defaultSettings(kind);
        // R7: a clip made from an image, or an image redrawn from one image (a view, a lock-up, an edit), keeps that
        // image's shape unless the step sets one.
        const shape = !s.aspect && (kind === 'video' || (kind === 'image' && imageRefs.length === 1)) ? inputAspect(kind === 'video' ? s.first_frame ?? imageRefs[0] : imageRefs[0]) : undefined;
        const aspectOptions = paramByRole(schema, 'aspect')?.options?.filter((o) => !isAutoOption(o)) ?? [];
        const inherited = shape && aspectOptions.length ? nearestAspect(aspectOptions, shape) : undefined;
        if (inherited) adjustments.push(`${s.id}: aspect ${aspectLabel(inherited)} from the input image`);
        const { settings, changes } = coerceSettings(schema, kind, {
          ...defaults,
          aspect: s.aspect ?? inherited ?? defaults.aspect,
          resolution: s.resolution ?? defaults.resolution,
          duration: s.duration ?? share ?? defaults.duration,
          audio: s.audio ?? defaults.audio,
          count: kind === 'model3d' ? 1 : s.count ?? (kind === 'video' ? 1 : defaults.count ?? 1),
          seed: s.seed,
          // Only models with a negative prompt field take it (coerceSettings); others get constraints in the prompt.
          negative: typeof s.params?.negative_prompt === 'string' ? s.params.negative_prompt : undefined,
          shots: kind === 'video' ? s.shots : undefined,
          // Structured params (colors as hex, palettes, style codes, ids): coerceSettings keeps only what the model takes.
          extras: s.params,
          advanced: s.model ? cleanParams(s.params) : { ...(defaults.advanced ?? {}), ...cleanParams(s.params) },
        });
        changes.forEach((c) => adjustments.push(`${s.id}: ${c}`));
        const shotProblem = kind === 'video' && schema.slots.shots ? shotsProblem(settings.shots, settings.duration) : null;
        if (shotProblem) errors.push(`${where}: ${shotProblem}`);
        // Candidates that differ: one variation per result; their number is the count (the confirmed one wins).
        const variations = kind === 'image' && Array.isArray(s.variations) ? s.variations.map((v) => String(v).trim()).filter(Boolean) : [];
        if (variations.length > 1) {
          const want = conf?.count;
          if (want && variations.length !== want) errors.push(`${where}: ${variations.length} variations but the user confirmed ${want} image${want === 1 ? '' : 's'}. Fix: write exactly ${want} variation${want === 1 ? '' : 's'}${want === 1 ? ' (or none)' : ''}.`);
          else settings.count = variations.length;
        }
        if (kind === 'image' || kind === 'model3d') {
          steps.push({ id: s.id!, kind, title, prompt, promptFrom: s.prompt_from, modelRef, settings, refs, ...(variations.length > 1 && kind === 'image' ? { variations } : {}) } satisfies ImageStep | Model3dStep);
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
          if (inputKind !== def.input) errors.push(`${where}: op "${opId}" needs a${def.input === 'image' ? 'n image' : ' video'} input, "${s.input}" is ${inputKind}.${def.input === 'image' && inputKind === 'video' ? ` Fix: add a step { kind: "op", op: "extract_frame", input: "${s.input}", params: { which: "last" } } and use it as input.` : def.input === 'video' && inputKind === 'image' ? ' Fix: make a clip from it first (a video step with first_frame) and use that step as input.' : ''}`);
        }
        const params: Record<string, AdvancedValue> = {};
        for (const f of def.fields) {
          // A field written on the step itself ("instruction": …) instead of in params counts as given.
          const loose = (s as unknown as Record<string, unknown>)[f.key];
          const v = s.params?.[f.key] ?? (typeof loose === 'string' || typeof loose === 'number' ? (loose as AdvancedValue) : undefined);
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
        // The step's own words go into the op's note (the op keeps its tuned instruction); before, they were dropped.
        if (s.prompt?.trim() && def.fields.some((f) => f.key === 'note') && !String(params.note ?? '').trim()) params.note = s.prompt.trim();
        // A model named on an edit / animate op runs it (before, the op silently used the source's model).
        if (s.model?.trim() && (def.engine === 'edit' || def.engine === 'video')) {
          const kind = def.engine === 'edit' ? 'image' : 'video';
          const ref = familyRef(ctx, s.model, kind, true, s.id!, adjustments);
          const got = ref ? await ctx.getModel(ref) : null;
          if (!got) errors.push(`${where}: unknown model "${s.model}".${didYouMean(ctx, s.model, kind, true)}`);
          else if (got.model.kind !== kind || !got.model.acceptsImage || got.model.needsVideo) errors.push(`${where}: model "${ref}" does not take an input image for "${opId}". Fix: use its edit variant (find_models) or leave "model" out.${didYouMean(ctx, s.model, kind, true)}`);
          else params._modelRef = ref!;
        }
        let more: string[] | undefined;
        if (def.multiInput) {
          more = (Array.isArray(s.more) ? s.more : []).map((r) => String(r).trim()).filter(Boolean);
          if (ctx.workspace === 'node') errors.push(`${where}: "${opId}" is not available in the Node workspace yet.`);
          if (!more.length) errors.push(`${where}: "${opId}" needs "more": the clips after "input", in order.`);
          if (more.length > 19) errors.push(`${where}: "${opId}" joins at most 20 clips.`);
          for (const r of more) {
            const k = refKind(r, where);
            if (k && k !== 'video') errors.push(`${where}: "${opId}" joins videos; "${r}" is ${k}.`);
          }
          const music = String(params.music ?? '').trim();
          if (music) {
            const k = refKind(music, where);
            if (k && k !== 'audio') errors.push(`${where}: params.music must be an audio step or asset; "${music}" is ${k}.`);
          }
        }
        steps.push({ id: s.id!, kind: 'op', title, op: opId, input: s.input ?? '', ...(more ? { more } : {}), params } satisfies OpStep);
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
        const drawing = Boolean(s.strokes?.length);
        const target = s.target?.trim() || (layerType === 'raster' && !drawing ? 'base' : 'new');
        const strokes = drawing && layerType !== 'text' ? normalizeStrokes(s.strokes, errors, where) : undefined;
        if (drawing && layerType === 'text') errors.push(`${where}: text layers cannot take strokes; use a vector or raster layer.`);
        if (layerType === 'raster' && drawing) {
          // Painted strokes always go on a new layer: the user's own raster layers are never painted over.
          if (s.source) errors.push(`${where}: a raster layer takes either "source" or "strokes", not both.`);
          if (target !== 'new') errors.push(`${where}: painted strokes go on a new raster layer (target "new").`);
        } else if (layerType === 'raster') {
          if (!s.source) errors.push(`${where}: raster layers need "source" (an image step, asset:<id> or layer:<id>) or "strokes".`);
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
          if (layerType === 'vector' && !s.shapes?.length && !drawing) errors.push(`${where}: vector layers need "shapes" or "strokes".`);
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
          shapes: layerType === 'vector' ? normalizeShapes(s.shapes, errors, where) : undefined,
          strokes,
        };
        steps.push(step);
        break;
      }
      default:
        errors.push(`${where}: unknown kind "${s.kind}". Use text, image, video, audio, op or layer.`);
    }
  }

  if (ctx.workspace === 'node' && steps.some((s) => s.kind === 'layer')) errors.push('Layer steps are not valid in the Node workspace.');
  const subjects = planSubjects(raw.subjects, steps, refKind, errors, adjustments, ctx.subjectNames?.() ?? []);
  unknownMentions(steps, [...(ctx.subjectNames?.() ?? []), ...subjects.map((x) => x.name)], errors);
  const style = raw.style?.trim();
  if (style) {
    for (const st of steps) if ((st.kind === 'image' || st.kind === 'video') && !st.prompt.includes(style)) st.prompt = `${st.prompt}\n\nStyle: ${style}`;
  }
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
      ...(subjects.length ? { subjects } : {}),
      ...(style ? { style } : {}),
      adjustments,
    },
    errors: [],
  };
}

/**
 * Plan subjects (F3): each names an image the plan saves as a session subject. Steps that mention @Name wait for
 * the step that makes it (`after`), so the subject exists before their prompt is sent. An existing name is reused.
 */
function planSubjects(
  raw: RawPlan['subjects'],
  steps: PlanStep[],
  refKind: (ref: string | undefined, where: string) => OutputKind | 'raster' | null,
  errors: string[],
  adjustments: string[],
  existing: string[],
): PlanSubject[] {
  const out: PlanSubject[] = [];
  for (const [i, r] of (Array.isArray(raw) ? raw : []).entries()) {
    const where = `subject ${i + 1}`;
    const name = String(r?.name ?? '').trim().replace(/^@/, '');
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(name)) {
      errors.push(`${where}: "name" must be one word (letters, digits, _ or -), e.g. "Reto".`);
      continue;
    }
    if (out.some((x) => x.name.toLowerCase() === name.toLowerCase())) {
      errors.push(`${where}: duplicate subject name "${name}".`);
      continue;
    }
    if (!r?.from) {
      errors.push(`${where}: "from" is required (an image step id or asset:<id>).`);
      continue;
    }
    const k = refKind(r.from, where);
    if (k && k !== 'image' && k !== 'raster') {
      errors.push(`${where}: "from" must be an image; "${r.from}" is ${k}.`);
      continue;
    }
    if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) adjustments.push(`@${name} already exists in this session: reused`);
    out.push({ name, from: r.from.trim(), ...(r.kind ? { kind: r.kind } : {}), ...(r.description?.trim() ? { description: r.description.trim() } : {}) });
  }
  for (const subj of out) {
    const p = parseRef(subj.from);
    if (p?.type !== 'step') continue;
    for (const st of steps) {
      if (st.id === p.id) continue;
      const text = st.kind === 'image' || st.kind === 'video' || st.kind === 'model3d' || st.kind === 'audio' ? st.prompt : st.kind === 'op' ? Object.values(st.params).join(' ') : undefined;
      if (mentions(text, subj.name) && !(st.after ?? []).includes(p.id)) st.after = [...(st.after ?? []), p.id];
    }
  }
  return out;
}

/** Reference syntaxes the agent writes itself (@Image1, @Video2, @Element1…): not library names. */
const REF_SYNTAX = /^(image|video|audio|element)\d+$/i;

/** A @Name that is neither in the library nor saved by this plan would reach the model with no image behind it. */
function unknownMentions(steps: PlanStep[], known: string[], errors: string[]): void {
  const names = new Set(known.map((n) => n.toLowerCase()));
  for (const st of steps) {
    if (st.kind !== 'image' && st.kind !== 'video') continue;
    for (const m of st.prompt.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)) {
      const n = m[1];
      if (REF_SYNTAX.test(n) || names.has(n.toLowerCase())) continue;
      errors.push(`step ${st.id}: @${n} is not in the library; add it to "subjects" (from an attached image or a reference step) or describe it without @.`);
    }
  }
}

function isJoin(s: PlanStep): s is OpStep {
  return s.kind === 'op' && OPS[s.op].multiInput === true;
}

/**
 * Before a plan runs: a join keeps only the clips that run (the user may have unchecked some). With fewer than
 * two left there is nothing to join and the step is dropped.
 */
export function pruneJoins(steps: PlanStep[], off: Set<string>): { steps: PlanStep[]; dropped: string[] } {
  const dropped: string[] = [];
  const out: PlanStep[] = [];
  for (const s of steps) {
    if (!isJoin(s)) {
      out.push(s);
      continue;
    }
    const clips = [s.input, ...(s.more ?? [])].filter((r) => {
      const p = parseRef(r);
      return !(p?.type === 'step' && off.has(p.id));
    });
    if (clips.length < 2) dropped.push(s.id);
    else out.push({ ...s, input: clips[0], more: clips.slice(1) });
  }
  return { steps: out, dropped };
}
