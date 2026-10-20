import type { AgentState, SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';
import { defaultChoice } from './settingsCard';
import { resolveModel } from '../catalog';
import { userNamed } from '../modelNaming';
import { changeNamed, type ModelChange } from '../modelNamed';

/**
 * DELICATE (docs/features/agente.md, "Cambio de modelo"): a model the user names in the CURRENT request replaces the
 * confirmed one only after a one-question card. This decides whether a confirm_settings call is that switch: one part,
 * a kind already confirmed, and the request asks for another model line (change "model") or names the provider of the
 * same line (change "provider", ADR 0025 D). The card is the same for both. Returns the card's section (the other
 * confirmed values carried over where the new model accepts them) and the choice that stays for the other steps.
 */
export async function switchSection(
  sections: SettingsSection[],
  confirmed: AgentState['settings'],
  parts: AgentState['settingsParts'],
  requestText: string,
  written: string | undefined,
  follow?: { switchedTo: AgentState['switchedTo']; auto: boolean },
): Promise<{ section: SettingsSection; from: SettingsChoice; followUp?: boolean; change?: ModelChange } | undefined> {
  const sec = sections[0];
  const from = sec && sections.length === 1 ? confirmed?.[sec.kind] : undefined;
  if (!sec || !from || (parts ?? []).filter((p) => p.kind === sec.kind).length > 1) return undefined;
  const [now, was] = await Promise.all([resolveModel(sec.recommended.modelRef), resolveModel(from.modelRef)]);
  if (!now || !was) return undefined;
  const change = changeNamed(now.model, was.model, requestText, written);
  if (!change) {
    // The follow-up (Auto): the last request switched this kind and this one names no model: continue with it, go back, or another.
    const to = follow?.auto ? follow.switchedTo?.[sec.kind] : undefined;
    if (!to || userNamed([was.model.name], requestText)) return undefined;
    return { section: { ...sec, recommended: { ...to, needsImage: sec.recommended.needsImage }, alternatives: sec.alternatives.filter((r) => r !== to.modelRef && r !== from.modelRef) }, from, followUp: true };
  }
  const carried = defaultChoice(sec.recommended.modelRef, now.schema, { kind: sec.kind, startImage: sec.recommended.needsImage, count: from.count }, { ...from, modelRef: sec.recommended.modelRef });
  return { section: { ...sec, count: from.count ?? sec.count, recommended: { ...carried, needsImage: sec.recommended.needsImage } }, from, change };
}

/** A switch card whose answer is the new model (Keep answers with the confirmed one: an ordinary confirmation). */
const switched = (item: SettingsFeedItem, sections: SettingsSection[]) => Boolean(item.switchFrom && !item.followUp && sections[0]?.chosen?.modelRef !== item.switchFrom.modelRef);

/** What the session keeps once a card is confirmed. A switch card adds the new model as a part and leaves the confirmed one as the kind's settings. */
export function confirmedState(a: AgentState, item: SettingsFeedItem, sections: SettingsSection[]): Pick<AgentState, 'pending' | 'settings' | 'settingsParts' | 'switchedTo'> {
  const firstOfKind = sections.filter((x, i) => sections.findIndex((y) => y.kind === x.kind) === i);
  const parts: NonNullable<AgentState['settingsParts']> = sections.map((x) => ({ ...(x.chosen as SettingsChoice), kind: x.kind }));
  const kind = sections[0].kind;
  if (switched(item, sections)) return { pending: undefined, settings: a.settings, settingsParts: [...parts, { ...(item.switchFrom as SettingsChoice), kind }], switchedTo: { ...a.switchedTo, [kind]: sections[0].chosen } };
  // An ordinary confirmation (and the follow-up's three answers) settles the question: nothing left to ask for these kinds.
  const left = { ...a.switchedTo };
  for (const x of firstOfKind) delete left[x.kind];
  return { pending: undefined, settings: { ...a.settings, ...Object.fromEntries(firstOfKind.map((x) => [x.kind, x.chosen])) }, settingsParts: parts, switchedTo: left };
}

/** For the agent after a switch: which steps get the new model, which keep the confirmed one. */
export function switchNote(item: SettingsFeedItem, sections: SettingsSection[], newName: string, oldName: string): string {
  // The same model at another provider has the same name: the refs tell them apart.
  if (newName === oldName) [newName, oldName] = [sections[0].chosen?.modelRef ?? newName, item.switchFrom?.modelRef ?? oldName];
  return switched(item, sections) ? `\nModel switch: steps whose "model" is ${newName} use it; steps that write no model or another one keep ${oldName}. Write the model on each step that should use ${newName}.` : '';
}
