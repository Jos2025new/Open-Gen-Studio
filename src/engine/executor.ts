import { isAbort } from '../lib/http';
import { estimateMedia, estimateOp } from './costs';
import { applyLayerStep, layerToAsset } from './design/actions';
import { ensureSchema, opFollowsSource, opModelFor, opModelForAsset, opModelFromRef } from './catalog';
import { createGeneration, opSpec, type OpSpecInput, runGeneration, videoOpSeconds, videoOpSettings } from './jobs';
import { lyricsBody, lyricsParam } from './params';
import { OPS } from './ops';
import { parseRef, topoOrder } from './plan';
import { sumEstimates } from './pricing';
import { uid } from '../lib/id';
import type { Estimate, GenerationOrigin, PlanStep, PlanSubject, StepState, Subject, Workspace } from './types';
import { useStore } from '../store/store';

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
  onState: (stepId: string, state: StepState, info?: { generationId?: string; error?: string }) => void;
}

export interface ExecResult {
  outputs: Map<string, StepOutput>;
  failed: Array<{ stepId: string; error: string }>;
  skipped: string[];
}

export function estimateSteps(steps: PlanStep[]): { total: Estimate; perStep: Record<string, Estimate> } {
  const perStep: Record<string, Estimate> = {};
  const videoSettings = get().composer.video.settings;
  for (const s of steps) {
    if (s.kind === 'image') perStep[s.id] = estimateMedia(s.modelRef, 'image', s.settings, s.refs.length > 0);
    else if (s.kind === 'model3d') perStep[s.id] = estimateMedia(s.modelRef, 'model3d', s.settings, s.refs.length > 0);
    else if (s.kind === 'video') perStep[s.id] = estimateMedia(s.modelRef, 'video', s.settings, Boolean(s.firstFrame));
    else if (s.kind === 'audio') perStep[s.id] = estimateMedia(s.modelRef, 'audio', s.settings, false);
    else if (s.kind === 'op') {
      const p = parseRef(s.input);
      const src = p?.type === 'asset' ? get().assets[p.id] : undefined;
      const engine = OPS[s.op].engine;
      if (engine === 'video_upscale' || engine === 'video_edit' || engine === 'video_extend') {
        // Same estimate as the direct operation on that clip (jobs.opSpec). A clip still to be made: its step's duration.
        const ref = typeof s.params._modelRef === 'string' ? s.params._modelRef : opModelFor(engine).ref;
        const settings = videoOpSettings(engine, get().catalog.schemas[ref], s.params);
        const upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
        const clip = src?.duration ?? (upstream?.kind === 'video' ? upstream.settings.duration : undefined);
        const est = estimateOp(s.op, s.params, src, { ...settings, duration: videoOpSeconds(engine, settings, clip) }, ref);
        perStep[s.id] = upstream && engine !== 'video_extend' ? { ...est, approximate: true } : est;
      } else {
        // Edit / video operations run on the model that made their input (jobs.opSpec); a step still to run: its model.
        const upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
        const kind = engine === 'edit' ? 'image' : 'video';
        const ref = opFollowsSource(engine) ? (typeof s.params._modelRef === 'string' ? s.params._modelRef : src ? opModelForAsset(engine, src.id).ref : (upstream && 'modelRef' in upstream ? opModelFromRef(upstream.modelRef, kind) : null) ?? opModelFor(engine).ref) : undefined;
        perStep[s.id] = estimateOp(s.op, s.params, src, videoSettings, ref);
      }
    } else perStep[s.id] = { usd: 0, approximate: false };
  }
  return { total: sumEstimates(Object.values(perStep)), perStep };
}

