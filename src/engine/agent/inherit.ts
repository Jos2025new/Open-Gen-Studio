import { lineRoutes } from '../catalog';
import type { PlanStep, SettingsChoice } from '../types';
import { rememberSessionModel } from './sessionModel';

/**
 * Direct has no settings card: when the user approves a plan, remember its model and values in that session.
 * A rejected or never-approved plan never reaches this.
 */
export function inheritApproved(sessionId: string, steps: PlanStep[], comparisons: readonly ('image' | 'video')[] = []): void {
  type Gen = Extract<PlanStep, { kind: 'image' | 'video' }>;
  const gens = steps.filter((step): step is Gen => step.kind === 'image' || step.kind === 'video');
  for (const kind of ['image', 'video'] as const) {
    if (comparisons.includes(kind)) continue;
    const of = gens.filter((step) => step.kind === kind && step.modelRef);
    const line = (ref: string) => lineRoutes(ref).text ?? ref;
    if (!of.length || new Set(of.map((step) => line(step.modelRef))).size > 1) continue;
    const step = of[0];
    const choice: SettingsChoice = {
      modelRef: line(step.modelRef),
      aspect: step.settings.aspect,
      resolution: step.settings.resolution,
      needsImage: Boolean(step.refs?.length || (step.kind === 'video' && step.firstFrame)),
      ...(step.kind === 'video' ? { duration: step.settings.duration } : { count: step.settings.count }),
    };
    rememberSessionModel(sessionId, kind, choice, true);
  }
}

/**
 * Auto: approving a plan confirms what it runs, so the next request starts from what the user approved and not from an
 * older choice the plan no longer shows (sandbox session 2026-10-25: Seedream ran, Nano Banana Pro stayed confirmed and
 * the next plan was "corrected" back to it). Per kind, the model and values of its first step that runs, as the card
 * shows them; the model as its text route (text to image or to video), never the edit or image-to-video variant a step's
 * inputs need. A kind run on two lines (a comparison) keeps its confirmed choice. Operations are not plan steps of a
 * kind, so they never set it.
 */
export function confirmApproved(sessionId: string, steps: PlanStep[], comparisons: readonly ('image' | 'video')[] = []): void {
  type Gen = Extract<PlanStep, { kind: 'image' | 'video' }>;
  const gens = steps.filter((s): s is Gen => s.kind === 'image' || s.kind === 'video');
  for (const kind of ['image', 'video'] as const) {
    if (comparisons.includes(kind)) continue;
    const of = gens.filter((s) => s.kind === kind && s.modelRef);
    const line = (ref: string) => lineRoutes(ref).text ?? ref;
    if (!of.length || new Set(of.map((s) => line(s.modelRef))).size > 1) continue;
    const s = of[0];
    const choice: SettingsChoice = { modelRef: line(s.modelRef), aspect: s.settings.aspect, resolution: s.settings.resolution, needsImage: Boolean(s.refs?.length || (s.kind === 'video' && s.firstFrame)), ...(s.kind === 'video' ? { duration: s.settings.duration } : { count: s.settings.count }) };
    rememberSessionModel(sessionId, kind, choice);
  }
}
