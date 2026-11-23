import { estimateOp } from '../../costs';
import { createGeneration, opSpec, opSpecForModel, videoOpSeconds } from '../../jobs';
import { opChoice } from '../../opSpec';
import { OPS, opCount, operationFactor, isVideoOpEngine } from '../../ops';
import { parseRef } from '../../planRef';
import { costAuthorization } from '../../priceAuthorization';
import { useStore } from '../../../store/store';
import type { GenSettings } from '../../types';
import type { EstimateStep, RunStep } from './env';

const get = useStore.getState;

export const runOp: RunStep<'op'> = async (s, { ctx, base, requireAsset, resolveAsset, runSettled, stepOutputs }) => {
  const source = await resolveAsset(s.input);
  if (!source) throw new Error(`No input for ${OPS[s.op].label}.`);
  let params = s.params;
  if (s.more?.length) {
    const rest: string[] = [];
    for (const r of s.more) {
      rest.push(await requireAsset(r));
    }
    params = { ...params, clips: rest.join(',') };
    // Music under the joined video: an audio step of this plan or an audio asset.
    if (typeof params.music === 'string' && params.music) params = { ...params, music: (await resolveAsset(params.music)) ?? '' };
  }
  if (s.refs?.length) {
    const got: Array<{ asset: string; role?: string; note?: string }> = [];
    for (const r of s.refs) {
      got.push({ asset: await requireAsset(r.ref), role: r.role, note: r.note });
    }
    params = { ...params, _refs: got.map((g) => g.asset).join(','), _refRoles: JSON.stringify(got) };
  }
  const spec = await opSpec({ ...base, sourceAssetId: source, op: s.op, params, nodeChoice: ctx.nodeOperations?.[s.id] });
  const g = createGeneration({ ...spec, ...(base.approvalTicketId ? { approvalTicketId: base.approvalTicketId } : {}), ...(base.approvedFingerprint ? { approvedFingerprint: base.approvedFingerprint } : {}) });
  ctx.onState(s.id, 'running', { generationId: g.id });
  const out = stepOutputs(g.id, await runSettled(g.id));
  // Text results (Transcribe) feed later prompts through prompt_from.
  return { ...out, text: get().generations[g.id]?.text };
};

export const estimateOperation: EstimateStep<'op'> = (s, { steps, nodeOperations, videoSettings }) => {
  const p = parseRef(s.input);
  const src = p?.type === 'asset' ? get().assets[p.id] : undefined;
  const engine = OPS[s.op].engine;
  let opRef: string | undefined;
  let opSettings: GenSettings | undefined;
  let estimate;
  if (['local', 'transcribe', 'voice'].includes(engine)) estimate = estimateOp(s.op, s.params, src, videoSettings);
  else {
    // The same spec the send builds (jobs.opSpecForModel): its model, settings and price, so the approved price is the sent one.
    const upstream = p?.type === 'step' ? steps.find((x) => x.id === p.id) : undefined;
    const node = nodeOperations?.[s.id];
    const choice = opChoice({ op: s.op, params: s.params, sourceAssetId: src?.id ?? '', nodeChoice: node, upstreamModelRef: upstream && 'modelRef' in upstream ? upstream.modelRef : undefined });
    opRef = choice.ref;
    const spec = opSpecForModel({ sessionId: '', origin: 'agent', op: s.op, params: s.params, sourceAssetId: src?.id ?? '', nodeChoice: node }, opRef, choice.viaEdit, get().catalog.schemas[opRef]);
    opSettings = spec.settings;
    estimate = spec.estimate ?? estimateOp(s.op, s.params, src, spec.settings, opRef);
    if (isVideoOpEngine(engine)) {
      // A clip still to be made: its step's duration.
      const clip = src?.duration ?? (upstream?.kind === 'video' ? upstream.settings.duration : undefined);
      const est = estimateOp(s.op, s.params, src, { ...spec.settings, duration: videoOpSeconds(engine, spec.settings, clip) }, opRef);
      estimate = upstream && engine !== 'video_extend' ? { ...est, approximate: true } : est;
    }
  }
  return { estimate, authorization: costAuthorization(opRef ?? '', opSettings ?? { count: opCount(OPS[s.op], s.params), advanced: {} }, estimate, operationFactor({ id: s.op, params: s.params })) };
};
