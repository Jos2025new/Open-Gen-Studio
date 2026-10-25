import { composerChosen, defaultModelFor, inputVariant, resolveModel } from '../catalog';
import { offerRequest, partModel } from '../modelNamed';
import { OPS } from '../ops';
import { useStore } from '../../store/store';
import type { SettingsSection, Workspace } from '../types';
import { autoConfirmSettings } from './autoSettings';
import { durationProblem, limitsLine, resolutionNote } from './modelLimits';
import { suggestModel } from './modelIndex';
import { buildSettings } from './settingsCard';

/** What a confirm_settings part asks (the tool's input, one kind). */
export interface SettingsPart { kind: 'video' | 'image'; purpose?: 'draft' | 'normal' | 'long'; start_image?: boolean; refs?: number; count?: number; duration?: number; aspect?: string; model?: string; provider?: string }

/** One card for the plan that comes now: images first, then video. */
export const imagesFirst = <P extends { kind: string }>(parts: P[]): P[] => [...parts].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'image' ? -1 : 1));

/** The parts a plan's generation steps ask for (an operation on an image model counts as image; only a step names its own model). */
export function partsOfSteps(steps: Array<{ kind: string; op?: string; model?: string; count?: number; duration?: number; aspect?: string; refs?: string[]; first_frame?: string }>): SettingsPart[] {
  return imagesFirst(steps.flatMap((s): SettingsPart[] => {
    const kind = s.kind === 'op' && (OPS as Record<string, { engine: string }>)[s.op ?? '']?.engine === 'edit' ? 'image' : s.kind;
    return kind === 'video' || kind === 'image' ? [{ kind, model: kind === s.kind ? s.model : undefined, count: s.count, duration: s.duration, aspect: s.aspect, start_image: Boolean(s.first_frame), refs: s.refs?.length }] : [];
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
    const built = await until(buildSettings(
      { kind: d.kind, purpose: d.purpose ?? 'normal', startImage: d.start_image ?? false, refs: d.refs ?? 0, count: d.count ?? 1, duration: d.duration, aspect: d.aspect, model: partModel(d, ag().settings), provider: d.provider },
      { getModel: resolveModel, suggestModel, composerChosen, routeModel: (mode) => useStore.getState().composer.videoRoutes?.[mode], defaultModel: defaultModelFor, inputVariant: (r, k) => inputVariant(r, k)?.ref },
    ));
    if ('error' in built) return { sections, failed: `${d.kind}: ${built.error}` };
    const long = d.kind === 'video' ? durationProblem(built.recommended.modelRef, d.duration, offerRequest(ag()), Object.keys(ag().draft?.answers ?? {}).length > 0) : undefined;
    log.action({ icon: 'search', label: `Checked ${(await resolveModel(built.recommended.modelRef))?.model.name ?? built.recommended.modelRef}`, detail: limitsLine(built.recommended.modelRef) || undefined });
    if (long) return { sections, failed: long };
    sections.push({ kind: d.kind, count: d.count ?? 1, recommended: built.recommended, alternatives: built.alternatives });
  }
  return { sections, failed: '' };
}

/** Auto confirms these sections itself: what the agent reads (values, guide), plus a line for a resolution the model lacks. */
export async function autoAnswer(sessionId: string, workspace: Workspace, toolCallId: string, summary: string | undefined, sections: SettingsSection[], parts: SettingsPart[]): Promise<string> {
  const request = offerRequest(useStore.getState().sessions[sessionId].agent);
  const text = await autoConfirmSettings(sessionId, workspace, toolCallId, summary, sections, parts);
  // The note reads the model the app chose (a composer pick may replace the recommended one), never the one it replaced.
  const chosen = useStore.getState().sessions[sessionId].agent.settings;
  return text + sections.map((x) => resolutionNote(chosen?.[x.kind as 'image' | 'video']?.modelRef ?? x.recommended.modelRef, request)).join('');
}

/**
 * Auto: a plan with image or video steps came before any settings were confirmed. The app runs the confirm path itself
 * and answers with the effective settings; the plan sent is not shown, so the prompts are written for them first.
 */
export async function settingsForPlan(sessionId: string, workspace: Workspace, toolCallId: string, steps: Parameters<typeof partsOfSteps>[0], until: <T>(work: Promise<T>) => Promise<T>, log: Parameters<typeof sectionsOfParts>[3]): Promise<string> {
  const parts = partsOfSteps(steps);
  const { sections, failed } = await sectionsOfParts(sessionId, parts, until, log);
  if (failed || !sections.length) return failed || 'The plan has no image or video step to confirm settings for.';
  return `${await autoAnswer(sessionId, workspace, toolCallId, undefined, sections, parts)}\nThe plan you sent was not shown. Now write the prompts for these settings and call propose_plan again.`;
}
