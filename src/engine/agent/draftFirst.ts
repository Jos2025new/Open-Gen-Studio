import type { AgentStyle, FeedItem } from '../types';

/*
 * Draft first (all videos): before a video plan the user always picks "Borrador" (cheap, lowest resolution, to choose
 * the style and the feeling), "Alta calidad directamente" or writes something else. It is the ordinary questions card with
 * one fixed question; the plan is refused until it is answered, and the card cannot be skipped.
 */

export const DRAFT_ID = 'draft_first';
export const DRAFT = 'Borrador';
export const HQ = 'Alta calidad directamente';
const QUESTION = 'Video: ¿borrador para elegir estilo y sensación, o alta calidad directamente?';

export const DRAFT_RULE = `Every video plan: after you have settled the video's model and before propose_plan, call ask_questions once with ONE question whose id is "${DRAFT_ID}" (the app fixes its options: "${DRAFT}", "${HQ}" and a free "Otra cosa…" field; you may leave options as any two strings). The app refuses a video plan until the user answered it. "${DRAFT}": every video step gets purpose "draft" and the lowest resolution its model lists (480p when it exists), so the user picks style and feeling cheaply. "${HQ}": the settings confirmed. Free text: follow it. A finished draft offers "Mejorar esta toma" (same prompt and seed in high quality); never offer it yourself.`;

type RawQuestion = { id: string; question: string; options: string[]; allow_custom?: boolean; multi?: boolean; default?: string };

/** The card the app wants for this question, whatever the agent wrote. */
export function draftCanon<Q extends RawQuestion>(questions: Q[]): Array<Q & RawQuestion> {
  return questions.map((q) => (q.id === DRAFT_ID ? { ...q, question: QUESTION, options: [DRAFT, HQ], allow_custom: true, multi: false, default: DRAFT } : q));
}

/** An ask_questions call that carries the draft question: it does not use up a question round. */
export const isDraftCard = (raw: unknown): boolean => Array.isArray((raw as { questions?: unknown })?.questions) && (raw as { questions: Array<{ id?: unknown }> }).questions.some((q) => q?.id === DRAFT_ID);

/** The user's answer to the latest answered draft card of this request: 'draft', 'hq' or their own words. */
export function draftAnswer(feed: FeedItem[], sinceLastUser = true): 'draft' | 'hq' | 'other' | undefined {
  const from = sinceLastUser ? feed.map((f) => f.type).lastIndexOf('user') : -1;
  for (let i = feed.length - 1; i > from; i--) {
    const f = feed[i];
    if (f.type !== 'questions' || f.status !== 'answered') continue;
    const a = f.answers?.[DRAFT_ID];
    if (a != null) return a === DRAFT ? 'draft' : a === HQ ? 'hq' : 'other';
  }
  return undefined;
}

/** Why a plan with video cannot be shown yet, or null. Direct mode has no cards, so it never asks. */
export function draftGate(steps: Array<{ kind?: string; purpose?: string; resolution?: string }>, feed: FeedItem[], style: AgentStyle, revision: boolean): string | null {
  const videos = steps.filter((s) => s.kind === 'video');
  if (!videos.length || style === 'direct') return null;
  const answer = draftAnswer(feed) ?? (revision ? draftAnswer(feed, false) : undefined);
  if (!answer) return `Not shown: a video plan needs the draft choice first. Call ask_questions with one question whose id is "${DRAFT_ID}" (the app sets its options) and wait for the answer; then call propose_plan again.`;
  if (answer === 'draft' && videos.some((s) => s.purpose !== 'draft' && !s.resolution)) return `The user chose "${DRAFT}": every video step needs purpose "draft" and the lowest resolution its model lists (480p when it exists). Fix the video steps and call propose_plan again.`;
  return null;
}
