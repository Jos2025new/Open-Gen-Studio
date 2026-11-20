import { isAbort } from '../lib/http';
import { layerToAsset } from './design/actions';
import { StepStillRunning, isLiveStatus, settleGeneration } from './settle';
import { cancelGeneration, type OpSpecInput, runGeneration } from './jobs';
import { parseRef, stepDeps, topoOrder } from './plan';
import { sumEstimates } from './pricing';
import { uid } from '../lib/id';
import type { Estimate, GenerationOrigin, PlanStep, PlanSubject, StepState, StepAuthorization, Subject, Workspace } from './types';
import { PriceReviewRequired } from './priceAuthorization';
import { useStore } from '../store/store';
import { clearPlanStop, isPlanStopped, stoppedError } from './planStop';
import { placeFor } from './place';
import { ESTIMATE_STEP, RUN_STEP } from './planSteps/exec';
import type { EstimateStep, RunStep } from './planSteps/exec/env';

const get = useStore.getState;

export interface StepOutput {
  assetIds: string[];
  text?: string;
  layerId?: string | null;
}

export interface ExecContext {
  sessionId: string;
  planId?: string;
  workspace: Workspace;
  origin: GenerationOrigin;
  docId?: string;
  concurrency?: number;
  /** Subjects the plan saves (F3): from an asset at the start, from a step when it ends. */
  subjects?: PlanSubject[];
  nodeLibrary?: Subject[];
  nodeOperations?: Record<string, OpSpecInput['nodeChoice']>;
  /** Resuming a plan: steps already done (their outputs are reused, they do not run again). */
  prior?: Map<string, StepOutput>;
  /** Resuming a plan: steps that failed again and stay failed (their dependents are skipped). */
  blocked?: Map<string, string>;
  waiting?: Set<string>;
  canceled?: Set<string>;
  reuseGenerations?: Record<string, string>;
  onState: (stepId: string, state: StepState, info?: { generationId?: string; error?: string }) => void;
}

export interface ExecResult {
  outputs: Map<string, StepOutput>;
  failed: Array<{ stepId: string; error: string }>;
  skipped: string[];
  waiting: string[];
  /** The user pressed Cancel: nothing new was started and the pending steps were not run. */
  stopped?: boolean;
}

export function estimateSteps(steps: PlanStep[], nodeOperations?: ExecContext['nodeOperations']): { total: Estimate; perStep: Record<string, Estimate>; authorizations: Record<string, StepAuthorization> } {
  const perStep: Record<string, Estimate> = {};
  const authorizations: Record<string, StepAuthorization> = {};
  const videoSettings = get().composer.video.settings;
  for (const s of steps) {
    const { estimate, authorization } = (ESTIMATE_STEP[s.kind] as EstimateStep<typeof s.kind>)(s as never, { steps, nodeOperations, videoSettings });
    perStep[s.id] = estimate;
    authorizations[s.id] = authorization;
  }
  return { total: sumEstimates(Object.values(perStep)), perStep, authorizations };
}

