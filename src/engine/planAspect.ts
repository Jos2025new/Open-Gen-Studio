import { aspectLabel } from './params';
import type { RawPlan } from './plan';

/*
 * Aspect follows the deliverable (ADR 0025 E). The aspect confirmed on the card is the deliverable's: it is forced on
 * the steps that make it. Two kinds of image step are not forced:
 * - a reference step (its output exists to be referenced: it is in another step's refs, a continuity source or a
 *   subject's source) that writes its own aspect, e.g. a full-body character in 9:16 inside a 16:9 job: the agent asked
 *   for it on purpose;
 * - a step made from one image that came from outside the plan (an upload, an earlier result) and writes no aspect
 *   keeps that image's shape (R7), instead of being cut to the card's.
 * A step that uses a reference STEP is a deliverable and takes the confirmed aspect. Videos always take the card's.
 */

/** Ids of the steps that exist to be referenced by others. */
export function referenceStepIds(raw: Pick<RawPlan, 'continuity' | 'subjects'>, steps: NonNullable<RawPlan['steps']>): Set<string> {
  const ids = new Set(steps.map((s) => s.id));
  const out = new Set<string>();
  const add = (ref: string | undefined) => {
    const id = ref?.split('#')[0];
    if (id && ids.has(id)) out.add(id);
  };
  for (const s of steps) if (s.kind === 'image' || s.kind === 'video') (s.refs ?? []).forEach((r) => add(typeof r === 'string' ? r : r.ref));
  raw.continuity?.forEach((g) => add(g.source));
  raw.subjects?.forEach((x) => add(x.from));
  return out;
}

/**
 * The aspect to force on this image step: the card's, the shape of its one outside input (R7; the model then snaps it
 * to its nearest option), or undefined to leave the step's own (a reference that wrote one). Notes what the app
 * changed in `adjustments`.
 */
export function aspectFor(
  step: { id?: string; aspect?: string },
  raw: Pick<RawPlan, 'continuity' | 'subjects'>,
  steps: NonNullable<RawPlan['steps']>,
  imageRefs: string[],
  inputAspect: (ref: string) => string | undefined,
  confirmed: string | undefined,
  adjustments: string[],
): string | undefined {
  if (confirmed == null) return undefined;
  if (step.aspect && referenceStepIds(raw, steps).has(step.id ?? '')) return undefined;
  const shape = !step.aspect && imageRefs.length === 1 && !steps.some((s) => s.id === imageRefs[0].split('#')[0]) ? inputAspect(imageRefs[0]) : undefined;
  if (!shape) return confirmed;
  const [w, h] = shape.split(':').map(Number);
  const g = gcd(w, h) || 1;
  const reduced = `${w / g}:${h / g}`;
  if (reduced !== confirmed) adjustments.push(`${step.id}: aspect ${aspectLabel(reduced)} from the input image, not the confirmed ${aspectLabel(confirmed)}`);
  return reduced;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
