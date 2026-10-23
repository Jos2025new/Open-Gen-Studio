/** Checks that measure a plan as it will be sent, kept apart from plan.ts, which may not grow. */
import { durationChoices } from './params';
import type { ModelSchema } from './types';

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

/** E3-01: the video length the plan really makes against the total the user asked for, said on the card (no stop). */
export function totalNote(total: unknown, steps: Array<{ kind: string; settings?: { duration?: number } }>): string | undefined {
  const asked = Number(total);
  const clips = steps.filter((s) => s.kind === 'video');
  if (!(asked > 0) || !clips.length || clips.some((s) => !(Number(s.settings?.duration) > 0))) return undefined;
  const made = clips.reduce((n, s) => n + Number(s.settings!.duration), 0);
  return Math.abs(made - asked) >= 1 ? `video total: ${made} s instead of the ${asked} s asked; each clip uses a length the model allows.` : undefined;
}

/** Sets the length of each unset video clip (pickClipLengths) once its model is resolved; set clips keep theirs. */
export async function fitTotal(
  total: number,
  raw: Array<{ id?: string; kind?: string; duration?: unknown }>,
  steps: Array<{ id: string; kind: string; modelRef?: string; settings?: { duration?: number } }>,
  getModel: (ref: string) => Promise<{ schema: ModelSchema } | null>,
): Promise<void> {
  const unsetIds = new Set(raw.filter((s) => s.kind === 'video' && s.duration == null).map((s) => s.id));
  const mine = steps.filter((s) => s.kind === 'video' && unsetIds.has(s.id) && s.settings && s.modelRef);
  const fixed = steps.filter((s) => s.kind === 'video' && !mine.includes(s)).reduce((n, s) => n + (Number(s.settings?.duration) || 0), 0);
  const options = await Promise.all(mine.map(async (s) => durationChoices((await getModel(s.modelRef!))?.schema)));
  const picks = pickClipLengths(total, fixed, options);
  picks?.forEach((n, i) => { mine[i].settings!.duration = n; });
}

/**
 * E3-01: the length of each clip whose duration is not set, chosen from what that clip's model allows so the video
 * total comes out as asked (25 s over three clips of 5/10 s → 10, 10, 5), or the closest total when none does.
 * Lengths are as even as possible; earlier clips take the longer ones. `fixedSecs` is what the set clips already add.
 */
export function pickClipLengths(total: number, fixedSecs: number, options: number[][]): number[] | undefined {
  const opts = options.map((o) => [...new Set(o.filter((n) => n > 0))].sort((a, b) => b - a));
  if (!(total > 0) || !opts.length || opts.some((o) => !o.length) || opts.length > 24) return undefined;
  const want = total - fixedSecs;
  let sums = new Set<number>([0]);
  for (const o of opts) sums = new Set([...sums].flatMap((s) => o.map((n) => s + n)));
  const best = [...sums].sort((a, b) => Math.abs(a - want) - Math.abs(b - want) || a - b)[0];
  const mean = best / opts.length;
  const memo = new Map<string, { cost: number; picks: number[] } | null>();
  const go = (i: number, left: number): { cost: number; picks: number[] } | null => {
    if (i === opts.length) return left === 0 ? { cost: 0, picks: [] } : null;
    const key = `${i}:${left}`;
    if (memo.has(key)) return memo.get(key)!;
    let out: { cost: number; picks: number[] } | null = null;
    for (const n of opts[i]) {
      const rest = n <= left ? go(i + 1, left - n) : null;
      if (!rest) continue;
      const cost = rest.cost + (n - mean) ** 2;
      if (!out || cost < out.cost - 1e-9) out = { cost, picks: [n, ...rest.picks] };
    }
    memo.set(key, out);
    return out;
  };
  return go(0, best)?.picks;
}
