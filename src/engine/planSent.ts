/** Checks that measure a plan as it will be sent, kept apart from plan.ts, which may not grow. */

/** The text the plan style adds to an image or video prompt (applyPlanStyle), so its length is checked with it. */
export function styleSuffix(kind: string, prompt: string, style: string | undefined): string {
  const s = style?.trim();
  return (kind === 'image' || kind === 'video') && s && !prompt.includes(s) ? `\n\nStyle: ${s}` : '';
}

/** Why a prompt is too long as sent (with the plan style the executor appends), or undefined. */
export function promptTooLong(kind: string, prompt: string, style: string | undefined, max: number | undefined): string | undefined {
  const extra = styleSuffix(kind, prompt, style);
  const n = prompt.length + extra.length;
  if (!max || n <= max) return undefined;
  return `takes prompts up to ${max} characters (this one has ${n}${extra ? ', with the plan style' : ''}). Shorten it${extra ? ' or the style' : ''}. [PROMPT_TOO_LONG]`;
}
