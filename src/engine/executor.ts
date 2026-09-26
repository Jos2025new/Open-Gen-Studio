import { isAbort } from '../lib/http';
import { estimateMedia, estimateOp } from './costs';
import { applyLayerStep, layerToAsset } from './design/actions';
import { ensureSchema, opModelFor } from './catalog';
import { createGeneration, opSpec, runGeneration, videoOpSeconds, videoOpSettings } from './jobs';
import { lyricsBody, lyricsParam } from './params';
import { OPS } from './ops';
import { parseRef, topoOrder } from './plan';
import { sumEstimates } from './pricing';
import type { Estimate, GenerationOrigin, PlanStep, StepState, Workspace } from './types';
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
        const settings = videoOpSettings(engine, get().catalog.schemas[opModelFor(engine).ref]);
        const upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
        const clip = src?.duration ?? (upstream?.kind === 'video' ? upstream.settings.duration : undefined);
        const est = estimateOp(s.op, s.params, src, { ...settings, duration: videoOpSeconds(engine, settings, clip) });
        perStep[s.id] = upstream && engine !== 'video_extend' ? { ...est, approximate: true } : est;
      } else perStep[s.id] = estimateOp(s.op, s.params, src, videoSettings);
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
            ? [s.input]
            : s.kind === 'layer'
              ? [s.source]
              : [];
    const ids: string[] = [];
    for (const r of refs) {
      const p = r ? parseRef(r) : null;
      if (p?.type === 'step' && byId.has(p.id)) ids.push(p.id);
    }
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
    return out?.assetIds[p.index] ?? out?.assetIds[0] ?? null;
  };

  const promptFor = (s: { prompt: string; promptFrom?: string }): string => {
    if (!s.promptFrom) return s.prompt;
    const p = parseRef(s.promptFrom);
    const text = p?.type === 'step' ? outputs.get(p.id)?.text ?? '' : '';
    return [text.trim(), s.prompt.trim()].filter(Boolean).join('\n');
  };

  const runStep = async (s: PlanStep): Promise<StepOutput> => {
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
        const g = createGeneration({ ...base, kind: 'image', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs } });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return { assetIds: await runGeneration(g.id) };
      }
      case 'model3d': {
        const refs: string[] = [];
        for (const r of s.refs) {
          const a = await resolveAsset(r);
          if (a) refs.push(a);
        }
        const g = createGeneration({ ...base, kind: 'model3d', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs: { refs } });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return { assetIds: await runGeneration(g.id) };
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
        const inputs = { refs, firstFrame, lastFrame, times: Object.keys(times).length ? times : undefined };
        const g = createGeneration({ ...base, kind: 'video', prompt: promptFor(s), modelRef: s.modelRef, settings: s.settings, inputs });
        ctx.onState(s.id, 'running', { generationId: g.id });
        return { assetIds: await runGeneration(g.id) };
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
        const g = createGeneration({ ...base, kind, prompt: promptFor(s), modelRef: s.modelRef, settings, inputs: { refs: [] } });
        ctx.onState(s.id, 'running', { generationId: g.id });
        const assetIds = await runGeneration(g.id);
        return { assetIds, text: get().generations[g.id]?.text };
      }
      case 'op': {
        const source = await resolveAsset(s.input);
        if (!source) throw new Error(`No input for ${OPS[s.op].label}.`);
        const spec = await opSpec({ ...base, sourceAssetId: source, op: s.op, params: s.params });
        const g = createGeneration(spec);
        ctx.onState(s.id, 'running', { generationId: g.id });
        const assetIds = await runGeneration(g.id);
        // Text results (Transcribe) feed later prompts through prompt_from.
        return { assetIds, text: useStore.getState().generations[g.id]?.text };
      }
      case 'layer': {
        if (!ctx.docId) throw new Error('No design document to place layers in.');
        const source = s.layerType === 'raster' ? await resolveAsset(s.source) : null;
        const layerId = await applyLayerStep(ctx.sessionId, ctx.docId, s, source);
        return { assetIds: [], layerId };
      }
    }
  };

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
