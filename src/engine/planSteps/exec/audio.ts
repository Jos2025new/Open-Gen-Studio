import { estimateMedia } from '../../costs';
import { ensureSchema } from '../../catalog';
import { createGeneration } from '../../jobs';
import { parseRef } from '../../planRef';
import { costAuthorization } from '../../priceAuthorization';
import { applyLyricsSettings } from '../../sendInputs';
import { useStore } from '../../../store/store';
import type { EstimateStep, RunStep } from './env';

export const runAudio: RunStep<'audio'> = async (s, { ctx, outputs, base, promptFor, inputsFor, runSettled, stepOutputs }) => {
  // Lyrics from an earlier step (a lyrics result keeps only the song text) into the model's lyrics field.
  let settings = s.settings;
  if (s.lyricsFrom) {
    const p = parseRef(s.lyricsFrom);
    const text = p?.type === 'step' ? outputs.get(p.id)?.text ?? '' : '';
    const applied = applyLyricsSettings(settings, text, (await ensureSchema(s.modelRef)) ?? undefined);
    if (!applied.key) throw new Error(`${s.title}: the model takes no lyrics.`);
    settings = applied.settings;
  }
  const kind = s.textOutput ? 'text' : 'audio';
  const g = createGeneration({ ...base, kind, prompt: promptFor(s), modelRef: s.modelRef, settings, inputs: inputsFor({ refs: [] }) });
  ctx.onState(s.id, 'running', { generationId: g.id });
  const out = stepOutputs(g.id, await runSettled(g.id));
  return { ...out, text: useStore.getState().generations[g.id]?.text };
};

export const estimateAudio: EstimateStep<'audio'> = (s) => {
  const estimate = estimateMedia(s.modelRef, 'audio', s.settings, false, false, s.prompt.length);
  return { estimate, authorization: costAuthorization(s.modelRef, { ...s.settings }, estimate) };
};
