import { modelSummary } from '../catalog';
import { guideForModel } from '../guides';
import { readGuide } from '../skills';
import type { SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';
import { draftLines } from './draftActions';
import { describeChoice } from './settingsCard';
import { switchNote } from './switchModel';

/**
 * What the agent reads once settings are confirmed: the values per kind, what the user changed and each model's
 * prompting guide (not repeated when the conversation already has it). The card's Continue and Auto's silent
 * confirmation (no card) send the same text.
 */
export function settingsResultText(item: SettingsFeedItem, sections: Array<SettingsSection & { chosen: SettingsChoice }>, seen: (text: string) => boolean, note?: string, auto = false): string {
  const name = (ref: string) => modelSummary(ref)?.name ?? ref;
  const lines = draftLines(item.draft, sections);
  let guides = '';
  for (const x of sections) {
    const c = x.chosen;
    const rec = x.recommended;
    const changes = [
      c.modelRef !== rec.modelRef ? `model ${name(rec.modelRef)} → ${name(c.modelRef)}` : '',
      c.resolution !== rec.resolution ? `resolution ${rec.resolution ?? 'default'} → ${c.resolution ?? 'default'}` : '',
      c.duration !== rec.duration ? `duration ${rec.duration ?? '?'} s → ${c.duration ?? '?'} s` : '',
      c.aspect !== rec.aspect ? `aspect ${rec.aspect ?? "the image's"} → ${c.aspect ?? "the image's"}` : '',
      c.count !== rec.count ? `images per step ${rec.count ?? 1} → ${c.count ?? 1}` : '',
    ].filter(Boolean);
    const several = sections.filter((y) => y.kind === x.kind).length > 1;
    lines.push(`- ${x.kind}${several ? ` (one of ${sections.filter((y) => y.kind === x.kind).length} compared models: its steps write "model": "${c.modelRef}")` : ''}: ${describeChoice(name(c.modelRef), c)} (${c.modelRef}).${changes.length ? ` The user changed: ${changes.join('; ')}.` : ' As recommended.'} Write these prompts for ${name(c.modelRef)}, in its format${x.kind === 'video' && c.duration ? `; each clip lasts exactly ${c.duration} s: time its beats, shots and spoken lines to fill those seconds` : ''}${c.aspect ? `; frame for ${c.aspect}` : ''}${x.kind === 'image' && c.count ? (c.count > 1 ? `; ${c.count} candidates of the image being explored: ONE image step with ${c.count} "variations" (the shared prompt once, one short variation each), not one step per option` : '; one image per image step') : ''}.`);
    const guide = guideForModel(c.modelRef.split('::')[1] ?? '');
    const text = guide ? readGuide(`model:${guide.id}`) : undefined;
    if (text && !seen(text) && !guides.includes(text)) guides += `\n\n---\nPrompting guide of ${name(c.modelRef)} (model:${guide!.id}); write its prompts in this format:\n${text}`;
  }
  return `${auto ? 'Settings chosen by the app (Auto shows no settings card: the model the user named, else the composer one; the user can change them on the plan card before approving)' : 'Settings confirmed by the user'} (the app applies them to every step of each kind; with several models of one kind, to the steps that name that model):\n${lines.join('\n')}${note ? `\nUser note: ${note}` : ''}${switchNote(item, sections, name(sections[0].chosen.modelRef), name(item.switchFrom?.modelRef ?? ''))}\nNow write the prompts and call propose_plan.${guides}`;
}
