/* Remote job recovery: Check status, recover a lost job id, follow a submitted job (moved out of jobs.ts, Opus #4). */
import { isRestart, statusChecker } from './checkStatus';
import { mayStartWork } from '../lib/writerLock';
import { isAbort } from '../lib/http';
import { logEvent } from '../lib/log';
import { apiKeyFor, isConnected } from './catalog';
import { ADAPTERS } from './providers/registry';
import { checkJobsNow } from './providers/shared';
import { PROVIDER_LABELS, parseModelRef } from './providers/types';
import type { Generation, RemoteJob } from './types';
import { addAssets, patchGeneration, useStore } from '../store/store';
import { checkDelivery, controllers, finish, finishText, keptJob, purgeDiscarded, running } from './jobState';
import { flushSendSave } from './sendMark';
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
    patchGeneration(id, { remoteJob: job, jobId: job.id, lostJob: undefined, statusText: 'Checking' });
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
      const mergedIds = [...cur.assetIds];
      for (const a of assets) if (!mergedIds.includes(a.id)) mergedIds.push(a.id);
      finish(id, mergedIds, result.costUsd, await checkDelivery(id, assets), result.costUsd, matching?.id);
      await flushSendSave();
      return assets.map((a) => a.id);
    } catch (err) {
      if (isRestart(controller.signal.reason)) return [];
      const remoteJob = keptJob(err, job);
      if (isAbort(err)) patchGeneration(id, { status: 'canceled', statusText: undefined, finishedAt: Date.now(), remoteJob });
      else {
        patchGeneration(id, { status: 'error', error: (err as Error).message, statusText: undefined, finishedAt: Date.now(), remoteJob });
        // A sent job that failed while followed (reload, Check status): same trail as a first-run failure (T5).
        const cur = get().generations[id];
        logEvent('provider-error', { generation: id, model: cur?.modelName, provider: job.provider, jobId: job.id, message: (err as Error).message, sent: cur?.sent, resumed: true });
      }
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
