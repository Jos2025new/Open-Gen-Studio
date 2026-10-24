import { uid } from '../../lib/id';
import { composerChosen } from '../catalog';
import { offerRequest } from '../modelNamed';
import { appendFeed, patchSession, useStore } from '../../store/store';
import type { AgentState, SettingsChoice, SettingsFeedItem, SettingsSection, Workspace } from '../types';
import { cardDraft, confirmedSections } from './draftActions';
import { inConversation } from './requestGuides';
import { settingsResultText } from './settingsResult';
import { confirmedState, keepConfirmed, switchSection } from './switchModel';

/**
 * Auto shows no settings card (docs/features/agente.md, "Auto: una tarjeta"): the app confirms the values itself and
 * the agent writes the prompts at once. The model is the one the user named in this request (no Keep / Change
 * question), else the confirmed or composer one; never one the agent picked on its own (keepConfirmed). The draft
 * choice is the session's last one, Borrador by default. The plan card shows all of it and lets the user change it.
 * Returns the tool result for the agent.
 */
export async function autoConfirmSettings(sessionId: string, workspace: Workspace, toolCallId: string, summary: string | undefined, sections: SettingsSection[], parts: Array<{ kind: string; model?: string }>): Promise<string> {
  const agent = () => useStore.getState().sessions[sessionId].agent;
  const sw = await switchSection(sections, agent().settings, agent().settingsParts, offerRequest(agent()), parts[0]?.model);
  const chosen = sw ? [sw.section] : (await keepConfirmed(sections, agent().settings, parts, (k) => (composerChosen(k) ? useStore.getState().composer[k].modelRef : undefined))).sections;
  const draft = cardDraft(sessionId, chosen.map((x) => ({ ...x, chosen: x.chosen ?? x.recommended })));
  const base: SettingsFeedItem = { id: uid('fd'), createdAt: Date.now(), workspace, type: 'settings', summary, status: 'confirmed', toolCallId, inline: true, ...draft };
  const item: SettingsFeedItem = { ...base, sections: confirmedSections(base, base.sections) };
  appendFeed(sessionId, item);
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, ...confirmedState(s.agent, item, item.sections) } as AgentState }));
  return settingsResultText(item, item.sections as Array<SettingsSection & { chosen: SettingsChoice }>, (t) => inConversation(sessionId, t), undefined, true);
}
