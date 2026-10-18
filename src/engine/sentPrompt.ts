import { opRealism } from './realism';
import { variantPrompt } from './variantPrompt';
import type { PlanStep } from './types';

type RealismSource = Parameters<typeof opRealism>[0];

/**
 * The prompt a request carries: the step's prompt with the capture style / realism clauses the settings ask for, then
 * the variation of that candidate on its own line. The send path (jobs.ts) and the plan card both build it here.
 */
export function sentPrompt(g: RealismSource, kind: string, prompt: string, modelId: string, variation?: string): string {
  return withVariation(opRealism(g, kind, prompt, modelId), variation);
}

/** The variation of a candidate after the (already styled) shared prompt. */
export const withVariation = (shown: string, variation?: string): string => (variation == null ? shown : variantPrompt(shown, variation));

/**
 * What the plan card shows for an image or video step: the same text the job will send. The model id is the catalog's
 * for the step's modelRef; the card cannot know what the job resolves later (see the report: @subject mentions, text
 * from another step, a storyboard that replaces the prompt, references that fail to load).
 */
export function stepSentPrompt(s: PlanStep, modelId: string, variation?: string): string {
  if (s.kind !== 'image' && s.kind !== 'video') return '';
  const g: RealismSource = { settings: s.settings, inputs: { refs: s.refs ?? [], firstFrame: s.kind === 'video' ? s.firstFrame : undefined } };
  return sentPrompt(g, s.kind, s.prompt, modelId, variation);
}