/** Run a DAG of steps with bounded concurrency. Failed steps skip their dependents. */
export async function executeSteps(steps: PlanStep[], ctx: ExecContext): Promise<ExecResult> {
  const order = topoOrder(steps);
  const byId = new Map(steps.map((s) => [s.id, s]));
  const outputs = new Map<string, StepOutput>();
  const failed: ExecResult['failed'] = [];
  const skipped: string[] = [];
  const state = new Map<string, StepState>(order.map((id) => [id, 'pending']));
  const limit = Math.max(1, ctx.concurrency ?? 2);

  const deps = (s: PlanStep): string[] => {
    const refs: Array<string | undefined> =
      s.kind === 'image' || s.kind === 'model3d'
        ? [s.promptFrom, ...s.refs]
        : s.kind === 'video'
          ? [s.promptFrom, s.firstFrame, s.lastFrame, ...(s.refs ?? [])]
          : s.kind === 'audio'
            ? [s.promptFrom, s.lyricsFrom]
            : s.kind === 'op'
            ? [s.input, ...(s.more ?? []), ...(typeof s.params?.music === 'string' && s.params.music ? [s.params.music] : [])]
            : s.kind === 'layer'
              ? [s.source]
              : [];
    const ids: string[] = [];
    for (const r of refs) {
      const p = r ? parseRef(r) : null;
      if (p?.type === 'step' && byId.has(p.id)) ids.push(p.id);
    }
    for (const a of s.after ?? []) if (byId.has(a)) ids.push(a);
    // Layer steps apply in plan order so the stack matches the plan.
    if (s.kind === 'layer') {
      const idx = order.indexOf(s.id);
      const prevLayer = order.slice(0, idx).reverse().find((id) => byId.get(id)?.kind === 'layer');
      if (prevLayer) ids.push(prevLayer);
    }
    return ids;
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
  const stepOutputs = (generationId: string, assetIds: string[]): StepOutput => {
    const g = useStore.getState().generations[generationId];
    if (!g || g.kind === 'text') return { assetIds };
    if (g.status === 'error' || g.status === 'canceled') throw new Error(g.error || `${g.modelName} did not finish (${g.status}).`);
    if (!assetIds.length && !g.assetIds.length) throw new Error(`${g.modelName} returned no result.`);
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

  const runStep = async (s: PlanStep): Promise<StepOutput> => {
    const nodeSubjects: Subject[] = [];
    for (const subject of s.nodeSubjects ?? []) {
      const asset = await resolveAsset(subject.from);
      if (!asset) throw new Error(`No image for @${subject.name}.`);
      nodeSubjects.push({ id: subject.name, name: subject.name, description: subject.description ?? '', kind: subject.kind ?? 'character', frontalAssetId: asset, refAssetIds: [] });
    }
    const inputsFor = <T extends object>(inputs: T) => ({ ...withLocal(inputs), ...(nodeSubjects.length ? { subjects: nodeSubjects } : {}) });
    const base = { sessionId: ctx.sessionId, origin: ctx.origin, planId: ctx.planId, stepId: s.id };
    switch (s.kind) {
      case 'text':
        return { assetIds: [], text: s.text };
      case 'image': {
        const refs: string[] = [];
        for (const r of s.refs) {
          const a = await resolveAsset(r);
          if (a) refs.push(a);
        }
        const g = createGeneration({ ...base, kind: 'image', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: inputsFor({ refs }), variants: s.variations });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return stepOutputs(g.id, await runGeneration(g.id));
      }
      case 'model3d': {
        const refs: string[] = [];
        for (const r of s.refs) {
          const a = await resolveAsset(r);
          if (a) refs.push(a);
        }
        const g = createGeneration({ ...base, kind: 'model3d', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: inputsFor({ refs }) });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return stepOutputs(g.id, await runGeneration(g.id));
      }
      case 'video': {
        const firstFrame = (await resolveAsset(s.firstFrame)) ?? undefined;
        const lastFrame = (await resolveAsset(s.lastFrame)) ?? undefined;
        const refs: string[] = [];
        const times: Record<string, number> = {};
        for (const [i, r] of (s.refs ?? []).entries()) {
          const a = await resolveAsset(r);
          if (!a) continue;
          refs.push(a);
          const t = s.times?.[i];
          if (t != null) times[a] = t;
        }
        const inputs = inputsFor({ refs, firstFrame, lastFrame, times: Object.keys(times).length ? times : undefined });
        const g = createGeneration({ ...base, kind: 'video', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return stepOutputs(g.id, await runGeneration(g.id));
      }
      case 'audio': {
        // Lyrics from an earlier step (a lyrics result keeps only the song text) into the model's lyrics field.
        let settings = s.settings;
        if (s.lyricsFrom) {
          const p = parseRef(s.lyricsFrom);
          const text = p?.type === 'step' ? outputs.get(p.id)?.text ?? '' : '';
          const key = lyricsParam((await ensureSchema(s.modelRef)) ?? undefined)?.key;
          if (!key) throw new Error(`${s.title}: the model takes no lyrics.`);
          settings = { ...settings, extras: { ...settings.extras, [key]: lyricsBody(text) } };
        }
        const kind = s.textOutput ? 'text' : 'audio';
        const g = createGeneration({ ...base, kind, prompt: promptFor(s), modelRef: s.modelRef, settings, inputs: inputsFor({ refs: [] }) });
        ctx.onState(s.id, 'running', { generationId: g.id });
        const out = stepOutputs(g.id, await runGeneration(g.id));
        return { ...out, text: get().generations[g.id]?.text };
      }
      case 'op': {
        const source = await resolveAsset(s.input);
        if (!source) throw new Error(`No input for ${OPS[s.op].label}.`);
        let params = s.params;
        if (s.more?.length) {
          const rest: string[] = [];
          for (const r of s.more) {
            const a = await resolveAsset(r);
            if (a) rest.push(a);
          }
          params = { ...params, clips: rest.join(',') };
          // Music under the joined video: an audio step of this plan or an audio asset.
          if (typeof params.music === 'string' && params.music) params = { ...params, music: (await resolveAsset(params.music)) ?? '' };
        }
        const spec = await opSpec({ ...base, sourceAssetId: source, op: s.op, params, nodeChoice: ctx.nodeOperations?.[s.id] });
        const g = createGeneration(spec);
        ctx.onState(s.id, 'running', { generationId: g.id });
        const out = stepOutputs(g.id, await runGeneration(g.id));
        // Text results (Transcribe) feed later prompts through prompt_from.
        return { ...out, text: useStore.getState().generations[g.id]?.text };
      }
      case 'layer': {
        if (!ctx.docId) throw new Error('No design document to place layers in.');
        const source = s.layerType === 'raster' ? await resolveAsset(s.source) : null;
        const layerId = await applyLayerStep(ctx.sessionId, ctx.docId, s, source);
        return { assetIds: [], layerId };
      }
    }
  };

  // The user's own images are saved to the library before anything runs. A subject made by a step (a reference
  // sheet) is only a candidate: it serves this plan's @Name and reaches the library when the user saves it.
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
  }
  for (const [id, error] of ctx.blocked ?? []) {
    if (!state.has(id)) continue;
    state.set(id, 'error');
    failed.push({ stepId: id, error });
  }

  await new Promise<void>((resolve) => {
    let active = 0;
    const pump = () => {
      let progressed = false;
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

  return { outputs, failed, skipped };
}

/** Save a plan subject in the library, unless one with that name exists (it is reused, as the plan card said). */
function saveSubjectOnce(subj: PlanSubject, assetId: string): void {
  if (get().assets[assetId]?.kind !== 'image') return;
  if (get().library.some((x) => x.name.toLowerCase() === subj.name.toLowerCase())) return;
  useStore.setState((st) => ({ library: [...st.library, { id: uid('sub'), name: subj.name, kind: subj.kind ?? 'character', description: subj.description, frontalAssetId: assetId, refAssetIds: [] }] }));
}
