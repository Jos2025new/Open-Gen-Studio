import { create } from 'zustand';
import { ensureSchema, inputVariant, modelSummary } from '../catalog';
import { guideForModel } from '../guides';
import { chat } from '../providers/llm';
import { requote } from '../quotes';
import { readGuide } from '../skills';
import { addSpend, patchSession, updateFeedItem, useStore } from '../../store/store';
import type { FeedItem, PlanFeedItem, PlanStep, SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';
import { draftMode, withModeResolution, type DraftMode } from './draftFirst';
import { agentEngine, llmCallUsd } from './runtime';
import { settingsOptions } from './settingsCard';

/*
 * Auto's one card (docs/features/agente.md, "Auto: una tarjeta"): the plan card carries the settings card's model,
 * values and draft choice. A change applies to the waiting plan's steps of that kind (the price follows from the
 * steps, as always); a change of model, duration or aspect asks the agent's LLM to rewrite only those prompts for the
 * new model's guide, on the same card. Approve waits while it rewrites; a failure says so and offers a retry.
 */

export type GenKind = 'image' | 'video';
type GenStep = Extract<PlanStep, { kind: GenKind }>;
const get = useStore.getState;

/** Rewrites in flight and the last failure, per plan card. */
export const usePlanRewrite = create<{ busy: Record<string, boolean>; failed: Record<string, string> }>(() => ({ busy: {}, failed: {} }));
const setRewrite = (id: string, busy: boolean, failed?: string) => usePlanRewrite.setState((s) => ({ busy: { ...s.busy, [id]: busy }, failed: { ...s.failed, [id]: failed ?? '' } }));
const runs = new Map<string, number>();

const isGen = (s: PlanStep): s is GenStep => s.kind === 'image' || s.kind === 'video';
const needsImage = (s: GenStep) => Boolean(s.refs?.length || (s.kind === 'video' && s.firstFrame));
const planOf = (sessionId: string, itemId: string): PlanFeedItem | undefined => {
  const it = get().sessions[sessionId]?.feed.find((f) => f.id === itemId);
  return it?.type === 'plan' && it.status === 'awaiting' ? it : undefined;
};

/** The settings the app chose for this plan (Auto, no card): the latest inline item of each kind before it. */
function inlineSection(feed: FeedItem[], planId: string, kind: GenKind): { item: SettingsFeedItem; section: SettingsSection } | undefined {
  for (let i = feed.findIndex((f) => f.id === planId) - 1; i >= 0; i--) {
    const f = feed[i];
    const section = f.type === 'settings' && f.inline ? f.sections.find((x) => x.kind === kind) : undefined;
    if (section) return { item: f as SettingsFeedItem, section };
  }
  return undefined;
}

/** The card's sections, read from the plan's own steps (one per kind, images first); empty outside Auto. */
export function planSections(feed: FeedItem[], plan: PlanFeedItem): SettingsSection[] {
  if (plan.style !== 'auto' || plan.nodeRun || plan.plan.workspace === 'node') return [];
  const out: SettingsSection[] = [];
  for (const kind of ['image', 'video'] as const) {
    const steps = plan.plan.steps.filter(isGen).filter((s) => s.kind === kind);
    if (!steps.length) continue;
    const s = steps[0];
    const choice: SettingsChoice = { modelRef: s.modelRef, aspect: s.settings.aspect, resolution: s.settings.resolution, needsImage: needsImage(s), ...(kind === 'video' ? { duration: s.settings.duration } : { count: s.settings.count }) };
    const was = inlineSection(feed, plan.id, kind)?.section;
    const alternatives = was ? [was.recommended.modelRef, ...was.alternatives].filter((r) => r !== s.modelRef) : [];
    out.push({ kind, count: steps.length, recommended: choice, chosen: choice, alternatives });
  }
  return out;
}

/** The draft choice shown on an Auto plan with video (the session's, Borrador by default). */
export const planDraft = (sessionId: string): DraftMode => get().sessions[sessionId]?.agent.draftMode ?? draftMode('draft');

/** The model this step runs on for a picked line: the variant its inputs need (edit, image-to-video). */
const stepModel = (ref: string, s: GenStep) => (needsImage(s) ? inputVariant(ref, s.kind)?.ref ?? ref : ref);

function applyChoice(s: GenStep, c: SettingsChoice): GenStep {
  const settings = { ...s.settings, aspect: c.aspect, resolution: c.resolution, ...(s.kind === 'video' ? { duration: c.duration ?? s.settings.duration } : { count: c.count ?? s.settings.count }) };
  return { ...s, modelRef: stepModel(c.modelRef, s), settings } as GenStep;
}

/** The session's confirmed choice of this kind follows the card, so the next request starts from it. */
function remember(sessionId: string, kind: GenKind, c: SettingsChoice, draft?: DraftMode) {
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, settings: { ...s.agent.settings, [kind]: c }, ...(draft ? { draftMode: draft } : {}) } }));
  const feed = get().sessions[sessionId].feed;
  const last = [...feed].reverse().find((f): f is SettingsFeedItem => f.type === 'settings' && Boolean(f.inline) && f.sections.some((x) => x.kind === kind));
  if (last) updateFeedItem<SettingsFeedItem>(sessionId, last.id, { sections: last.sections.map((x) => (x.kind === kind ? { ...x, chosen: c } : x)), ...(draft ? { draft } : {}) });
}

