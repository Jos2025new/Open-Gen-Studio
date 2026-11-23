import { sendMediaViaPaidGate } from './money/transport';
import { isRestart } from './checkStatus';
import { mayStartWork } from '../lib/writerLock';
import { checkStepAuthorization, costAuthorization, PriceReviewRequired, stepApproved } from './priceAuthorization';
import { uid } from '../lib/id';
import { AbortedError, isAbort, NetworkError, sleep } from '../lib/http';
import { estimateMedia } from './costs';
import { randomSeed } from '../lib/rng';
import { describeRequest, type MediaInfoLite } from '../lib/debug';
import { logEvent } from '../lib/log';
import { approvalEstimateForPlan, journeyActive, journeyIdFor, recordJourneyEvent } from '../lib/journeyTrace';
import { apiKeyFor, modelSummary, isConnected, sentModelRef, RECRAFT_STYLE_REF } from './catalog';
import { variantRoute } from './variants';
import { withVariation } from './sentPrompt';
import { isCreditError, onGenerationCredit } from './credit';
import { OPS, operationFactor } from './ops';
import { maxCountPerRequest, paramByRole } from './params';
import { ADAPTERS } from './providers/registry';
import { resolveSendable, SchemaUnavailableError } from './schemaGuard';
import { retrySpec } from './retryPartial';
import { PROVIDER_LABELS, parseModelRef, type MediaInput } from './providers/types';
import { opRealism, negFor } from './realism';
import type { Asset, Generation, MediaKind, ModelSchema } from './types';
import { addAssets, patchGeneration, toast, upsertGeneration, useStore } from '../store/store';
import { holdRetry, relinkAttempt } from './relinkAttempt';
import { shareOfEstimate } from './sendLedger';
import { flushSendSave, interruptedByReload, SendNotCommittedError, wasFreeSend } from './sendMark';
import { ensureGenerationTicket, grantGenerationTicketPass, hasOpenInFlightSend, hasUncertainTicketSend, slotPriceForGeneration, storeTickets, ticketPassFromEstimate } from './money/storeBridge';
import { assertWithinLimit, bindGenerationPass, clearGenerationPass, consumeOnce, generationQuoteGuard, passActiveFor, remainingBudget, startGenerationPass, type BudgetPass } from './budget';
import { expectedDims, storeModelOutputs, storeOutput } from './assetIO';
import { activeRemoteJob, followRemote } from './jobRecovery';
import { requestQuote } from './quotes';
import { chargePartial, checkDelivery, controllers, estimateSpec, finish, finishText, keptJob, purgeDiscarded, requestEstimate, running, type GenerationSpec } from './jobState';
import { runLocalOp } from './localOps';
import { runCreateStyle, runCreateVoice, runTranscribe } from './specialSends';
import { promptShape, slotInputs, structuredSlots, subjectInputs } from './sendInputs';

// Moved out of this file (Opus #4); kept here so every caller and mock keeps its path.
export { adoptRemoteAssets, storeModelOutputs } from './assetIO';
export { canRecheck, checkStatusNow, recheckGeneration } from './jobRecovery';
export { opSpec, opSpecForModel, videoOpSeconds, videoOpSettings, type OpSpecInput } from './opSpec';

export { estimateSpec, type GenerationSpec } from './jobState';

const get = useStore.getState;
const retrying = new Map<string, Promise<string[]>>();

export function modelName(ref: string): string {
  if (ref === 'local::frame') return 'Local tool';
  if (ref.startsWith('local::')) return ref === 'local::studio-video' ? 'Local Motion' : 'Local Sketch';
  return get().catalog.models[ref]?.name ?? get().catalog.transcribers?.[ref]?.name ?? parseModelRef(ref)?.id ?? ref;
}

