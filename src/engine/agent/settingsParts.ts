import { composerChosen, defaultModelFor, inputVariant, modelSummary, resolveModel } from '../catalog';
import { offerRequest, partModel } from '../modelNamed';
import { OPS } from '../ops';
import { useStore } from '../../store/store';
import type { SettingsSection, Workspace } from '../types';
import { autoConfirmSettings } from './autoSettings';
import { durationProblem, limitsLine, OWED_QUESTION, resolutionNote } from './modelLimits';
import { suggestModel } from './modelIndex';
import { fittingModels, missing } from './providerFit';
import { buildSettings } from './settingsCard';
import { modelPriority } from './modelPriority';
import { partNamed } from '../modelNamed';

/** What a confirm_settings part asks (the tool's input, one kind). */
export interface SettingsPart { kind: 'video' | 'image'; purpose?: 'draft' | 'normal' | 'long'; start_image?: boolean; refs?: number; count?: number; duration?: number; aspect?: string; model?: string; provider?: string; user_requested?: boolean }

/** One card for the plan that comes now: images first, then video. */
export const imagesFirst = <P extends { kind: string }>(parts: P[]): P[] => [...parts].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1));

/** The parts a plan's generation steps ask for (an operation on an image model counts as image; only a step names its own model). */
export function partsOfSteps(steps: Array<{ kind: string; op?: string; model?: string; user_requested?: boolean; count?: number; duration?: number; aspect?: string; refs?: string[]; first_frame?: string }>): SettingsPart[] {
  return imagesFirst(steps.flatMap((s): SettingsPart[] => {
    const kind = s.kind === 'op' && (OPS as Record<string, { engine: string }>)[s.op ?? '']?.engine === 'edit' ? 'image' : s.kind;
    return kind === 'video' || kind === 'image' ? [{ kind, model: kind === s.kind ? s.model : undefined, user_requested: s.user_requested, count: s.count, duration: s.duration, aspect: s.aspect, start_image: Boolean(s.first_frame), refs: s.refs?.length }] : [];
  }));
}

/** The settings sections of these parts (what confirm_settings shows or Auto confirms), or what stops them: an unknown model, a length the model cannot make. */
export async function sectionsOfParts(sessionId: string, parts: SettingsPart[], until: <T>(work: Promise<T>) => Promise<T>, log: { action(e: { icon: string; label: string; detail?: string }): void }): Promise<{ sections: SettingsSection[]; failed: string }> {
  const ag = () => useStore.getState().sessions[sessionId].agent;
  const sections: SettingsSection[] = [];
  for (const d of parts) {
    // One part per kind, except to compare models: another part of that kind needs a model of its own.
    const seen = parts.slice(0, parts.indexOf(d)).filter((x) => x.kind === d.kind);
    if (seen.length && (!d.model || seen.some((x) => !x.model || x.model === d.model))) continue;
    const selection = modelPriority({ session: ag().settings?.[d.kind]?.modelRef, composer: defaultModelFor(d.kind, Boolean(d.refs || d.start_image)) ?? undefined, proposed: partModel(d, ag().settings), userRequested: d.user_requested, comparison: new Set(parts.filter((p) => p.kind === d.kind).map((p) => p.model).filter(Boolean)).size > 1 });
    const built = await until(buildSettings(
      { kind: d.kind, purpose: d.purpose ?? 'normal', startImage: d.start_image ?? false, refs: d.refs ?? 0, count: d.count ?? 1, duration: d.duration, aspect: d.aspect, model: selection.modelRef, provider: selection.reason === 'user request' || selection.reason === 'comparison' ? d.provider : undefined },
      { getModel: resolveModel, suggestModel, composerChosen, routeModel: (mode) => useStore.getState().composer.videoRoutes?.[mode], defaultModel: defaultModelFor, inputVariant: (r, k) => inputVariant(r, k)?.ref },
    ));
    if ('error' in built) return { sections, failed: `${d.kind}: ${built.error}` };
    const long = d.kind === 'video' ? durationProblem(built.recommended.modelRef, d.duration, offerRequest(ag()), Object.keys(ag().draft?.answers ?? {}).length > 0) : undefined;
    log.action({ icon: 'search', label: `Checked ${(await resolveModel(built.recommended.modelRef))?.model.name ?? built.recommended.modelRef}`, detail: limitsLine(built.recommended.modelRef) || undefined });
    if (long) return { sections, failed: long };
    sections.push({ modelSelection: { requested: d.model, reason: selection.reason }, kind: d.kind, count: d.count ?? 1, recommended: built.recommended, alternatives: built.alternatives });
  }
  return { sections, failed: '' };
}

