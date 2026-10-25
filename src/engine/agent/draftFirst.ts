import type { AgentStyle, FeedItem, SettingsChoice } from '../types';

/** The draft choice every video settings card carries; `locked`: the app fixed the resolution (draft) and only the padlock lifts it; `unlocked`: it was lifted. */
export interface DraftMode { kind: 'draft' | 'hq' | 'other'; text?: string; locked: boolean; unlocked?: boolean }

/*
 * Draft first (all videos): the video settings card carries a mandatory choice at its top: "Borrador" (cheap, lowest
 * resolution, to choose the style and the feeling), "Alta calidad" or the user's own words. The plan is refused until
 * a settings card with that choice was confirmed; in Auto the latest choice confirmed in the session is reused (the plan card says so and has a Cambiar button) unless the user asks to change it. "Borrador" sets the lowest resolution and LOCKS it: the app applies it
 * at confirmation and over every plan step, so the agent cannot change it. The padlock on the card lifts the lock.
 */

export const DRAFT = 'Borrador';
export const HQ = 'Alta calidad';

export const DRAFT_RULE = `Every video plan: the app puts the draft choice ("${DRAFT}" / "${HQ}" / the user's words) at the top of the video settings card; never ask it yourself and never put a resolution in confirm_settings. "${DRAFT}": the app sets the lowest resolution and locks it; you cannot change or unlock it, and any resolution you write in a step is replaced. If a note says the user unlocked the resolution and chose another, they decided it: acknowledge it briefly, do not question it, and go on with the plan already accepted. Free text: follow it. Auto shows no settings card: confirm_settings returns at once with the session's draft choice (Borrador by default) and the user changes it, the model and the values on the plan card, where the app adapts the prompts itself; never ask it. Guided asks on every request. A finished draft offers "Mejorar esta toma" (same prompt and seed in high quality); never offer it yourself.`;

const pixels = (r: string): number => Number(/(\d{3,4})/.exec(r)?.[1] ?? NaN);

/** 480p when the model has it, else its lowest resolution. */
export function lowestResolution(list: string[]): string | undefined {
  if (!list.length) return undefined;
  if (list.includes('480p')) return '480p';
  return [...list].sort((a, b) => (pixels(a) || Infinity) - (pixels(b) || Infinity))[0];
}

export function highestResolution(list: string[]): string | undefined {
  return [...list].sort((a, b) => (pixels(b) || 0) - (pixels(a) || 0))[0];
}

/** The resolution a draft mode gives a video choice: draft the lowest (locked), high quality the recommended unless that is the lowest, else the highest. */
export function modeResolution(mode: DraftMode | undefined, list: string[], recommended?: string): string | undefined {
  if (!list.length) return undefined;
  if (mode?.kind === 'draft') return lowestResolution(list);
  if (mode?.kind === 'hq') return recommended && list.includes(recommended) && recommended !== lowestResolution(list) ? recommended : highestResolution(list);
  return undefined;
}

/** The draft mode for a choice made on the card. */
export const draftMode = (kind: DraftMode['kind'], text?: string): DraftMode => ({ kind, ...(kind === 'other' ? { text: text ?? '' } : {}), locked: kind === 'draft' });

/** What the agent is told when the user lifts the padlock: a fact, not a request. */
export const unlockNote = (resolution: string | undefined): string => `El usuario desbloqueó la resolución de borrador y eligió ${resolution ?? 'la predeterminada'}. Es su decisión: no la cuestiones; confírmalo en una frase y sigue con el plan ya aceptado.`;

/** The user's choice on the latest confirmed video settings card of this request: 'draft', 'hq' or their own words. */
export function draftAnswer(feed: FeedItem[], sinceLastUser = true): 'draft' | 'hq' | 'other' | undefined {
  const from = sinceLastUser ? feed.map((f) => f.type).lastIndexOf('user') : -1;
  for (let i = feed.length - 1; i > from; i--) {
    const f = feed[i];
    if (f.type !== 'settings' || f.status !== 'confirmed' || !f.draft) continue;
    if (f.draft.kind === 'other' && !f.draft.text?.trim()) continue;
    return f.draft.kind;
  }
  return undefined;
}

/** The user's words ask to change the draft / quality choice ("en alta calidad", "mejor un borrador", "cambiar la resolución"). */
export const asksDraftChange = (text: string | undefined): boolean => /borrador|draft|calidad|quality|resoluci|resolution/i.test(text ?? '');

/** The quality a request clearly asks for ("alta calidad", "HQ" / "borrador", "draft"); "calidad" or "resolución" alone, or both kinds, ask nothing. */
export function askedQuality(text: string | undefined): 'draft' | 'hq' | undefined {
  const hq = /\b(alta\s+calidad|calidad\s+alta|high[\s-]quality|hq)\b/i.test(text ?? '');
  const draft = /\b(borrador|draft)\b/i.test(text ?? '');
  return hq === draft ? undefined : hq ? 'hq' : 'draft';
}

const lastUserText = (feed: FeedItem[]): string | undefined => {
  const u = [...feed].reverse().find((f) => f.type === 'user');
  return u?.type === 'user' ? u.text : undefined;
};

/** The latest draft choice confirmed in the session (Auto reuses it in later requests), or undefined. */
export function latestDraft(feed: FeedItem[]): DraftMode | undefined {
  for (let i = feed.length - 1; i >= 0; i--) {
    const f = feed[i];
    if (f.type === 'settings' && f.status === 'confirmed' && f.draft && !(f.draft.kind === 'other' && !f.draft.text?.trim())) return f.draft;
  }
  return undefined;
}

/**
 * The draft choice this plan reused instead of asking again (Auto only), for the plan card: none was confirmed since
 * the user's last message before the plan, and an earlier one exists.
 */
export function reusedDraft(feed: FeedItem[], planId: string): DraftMode | undefined {
  const at = feed.findIndex((f) => f.id === planId);
  const plan = feed[at];
  if (plan?.type !== 'plan' || plan.style !== 'auto' || !plan.plan.steps.some((s) => s.kind === 'video')) return undefined;
  const before = feed.slice(0, at);
  return draftAnswer(before) ? undefined : latestDraft(before);
}

/** Why a plan with video cannot be shown yet, or null. Direct mode has no cards, so it never asks. Auto reuses the session's last choice unless the user asks to change it; a revision keeps the request's own (any style). */
export function draftGate(steps: Array<{ kind?: string }>, feed: FeedItem[], style: AgentStyle, revision: boolean): string | null {
  if (!steps.some((s) => s.kind === 'video') || style === 'direct') return null;
  if (draftAnswer(feed)) return null;
  const auto = style === 'auto';
  const change = auto && asksDraftChange(lastUserText(feed));
  if ((revision || auto) && !change && latestDraft(feed)) return null;
  return auto
    ? `Not shown: call confirm_settings (kind video) first. In Auto it shows no card: the app sets the values and the draft choice and answers at once; then call propose_plan again, in this turn.`
    : `Not shown: a video plan needs the draft choice, which is on the video settings card. Call confirm_settings (kind video) and wait for the user to continue; then call propose_plan again.`;
}

/** The choice with the mode's resolution applied (draft: always the lowest, whatever it held). */
export function withModeResolution(choice: SettingsChoice, mode: DraftMode | undefined, list: string[], recommended?: string): SettingsChoice {
  const r = modeResolution(mode, list, recommended);
  return r ? { ...choice, resolution: r } : choice;
}
