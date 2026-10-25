import { lineRoutes, pickComposerModel } from '../catalog';
import { patchSession, setComposerMedia, useStore } from '../../store/store';
import type { MediaKind, PlanStep, SettingsChoice } from '../types';

/**
 * Direct has no settings card: when the user approves a plan, the model and values of each step become the
 * composer's defaults for that kind, so the next request starts from them (the user changes them by saying so).
 * A rejected or never-approved plan never reaches this.
 */
export function inheritApproved(steps: PlanStep[]): void {
  const done = new Set<string>();
  for (const st of steps) {
    const kind = st.kind as MediaKind;
    if ((kind !== 'image' && kind !== 'video') || done.has(kind) || !('settings' in st)) continue;
    done.add(kind);
    const cur = useStore.getState().composer[kind];
    const { aspect, resolution, count, duration } = st.settings;
    const settings = { ...cur.settings, ...(aspect ? { aspect } : {}), ...(resolution ? { resolution } : {}), ...(count ? { count } : {}), ...(kind === 'video' && duration ? { duration } : {}) };
    setComposerMedia(kind, { settings });
    if ('modelRef' in st && st.modelRef && st.modelRef !== cur.modelRef) void pickComposerModel(kind, st.modelRef);
  }
}

/**
 * Auto: approving a plan confirms what it runs, so the next request starts from what the user approved and not from an
 * older choice the plan no longer shows (sandbox session 2026-10-25: Seedream ran, Nano Banana Pro stayed confirmed and
 * the next plan was "corrected" back to it). Per kind, the model and values of its first step that runs, as the card
 * shows them; the model as its text route (text to image or to video), never the edit or image-to-video variant a step's
 * inputs need. A kind run on two lines (a comparison) keeps its confirmed choice. Operations are not plan steps of a
 * kind, so they never set it.
 */
export function confirmApproved(sessionId: string, steps: PlanStep[]): void {
  type Gen = Extract<PlanStep, { kind: 'image' | 'video' }>;
  const gens = steps.filter((s): s is Gen => s.kind === 'image' || s.kind === 'video');
  for (const kind of ['image', 'video'] as const) {
    const of = gens.filter((s) => s.kind === kind && s.modelRef);
    const line = (ref: string) => lineRoutes(ref).text ?? ref;
    if (!of.length || new Set(of.map((s) => line(s.modelRef))).size > 1) continue;
    const s = of[0];
    const choice: SettingsChoice = { modelRef: line(s.modelRef), aspect: s.settings.aspect, resolution: s.settings.resolution, needsImage: Boolean(s.refs?.length || (s.kind === 'video' && s.firstFrame)), ...(s.kind === 'video' ? { duration: s.settings.duration } : { count: s.settings.count }) };
    patchSession(sessionId, (x) => ({ ...x, agent: { ...x.agent, settings: { ...x.agent.settings, [kind]: choice } } }));
  }
}