export function createGeneration(spec: GenerationSpec): Generation {
  const estimate = spec.estimate ?? estimateSpec(spec);
  // The net behind every entry: before the pass of an approved action is spent, a run nobody approved is refused.
  const approval = spec.approvalTicketId ? storeTickets.get(spec.approvalTicketId) : undefined;
  const nodeRunApproved = Boolean(
    approval && (approval.kind === 'node_run' || approval.kind === 'commands') && approval.sessionId === spec.sessionId && spec.stepId && approval.scope.nodeIds?.includes(spec.stepId),
  );
  const nodeRunHadPass = Boolean(nodeRunApproved && approval?.pass);
  const approved = stepApproved(spec.sessionId, spec.planId, spec.stepId) || nodeRunApproved;
  assertWithinLimit(estimate, spec.sessionId, approved, spec.budgetPass);
  const pass = passActiveFor(spec.budgetPass, spec.sessionId, estimate) ? spec.budgetPass : undefined;
  const passOwner = pass ?? (nodeRunHadPass ? spec.approvalTicketId : undefined);
  const parsed = parseModelRef(spec.modelRef);
  const g: Generation = {
    id: uid('gen'),
    sessionId: spec.sessionId,
    kind: spec.kind,
    prompt: spec.prompt,
    modelRef: spec.modelRef,
    modelName: modelName(spec.modelRef),
    provider: parsed?.provider ?? 'local',
    settings: { ...spec.settings, seed: spec.settings.seed ?? randomSeed() },
    inputs: spec.inputs ?? { refs: [] },
    op: spec.op,
    origin: spec.origin,
    place: spec.place,
    mode: spec.mode,
    status: 'queued',
    assetIds: [],
    estimate,
    ...(approval?.sessionId === spec.sessionId ? { approvalTicketId: approval.id } : {}),
    retryBaseEstimate: estimate,
    retryTotal: spec.variants?.length ?? spec.settings.count,
    parentId: spec.parentId,
    operationId: spec.operationId,
    planId: spec.planId,
    stepId: spec.stepId,
    ...(spec.nodeRequest ? { nodeRequest: spec.nodeRequest } : {}),
    ...(spec.variants?.length ? { variants: spec.variants } : {}),
    createdAt: Date.now(),
  };
  const rem = remainingBudget();
  const needsTicketPass = Boolean(
    passOwner ||
    (stepApproved(spec.sessionId, spec.planId, spec.stepId) &&
      (estimate.usd == null || estimate.lowerBound || (rem != null && estimate.usd > rem + 1e-9))),
  );
  if (passOwner && estimate.usd !== 0) bindGenerationPass(g.id, spec.sessionId, estimate.lowerBound ? null : estimate.usd, passOwner);
  consumeOnce(spec.budgetPass, estimate);
  upsertGeneration(g);
  if (!g.approvalTicketId && slotPriceForGeneration(g).maxVerifiableUsd !== 0) {
    ensureGenerationTicket(g, needsTicketPass ? { pass: ticketPassFromEstimate(estimate) } : {});
  } else if (g.approvalTicketId && approval?.kind !== 'commands' && pass && !approval?.pass) {
    grantGenerationTicketPass(g.id, estimate);
  }
  return g;
}

/** One at a time per serialKey. */
const series = new Map<string, Promise<unknown>>();

/** Run `send` when the previous request to the same model is done; different models never wait for each other. */
function oneAtATime<T>(key: string, send: () => Promise<T>): Promise<T> {
  const previous = series.get(key) ?? Promise.resolve();
  const mine = previous.then(send, send);
  series.set(key, mine);
  void mine.catch(() => undefined).then(() => {
    if (series.get(key) === mine) series.delete(key);
  });
  return mine;
}

/** Execute a queued generation. Resolves with the created asset ids. */
export function runGeneration(id: string, nodeLock?: () => void): Promise<string[]> {
  const existing = running.get(id);
  if (existing) return existing;
  if (!mayStartWork()) return Promise.reject((clearGenerationPass(id, true), new Error('Open Gen Studio is open in another tab')));
  const generation = get().generations[id];
  if (generation?.status === 'review') {
    clearGenerationPass(id, true);
    return Promise.reject(new PriceReviewRequired('Necesita revisión'));
  }
  startGenerationPass(id);
  const p = attempt(id, nodeLock).finally(() => {
    running.delete(id);
    controllers.delete(id);
    clearGenerationPass(id);
    purgeDiscarded(id);
  });
  running.set(id, p);
  return p;
}