/** Auto confirms these sections itself: what the agent reads (values, guide), plus a line for a resolution the model lacks. */
export async function autoAnswer(sessionId: string, workspace: Workspace, toolCallId: string, summary: string | undefined, sections: SettingsSection[], parts: SettingsPart[], log?: Parameters<typeof sectionsOfParts>[3]): Promise<string> {
  const request = offerRequest(useStore.getState().sessions[sessionId].agent);
  const text = await autoConfirmSettings(sessionId, workspace, toolCallId, summary, sections, parts);
  // What follows reads the model the app chose (a composer pick or another provider may replace the recommended one).
  const effective = useStore.getState().sessions[sessionId].agent.settingsParts;
  const lines = await Promise.all(sections.map(async (x, i) => {
    const ref = effective?.[i]?.modelRef ?? x.recommended.modelRef;
    const name = modelSummary(ref)?.name ?? ref;
    if (ref !== x.recommended.modelRef) log?.action({ icon: 'search', label: `Checked ${name}`, detail: limitsLine(ref) || undefined });
    return `${limitsLine(ref) ? `\n${name} (${ref}) takes: ${limitsLine(ref)}.` : ''}${await imagesFit(ref, parts.filter((p) => p.kind === x.kind && (!x.modelSelection?.requested || p.model === x.modelSelection.requested)))}${resolutionNote(ref, request)}`;
  }));
  return text + lines.join('');
}

/**
 * Whether the images the parts declare fit the chosen model. When they do not, the agent never plans with a model that
 * would drop them: it offers the connected models that take them all (fittingModels), and only without one plans what fits.
 */
export async function imagesFit(ref: string, parts: SettingsPart[]): Promise<string> {
  const images = Math.max(0, ...parts.map((p) => p.refs ?? 0));
  const start = parts.some((p) => p.start_image);
  if (!images && !start) return '';
  const want = { startImage: start, images, count: Math.max(1, ...parts.map((p) => p.count ?? 1)) };
  const lacks = missing(useStore.getState().catalog.schemas[ref], want);
  const n = images + (start ? 1 : 0);
  if (!lacks.length) return ` Your ${n} image${n > 1 ? 's fit' : ' fits'}.`;
  const others = await fittingModels(ref, want);
  const name = modelSummary(ref)?.name ?? ref;
  if (others.length) {
    const options = others.map((r) => `"${modelSummary(r)?.name ?? r}" (${r})`).join('; ');
    return ` Your ${n} image${n > 1 ? 's do' : ' does'} not fit ${name} (${limitsLine(ref) || 'its inputs'}). Do not plan yet. Say it in one short sentence and ${OWED_QUESTION}, these options): ${options}; "Seguir con ${name} con menos imágenes". Then call confirm_settings again with the chosen model and plan for it.`;
  }
  return ` Your ${n} image${n > 1 ? 's do' : ' does'} not fit it and no connected model takes them all: explain this and offer a feasible adapted request. Wait for the user to choose before dropping inputs or changing model.`;
}

/** Reuse an already resolved set; a new explicit model still uses the same internal settings path. */
export async function modelsNeedSettings(sessionId: string, steps: Parameters<typeof partsOfSteps>[0]): Promise<boolean> {
  const a = useStore.getState().sessions[sessionId].agent;
  for (const p of partsOfSteps(steps).filter((p) => p.model && p.user_requested)) {
    const confirmed = (a.settingsParts ?? []).filter((x) => x.kind === p.kind);
    const choices = confirmed.length ? confirmed : a.settings?.[p.kind] ? [a.settings[p.kind]!] : [];
    if (!(await partNamed(choices, p.model!, resolveModel))) return true;
  }
  return false;
}

/**
 * Auto: a plan with image or video steps came before any settings were confirmed. The app runs the confirm path itself
 * and answers with the effective settings; the plan sent is not shown, so the prompts are written for them first.
 */
export async function settingsForPlan(sessionId: string, workspace: Workspace, toolCallId: string, steps: Parameters<typeof partsOfSteps>[0], until: <T>(work: Promise<T>) => Promise<T>, log: Parameters<typeof sectionsOfParts>[3]): Promise<string | null> {
  const parts = partsOfSteps(steps);
  const { sections, failed } = await sectionsOfParts(sessionId, parts, until, log);
  if (failed || !sections.length) return failed || 'The plan has no image or video step to confirm settings for.';
  const text = await autoAnswer(sessionId, workspace, toolCallId, undefined, sections, parts, log);
  // The prompts already fit what the app chose (same model, length and frame): the plan is shown as sent, written once.
  return await fitsChosen(sessionId, parts) ? null : `${text}\nThe plan you sent was not shown. Now write the prompts for these settings and call propose_plan again.`;
}

/** A comparison is matched per model, never against the first part of its kind. */
async function fitsChosen(sessionId: string, parts: SettingsPart[]): Promise<boolean> {
  const a = useStore.getState().sessions[sessionId].agent;
  for (const p of parts) {
    const all = (a.settingsParts ?? []).filter((x) => x.kind === p.kind);
    const c = all.length > 1 && p.model ? await partNamed(all, p.model, resolveModel) : all[0] ?? a.settings?.[p.kind];
    if (!c || (p.model && !(await partNamed([c], p.model, resolveModel))) || (p.duration != null && p.duration !== c.duration) || (p.aspect != null && p.aspect !== c.aspect)) return false;
  }
  return true;
}
