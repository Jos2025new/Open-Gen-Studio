/* Remote job recovery: Check status, recover a lost job id, follow a submitted job (moved out of jobs.ts, Opus #4). */
import { deliverSend, shareOfEstimate, usesLedger } from './sendLedger';
import { isRestart, statusChecker } from './checkStatus';
import { mayStartWork } from '../lib/writerLock';
import { isAbort, JobFailedError } from '../lib/http';
import { logEvent } from '../lib/log';
import { apiKeyFor, isConnected } from './catalog';
import { ADAPTERS } from './providers/registry';
import { checkJobsNow } from './providers/shared';
import { PROVIDER_LABELS, parseModelRef } from './providers/types';
import type { Generation, RemoteJob } from './types';
import { addAssets, patchGeneration, useStore } from '../store/store';
import { addSpend } from '../store/spend';
import { checkDelivery, controllers, finish, finishText, keptJob, purgeDiscarded, running } from './jobState';
import { flushSendSave, markRemoteJobFailed, markSendsDone } from './sendMark';
import { expectedDims, storeModelOutputs, storeOutput } from './assetIO';

const get = useStore.getState;

/** Active remote job from top-level field or per-request ledger. */
export function activeRemoteJob(g: Generation): RemoteJob | undefined {
  return g.remoteJob ?? g.sends?.find((s) => s.status === 'sent' && s.remoteJob)?.remoteJob;
}

/**
 * True when a stopped generation still has a submitted job whose result can be fetched, or when its job id was lost
 * but the provider can look it up among its recent runs (NanoGPT video and 3D: generate-video/recover).
 */
export function canRecheck(g: Generation): boolean {
  if (g.status === 'done') return false;
  const job = activeRemoteJob(g);
  // In progress: only a job no loop follows any more (the app stalled or was reloaded mid-wait) is resumed here.
  if (g.status === 'running' || g.status === 'queued') return Boolean(job && !running.has(g.id) && ADAPTERS[job.provider]?.resume);
  if (job) return Boolean(ADAPTERS[job.provider]?.resume);
  return canRecover(g);
}

function canRecover(g: Generation): boolean {
  const parsed = parseModelRef(g.modelRef);
  const uncertain = Boolean(g.lostJob || g.sends?.some((s) => s.status === 'uncertain'));
  return Boolean(parsed && parsed.provider !== 'local' && ADAPTERS[parsed.provider]?.recover && (g.kind === 'video' || g.kind === 'model3d') && uncertain && g.startedAt && (g.settings.count ?? 1) <= 1 && !g.op?.id.startsWith('transcribe'));
}

/** Look the lost job up at the provider; adopt it (then it is followed like any job) or say it never arrived. */
async function recoverJob(g: Generation): Promise<RemoteJob | null> {
  const parsed = parseModelRef(g.modelRef)!;
  const taken = new Set(Object.values(get().generations).flatMap((x) => [x.jobId, x.remoteJob?.id, ...(x.sends?.map((s) => s.remoteJob?.id) ?? [])].filter((v): v is string => Boolean(v))));
  return ADAPTERS[parsed.provider].recover!({ modelId: parsed.id, apiKey: apiKeyFor(parsed.provider), since: g.startedAt!, until: g.finishedAt ?? Date.now(), taken });
}

/** Check an existing remote job, interrupting a stalled local follower before resuming it. */
export const checkStatusNow = statusChecker({
  job: (id) => get().generations[id], pending: (id) => running.get(id),
  controller: (id) => controllers.get(id), wake: checkJobsNow, resume: recheckGeneration,
  restartable: (id) => { const g = get().generations[id]; return (g?.settings.count ?? 1) <= 1 && !g?.variants?.length; },
});

/** Ask the provider again about a job we stopped waiting for (connection problem, time limit, stop, reload). */
export function recheckGeneration(id: string): Promise<string[]> {
  const pending = running.get(id);
  if (pending) return pending;
  const g = get().generations[id];
  if (!g || !canRecheck(g) || !mayStartWork()) return Promise.resolve([]);
  const job = activeRemoteJob(g);
  if (!job) return recoverThenFollow(id);
  if (!isConnected(job.provider)) {
    patchGeneration(id, { status: 'error', error: `Connect ${PROVIDER_LABELS[job.provider]} in Settings to check this job.` });
    return Promise.resolve([]);
  }
  patchGeneration(id, { status: 'running', error: undefined, statusText: 'Checking', progress: undefined, finishedAt: undefined, remoteJob: job });
  return followRemote(id, job);
}

function recoverThenFollow(id: string): Promise<string[]> {
  const g = get().generations[id];
  const provider = parseModelRef(g.modelRef)!.provider;
  if (!isConnected(provider)) {
    patchGeneration(id, { status: 'error', error: `Connect ${PROVIDER_LABELS[provider]} in Settings to check this job.` });
    return Promise.resolve([]);
  }
  patchGeneration(id, { status: 'running', error: undefined, statusText: 'Looking for the job', progress: undefined, finishedAt: undefined });
  const p = (async () => {
    let job: RemoteJob | null;
    try {
      job = await recoverJob(g);
    } catch (err) {
      running.delete(id);
      patchGeneration(id, { status: 'error', error: `Could not ask ${PROVIDER_LABELS[provider]} for recent jobs: ${(err as Error).message}`, statusText: undefined, finishedAt: Date.now() });
      return [];
    }
    running.delete(id);
    if (!job) {
      patchGeneration(id, { status: 'error', error: `${PROVIDER_LABELS[provider]} has no recent job for this request from that time: it most likely never arrived. Retry runs it again.`, statusText: undefined, finishedAt: Date.now() });
      return [];
    }
    // The adopted job is the uncertain request's answer: tie it to that record, so the ledger books it once.
    const cur = get().generations[id];
    const open = cur?.sends?.findIndex((s) => !s.remoteJob && (s.status === 'uncertain' || s.status === 'intent')) ?? -1;
    const sends = open >= 0 ? cur!.sends!.map((s, i) => (i === open ? { ...s, status: 'sent' as const, remoteJob: job! } : s)) : undefined;
    patchGeneration(id, { remoteJob: job, jobId: job.id, lostJob: undefined, statusText: 'Checking', ...(sends ? { sends } : {}) });
    await flushSendSave();
    return followRemote(id, job);
  })();
  running.set(id, p);
  return p;
}

