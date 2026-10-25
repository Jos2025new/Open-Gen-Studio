import { create } from 'zustand';
import { ensureSchema, inputVariant, modelSummary } from '../catalog';
import { guideForModel } from '../guides';
import { chat } from '../providers/llm';
import { VIDEO_DIRECTION_POLICY } from '../procedure';
import { requote } from '../quotes';
import { readGuide } from '../skills';
import { addSpend, patchSession, updateFeedItem, useStore } from '../../store/store';
import type { FeedItem, PlanFeedItem, PlanStep, SettingsChoice, SettingsFeedItem, SettingsSection } from '../types';
import { draftMode, withModeResolution, type DraftMode } from './draftFirst';
import { agentSeesImages, attachmentParts, userMessage } from './attachments';
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
  if (promptWriterOn(sessionId) && (prompts || c.duration !== before.settings.duration || c.aspect !== before.settings.aspect)) await rewritePrompts(sessionId, itemId, kind);
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

/** The plan card's prompt writer is on unless the user turned it off (then prompts are sent as written). */
export const promptWriterOn = (sessionId: string) => get().sessions[sessionId]?.agent.enhance !== false;

/** The switch on the plan card; turning it on adapts the prompts to the card as it is now. */
export function setPromptWriter(sessionId: string, itemId: string, on: boolean): void {
  patchSession(sessionId, (s) => ({ ...s, agent: { ...s.agent, enhance: on } }));
  const item = planOf(sessionId, itemId);
  if (on && item) for (const kind of new Set(item.plan.steps.filter(isGen).map((x) => x.kind))) void rewritePrompts(sessionId, itemId, kind);
}

const MAX_PROMPT = 4000;
const assetsOf = (s: GenStep) => [s.kind === 'video' ? s.firstFrame : undefined, ...(s.refs ?? [])].filter((r): r is string => Boolean(r?.startsWith('asset:'))).map((r) => r.slice(6));

/** What the writer must know of a step besides its prompt: the card's values and what each input image is for. */
function stepInputs(s: GenStep): string {
  const v = s.settings;
  const out = [`${s.kind}${v.duration ? `, ${v.duration} s` : ''}${v.aspect ? `, ${v.aspect}` : ''}${v.resolution ? `, ${v.resolution}` : ''}`];
  if (s.kind === 'video' && s.firstFrame) out.push(`start image ${s.firstFrame}: the clip opens on it; describe what moves and changes from it, never cite it as @Image`);
  if (s.refs?.length) out.push(`references in order ${s.refs.join(', ')}: cite them with the model's syntax (@Image1… in this order), each with its role`);
  return out.join('; ');
}

/**
 * Rewrite the prompts of one kind for the card as it is now: its model (and prompting guide), duration, aspect and the
 * images each step sends, with the agent's video rules. The agent is told that the card's writer wrote them, not it.
 */
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
  const style = item.plan.style ? ` The app appends this style block to every prompt; never repeat or restate it: "${item.plan.style}".` : '';
  const system = `You are the plan card's prompt writer. The user changed the card; rewrite each prompt for ${name} and the step's settings and inputs listed with it${text ? ', following the prompting guide below' : ''}. Keep the content and intent: subjects, @names, the role of each image, actions, the style. Rules: English, except quoted dialogue and on-screen text, which stay as written. At most ${MAX_PROMPT} characters each; shorter is better. Fit the beats to the duration: drop beats rather than compress them, whole seconds only.${style}${kind === 'video' ? ` ${VIDEO_DIRECTION_POLICY}` : ''} The images of each step are attached after its line: look at them. Answer only a JSON object {"<step id>": "<new prompt>"}, nothing else.${text ? `\n\n---\nPrompting guide of ${name}:\n${text}` : ''}`;
  const lines = steps.map((s) => `${s.id} (${stepInputs(s)}) "${s.title}":\n${s.prompt}`).join('\n\n');
  const parts = agentSeesImages() ? await attachmentParts([...new Set(steps.flatMap(assetsOf))]) : [];
  let tooLong = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const content = attempt ? `${lines}\n\nYour last answer had a prompt over ${MAX_PROMPT} characters (${tooLong}). Write them shorter.` : lines;
      const result = await chat({ provider: engine.provider, apiKey: engine.key, model: engine.model, system, messages: [userMessage(content, parts)], tools: [], signal: new AbortController().signal });
      addSpend(llmCallUsd(engine.provider, engine.model, result.usage), { category: 'agent', provider: engine.provider, model: engine.model, sessionId, estimated: result.usage?.costUsd == null });
      if (runs.get(itemId) !== run) return;
      const out = JSON.parse(fenced(result.text)) as Record<string, unknown>;
      const long = steps.filter((s) => typeof out[s.id] === 'string' && (out[s.id] as string).trim().length > MAX_PROMPT);
      if (long.length) { tooLong = long.map((s) => `${s.id}: ${(out[s.id] as string).trim().length}`).join(', '); continue; }
      const now = planOf(sessionId, itemId);
      if (!now) return setRewrite(itemId, false);
      const done: string[] = [];
      const next = now.plan.steps.map((s) => {
        const p = out[s.id];
        if (!isGen(s) || s.kind !== kind || typeof p !== 'string' || !p.trim()) return s;
        done.push(`${s.id}: "${p.trim()}"`);
        return { ...s, prompt: p.trim() } as GenStep;
      });
      if (!done.length) throw new Error('the answer had no prompts');
      updateFeedItem<PlanFeedItem>(sessionId, itemId, { plan: { ...now.plan, steps: next } });
      patchSession(sessionId, (x) => ({ ...x, agent: { ...x.agent, notes: [...x.agent.notes, `The plan card's prompt writer, not you, rewrote these prompts of "${now.plan.title}" after the user changed the card (${name}); they are what runs. No need to mention it. ${done.join(' ')}`] } }));
      setRewrite(itemId, false);
      return;
    }
    throw new Error(`the prompt came out over ${MAX_PROMPT} characters`);
  } catch (e) {
    if (runs.get(itemId) === run) setRewrite(itemId, false, `The prompt was not rewritten for ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
