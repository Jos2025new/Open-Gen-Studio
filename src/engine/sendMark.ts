import { uid } from '../lib/id';
import { guard } from '../lib/saveGuard';
import { holdsWriterLock } from '../lib/writerLock';
import { saveStatus } from '../store/saveStatus';
import { patchGeneration, saveNow, toast, useStore } from '../store/store';
import { isMuted, setMuted } from './notices';
import { PROVIDER_LABELS } from './providers/types';
import type { Generation, RemoteJob, SendRecord } from './types';

const SEND_SAVE_TIMEOUT_MS = 8000;
const NOT_SENT_MESSAGE = 'Not sent: could not save before sending. Nothing was charged; retry to try again.';
const PARTIAL_NOT_SENT_MESSAGE = 'Next request not sent: could not save before sending. Earlier items in this batch were already sent; retry to continue with the rest.';
const PRIOR_UNCERTAIN_NOT_SENT_MESSAGE = 'Not sent: could not save before sending. A previous request for this generation may have been charged; check before retrying.';

/** True when the send has zero cost (local models or $0 price) and never needs the paid-send gate. */
function isFreeSend(g: Pick<Generation, 'provider' | 'modelRef' | 'estimate'>, quote?: number | null): boolean {
  // A remote send is free only when both the estimate and the quote (if any) say $0: either one above $0 bills.
  return g.provider === 'local' || g.modelRef.startsWith('local::') || (g.estimate?.usd === 0 && (quote == null || quote === 0));
}

/** Free as far as a later step can tell: an open send record means it was judged paid (with its quote) when it left. */
export function wasFreeSend(g: Pick<Generation, 'provider' | 'modelRef' | 'estimate' | 'sends'>, freeAtSend = false): boolean {
  if (g.sends?.some((s) => s.status === 'intent' || s.status === 'uncertain')) return false;
  return freeAtSend || isFreeSend(g);
}

function notSentMessage(g: Generation | undefined, reqId?: string): string {
  const priorBatch = Boolean(
    g && (g.sends?.some((s) => s.id !== reqId && (s.status === 'done' || s.status === 'sent' || s.status === 'failed')) || (g.assetIds.length > 0 && !g.parentId)),
  );
  if (priorBatch) return PARTIAL_NOT_SENT_MESSAGE;
  const priorUncertain = Boolean(
    g && (g.lostJob || g.remoteJob || g.sends?.some((s) => s.id !== reqId && (s.status === 'uncertain' || Boolean(s.remoteJob)))),
  );
  return priorUncertain ? PRIOR_UNCERTAIN_NOT_SENT_MESSAGE : NOT_SENT_MESSAGE;
}

/** Thrown when pre-send persistence or lock/discard guards fail before calling a provider. */
export class SendNotCommittedError extends Error {
  constructor(message = NOT_SENT_MESSAGE) {
    super(message);
    this.name = 'SendNotCommittedError';
  }
}

function upsertIntent(sends: SendRecord[] | undefined, reqId: string, index: number): SendRecord[] {
  const list = sends ?? [];
  const next: SendRecord = { id: reqId, index, status: 'intent' };
  const at = list.findIndex((s) => s.id === reqId);
  return at >= 0 ? list.map((s, i) => (i === at ? next : s)) : [...list, next];
}

function dropIntent(id: string, reqId: string): void {
  const cur = useStore.getState().generations[id];
  if (!cur) return;
  const remaining = cur.sends?.filter((s) => s.id !== reqId);
  patchGeneration(id, {
    sending: undefined,
    ...(cur.sends ? { sends: remaining?.length ? remaining : undefined } : {}),
  });
}

