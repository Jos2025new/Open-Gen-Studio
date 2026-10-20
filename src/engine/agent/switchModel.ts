import type { AgentState, SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';
import { defaultChoice } from './settingsCard';
import { resolveModel } from '../catalog';
import { lineKey } from '../variants';
import { userNamed } from '../modelNaming';

/**
 * DELICATE (docs/features/agente.md, "Cambio de modelo"): a model the user names in the CURRENT request replaces the
 * confirmed one only after a one-question card. This decides whether a confirm_settings call is that switch: one part,
 * a kind already confirmed, another model line, and the request names it. Returns the card's section (the other
 * confirmed values carried over where the new model accepts them) and the choice that stays for the other steps.
 */
export async function switchSection(
  sections: SettingsSection[],
  confirmed: AgentState['settings'],
  parts: AgentState['settingsParts'],
  requestText: string,
  written: string | undefined,
): Promise<{ section: SettingsSection; from: SettingsChoice } | undefined> {
  const sec = sections[0];
  const from = sec && sections.length === 1 ? confirmed?.[sec.kind] : undefined;
  if (!sec || !from || (parts ?? []).filter((p) => p.kind === sec.kind).length > 1) return undefined;
  const [now, was] = await Promise.all([resolveModel(sec.recommended.modelRef), resolveModel(from.modelRef)]);
  if (!now || !was || lineKey(now.model) === lineKey(was.model)) return undefined;
  if (!userNamed([now.model.name, written ?? ''], requestText)) return undefined;
  const carried = defaultChoice(sec.recommended.modelRef, now.schema, { kind: sec.kind, startImage: sec.recommended.needsImage, count: from.count }, { ...from, modelRef: sec.recommended.modelRef });
  return { section: { ...sec, count: from.count ?? sec.count, recommended: { ...carried, needsImage: sec.recommended.needsImage } }, from };
}

/** A switch card whose answer is the new model (Keep answers with the confirmed one: an ordinary confirmation). */
const switched = (item: SettingsFeedItem, sections: SettingsSection[]) => Boolean(item.switchFrom && sections[0]?.chosen?.modelRef !== item.switchFrom.modelRef);

/** What the session keeps once a card is confirmed. A switch card adds the new model as a part and leaves the confirmed one as the kind's settings. */
export function confirmedState(a: AgentState, item: SettingsFeedItem, sections: SettingsSection[]): Pick<AgentState, 'pending' | 'settings' | 'settingsParts'> {
  const firstOfKind = sections.filter((x, i) => sections.findIndex((y) => y.kind === x.kind) === i);
  const parts: NonNullable<AgentState['settingsParts']> = sections.map((x) => ({ ...(x.chosen as SettingsChoice), kind: x.kind }));
  if (switched(item, sections)) return { pending: undefined, settings: a.settings, settingsParts: [...parts, { ...(item.switchFrom as SettingsChoice), kind: sections[0].kind }] };
  return { pending: undefined, settings: { ...a.settings, ...Object.fromEntries(firstOfKind.map((x) => [x.kind, x.chosen])) }, settingsParts: parts };
}

/** For the agent after a switch: which steps get the new model, which keep the confirmed one. */
export function switchNote(item: SettingsFeedItem, sections: SettingsSection[], newName: string, oldName: string): string {
  return switched(item, sections) ? `\nModel switch: steps whose "model" is ${newName} use it; steps that write no model or another one keep ${oldName}. Write the model on each step that should use ${newName}.` : '';
}
