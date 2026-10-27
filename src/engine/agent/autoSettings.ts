import { uid } from '../../lib/id';
import { lineRoutes, resolveModel } from '../catalog';
import { defaultChoice } from './settingsCard';
import { offerRequest, userRequest } from '../modelNamed';
import { appendFeed, patchSession, useStore } from '../../store/store';
import type { AgentState, SettingsChoice, SettingsFeedItem, SettingsSection, Workspace } from '../types';
import { cardDraft, confirmedSections } from './draftActions';
import { askedQuality, draftMode } from './draftFirst';
import { inConversation } from './requestGuides';
import { settingsResultText } from './settingsResult';
import { betterProvider, missing, wantedOf } from './providerFit';
import { confirmedState } from './switchModel';
import { rememberSessionModel } from './sessionModel';

/**
 * Auto shows no settings card (docs/features/agente.md, "Auto: una tarjeta"): the app confirms the values itself and
 * the agent writes the prompts at once. The model is the one the user named in this request (no Keep / Change
 * question), else the confirmed or composer one; never one the agent picked on its own (keepConfirmed). The draft
 * choice is the session's last one, Borrador by default, unless this request clearly asks for another (askedQuality). The plan card shows all of it and lets the user change it.
 * Returns the tool result for the agent.
 */
export async function autoConfirmSettings(sessionId: string, workspace: Workspace, toolCallId: string, summary: string | undefined, sections: SettingsSection[], parts: Array<{ kind: string; model?: string; refs?: number; start_image?: boolean }>): Promise<string> {
  const agent = () => useStore.getState().sessions[sessionId].agent;
  // Both confirm_settings and propose_plan arrive with the same resolved model priority.
  const chosen = sections;
  const inputs = (x: SettingsSection) => parts.filter((p) => p.kind === x.kind && (!x.modelSelection?.requested || p.model === x.modelSelection.requested));
  // The quality the user's words clearly ask for in this request wins over the inherited choice.
  const asked = askedQuality(userRequest(agent()));
  // The chosen model's line on its provider, in the variant that takes the images this request declares (never ignore them).
  const variants = await Promise.all(chosen.map(async (x) => {
    const p = inputs(x);
    const want = { startImage: p.some((q) => q.start_image), images: Math.max(0, ...p.map((q) => q.refs ?? 0)) };
    const r = x.recommended;
    if (x.kind !== 'video' || (!want.images && !want.startImage) || !missing(useStore.getState().catalog.schemas[r.modelRef], want).length) return x;
    const alt = want.images ? lineRoutes(r.modelRef).reference : lineRoutes(r.modelRef).image;
    const got = alt && alt !== r.modelRef ? await resolveModel(alt) : undefined;
    if (!got || missing(got.schema, want).length) return x;
    return { ...x, recommended: { ...defaultChoice(alt!, got.schema, { kind: x.kind, startImage: r.needsImage, duration: r.duration, aspect: r.aspect, count: r.count }), needsImage: r.needsImage }, alternatives: [r.modelRef, ...x.alternatives.filter((a) => a !== alt && a !== r.modelRef)] };
  }));
  // The provider that cannot take what was asked gives way to the same model and variant at one that can (providerFit).
  const notes: string[] = [];
  const fitted = await Promise.all(variants.map(async (x) => {
    const images = Math.max(0, ...inputs(x).map((p) => p.refs ?? 0));
    const better = x.kind === 'video' || x.kind === 'image' ? await betterProvider(x.recommended.modelRef, wantedOf(x.recommended, offerRequest(agent()), images), offerRequest(agent())) : undefined;
    const got = better ? await resolveModel(better.ref) : undefined;
    if (!better || !got) return x;
    notes.push(better.note);
    const r = x.recommended;
    return { ...x, recommended: { ...defaultChoice(better.ref, got.schema, { kind: x.kind, startImage: r.needsImage, duration: r.duration, aspect: r.aspect, count: r.count }), needsImage: r.needsImage }, alternatives: [r.modelRef, ...x.alternatives.filter((a) => a !== better.ref && a !== r.modelRef)] };
  }));
  for (const x of fitted) {
    const before = sections.find((p) => p.kind === x.kind && p.modelSelection === x.modelSelection);
    if (before && before.recommended.modelRef !== x.recommended.modelRef) x.modelSelection = { ...x.modelSelection, reason: `${x.modelSelection?.reason ?? 'session'}; compatible variant or provider` };
  }
  const draft = cardDraft(sessionId, fitted.map((x) => ({ ...x, chosen: x.chosen ?? x.recommended })), asked && draftMode(asked));
  const base: SettingsFeedItem = { id: uid('fd'), createdAt: Date.now(), workspace, type: 'settings', summary, status: 'confirmed', toolCallId, inline: true, ...draft };
  const item: SettingsFeedItem = { ...base, sections: confirmedSections(base, base.sections) };
  appendFeed(sessionId, item);
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, ...confirmedState(s.agent, item, item.sections) } as AgentState }));
  for (const x of item.sections) {
    if (x.chosen && x.modelSelection?.reason.startsWith('user request') && item.sections.filter((y) => y.kind === x.kind).length === 1) rememberSessionModel(sessionId, x.kind, x.chosen, true);
  }
  return settingsResultText(item, item.sections as Array<SettingsSection & { chosen: SettingsChoice }>, (t) => inConversation(sessionId, t), undefined, true) + notes.join('');
}
