import { fitTotal, totalNote } from './planSent';
import { applyPlanStyle, continuityErrors, recurringSubjectErrors } from './continuity';
import { normalizeStepRefs } from './refRoles';
import { fitPlanSteps, fitState } from './agent/fit';
import type { OpStep, Plan, PlanStep, PlanSubject, StepRef } from './types';
import { derivedSchemaErrors } from './schemaGuard';
import { NORMALIZE_STEP } from './planSteps';
import { isJoin, stepInfo } from './planSteps/inspect';
import { rawStepInfo } from './planSteps/raw';
import type { OutputKind, PlanContext, RawPlan, StepEnv } from './planSteps/env';
import { parseRef } from './planRef';

export type { OutputKind, PlanContext, RawPlan, RawStep } from './planSteps/env';

/** Largest plan the agent may propose (tool schema, zod and normalizer share it). */
export const MAX_PLAN_STEPS = 16;

/* Plans are DAGs of steps proposed by the agent. This module validates them. */

/** "@Name" in a prompt, as the app reads mentions (params.mentionSubjects). */
export function mentions(prompt: string | undefined, name: string): boolean {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(prompt) && new RegExp(`@${esc}(?![\\p{L}\\p{N}_-])`, 'iu').test(prompt!);
}

export function stepOutputKind(step: PlanStep): OutputKind {
  return stepInfo(step).output();
}

export function stepDeps(step: PlanStep): StepRef[] {
  return stepInfo(step).deps();
}

export function ownDeps(step: PlanStep): StepRef[] {
  return stepInfo(step).ownDeps();
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
  const unset = rawSteps.filter((s) => rawStepInfo(s)?.clip && s.duration == null);
  const setSecs = rawSteps.reduce((sum, s) => sum + (rawStepInfo(s)?.clip && s.duration != null ? Number(s.duration) || 0 : 0), 0);
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
    const output = rawStepInfo(s)?.output(s, ctx);
    const kind = output instanceof Promise ? await output : output;
    if (kind) kindById.set(s.id!, kind);
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
      return st && stepInfo(st).imageAspect();
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
    rawStepInfo(s)?.repairFrames?.(s, isVideo, frameOf, adjustments);
  }
  const env: StepEnv = { ctx, raw, rawSteps, errors, adjustments, steps, st, share, stepRoles, fit, refKind, expectImage, inputAspect, frameOf };
  for (const s of rawSteps) {
    const where = `Step ${s.id}`;
    const normalize = Object.hasOwn(NORMALIZE_STEP, s.kind ?? '') ? NORMALIZE_STEP[s.kind as PlanStep['kind']] : undefined;
    if (normalize) await normalize(s, env);
    else errors.push(`${where}: unknown kind "${s.kind}". Use text, image, video, audio, op or layer.`);
  }

  if (ctx.workspace === 'node') {
    const problems = new Set(steps.flatMap((s) => stepInfo(s).nodePlanProblem ?? []));
    errors.push(...problems);
  }
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
    const candidates = new Set(steps.filter((st) => stepInfo(st).hasCandidates()).map((st) => st.id));
    for (const st of steps) {
      const uses = stepDeps(st).map((r) => parseRef(r)).filter((p) => p?.type === 'step' && candidates.has(p.id)).map((p) => p!.id);
      for (const id of new Set(uses)) {
        errors.push(`${st.id}: uses ${id}, which makes ${stepInfo(steps.find((x) => x.id === id)!).candidateLabel} for the user to choose from — the user has not picked one yet. Fix: end this plan at ${id} (drop ${st.id} and every step after it that needs ${id}); after the user picks, the next plan uses the chosen result.`);
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
      if (stepInfo(st).prompts().some((text) => mentions(text, subj.name)) && !(st.after ?? []).includes(p.id)) st.after = [...(st.after ?? []), p.id];
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
    const info = stepInfo(st);
    if (!info.visual) continue;
    const prompts = info.prompts();
    for (const m of prompts.flatMap((prompt) => [...prompt.matchAll(/(?<![\p{L}\p{N}._-])@([\p{L}\p{N}_-]{1,32})/gu)])) {
      const n = m[1];
      if (REF_SYNTAX.test(n) || names.has(n.toLowerCase())) continue;
      errors.push(`step ${st.id}: @${n} is not in the library; for temporary use of an existing image, carry it in refs and cite its role with the model reference syntax, or describe without @ if no reference is needed. A subject from an image step is temporary; use subjects from asset:<id> only when the user explicitly asked to save or accepted an offer to save.`);
    }
  }
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
