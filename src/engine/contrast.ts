/*
 * Contrast levels for ideation: how far an idea departs from what the viewer expects. Applied only to the subject and
 * action part of a prompt, never to camera or style (capture styles), so it combines with any preset. No fixed UI:
 * the agent offers variants during ideation and the user asks in words ("súbelo a nivel 2") or ignores it.
 */
export const CONTRAST_LEVELS = [
  { level: 0, name: 'none', what: 'the idea as expected: the subject does the obvious thing in the obvious place' },
  { level: 1, name: 'unexpected situation', what: 'what happens, or who or what is there, is out of place' },
  { level: 2, name: 'unexpected styling or attitude', what: 'how the subject looks or behaves clashes with the situation' },
  { level: 3, name: 'feeling', what: 'a felt contradiction the viewer senses without it being stated' },
] as const;

export const MAX_CONTRAST = CONTRAST_LEVELS.length - 1;
export const clampContrast = (n: number) => Math.min(MAX_CONTRAST, Math.max(0, Math.round(n)));

/** The always-on rule (the guide skill:contrast has the examples). */
export const CONTRAST_RULE = `Contrast levels (ideation, only when shaping an idea): ${CONTRAST_LEVELS.map((l) => `${l.level} ${l.name}`).join('; ')}. Assess the idea's level; if it is 0 or 1 offer 2-3 variants one level up as suggestions, in the user's language. A level changes only the subject and action part of the prompt, never camera, style or capture, so it combines with any preset. The user may ask ("súbelo a nivel 2", "más contraste") or ignore it: then drop it. No controls, no questions card just for this. Load skill:contrast for examples.`;

export interface ContrastAsk { level?: number; delta?: number }

/** What a user message asks about contrast: an explicit level, or one step up or down. */
export function parseContrastAsk(text: string): ContrastAsk | null {
  const t = text.toLowerCase();
  const n = /\b(?:nivel(?:es)?|level)\s*([0-3])\b/.exec(t);
  if (n) return { level: Number(n[1]) };
  if (/\b(?:s[uú]be(?:l[oae])?|subir|aumenta(?:r)?|m[aá]s|raise|increase|more)\b\s*(?:el\s+|the\s+)?(?:contraste|contrast)\b/.test(t)) return { delta: 1 };
  if (/\b(?:b[aá]ja(?:l[oae])?|bajar|reduce|menos|less|lower)\b\s*(?:el\s+|the\s+)?(?:contraste|contrast)\b/.test(t)) return { delta: -1 };
  return null;
}

/** The context line when the latest user message asks for a level. */
export function contrastLine(userText: string | undefined): string | undefined {
  const ask = userText ? parseContrastAsk(userText) : null;
  if (!ask) return undefined;
  const what = ask.level != null ? `level ${clampContrast(ask.level)} (${CONTRAST_LEVELS[clampContrast(ask.level)].name})` : `${ask.delta! > 0 ? 'one level up' : 'one level down'} from the idea's current level`;
  return `contrast: the user asks for ${what}. Rewrite only the subject and action part of the prompts; keep camera, style and capture.`;
}