/** The user changed the model or a value of one kind on the plan card. */
export async function changePlanChoice(sessionId: string, itemId: string, kind: GenKind, next: SettingsChoice): Promise<void> {
  const item = planOf(sessionId, itemId);
  const before = item?.plan.steps.find((s): s is GenStep => isGen(s) && s.kind === kind);
  if (!item || !before) return;
  await Promise.all([ensureSchema(next.modelRef), ...item.plan.steps.filter(isGen).map((s) => ensureSchema(stepModel(next.modelRef, s)))]);
  const draft = kind === 'video' ? planDraft(sessionId) : undefined;
  const c = kind === 'video' ? withModeResolution(next, draft, settingsOptions(get().catalog.schemas[next.modelRef], 'video').resolutions, next.resolution) : next;
  const now = planOf(sessionId, itemId);
  if (!now) return;
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { plan: { ...now.plan, steps: now.plan.steps.map((s) => (isGen(s) && s.kind === kind ? applyChoice(s, c) : s)) } });
  remember(sessionId, kind, c);
  const prompts = stepModel(c.modelRef, before) !== before.modelRef;
  if (prompts || c.duration !== before.settings.duration || c.aspect !== before.settings.aspect) await rewritePrompts(sessionId, itemId, kind);
}

/** Borrador / Alta calidad / the user's words on the plan card: the app sets (a draft locks) the video resolution. */
export function changePlanDraft(sessionId: string, itemId: string, kind: DraftMode['kind'], text?: string, unlock = false): void {
  const item = planOf(sessionId, itemId);
  if (!item) return;
  const prev = planDraft(sessionId);
  const mode: DraftMode = unlock ? { ...prev, locked: false, unlocked: true } : prev.kind === kind && kind !== 'draft' ? { ...draftMode(kind, text), unlocked: prev.unlocked } : draftMode(kind, text);
  const schemas = get().catalog.schemas;
  let chosen: SettingsChoice | undefined;
  const steps = item.plan.steps.map((s) => {
    if (!isGen(s) || s.kind !== 'video' || unlock || (kind === 'other' && prev.kind === 'other')) return s;
    const c = withModeResolution({ modelRef: s.modelRef, resolution: s.settings.resolution, needsImage: needsImage(s) }, mode, settingsOptions(schemas[s.modelRef], 'video').resolutions, s.settings.resolution);
    chosen ??= c;
    return { ...s, settings: { ...s.settings, resolution: c.resolution } } as GenStep;
  });
  updateFeedItem<PlanFeedItem>(sessionId, itemId, { plan: { ...item.plan, steps } });
  const video = planSections(get().sessions[sessionId].feed, { ...item, plan: { ...item.plan, steps } }).find((x) => x.kind === 'video');
  if (video) remember(sessionId, 'video', { ...video.recommended, ...(chosen ? { resolution: chosen.resolution } : {}) }, mode);
}

