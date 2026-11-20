import { fitTotal, totalNote } from './planSent';
import { type VariantRoute } from './variants';
import { applyPlanStyle, continuityErrors, recurringSubjectErrors } from './continuity';
import { parsePath } from './design/path';
import { OPS } from './ops';
import { normalizeStepRefs, type RefSpec } from './refRoles';
import { type Realism } from './realism';
import { fitPlanSteps, fitState } from './agent/fit';
import { type RouteMode } from './routing';
import type { AssetKind, GenSettings, MediaKind, ModelSchema, ModelSummary, OpId, OpStep, Plan, PlanStep, PlanSubject, PlanContinuity, ShapeSpec, StrokeSpec, StepRef, TextStyle, Workspace, SubjectKind, SettingsChoice, Subject } from './types';
import { derivedSchemaErrors } from './schemaGuard';
import { NORMALIZE_STEP } from './planSteps';
import type { StepEnv } from './planSteps/env';
import { num } from './planSteps/shared';

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
  user_requested?: boolean;
  /** Video purpose. */
  purpose?: string;
  aspect?: string;
  resolution?: string;
  count?: number;
  /** Image: one short variation per result (candidates that differ). */
  variations?: string[];
  duration?: number;
  audio?: boolean;
  seed?: number;
  refs?: RefSpec[];
  realism?: Realism;
  shot?: string;
  capture?: unknown;
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
  continuity?: PlanContinuity[];
  title?: string;
  summary?: string;
  /** Seconds the video steps add up to; split over the video steps without their own duration. */
  total_duration?: number;
  steps?: RawStep[];
  /** Subjects to save: { name, from: an image step or asset:<id>, description? }. */
  subjects?: Array<{ name?: string; kind?: SubjectKind; from?: string; description?: string }>;
  /** One style block the app appends to every image and video prompt. */
  style?: string;
  /** Notes of what a revision copied from the plan it replaces (set by the app, not the agent). */
  carried?: string[];
}

export type OutputKind = AssetKind | 'text' | 'layer';

