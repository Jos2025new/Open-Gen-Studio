import { patchSession, updateFeedItem, useStore } from '../../store/store';
import type { AgentState, SettingsFeedItem, SettingsSection } from '../types';
import { draftMode, unlockNote, withModeResolution, type DraftMode } from './draftFirst';

export { draftGate } from './draftFirst';
import { sectionsOf, settingsOptions } from './settingsCard';

/** The video sections with the draft mode's resolution applied to the selection (the app's, never the agent's). */
export function lockSections<S extends SettingsSection>(sections: S[], mode: DraftMode): S[] {
  const schemas = useStore.getState().catalog.schemas;
  return sections.map((x) => {
    if (x.kind !== 'video') return x;
    const c = x.chosen ?? x.recommended;
    return { ...x, chosen: withModeResolution(c, mode, settingsOptions(schemas[c.modelRef], 'video').resolutions, x.recommended.resolution) };
  });
}

const cardOf = (sessionId: string, itemId: string): SettingsFeedItem | undefined => {
  const item = useStore.getState().sessions[sessionId]?.feed.find((f) => f.id === itemId);
  return item?.type === 'settings' && item.status === 'pending' ? item : undefined;
};
const remember = (sessionId: string, mode: DraftMode) => patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, draftMode: mode } as AgentState }));

/** The user picked Borrador / Alta calidad / their own words on the card: the app sets (and for a draft locks) the resolution. */
export function selectDraft(sessionId: string, itemId: string, kind: DraftMode['kind'], text?: string): void {
  const item = cardOf(sessionId, itemId);
  if (!item) return;
  const mode = draftMode(kind, text);
  // Editing the free text keeps the selection; switching kind resets the lock.
  const same = item.draft?.kind === kind;
  const next: DraftMode = same && kind !== 'draft' ? { ...mode, unlocked: item.draft?.unlocked } : mode;
  updateFeedItem<SettingsFeedItem>(sessionId, itemId, { draft: next, ...(same && kind === 'other' ? {} : { sections: lockSections(sectionsOf(item), next) }) });
  remember(sessionId, next);
}

/** The padlock: the user lifts the lock to change the resolution; the agent is told once the card is confirmed. */
export function unlockDraft(sessionId: string, itemId: string): void {
  const item = cardOf(sessionId, itemId);
  if (!item?.draft?.locked) return;
  const next: DraftMode = { ...item.draft, locked: false, unlocked: true };
  updateFeedItem<SettingsFeedItem>(sessionId, itemId, { draft: next });
  remember(sessionId, next);
}

/** What the agent reads of the draft choice when the card is confirmed (the unlock is a fact it must not question). */
export function draftLines(d: DraftMode | undefined, sections: Array<SettingsSection & { chosen: { resolution?: string } }>): string[] {
  const video = sections.find((x) => x.kind === 'video');
  if (!d || !video) return [];
  const lines = [d.kind === 'draft' ? `- Draft choice: "Borrador". The app set the resolution to ${video.chosen.resolution ?? 'the lowest'} and locked it; do not write or change a resolution.`
    : d.kind === 'hq' ? '- Draft choice: "Alta calidad" (resolution unlocked, as confirmed below).'
      : `- Draft choice, the user's words: ${d.text}`];
  if (d.unlocked) lines.push(`- ${unlockNote(video.chosen.resolution)}`);
  return lines;
}

/** Video cards carry the draft choice; the one set earlier in this request stays (a second card cannot lift the lock). */
export function cardDraft<S extends SettingsSection>(sessionId: string, sections: S[]): { sections: S[]; draft?: DraftMode } {
  if (!sections.some((x) => x.kind === 'video')) return { sections };
  const draft = useStore.getState().sessions[sessionId].agent.draftMode ?? draftMode('draft');
  remember(sessionId, draft);
  return { sections: lockSections(sections, draft), draft };
}

/** A locked draft: the resolution is the app's whatever the card was sent (no caller can raise it). */
export const confirmedSections = <S extends SettingsSection>(item: SettingsFeedItem, sections: S[]): S[] => (item.draft?.locked ? lockSections(sections, item.draft) : sections);