/** The price button: ask the provider's price again for the plan's steps (Atlas quotes; schemas that had not loaded). */
export async function recheckPlanPrice(sessionId: string, itemId: string): Promise<void> {
  const item = planOf(sessionId, itemId);
  if (!item) return;
  await Promise.all(item.plan.steps.filter(isGen).map(async (s) => { await ensureSchema(s.modelRef); requote(s.modelRef, s.settings); }));
  useStore.setState((s) => ({ quotes: { ...s.quotes } }));
}

const fenced = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();

/** Rewrite the prompts of one kind for the model now on the card (its prompting guide); only the prompts change. */
export async function rewritePrompts(sessionId: string, itemId: string, kind: GenKind): Promise<void> {
  const engine = agentEngine();
  const item = planOf(sessionId, itemId);
  const steps = item?.plan.steps.filter(isGen).filter((s) => s.kind === kind && s.prompt.trim()) ?? [];
  if (engine.kind !== 'llm' || !item || !steps.length) return;
  const run = (runs.get(itemId) ?? 0) + 1;
  runs.set(itemId, run);
  setRewrite(itemId, true);
  const ref = steps[0].modelRef;
  const name = modelSummary(ref)?.name ?? ref;
  const guide = guideForModel(ref.split('::')[1] ?? '');
  const text = guide ? readGuide(`model:${guide.id}`) : undefined;
  const s0 = steps[0].settings;
  const system = `You adapt generation prompts to another model. Rewrite each prompt for ${name}${text ? ', following its prompting guide below' : ''}. Keep the same content and intent: subjects, @names, the role of each reference image, actions, style, language of on-screen words${kind === 'video' && s0.duration ? `, a clip of exactly ${s0.duration} s (time the beats to it)` : ''}${s0.aspect ? `, framed for ${s0.aspect}` : ''}. Change only what the guide asks for (order, wording, format, length). Answer only a JSON object {"<step id>": "<new prompt>"}, nothing else.${text ? `\n\n---\nPrompting guide of ${name}:\n${text}` : ''}`;
  const content = JSON.stringify(steps.map((s) => ({ id: s.id, title: s.title, prompt: s.prompt })));
  try {
    const result = await chat({ provider: engine.provider, apiKey: engine.key, model: engine.model, system, messages: [{ role: 'user', content }], tools: [], signal: new AbortController().signal });
    addSpend(llmCallUsd(engine.provider, engine.model, result.usage), { category: 'agent', provider: engine.provider, model: engine.model, sessionId, estimated: result.usage?.costUsd == null });
    if (runs.get(itemId) !== run) return;
    const out = JSON.parse(fenced(result.text)) as Record<string, unknown>;
    const now = planOf(sessionId, itemId);
    if (!now) return setRewrite(itemId, false);
    let changed = 0;
    const next = now.plan.steps.map((s) => {
      const p = out[s.id];
      if (!isGen(s) || s.kind !== kind || typeof p !== 'string' || !p.trim()) return s;
      changed++;
      return { ...s, prompt: p.trim() } as GenStep;
    });
    if (!changed) throw new Error('the answer had no prompts');
    updateFeedItem<PlanFeedItem>(sessionId, itemId, { plan: { ...now.plan, steps: next } });
    setRewrite(itemId, false);
  } catch (e) {
    if (runs.get(itemId) === run) setRewrite(itemId, false, `The prompt was not rewritten for ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
