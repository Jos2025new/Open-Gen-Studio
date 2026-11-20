import { estimateMedia } from '../../costs';
import { sentModelRef } from '../../catalog';
import { createGeneration } from '../../jobs';
import { costAuthorization } from '../../priceAuthorization';
import type { EstimateStep, RunEnv, RunStep } from './env';

type GenInputs = Parameters<typeof createGeneration>[0]['inputs'];

/** The generation of a step that makes images, a model or a clip from its references: they differ only in their inputs. */
async function generate(kind: 'image' | 'model3d' | 'video', s: { id: string; prompt: string; promptFrom?: string; modelRef: string; settings: Parameters<typeof createGeneration>[0]['settings'] }, inputs: GenInputs, env: RunEnv, variants?: Parameters<typeof createGeneration>[0]['variants']) {
  const { ctx, base, promptFor, runSettled, stepOutputs } = env;
  const g = createGeneration({ ...base, kind, prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs, variants });
  ctx.onState(s.id, 'running', { generationId: g.id });
  return stepOutputs(g.id, await runSettled(g.id));
}

async function refAssets(refs: string[], env: RunEnv): Promise<string[]> {
  const out: string[] = [];
  for (const r of refs) out.push(await env.requireAsset(r));
  return out;
}

export const runImage: RunStep<'image'> = async (s, env) => generate('image', s, env.inputsFor({ refs: await refAssets(s.refs, env) }), env, s.variations);

export const runModel3d: RunStep<'model3d'> = async (s, env) => generate('model3d', s, env.inputsFor({ refs: await refAssets(s.refs, env) }), env);

export const runVideo: RunStep<'video'> = async (s, env) => {
  const { requireAsset, inputsFor } = env;
  const firstFrame = s.firstFrame ? await requireAsset(s.firstFrame, 'first frame') : undefined;
  const lastFrame = s.lastFrame ? await requireAsset(s.lastFrame, 'last frame') : undefined;
  const refs: string[] = [];
  const times: Record<string, number> = {};
  for (const [i, r] of (s.refs ?? []).entries()) {
    const a = await requireAsset(r);
    refs.push(a);
    const t = s.times?.[i];
    if (t != null) times[a] = t;
  }
  return generate('video', s, inputsFor({ refs, firstFrame, lastFrame, times: Object.keys(times).length ? times : undefined }), env);
};

export const estimateImage: EstimateStep<'image'> = (s) => {
  // Priced as sent: inputs on a text-only model run as its image twin (jobs.ts, sentModelRef).
  const sent = sentModelRef(s.modelRef, 'image', Boolean(s.refs?.length));
  const estimate = estimateMedia(sent, 'image', s.settings, s.refs.length > 0);
  return { estimate, authorization: costAuthorization(sent, { ...s.settings, ...(s.variations?.length ? { count: s.variations.length } : {}) }, estimate) };
};

export const estimateModel3d: EstimateStep<'model3d'> = (s) => {
  const estimate = estimateMedia(s.modelRef, 'model3d', s.settings, s.refs.length > 0);
  return { estimate, authorization: costAuthorization(s.modelRef, { ...s.settings }, estimate) };
};

export const estimateVideo: EstimateStep<'video'> = (s) => {
  const sent = sentModelRef(s.modelRef, 'video', Boolean(s.refs?.length || s.firstFrame));
  const estimate = estimateMedia(sent, 'video', s.settings, Boolean(s.firstFrame || s.refs?.length));
  return { estimate, authorization: costAuthorization(sent, { ...s.settings }, estimate) };
};