export function followRemote(id: string, job: RemoteJob): Promise<string[]> {
  const pending = running.get(id);
  if (pending) return pending;
  const g0 = get().generations[id];
  if (!g0 || g0.status === 'done') return Promise.resolve(g0?.assetIds ?? []);
  const send0 = g0.sends?.find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
  if (send0?.status === 'done') return Promise.resolve(g0.assetIds);

  const controller = new AbortController();
  controllers.set(id, controller);
  const p = (async () => {
    try {
      const g = get().generations[id];
      const result = await ADAPTERS[job.provider].resume!(job, {
        kind: g.kind,
        apiKey: apiKeyFor(job.provider),
        signal: controller.signal,
        onStatus: (text, progress) => patchGeneration(id, { statusText: text, progress }),
      });
      const cur = get().generations[id];
      if (!cur || cur.status === 'done') return cur?.assetIds ?? [];
      const matching = cur.sends?.find((s) => s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider);
      if (matching?.status === 'done') return cur.assetIds;
      if (cur.kind === 'text') {
        finishText(id, result.text ?? '', result.costUsd, matching?.id);
        await flushSendSave();
        return [];
      }
      const kind = cur.kind;
      const fallback = expectedDims(kind, cur.settings);
      const assets = kind === 'model3d' ? await storeModelOutputs(result.outputs, cur) : await Promise.all(result.outputs.map((o) => storeOutput(o, cur, kind, fallback)));
      addAssets(assets);
      // Read the files back first: the request is booked and marked done only once nothing is left to wait for,
      // so a reload in between follows the job again instead of leaving it booked and stuck.
      const delivery = await checkDelivery(id, assets);
      const latest = get().generations[id];
      if (!latest || latest.status === 'done') return latest?.assetIds ?? [];
      if (latest.sends?.some((s) => s.status === 'done' && s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider)) return latest.assetIds;
      const mergedIds = [...latest.assetIds];
      for (const a of assets) if (!mergedIds.includes(a.id)) mergedIds.push(a.id);
      const uniqueIds = [...new Set(mergedIds)];
      const remainingVariants = latest.variants ? latest.variants.slice(assets.length) : undefined;
      const expectedTotal = latest.variants ? latest.assetIds.length + latest.variants.length : (latest.retryTotal ?? latest.settings.count);
      const batchIncomplete = remainingVariants ? remainingVariants.length > 0 : uniqueIds.length < expectedTotal;
      // Ledger: this job's record carries its cost and is booked now, once; older data keeps the old path.
      const ledger = usesLedger(latest);
      const cost = result.costUsd ?? shareOfEstimate(latest, assets.length);
      if (ledger) deliverSend(id, matching?.id, latest.sends!.length, cost, result.costUsd == null);
      if (batchIncomplete) {
        const sends = ledger ? get().generations[id]?.sends : markSendsDone(latest.sends, matching?.id);
        if (!ledger) {
          if (cost == null || cost > 0) addSpend(cost, { category: latest.kind, provider: latest.modelRef.split('::')[0], model: latest.modelRef, sessionId: latest.sessionId, estimated: result.costUsd == null });
        }
        const remaining = remainingVariants ? remainingVariants.length : Math.max(1, expectedTotal - uniqueIds.length);
        patchGeneration(id, {
          status: 'error',
          error: `Interrupted after delivering ${uniqueIds.length} of ${expectedTotal}. Retry to generate the remaining ${remaining}.`,
          assetIds: uniqueIds,
          ...(remainingVariants ? { variants: remainingVariants } : {}),
          statusText: undefined,
          progress: undefined,
          finishedAt: Date.now(),
          remoteJob: undefined,
          sending: undefined,
          lostJob: Boolean(latest.sends?.some((s) => s.status === 'uncertain')),
          ...(sends ? { sends } : {}),
        });
        await flushSendSave();
        return assets.map((a) => a.id);
      }
      finish(id, uniqueIds, result.costUsd, delivery, result.costUsd, matching?.id);
      await flushSendSave();
      return assets.map((a) => a.id);
    } catch (err) {
      if (isRestart(controller.signal.reason)) return [];
      const remoteJob = keptJob(err, job);
      const cur = get().generations[id];
      const sends = err instanceof JobFailedError ? markRemoteJobFailed(cur?.sends, job) : cur?.sends;
      const sendsPatch = err instanceof JobFailedError && sends ? { sends } : {};
      if (isAbort(err)) patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob, ...sendsPatch });
      else {
        patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob, ...sendsPatch });
        // A sent job that failed while followed (reload, Check status): same trail as a first-run failure (T5).
        const after = get().generations[id];
        logEvent('provider-error', { generation: id, model: after?.modelName, provider: job.provider, jobId: job.id, message: (err as Error).message, sent: after?.sent, resumed: true });
      }
      if (err instanceof JobFailedError) await flushSendSave();
      return [];
    } finally {
      running.delete(id);
      controllers.delete(id);
      purgeDiscarded(id);
    }
  })();
  running.set(id, p);
  return p;
}