export interface PlanContext {
  workspace: Workspace;
  getModel: (ref: string) => Promise<{ model: ModelSummary; schema: ModelSchema } | null>;
  defaultModel: (kind: MediaKind, needsImage: boolean) => string | null;
  defaultSettings: (kind: MediaKind) => Partial<GenSettings>;
  asset: (id: string) => { kind: AssetKind; width?: number; height?: number } | undefined;
  layer: (id: string) => { type: string } | undefined;
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
  /** Exact input route within the confirmed model line and provider; no fuzzy name search. */
  variantModel?: (ref: string, route: VariantRoute) => string | undefined;
  /** True when the user picked this kind's model by hand but it has no variant for these inputs and a stand-in is used. */
  defaultIsFallback?: (kind: MediaKind, needsImage: boolean) => boolean;
  /** What the user wrote (messages, answers): a model the plan names wins over the composer's pick only if it is named here. */
  userText?: () => string;
  /** Images attached to the current request: the start frame a model needs when the plan forgot it. */
  requestImages?: () => string[];
  /** Sources for known @Name references. */
  librarySubjects?: () => Subject[];
  /** Library names for callers that do not need source assets. */
  subjectNames?: () => string[];
  /** New proposals require recurring continuity coverage. */
  strictContinuity?: boolean;
  /** Settings the user confirmed (phase 2): model, resolution, duration and aspect for every step of that kind. */
  confirmed?: (kind: MediaKind) => SettingsChoice | undefined;
  /** Every confirmed part of that kind, in card order: several when the card compared models (A/B in one plan). */
  confirmedParts?: (kind: MediaKind) => SettingsChoice[];
  /** The request being handled: its message and its answers. What a fitted operation parameter is read from. */
  requestText?: () => string;
  switchedTo?: (kind: MediaKind) => SettingsChoice | undefined;
  /** Angle values already made from this source image, so "a different angle" takes one that is not made yet. */
  usedAngles?: (assetId: string) => string[];
  /** Direct mode: no questions, so an ambiguity takes the operation's visible default instead of asking. */
  direct?: () => boolean;
  /** A question round is left in this request, and whether the user already answered one (fit.ts asks once). */
  canAsk?: () => boolean;
  answered?: () => boolean;
  /** The image model an image-model operation runs on: the confirmed one (Auto, Guided) or the composer's (Direct). */
  opModel?: () => string | undefined;
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

export function ownDeps(step: PlanStep): StepRef[] {
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
      return [step.input, ...(step.more ?? []), ...(step.refs ?? []).map((r) => r.ref), ...(typeof step.params?.music === 'string' && step.params.music ? [step.params.music] : [])];
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

/** Validate a raw agent plan and return a usable plan or repair errors. */
export async function normalizePlan(raw: RawPlan, ctx: PlanContext, planId: string): Promise<{ plan: Plan | null; errors: string[] }> {
  const errors: string[] = [];
  const adjustments: string[] = [...(raw.carried ?? [])];
  // Fit across steps (fit.ts): "múltiples ángulos" asked, or three angle steps in Direct; views as angles asked.
  const fit = fitState(Boolean(ctx.direct?.()), ctx.canAsk?.() ?? true, ctx.answered?.() ?? false);
  const planFit = fitPlanSteps(Array.isArray(raw.steps) ? raw.steps : [], ctx.requestText?.() ?? '', fit);
  const rawSteps = planFit.steps;
  const stepRoles = normalizeStepRefs(rawSteps, errors, ctx.requestImages?.());
  errors.push(...planFit.errors);
  adjustments.push(...planFit.adjustments);
  const maxSteps = ctx.maxSteps ?? MAX_PLAN_STEPS;
  if (!rawSteps.length) return { plan: null, errors: ['The plan has no steps.'] };
  // A total length is split evenly over video steps that set none (snapped to the model's lengths).
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
  const st = new Map<string, boolean>();
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
  const env: StepEnv = { ctx, raw, rawSteps, errors, adjustments, steps, st, ids, share, total, stepRoles, fit, refKind, expectImage, inputAspect, frameOf, frames };
  for (const s of rawSteps) {
    const where = `Step ${s.id}`;
    const normalize = Object.hasOwn(NORMALIZE_STEP, s.kind ?? '') ? NORMALIZE_STEP[s.kind as PlanStep['kind']] : undefined;
    if (normalize) await normalize(s, env);
    else errors.push(`${where}: unknown kind "${s.kind}". Use text, image, video, audio, op or layer.`);
  }

  if (ctx.workspace === 'node' && steps.some((s) => s.kind === 'layer')) errors.push('Layer steps are not valid in the Node workspace.');
  const library = ctx.librarySubjects?.() ?? [];
  const knownNames = [...(ctx.subjectNames?.() ?? []), ...library.map((x) => x.name)];
  const subjects = planSubjects(raw.subjects, steps, refKind, errors, adjustments, knownNames);
  const continuity = raw.continuity ?? [];
  for (const group of continuity) {
    if (!group.source?.trim() || !group.preserve?.trim() || !Array.isArray(group.steps) || !group.steps.length) errors.push('continuity: source, preserve and consuming steps are required.');
    else refKind(group.source, 'continuity source');
  }
  if (continuity.length && !errors.length) errors.push(...continuityErrors(continuity, steps, subjects, library, ctx.strictContinuity ? step => st.get(step.id) ?? false : undefined));
  if (ctx.strictContinuity) errors.push(...recurringSubjectErrors(steps, subjects, library, continuity));
  unknownMentions(steps, [...knownNames, ...subjects.map((x) => x.name)], errors);
  const style = raw.style?.trim();
  if (style) {
    for (const st of steps) applyPlanStyle(st, style);
  }
  // Candidates end a plan: no later step may take one of several results the user has not picked (not in Nodes).
  if (ctx.workspace !== 'node') {
    // Steps with count > 1, and ops that make several.
    const several = (st: PlanStep) => ((st.kind === 'image' || st.kind === 'video') && (st.settings.count ?? 1) > 1) || (st.kind === 'op' && Number(st.params.count ?? 1) > 1);
    const candidates = new Set(steps.filter(several).map((st) => st.id));
    for (const st of steps) {
      const uses = stepDeps(st).map((r) => parseRef(r)).filter((p) => p?.type === 'step' && candidates.has(p.id)).map((p) => p!.id);
      for (const id of new Set(uses)) {
        errors.push(`${st.id}: uses ${id}, which makes ${steps.find((x) => x.id === id)!.kind === 'video' ? 'several clips' : 'several images'} for the user to choose from — the user has not picked one yet. Fix: end this plan at ${id} (drop ${st.id} and every step after it that needs ${id}); after the user picks, the next plan uses the chosen result.`);
      }
    }
  }
  if (!errors.length) errors.push(...await derivedSchemaErrors(steps, ctx.getModel));
  if (!errors.length) {
    try {
      topoOrder(steps);
    } catch (err) {
      errors.push((err as Error).message);
    }
  }
  if (errors.length) return { plan: null, errors };
  if (share) await fitTotal(total, rawSteps, steps, ctx.getModel, adjustments);
  const totalLine = totalNote(raw.total_duration, steps);
  if (totalLine) adjustments.push(totalLine);
  return {
    plan: {
      id: planId,
      title: (raw.title ?? '').trim() || 'Plan',
      summary: (raw.summary ?? '').trim(),
      workspace: ctx.workspace,
      steps,
      ...(subjects.length ? { subjects } : {}),
      ...(continuity.length ? { continuity } : {}),
      ...(style ? { style } : {}),
      adjustments,
    },
    errors: [],
  };
}

/**
 * Asset subjects save or reuse library entries; step subjects are temporary overrides. Mentions add `after`
 * dependencies so the source image exists before the dependent prompt is sent.
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
    if (existing.some((n) => n.toLowerCase() === name.toLowerCase())) {
      adjustments.push(parseRef(r.from)?.type === 'step'
        ? `@${name} uses the temporary image from ${r.from}; the existing library item is unchanged`
        : `@${name} already exists in this session: reused`);
    }
    out.push({ name, from: r.from.trim(), ...(r.kind ? { kind: r.kind } : {}), ...(r.description?.trim() ? { description: r.description.trim() } : {}) });
  }
  for (const subj of out) {
    const p = parseRef(subj.from);
    if (p?.type !== 'step') continue;
    for (const st of steps) {
      if (st.id === p.id) continue;
      const text = st.kind === 'image' || st.kind === 'video' || st.kind === 'model3d' || st.kind === 'audio' ? st.prompt : st.kind === 'op' ? Object.values(st.params).join(' ') : undefined;
      if ((mentions(text, subj.name) || (st.kind === 'video' && st.settings.shots?.some((shot) => mentions(shot.prompt, subj.name)))) && !(st.after ?? []).includes(p.id)) st.after = [...(st.after ?? []), p.id];
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
    const prompts = [st.prompt, ...(st.kind === 'video' ? st.settings.shots?.map((shot) => shot.prompt) ?? [] : [])];
    for (const m of prompts.flatMap((prompt) => [...prompt.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)])) {
      const n = m[1];
      if (REF_SYNTAX.test(n) || names.has(n.toLowerCase())) continue;
      errors.push(`step ${st.id}: @${n} is not in the library; for temporary use of an existing image, carry it in refs and cite its role with the model reference syntax, or describe without @ if no reference is needed. A subject from an image step is temporary; use subjects from asset:<id> only when the user explicitly asked to save or accepted an offer to save.`);
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