async function saveWithinCap(timeoutMs: number, message: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      saveNow(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SendNotCommittedError(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The request is about to leave for the provider: record its intent and `sending` mark, then wait up to 8 s for
 * IndexedDB confirmation while still holding the writer lock and not discarding. Throws before any send if guarded.
 */
export async function markSending(id: string, index = 0, reqId = uid('req')): Promise<string> {
  const g = useStore.getState().generations[id];
  const errMsg = notSentMessage(g, reqId);
  if (!holdsWriterLock() || guard.discarding) {
    if (g?.sends?.some((s) => s.id === reqId && s.status === 'intent')) dropIntent(id, reqId);
    throw new SendNotCommittedError(errMsg);
  }
  const sends = upsertIntent(g?.sends, reqId, index);
  patchGeneration(id, { sending: Date.now(), sends });
  const targetVersion = saveStatus.getState().version;
  try {
    await saveWithinCap(SEND_SAVE_TIMEOUT_MS, errMsg);
  } catch {
    dropIntent(id, reqId);
    throw new SendNotCommittedError(errMsg);
  }
  if (!holdsWriterLock() || guard.discarding || saveStatus.getState().confirmed < targetVersion) {
    dropIntent(id, reqId);
    throw new SendNotCommittedError(errMsg);
  }
  return reqId;
}

/** Drop an uncommitted or pre-flight-aborted intent so it is not mistaken for a sent request. */
export function rollbackSendIntent(id: string, reqId: string | undefined): void {
  if (reqId) dropIntent(id, reqId);
  else patchGeneration(id, { sending: undefined });
}

/**
 * Common gate before any provider transport: for paid sends, persist intent and `sending` to IndexedDB;
 * then re-check abort and optional authorization right before transport, rolling back the intent if either fails.
 */
export async function commitPaidSend(opts: {
  g: Generation;
  index?: number;
  reqId?: string;
  quote?: number | null;
  signal: AbortSignal;
  authorize?: () => void;
}): Promise<{ reqId: string | undefined; freeSend: boolean }> {
  const freeSend = isFreeSend(opts.g, opts.quote);
  let reqId: string | undefined;
  if (freeSend) {
    void saveNow().catch(() => undefined);
  } else {
    reqId = await markSending(opts.g.id, opts.index ?? 0, opts.reqId);
  }
  try {
    opts.signal.throwIfAborted();
    opts.authorize?.();
  } catch (err) {
    rollbackSendIntent(opts.g.id, reqId);
    throw err;
  }
  return { reqId, freeSend };
}

/** Persist a provider job id on both the generation and its per-request ledger, flushing immediately. */
export function recordRemoteJob(id: string, reqId: string | undefined, job: RemoteJob): void {
  const cur = useStore.getState().generations[id];
  if (!cur) return;
  const sends = cur.sends?.map((s) => (reqId ? s.id === reqId : s.status === 'intent') ? { ...s, status: 'sent' as const, remoteJob: job } : s);
  patchGeneration(id, {
    remoteJob: job,
    jobId: job.id,
    sending: undefined,
    sent: cur.sent ? { ...cur.sent, jobId: job.id } : undefined,
    ...(sends ? { sends } : {}),
  });
  void saveNow().catch(() => undefined);
}

/** Return updated `sends` with the matching request (or active intent/sent entries) marked done. */
export function markSendsDone(sends: SendRecord[] | undefined, reqId?: string): SendRecord[] | undefined {
  if (!sends?.length) return sends;
  return sends.map((s) => ((reqId ? s.id === reqId : s.status === 'intent' || s.status === 'sent') ? { ...s, status: 'done' as const } : s));
}

/** Return updated `sends` with an unanswered intent marked uncertain, a failed remote job marked failed, or never-sent intent dropped. */
export function settleFailedSend(sends: SendRecord[] | undefined, reqId: string | undefined, uncertain: boolean, failed = false): SendRecord[] | undefined {
  if (!sends?.length || !reqId) return sends;
  if (failed) return sends.map((s) => (s.id === reqId ? { ...s, status: 'failed' as const } : s));
  if (uncertain) return sends.map((s) => (s.id === reqId && !s.remoteJob ? { ...s, status: 'uncertain' as const } : s));
  const rest = sends.filter((s) => !(s.id === reqId && !s.remoteJob && s.status === 'intent'));
  return rest.length ? rest : undefined;
}

/** Mark the send matching a dead remote job as failed so `activeRemoteJob()` never resurrects it. */
export function markRemoteJobFailed(sends: SendRecord[] | undefined, job: RemoteJob): SendRecord[] | undefined {
  if (!sends?.length) return sends;
  return sends.map((s) => (s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider ? { ...s, status: 'failed' as const } : s));
}

/** Best-effort immediate flush to IndexedDB after storing job results or progress. */
export async function flushSendSave(): Promise<void> {
  await saveNow().catch(() => undefined);
}

/** What a reload leaves on a generation that was running: the error, no mark, and (when a send was in flight) a toast unless silenced. */
export function interruptedByReload(g: Generation, job: RemoteJob | undefined): Partial<Generation> {
  const free = wasFreeSend(g);
  const hasUncertainRecord = Boolean(g.sends?.some((s) => !s.remoteJob && (s.status === 'intent' || s.status === 'uncertain')));
  const maybeCharged = !free && !job && (g.sending != null || hasUncertainRecord);
  if (maybeCharged && !isMuted('send-uncertain')) {
    toast(`${g.modelName}: this may have been sent and charged; check the provider before regenerating.`, 'error', 12000, { label: 'Don\u2019t show again', run: () => setMuted('send-uncertain', true) });
  }
  const error = job ? `Interrupted by a page reload or tab change. Connect ${PROVIDER_LABELS[job.provider]} and use Check again.`
    : maybeCharged ? 'Interrupted by a page reload or tab change while the request was being sent. It may have been sent and charged: check the provider before regenerating.'
    : 'Interrupted by a page reload or tab change. Regenerate to try again.';
  const cleanedFree = free ? g.sends?.filter((s) => s.status !== 'intent' && s.status !== 'uncertain') : undefined;
  const sends = free
    ? (cleanedFree?.length ? cleanedFree : undefined)
    : g.sends?.length
      ? g.sends.map((s) => (!job && !s.remoteJob && s.status === 'intent' ? { ...s, status: 'uncertain' as const } : s))
      : undefined;
  return { error, sending: undefined, ...(maybeCharged ? { lostJob: true } : {}), ...(sends ? { sends } : {}) };
}