/** Retry provider credit failures as appropriate (a provider's own refusals: ProviderAdapter.retry). */
async function attempt(id: string, nodeLock?: () => void): Promise<string[]> {
  try {
    return await execute(id);
  } catch (err) {
    const failed = get().generations[id];
    if (isCreditError(err) && !(failed && hasUncertainTicketSend(failed))) {
      let rerun: Promise<string[]> | undefined;
      await onGenerationCredit(id, (gid) => (rerun = execute(gid)), runGeneration, requestEstimate, nodeLock);
      if (rerun) return rerun;
      throw err;
    }
    throw err;
  }
}

async function execute(id: string): Promise<string[]> {
  const g0 = get().generations[id];
  if (!g0) throw new Error('Generation not found');
  const checkQuote = generationQuoteGuard(id);
  const controller = new AbortController();
  controllers.set(id, controller);
  const signal = controller.signal;
  patchGeneration(id, { status: 'running', startedAt: Date.now(), error: undefined, statusText: 'Starting', progress: undefined, delivery: undefined, sent: undefined, providerReportedUsd: undefined });
  let g = get().generations[id];
  let submitted = false;
  let freeSend = false;
  let localPostSend = false;
  try {
    if (g.op && OPS[g.op.id].engine === 'local') {
      const assetIds = await runLocalOp(g, signal);
      finish(id, assetIds, 0);
      return assetIds;
    }
    if (g.planId && ((g.op && ['transcribe', 'voice'].includes(OPS[g.op.id].engine)) || (g.kind === 'text' && g.modelRef === RECRAFT_STYLE_REF))) {
      checkStepAuthorization(g, costAuthorization(g.modelRef, g.settings, requestEstimate(g)));
    }
    if (g.op && OPS[g.op.id].engine === 'transcribe') {
      await runTranscribe(g, signal);
      return [];
    }
    if (g.op && OPS[g.op.id].engine === 'voice') {
      await runCreateVoice(g, signal);
      return [];
    }
    if (g.kind === 'text' && g.modelRef === RECRAFT_STYLE_REF) {
      await runCreateStyle(g, signal);
      return [];
    }
    // Text-only model + inputs: image-input twin (edit / image-to-video).
    if ((g.kind === 'image' || g.kind === 'video') && !g.op && (g.inputs.refs.length || g.inputs.firstFrame)) {
      const cur = modelSummary(g.modelRef);
      const twin = sentModelRef(g.modelRef, g.kind, true);
      if (twin !== g.modelRef) {
        const before = { modelRef: g.modelRef, variant: cur ? variantRoute(cur) : 'unknown', inputRoles: { references: g.inputs.refs.length, firstFrame: !!g.inputs.firstFrame, lastFrame: !!g.inputs.lastFrame } };
        patchGeneration(g.id, { modelRef: twin, modelName: modelSummary(twin)?.name ?? g.modelName, provider: modelSummary(twin)?.provider ?? g.provider });
        g = get().generations[g.id];
        recordJourneyEvent({ journeyId: journeyIdFor(g.sessionId) ?? g.sessionId, journey: 'variant-inputs', event: 'generation.variant_resolved', reason: 'late variant resolution', sessionId: g.sessionId, planId: g.planId, stepId: g.stepId, generationId: g.id, before, after: { modelRef: g.modelRef, variant: modelSummary(g.modelRef) ? variantRoute(modelSummary(g.modelRef)!) : 'unknown', inputRoles: before.inputRoles } });
      }
    }
    const resolved = await resolveSendable(g.modelRef);
    if (!resolved) {
      const parsed = parseModelRef(g.modelRef);
      const prov = parsed ? PROVIDER_LABELS[parsed.provider] : 'its provider';
      throw new Error(parsed && !isConnected(parsed.provider) ? `Connect ${prov} in Settings to use ${g.modelName}.` : `Model ${g.modelName} is not available.`);
    }
    const { model, schema } = resolved;
    if (g.kind === 'text' && !model.textOutput) throw new Error(`${model.name} makes ${model.kind}, not text.`);
    // What the provider is asked for: a text-output model (lyrics) runs as its media kind.
    const kind: MediaKind = g.kind === 'text' ? model.kind : g.kind;
    if (schema.missing?.length) throw new Error(`${model.name} needs ${schema.missing.join(', ')}, which the app cannot send yet. Pick another model.`);
    const apiKey = apiKeyFor(model.provider);
    if (model.provider !== 'local' && !apiKey) throw new Error(`Add your ${PROVIDER_LABELS[model.provider]} key in Settings.`);
    const adapter = ADAPTERS[model.provider];

    // Inputs
    const slots = await slotInputs(g, model, schema, kind);
    const subjects = await subjectInputs(g, model, schema, slots);
    const shaped = promptShape(g, model, schema, kind, slots, subjects);
    const { firstFrame, lastFrame, video, mask, audio, refAudios } = slots;
    const { elements } = subjects;
    const { prompt } = shaped;
    const { keyframes, clips, refs, refVideos, genSettings: shapedSettings } = structuredSlots(g, schema, subjects, slots, shaped.genSettings);
    let genSettings = shapedSettings;

    const { variants, priorCount, total, progressTotal, perRequest } = batchPlan(g, schema);
    const approvalSettings = { ...genSettings, count: total };
    const proposed = g.planId ? costAuthorization(g.modelRef, approvalSettings, requestEstimate({ ...g, settings: approvalSettings }), operationFactor(g.op)) : undefined;
    if (proposed) checkStepAuthorization(g, proposed);
    const shown = opRealism(g, kind, prompt, model.id);
    genSettings = negFor(genSettings, shown !== prompt && paramByRole(schema, 'negative'));
    const fallback = expectedDims(kind, g.settings);
    const assetIds: string[] = [...g.assetIds];
    const delivered: Asset[] = [];
    let cost = 0;
    let costKnown = true;
    let providerReportedCost = 0;
    let providerReportedCostKnown = true;
    let done = 0;
    // Request number from 1; the app's own retries and each candidate count (T5).
    let requests = 0;
    let activeReqId: string | undefined;
    while (done < total) {
      const n = Math.min(perRequest, total - done);
      const settings = { ...genSettings, seed: genSettings.seed != null ? genSettings.seed + priorCount + done : undefined };
      // A quote is not a provider-reported charge in the agent notice.
      const quote = await requestQuote(g.modelRef, schema, settings, n);
      const reqIndex = priorCount + done;
      activeReqId = undefined;
      localPostSend = false;
      const send = (retry: number) => sendMediaViaPaidGate({
        g,
        provider: model.provider,
        index: reqIndex,
        items: n,
        quote,
        signal,
        beforeTransport: () => {
          checkQuote(quote);
          if (proposed) checkStepAuthorization(g, proposed);
        },
        isRetryable: (err) => {
          const policy = adapter.retry;
          const wait = policy?.waits[retry];
          return Boolean(policy && wait != null && !submitted && !signal.aborted && !(err instanceof NetworkError) && policy.matches((err as Error).message));
        },
        request: (onRemoteJob) => ({ method: 'generate', input: {
            kind,
            model,
            schema,
            prompt: withVariation(shown, variants?.[done]),
            settings,
            count: n,
            refs,
            refVideos,
            keyframes,
            clips,
            audio,
            refAudios,
            elements,
            mask,
            firstFrame,
            lastFrame,
            video,
            op: g.op ? { id: g.op.id, params: g.op.params } : undefined,
            apiKey,
            signal,
            onStatus: (text, progress) => patchGeneration(id, { statusText: progressTotal > 1 ? `${text} · ${priorCount + done + 1}/${progressTotal}` : text, progress }),
            onRemoteJob: (job) => {
              submitted = true;
              onRemoteJob(job);
            },
            // What the provider is about to read: kept for "Copy debug info" (T5), without keys and without media.
            onRequest: (info) => {
              requests += 1;
              // Trace only in tests and the sandbox: the real app builds nothing here, so a send can never fail on it.
              if (journeyActive()) try {
              const estimate = estimateMedia(g.modelRef, kind, { ...settings, count: n }, refs.length > 0 || Boolean(firstFrame), false, g.prompt.length);
              const approval = approvalEstimateForPlan(g.planId);
              recordJourneyEvent({ journeyId: journeyIdFor(g.sessionId) ?? g.sessionId, journey: 'price-approval-execution', event: 'generation.request_prepared', reason: 'provider adapter exposed final request immediately before send', sessionId: g.sessionId, planId: g.planId, stepId: g.stepId, generationId: g.id, approvalId: approval.approvalId, after: { modelRef: g.modelRef, kind, inputRoles: { references: refs.length, referenceVideos: refVideos.length, firstFrame: Boolean(firstFrame), lastFrame: Boolean(lastFrame), keyframes: keyframes?.length ?? 0 }, settings: { count: n, duration: settings.duration, resolution: settings.resolution, aspect: settings.aspect, quality: settings.advanced?.quality } }, prices: { acceptedEstimateUsd: approval.acceptedEstimateUsd ?? null, currentEstimateUsd: estimate.usd } }); } catch { /* diagnostics never block a send */ }
              patchGeneration(id, { sent: describeRequest({ ...info, attempt: requests, media: mediaInfo(refs[0] ?? firstFrame ?? video) }) });
            },
        } }),
        settlement: (value) => {
          const countDelivered = g.kind === 'text' ? 1 : Math.max(1, Math.min(n, value.outputs.length));
          const knownCost = g.kind === 'text' ? (value.costUsd ?? g.estimate.usd) : (value.costUsd ?? quote);
          const costUsd = knownCost ?? shareOfEstimate(get().generations[id] ?? g, countDelivered) ?? null;
          return { costUsd, estimated: knownCost == null };
        },
      });
      const serial = adapter.serialKey?.(model) ?? null;
      const once = (retry: number) => (serial ? oneAtATime(serial, () => send(retry)) : send(retry));
      // ProviderAdapter.retry: only the refused request is retried, spaced out; finished images are kept.
      let outcome: Awaited<ReturnType<typeof send>> | undefined;
      for (let retry = 0; ; retry++) {
        try {
          outcome = await once(retry);
          submitted = false;
          break;
        } catch (err) {
          const policy = adapter.retry;
          const wait = policy?.waits[retry];
          if (!policy || wait == null || submitted || signal.aborted || err instanceof NetworkError || err instanceof SendNotCommittedError || !policy.matches((err as Error).message)) throw err;
          const which = total > 1 ? ` (image ${done + 1} of ${total})` : '';
          const refused = `${policy.label} refused access`;
          patchGeneration(id, {
            statusText: `${refused}${which}; trying again in ${wait / 1000} s`,
            notes: [...(get().generations[id]?.notes ?? []).filter((x) => !x.startsWith(refused)), `${refused} ("${policy.reason}")${which}; it was tried again on its own.`],
          });
          logEvent('retry', { generation: id, model: g.modelName, reason: policy.reason.toLowerCase(), waitMs: wait, attempt: retry + 2, image: done + 1 });
          await sleep(wait, signal);
        }
      }
      freeSend = outcome.free;
      activeReqId = outcome.sendId;
      const result = outcome.value;
      const reqCost = result.costUsd ?? quote;
      if (reqCost != null) cost += reqCost;
      else costKnown = false;
      if (result.costUsd != null) providerReportedCost += result.costUsd;
      else providerReportedCostKnown = false;
      if (g.kind === 'text') {
        finishText(id, result.text ?? '', result.costUsd, activeReqId);
        await flushSendSave();
        return [];
      }
      const items = Math.max(1, Math.min(n, result.outputs.length));
      // paidSend already settled and booked this send idempotently before local storage;
      // keep `sending` set while blobs are written so a reload before `assetIds` lands warns the user.
      localPostSend = !freeSend || (reqCost != null && reqCost > 0);
      if (localPostSend) patchGeneration(id, { sending: Date.now() });
      const assets = kind === 'model3d' ? await storeModelOutputs(result.outputs, g) : await Promise.all(result.outputs.slice(0, n).map((o) => storeOutput(o, g, kind, fallback)));
      addAssets(assets);
      delivered.push(...assets);
      assetIds.push(...assets.map((a) => a.id));
      done += items;
      const batchDone = done >= total || !result.outputs.length;
      patchGeneration(id, {
        assetIds: [...assetIds],
        ...(variants ? { variants: variants.slice(done) } : {}),
        sending: undefined,
        remoteJob: undefined,
        ...(batchDone && costKnown ? { actualUsd: cost } : {}),
        ...(batchDone && providerReportedCostKnown ? { providerReportedUsd: providerReportedCost } : {}),
      });
      localPostSend = false;
      await flushSendSave();
      if (!result.outputs.length) break;
    }
    finish(id, assetIds, costKnown ? cost : undefined, await checkDelivery(id, delivered), providerReportedCostKnown ? providerReportedCost : undefined, activeReqId);
    await flushSendSave();
    return assetIds;
  } catch (err) {
    if (err instanceof PriceReviewRequired) {
      patchGeneration(id, { sending: undefined });
      throw err;
    }
    const cur = get().generations[id];
    if (err instanceof SendNotCommittedError) {
      const keepLost = Boolean(cur && !wasFreeSend(cur) && hasUncertainTicketSend(cur));
      patchGeneration(id, { status: 'error', error: err.message, statusText: undefined, finishedAt: Date.now(), lostJob: keepLost, sending: undefined });
      toast(err.message, 'error', 9000, cur?.planId || keepLost ? undefined : { label: 'Retry', run: () => { void retryGeneration(id).catch((e) => { if (!isAbort(e)) toast((e as Error).message, 'error'); }); } });
      throw err;
    }
    if (isRestart(signal.reason)) return [];
    const remoteJob = keptJob(err, cur?.remoteJob);
    if (isAbort(err) || signal.aborted) {
      const uncertain = Boolean((localPostSend && !remoteJob) || (cur && !wasFreeSend(cur, freeSend) && !remoteJob && hasUncertainTicketSend(cur)));
      patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob, ...(uncertain ? { lostJob: true } : {}), sending: undefined });
      if (cur?.assetIds.length) chargePartial(cur);
      if (localPostSend) await flushSendSave();
      throw new AbortedError();
    }
    // The connection failed before any job id came back: the request may still have reached the provider.
    const free = cur ? wasFreeSend(cur, freeSend) : freeSend;
    const lostJob = (!free && !remoteJob && (Boolean(cur && hasUncertainTicketSend(cur)) || err instanceof NetworkError || (submitted && isCreditError(err)))) || (localPostSend && !remoteJob);
    patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob, lostJob, sending: undefined });
    if (localPostSend) await flushSendSave();
    // A refusal says nothing about what it received: leave the trail for the log (T5). A problem the app
    // caught before sending (a missing key, a bad input) never left the browser and the card already says so.
    if (cur?.sent) logEvent('provider-error', { generation: id, model: cur?.modelName, provider: cur?.provider, jobId: remoteJob?.id, message: (err as Error).message, sent: cur.sent });
    throw err;
  }
}