/** Run a DAG of steps with bounded concurrency. Failed steps skip their dependents. */
export async function executeSteps(steps: PlanStep[], ctx: ExecContext): Promise<ExecResult> {
  const order = topoOrder(steps);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const outputs = new Map<string, StepOutput>();
  const failed: ExecResult['failed'] = [];
  const skipped: string[] = [];
  const waiting: string[] = [];
  const state = new Map<string, StepState>(order.map((id) => [id, 'pending']));
  const limit = Math.max(1, ctx.concurrency ?? 2);
  clearPlanStop(ctx.planId);

  // The same inputs the plan card uses (plan.stepDeps: refs as `step:` refs, `after` as plain ids), computed once.
  const depsOf = new Map<string, string[]>();
  const deps = (s: PlanStep): string[] => {
    const known = depsOf.get(s.id);
    if (known) return known;
    const ids: string[] = [];
    for (const r of stepDeps(s)) {
      const p = r ? parseRef(r) : null;
      const id = p?.type === 'step' ? p.id : !p && r && byId.has(r) ? r : null;
      if (id && byId.has(id) && !ids.includes(id)) ids.push(id);
    }
    // Layer steps apply in plan order so the stack matches the plan.
    if (s.kind === 'layer') {
      const idx = order.indexOf(s.id);
      const prevLayer = order.slice(0, idx).reverse().find((id) => byId.get(id)?.kind === 'layer');
      if (prevLayer && !ids.includes(prevLayer)) ids.push(prevLayer);
    }
    depsOf.set(s.id, ids);
    return ids;
  };

  /** A reference the step declares must resolve: a missing one stops the step before any provider call. */
  const requireAsset = async (ref: string, what = 'reference'): Promise<string> => {
    const a = await resolveAsset(ref);
    if (!a || (ref.startsWith('asset:') && !useStore.getState().assets[a])) throw new Error(`Missing ${what} "${ref}": its image does not exist. Nothing was sent to the provider.`);
    return a;
  };

  const resolveAsset = async (ref: string | undefined): Promise<string | null> => {
    if (!ref) return null;
    const p = parseRef(ref);
    if (!p) return null;
    if (p.type === 'asset') return p.id;
    if (p.type === 'layer') {
      if (!ctx.docId) throw new Error('No active design document for layer references.');
      return (await layerToAsset(ctx.sessionId, ctx.docId, p.id)).id;
    }
    const out = outputs.get(p.id);
    if (p.index > 0 && !out?.assetIds[p.index]) throw new Error(`Selected candidate ${p.index + 1} is unavailable for ${p.id}.`);
    return out?.assetIds[p.index] ?? null;
  };

  /**
   * A step counts as done only if its generation made something (T1). The plan card, the closing message and what a
   * later step can use are all built from these states, so a step that "succeeded" without making anything would
   * have the agent telling the user it delivered a result that does not exist (ses_mursnwichu).
   * Text results (a transcription, lyrics, a voice, a style) finish with text and no files, so they are exempt.
   * A runner that resolves without recording anything is taken at its word (some callers answer with assets only).
   */
  // A run that returns before its job is over (Check status took over the follower) waits for the follower.
  const runSettled = async (id: string) => {
    // Cancel arrived while this step prepared its request: it is not sent.
    if (isPlanStopped(ctx.planId)) { cancelGeneration(id); throw stoppedError(); }
    const assetIds = await runGeneration(id);
    await settleGeneration(id);
    return assetIds;
  };

  const stepOutputs = (generationId: string, assetIds: string[]): StepOutput => {
    const g = useStore.getState().generations[generationId];
    if (!g || g.kind === 'text') return { assetIds };
    if (g.status === 'error' || g.status === 'canceled') throw new Error(g.error || `${g.modelName} did not finish (${g.status}).`);
    if (!assetIds.length && !g.assetIds.length) {
      if (isLiveStatus(g.status)) throw new StepStillRunning(g.modelName);
      throw new Error(`${g.modelName} returned no result.`);
    }
    return { assetIds };
  };

  const promptFor = (s: { prompt: string; promptFrom?: string }): string => {
    if (!s.promptFrom) return s.prompt;
    const p = parseRef(s.promptFrom);
    const text = p?.type === 'step' ? outputs.get(p.id)?.text ?? '' : '';
    return [text.trim(), s.prompt.trim()].filter(Boolean).join('\n');
  };

  const local: Subject[] = [];
  const withLocal = <T extends object>(inputs: T) => ({ ...inputs, ...(local.length ? { subjects: [...local] } : {}), ...(ctx.nodeLibrary ? { nodeLibrary: ctx.nodeLibrary } : {}) });

  const runEnv = { ctx, outputs, requireAsset, resolveAsset, promptFor, runSettled, stepOutputs };

  const runStep = async (s: PlanStep): Promise<StepOutput> => {
    const reuse = ctx.reuseGenerations?.[s.id];
    if (reuse) {
      const out = stepOutputs(reuse, await runSettled(reuse));
      return { ...out, text: get().generations[reuse]?.text };
    }
    const nodeSubjects: Subject[] = [];
    for (const subject of s.nodeSubjects ?? []) {
      const asset = await resolveAsset(subject.from);
      if (!asset) throw new Error(`No image for @${subject.name}.`);
      nodeSubjects.push({ id: subject.name, name: subject.name, description: subject.description ?? '', kind: subject.kind ?? 'character', frontalAssetId: asset, refAssetIds: [] });
    }
    const inputsFor = <T extends object>(inputs: T) => ({ ...withLocal(inputs), ...(nodeSubjects.length ? { subjects: nodeSubjects } : {}) });
    const base = { sessionId: ctx.sessionId, origin: ctx.origin, place: placeFor({}, ctx.workspace), mode: 'agent' as const, planId: ctx.planId, stepId: s.id };
    return (RUN_STEP[s.kind] as RunStep<typeof s.kind>)(s as never, { ...runEnv, base, inputsFor });
  };

  // Asset subjects save/reuse library entries. Step subjects serve this plan without saving to the library.
  for (const subj of ctx.subjects ?? []) {
    const p = parseRef(subj.from);
    if (p?.type === 'asset') saveSubjectOnce(subj, p.id);
  }
  const saveSubjectsOf = (stepId: string, out: StepOutput) => {
    for (const subj of ctx.subjects ?? []) {
      const p = parseRef(subj.from);
      if (p?.type !== 'step' || p.id !== stepId) continue;
      const asset = out.assetIds[p.index] ?? out.assetIds[0];
      if (asset && get().assets[asset]?.kind === 'image') {
        local.push({ id: uid('sub'), name: subj.name, kind: subj.kind ?? 'character', description: subj.description, frontalAssetId: asset, refAssetIds: [] });
      }
    }
  };

  for (const [id, out] of ctx.prior ?? []) {
    if (!state.has(id)) continue;
    state.set(id, 'done');
    outputs.set(id, out);
    saveSubjectsOf(id, out);
  }
  for (const [id, error] of ctx.blocked ?? []) {
    if (!state.has(id)) continue;
    state.set(id, 'error');
    failed.push({ stepId: id, error });
  }

  for (const id of ctx.canceled ?? []) {
    if (state.has(id)) { state.set(id, 'skipped'); skipped.push(id); }
  }
  for (const id of ctx.waiting ?? []) {
    if (state.has(id)) { state.set(id, 'review'); waiting.push(id); }
  }

  await new Promise<void>((resolve) => {
    let active = 0;
    const pump = () => {
      let progressed = false;
      if (isPlanStopped(ctx.planId)) {
        // Cancel: nothing else starts. Pending steps are not run; the running ones end by their own cancellation.
        for (const id of order) if (state.get(id) === 'pending') { state.set(id, 'skipped'); skipped.push(id); ctx.onState(id, 'skipped'); }
        if (active === 0) resolve();
        return;
      }
      for (const id of order) {
        if (state.get(id) !== 'pending') continue;
        const s = byId.get(id)!;
        const ds = deps(s);
        if (ds.some((d) => state.get(d) === 'error' || state.get(d) === 'skipped')) {
          state.set(id, 'skipped');
          skipped.push(id);
          ctx.onState(id, 'skipped');
          progressed = true;
          continue;
        }
        if (!ds.every((d) => state.get(d) === 'done')) continue;
        // Layer steps mutate the document; run them one at a time.
        if (active >= limit || (s.kind === 'layer' && active > 0)) continue;
        state.set(id, 'running');
        ctx.onState(id, 'running');
        active++;
        progressed = true;
        runStep(s)
          .then((out) => {
            outputs.set(id, out);
            saveSubjectsOf(id, out);
            state.set(id, 'done');
            ctx.onState(id, 'done');
          })
          .catch((err: unknown) => {
            // Still live at the provider: the plan waits for it, it does not fail (see settleGeneration).
            if (err instanceof StepStillRunning) {
              state.set(id, 'review');
              waiting.push(id);
              ctx.onState(id, 'review');
              return;
            }
            if (err instanceof PriceReviewRequired) {
              state.set(id, 'review');
              waiting.push(id);
              ctx.onState(id, 'review');
              return;
            }
            state.set(id, 'error');
            const message = isAbort(err) ? 'Canceled' : (err as Error).message;
            failed.push({ stepId: id, error: message });
            ctx.onState(id, 'error', { error: message });
          })
          .finally(() => {
            active--;
            pump();
          });
      }
      if (progressed) pump();
      else if (active === 0) resolve();
    };
    pump();
  });

  for (const [id, st] of state) if (st === 'pending') { waiting.push(id); ctx.onState(id, 'pending'); }
  const stopped = isPlanStopped(ctx.planId);
  if (stopped) for (const id of waiting.splice(0)) { skipped.push(id); ctx.onState(id, 'skipped'); } // a step waiting for review does not continue after Cancel
  return { outputs, failed, skipped, waiting, ...(stopped ? { stopped: true } : {}) };
}

/** Save a plan subject in the library, unless one with that name exists (it is reused, as the plan card said). */
function saveSubjectOnce(subj: PlanSubject, assetId: string): void {
  if (get().assets[assetId]?.kind !== 'image') return;
  if (get().library.some((x) => x.name.toLowerCase() === subj.name.toLowerCase())) return;
  useStore.setState((st) => ({ library: [...st.library, { id: uid('sub'), name: subj.name, kind: subj.kind ?? 'character', description: subj.description, frontalAssetId: assetId, refAssetIds: [] }] }));
}
