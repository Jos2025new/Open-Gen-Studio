import { aspectOfShape, fitStepParams, longEdgeOf } from '../agent/fit';
import { OPS } from '../ops';
import { opStepRefs } from '../refRoles';
import type { OpId, OpStep } from '../types';
import { parseRef } from '../planRef';
import { didYouMean, familyRef } from './shared';
import type { RawStep, StepEnv } from './env';

export async function normalizeOp(s: RawStep, env: StepEnv): Promise<void> {
  const { ctx, errors, adjustments, steps, stepRoles, fit, refKind } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  const opId = s.op as OpId;
  const def = OPS[opId];
  if (!def) {
    errors.push(`${where}: unknown op "${s.op}". Valid: ${Object.keys(OPS).join(', ')}.`);
    return;
  }
  if (def.viaSketch) {
    errors.push(`${where}: "${s.op}" needs a mask the user paints in Sketch; use an edit op with an instruction instead.`);
    return;
  }
  const k = refKind(s.input, where);
  if (!s.input) errors.push(`${where}: "input" is required.`);
  else if (k) {
    const inputKind = k === 'raster' ? 'image' : k;
    if (inputKind !== def.input) errors.push(`${where}: op "${opId}" needs a${def.input === 'image' ? 'n image' : ' video'} input, "${s.input}" is ${inputKind}.${def.input === 'image' && inputKind === 'video' ? ` Fix: add a step { kind: "op", op: "extract_frame", input: "${s.input}", params: { which: "last" } } and use it as input.` : def.input === 'video' && inputKind === 'image' ? ' Fix: make a clip from it first (a video step with first_frame) and use that step as input.' : ''}`);
  }
  // The request and the source (an asset, or the resolution of the step it comes from) fill what the agent left out;
  // an impossibility is refused and an ambiguity asked or decided by mode (fit.ts).
  const src = s.input ? parseRef(s.input) : null;
  const srcAsset = src?.type === 'asset' ? ctx.asset(src.id) : undefined;
  const srcStep = src?.type === 'step' ? steps.find((x) => x.id === src.id) : undefined;
  const srcSettings = srcStep && 'settings' in srcStep ? (srcStep.settings as { resolution?: string; aspect?: string }) : undefined;
  const fitted = fitStepParams({ id: s.id!, where, op: opId, input: s.input, params: s.params, loose: s as unknown as Record<string, unknown> }, def.fields, ctx.requestText?.() ?? '', {
    sourceLongEdge: srcAsset?.width && srcAsset?.height ? Math.max(srcAsset.width, srcAsset.height) : longEdgeOf(srcSettings?.resolution),
    sourceAspect: srcAsset?.width && srcAsset?.height ? aspectOfShape(srcAsset.width / srcAsset.height) : srcSettings?.aspect,
    usedAngles: src?.type === 'asset' && ctx.usedAngles ? ctx.usedAngles(src.id) : [],
    sourceGrid: srcStep?.kind === 'op' && srcStep.op === 'contact_sheet' ? (String(srcStep.params.angles) === '6' ? '2x3' : '3') : undefined,
  }, fit);
  const params = fitted.params;
  errors.push(...fitted.errors);
  adjustments.push(...fitted.adjustments);
  if (opId === 'edit' && !String(params.instruction ?? '').trim()) {
    if (s.prompt?.trim()) params.instruction = s.prompt.trim();
    else errors.push(`${where}: op "edit" needs params.instruction.`);
  }
  if ((opId === 'animate' || opId === 'continue') && !String(params.motion ?? '').trim() && s.prompt?.trim()) params.motion = s.prompt.trim();
  // The step's own words go into the op's note (the op keeps its tuned instruction); before, they were dropped.
  if (s.prompt?.trim() && def.fields.some((f) => f.key === 'note') && !String(params.note ?? '').trim()) params.note = s.prompt.trim();
  // A model named on an edit / animate op runs it (before, the op silently used the source's model).
  if (s.model?.trim() && (def.engine === 'edit' || def.engine === 'video')) {
    const kind = def.engine === 'edit' ? 'image' : 'video';
    const ref = familyRef(ctx, s.model, kind, true, s.id!, adjustments);
    const got = ref ? await ctx.getModel(ref) : null;
    if (!got) errors.push(`${where}: unknown model "${s.model}".${didYouMean(ctx, s.model, kind, true)}`);
    else if (got.model.kind !== kind || !got.model.acceptsImage || got.model.needsVideo) errors.push(`${where}: model "${ref}" does not take an input image for "${opId}". Fix: use its edit variant (find_models) or leave "model" out.${didYouMean(ctx, s.model, kind, true)}`);
    else params._modelRef = ref!;
  }
  // Otherwise the confirmed (or, in Direct, the composer's) image model runs it, in its edit variant (ADR 0009).
  const opModel = def.engine === 'edit' && !params._modelRef ? ctx.opModel?.() : undefined;
  if (opModel) params._modelRef = ctx.variantModel?.(opModel, 'edit') ?? opModel;
  const opRefs = s.refs?.length ? opStepRefs(def.engine, opId, s.refs as string[], stepRoles.get(s.id!), where, errors, refKind) : undefined;
  let more: string[] | undefined;
  if (def.multiInput) {
    more = (Array.isArray(s.more) ? s.more : []).map((r) => String(r).trim()).filter(Boolean);
    if (ctx.workspace === 'node') errors.push(`${where}: "${opId}" is not available in the Node workspace yet.`);
    if (!more.length) errors.push(`${where}: "${opId}" needs "more": the clips after "input", in order.`);
    if (more.length > 19) errors.push(`${where}: "${opId}" joins at most 20 clips.`);
    for (const r of more) {
      const k = refKind(r, where);
      if (k && k !== 'video') errors.push(`${where}: "${opId}" joins videos; "${r}" is ${k}.`);
    }
    const music = String(params.music ?? '').trim();
    if (music) {
      const k = refKind(music, where);
      if (k && k !== 'audio') errors.push(`${where}: params.music must be an audio step or asset; "${music}" is ${k}.`);
    }
  }
  steps.push({ id: s.id!, kind: 'op', title, op: opId, input: s.input ?? '', ...(more ? { more } : {}), ...(opRefs ? { refs: opRefs } : {}), params } satisfies OpStep);
}