/** How many requests a generation takes: candidates with their own variation go one each (variantPrompt). */
function batchPlan(g: Generation, schema: ModelSchema) {
  const variants = g.variants?.length ? g.variants : undefined;
  const priorCount = g.assetIds.length;
  const total = variants ? variants.length : Math.max(0, g.settings.count - priorCount);
  const perRequest = variants ? 1 : Math.max(1, Math.min(total, maxCountPerRequest(schema)));
  return { variants, priorCount, total, progressTotal: priorCount + total, perRequest };
}

/** What a media input looked like, for the debug record. */
function mediaInfo(input: MediaInput | undefined): MediaInfoLite[] | undefined {
  return input ? [{ mime: input.mime, width: input.width, height: input.height }] : undefined;
}

export function cancelGeneration(id: string): void {
  clearGenerationPass(id, true);
  controllers.get(id)?.abort();
  const g = get().generations[id];
  if (g && g.status === 'queued') patchGeneration(id, { status: 'canceled', finishedAt: Date.now() });
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

/** After a reload: resume polling remote jobs; mark other in-flight generations as interrupted. */
export async function resumeInterrupted(): Promise<void> {
  const gens = Object.values(get().generations).filter((g) => g.status === 'running' || g.status === 'queued');
  for (const g of gens) {
    if (running.has(g.id)) continue;
    const job = activeRemoteJob(g);
    if (!job || !ADAPTERS[job.provider]?.resume || !isConnected(job.provider)) {
      const hasOpenSend = hasOpenInFlightSend(g);
      const expectedTotal = g.variants ? g.assetIds.length + g.variants.length : (g.retryTotal ?? g.settings.count);
      const allDelivered = g.status === 'running' && g.kind !== 'text' && !job && !hasOpenSend && g.assetIds.length > 0 && (g.variants ? g.variants.length === 0 : g.assetIds.length >= expectedTotal);
      if (allDelivered) {
        finish(g.id, g.assetIds, g.actualUsd, undefined, g.providerReportedUsd);
        purgeDiscarded(g.id);
        continue;
      }
      patchGeneration(g.id, { status: 'error', statusText: undefined, finishedAt: Date.now(), ...interruptedByReload(g, job) });
      purgeDiscarded(g.id);
      continue;
    }
    patchGeneration(g.id, { statusText: 'Resuming', remoteJob: job });
    followRemote(g.id, job);
  }
}

export function retryGeneration(id: string, planItemId?: string, budgetPass?: BudgetPass, confirmedCharge = false): Promise<string[]> {
  const ongoing = retrying.get(id);
  if (ongoing) return ongoing;
  const g = get().generations[id];
  if (!g || (g.status !== 'error' && g.status !== 'canceled')) return Promise.resolve(g?.assetIds ?? []);
  if (!confirmedCharge && (g.lostJob || hasOpenInFlightSend(g) || activeRemoteJob(g))) return Promise.resolve(g.assetIds);
  const held = holdRetry(g, planItemId, budgetPass);
  if (held instanceof SchemaUnavailableError) return Promise.reject(held);
  if (!held) return Promise.resolve(g.assetIds);
  try {
    clearGenerationPass(id, true);
    // New Generation: another attempt of the same operation.
    const newG = createGeneration({ sessionId: g.sessionId, kind: g.kind, prompt: g.prompt, modelRef: g.modelRef, ...retrySpec(g), nodeRequest: g.nodeRequest, budgetPass });
    patchGeneration(newG.id, { assetIds: g.assetIds, retryBaseEstimate: g.retryBaseEstimate ?? g.estimate, retryTotal: g.retryTotal ?? (g.variants?.length ?? g.settings.count) });
    // The failed attempt's card now shows this one, so the retry's result is seen.
    relinkAttempt(g.id, newG.id);
    const retry = runGeneration(newG.id, held.release).finally(() => { retrying.delete(id); held.release(); });
    retrying.set(id, retry);
    return retry;
  } catch (err) {
    held.release();
    return Promise.reject(err);
  }
}
