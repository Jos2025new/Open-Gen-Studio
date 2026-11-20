import { coerceSettings, lyricsParam, songProblem } from '../params';
import type { AudioStep } from '../types';
import type { RawStep } from '../plan';
import { cleanParams, didYouMean, familyRef } from './shared';
import type { StepEnv } from './env';

export async function normalizeAudio(s: RawStep, env: StepEnv): Promise<void> {
  const { ctx, errors, adjustments, steps, refKind } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  const modelRef = familyRef(ctx, s.model, 'audio', false, s.id!, adjustments) || ctx.defaultModel('audio', false);
  if (!modelRef) {
    errors.push(`${where}: no audio model is available. Ask the user to connect Atlas Cloud.`);
    return;
  }
  const resolved = await ctx.getModel(modelRef);
  if (!resolved) {
    errors.push(`${where}: model "${modelRef}" was not found in the catalog.${didYouMean(ctx, modelRef, 'audio', false)}`);
    return;
  }
  if (resolved.model.kind !== 'audio') {
    errors.push(`${where}: model "${modelRef}" generates ${resolved.model.kind}, not audio.`);
    return;
  }
  const { schema } = resolved;
  for (const [key, ref] of [['prompt_from', s.prompt_from], ['lyrics_from', s.lyrics_from]] as const) {
    const k = refKind(ref, where);
    if (k && k !== 'text') errors.push(`${where}: ${key} must reference a text step (a text step, a lyrics step or a transcription).`);
  }
  if (s.refs?.length) errors.push(`${where}: audio steps take no refs.`);
  const lyricsDef = lyricsParam(schema);
  if (s.lyrics_from && !lyricsDef) errors.push(`${where}: model "${modelRef}" takes no lyrics.`);
  const prompt = (s.prompt ?? '').trim();
  if (!prompt && !s.prompt_from && schema.slots.promptRequired) errors.push(`${where}: a prompt is required.`);
  if (schema.slots.promptMax && prompt.length > schema.slots.promptMax) errors.push(`${where}: model "${modelRef}" takes prompts up to ${schema.slots.promptMax} characters (this one has ${prompt.length}). Shorten it. [PROMPT_TOO_LONG]`);
  const { settings, changes } = coerceSettings(schema, 'audio', { count: 1, extras: s.params, advanced: cleanParams(s.params) });
  changes.forEach((c) => adjustments.push(`${s.id}: ${c}`));
  // Lyrics arriving from another step are only known at run time; the same rules then run in the job.
  const song = s.lyrics_from || s.prompt_from ? null : songProblem(schema, prompt, settings);
  if (song) errors.push(`${where}: model "${modelRef}" ${song.message} [${song.code}]`);
  steps.push({
    id: s.id!,
    kind: 'audio',
    title,
    prompt,
    promptFrom: s.prompt_from,
    lyricsFrom: s.lyrics_from,
    modelRef,
    settings: { ...settings, count: 1 },
    ...(resolved.model.textOutput ? { textOutput: true } : {}),
  } satisfies AudioStep);
}
