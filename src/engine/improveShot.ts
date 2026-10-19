import { uid } from '../lib/id';
import { isAbort } from '../lib/http';
import { opModelFor } from './catalog';
import { budgetProblem, opEstimate, runAssetOp } from './actions';
import { estimateMedia } from './costs';
import { createGeneration, runGeneration } from './jobs';
import { paramByRole } from './params';
import type { Estimate, Generation } from './types';
import { appendFeed, toast, useStore } from '../store/store';

/*
 * "Mejorar esta toma": a finished draft video becomes the high-quality one. The same prompt, inputs and seed are
 * rendered at 1080p when the model has that resolution; otherwise the clip goes through the video upscaler.
 * The cost is shown and confirmed in the card (SpendConfirm), like Regenerate.
 */

const get = useStore.getState;
export type ImprovePlan = { mode: 'rerender'; resolution: string } | { mode: 'upscale' };
const HIGH = 1080;

/** What improving this result does, or null when it is not a lower-resolution video of a generation. */
export function improvePlan(g: Generation): ImprovePlan | null {
  if (g.kind !== 'video' || g.op || g.status !== 'done' || !g.assetIds.length) return null;
  const now = parseInt(g.settings.resolution ?? '', 10);
  if (!Number.isFinite(now) || now >= HIGH) return null;
  const options = paramByRole(get().catalog.schemas[g.modelRef], 'resolution')?.options?.map(String) ?? [];
  const high = options.find((o) => /^1080p?$/i.test(o.trim()));
  if (high) return { mode: 'rerender', resolution: high };
  return opModelFor('video_upscale').ref ? { mode: 'upscale' } : null;
}

export async function improveEstimate(g: Generation, plan: ImprovePlan): Promise<Estimate> {
  if (plan.mode === 'upscale') return (await opEstimate(g.assetIds[0], 'video_upscale', {})).estimate;
  return estimateMedia(g.modelRef, g.kind as 'video', { ...g.settings, resolution: plan.resolution }, Boolean(g.inputs.refs.length || g.inputs.firstFrame), false, g.prompt.length);
}

/** Run the improvement. Call after the user confirmed the cost. */
export async function improveShot(generationId: string): Promise<void> {
  const g = get().generations[generationId];
  const plan = g && improvePlan(g);
  if (!g || !plan) return;
  const estimate = await improveEstimate(g, plan);
  const problem = budgetProblem(estimate);
  if (problem) { toast(problem, 'error'); return; }
  if (plan.mode === 'upscale') { await runAssetOp(g.assetIds[0], 'video_upscale', {}, undefined, undefined, g.place, g.mode); return; }
  const next = createGeneration({
    sessionId: g.sessionId, kind: g.kind, prompt: g.prompt, modelRef: g.modelRef, inputs: g.inputs, origin: g.origin, place: g.place, mode: g.mode,
    settings: { ...g.settings, resolution: plan.resolution },
    parentId: g.id, operationId: g.operationId ?? g.id, estimate,
  });
  appendFeed(g.sessionId, { id: uid('fd'), createdAt: Date.now(), workspace: 'chat', type: 'generation', generationId: next.id });
  runGeneration(next.id).catch((err) => { if (!isAbort(err)) toast((err as Error).message, 'error'); });
}
