import type { MediaKind, SettingsSection } from '../types';
import { indexedModels } from './modelIndex';
import { composerChosen, modelSummary, resolveModel } from '../catalog';
import { modelChange, offerRequest, providersIn } from '../modelNamed';
import { userNamed } from '../modelNaming';
import { lineKey } from '../variants';
import { journeyIdFor, recordJourneyEvent } from '../../lib/journeyTrace';
import { useStore } from '../../store/store';
import { confirmedStandNote } from './changeRules';
import { latestDraft } from './draftFirst';

/** Words that may ask to change the model, provider or settings: when unsure the card is shown (the safe side). */
const CHANGE_WORDS = /cambi|chang|switch|swap|modelo|model\b|proveedor|provider|resoluci|resolution|calidad|quality|ajuste|setting|\b[1-8]k\b|\b\d{3,4}p\b|en vez|instead|distint|different|another|otro\b/i;

/** Whether the user's text may ask for a change of model, provider or settings for `kind` (its confirmed line is `wasKey`). */
function asksChange(said: string, kind: MediaKind, wasKey: string): boolean {
  return CHANGE_WORDS.test(said) || providersIn(said).length > 0 || indexedModels().some((m) => m.kind === kind && lineKey(m) !== wasKey && userNamed([m.name], said));
}

/**
 * A1: after the user confirmed a kind (Auto), confirm_settings again with the SAME model line and provider is not a
 * question. Returns the tool result the app answers with (no card; a journey event records it), or undefined to show
 * the card as before. Never skips: in Guided/Direct, with a part that compares models, a kind not confirmed, another
 * line or provider, a model the user picked in the composer that differs from the confirmed one (that pick is the one
 * the plan uses, so it is never reported as the confirmed), or a request that may ask for a change. Aspect and count
 * are not compared.
 */
export async function repeatedConfirmation(sessionId: string, sections: SettingsSection[], parts: Array<{ kind: string }>): Promise<string | undefined> {
  const { composer, sessions } = useStore.getState();
  const agent = sessions[sessionId]?.agent;
  if (composer.agentStyle !== 'auto' || !agent || !sections.length) return undefined;
  const said = offerRequest(agent);
  const kept: string[] = [];
  for (const sec of sections) {
    const from = agent.settings?.[sec.kind];
    if (!from || parts.filter((p) => p.kind === sec.kind).length > 1) return undefined;
    // A video card also carries the draft choice: with none confirmed yet, the card is the only way to make it (no loop with draftGate).
    if (sec.kind === 'video' && !latestDraft(sessions[sessionId].feed)) return undefined;
    const [now, was] = await Promise.all([resolveModel(sec.recommended.modelRef), resolveModel(from.modelRef)]);
    if (!now || !was || modelChange(now.model, was.model)) return undefined;
    const pick = composerChosen(sec.kind) ? composer[sec.kind].modelRef : undefined;
    const picked = pick ? (await resolveModel(pick))?.model : undefined;
    if (pick && (!picked || modelChange(picked, was.model))) return undefined;
    if (asksChange(said, sec.kind, lineKey(was.model))) return undefined;
    kept.push(`${sec.kind}: ${modelSummary(from.modelRef)?.name ?? from.modelRef} (${from.modelRef})${from.resolution ? `, ${from.resolution}` : ''}`);
  }
  recordJourneyEvent({ journeyId: journeyIdFor(sessionId) ?? sessionId, journey: 'settings-response', event: 'settings.repeat_skipped', reason: 'same confirmed model line: no card', sessionId, after: { kept } });
  return confirmedStandNote(kept);
}
