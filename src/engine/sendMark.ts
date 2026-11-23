/*
 * Reload/settlement helpers and SendNotCommittedError.
 * Pre-send durable marking and locking now live solely in `money/paidSend.ts` + `money/storeBridge.ts`.
 */
import { saveNow, toast } from '../store/store';
import { isMuted, setMuted } from './notices';
import { PROVIDER_LABELS } from './providers/types';
import type { Generation, RemoteJob, SendRecord } from './types';
import { hasUnstoredPaidResult, interruptTicketOnReload, SendNotCommittedError, wasFreeTicketSend } from './money/storeBridge';

export { SendNotCommittedError };

/** Free as far as a later step can tell: an open paid send means it was judged paid when it left. */
export function wasFreeSend(g: Pick<Generation, 'id' | 'provider' | 'modelRef' | 'estimate' | 'sends'>, freeAtSend = false): boolean {
  return wasFreeTicketSend(g, freeAtSend);
}

/** Return updated `sends` with the matching request (or active intent/sent entries) marked done (legacy fallback). */
export function markSendsDone(sends: SendRecord[] | undefined, reqId?: string): SendRecord[] | undefined {
  if (!sends?.length) return sends;
  return sends.map((s) => ((reqId ? s.id === reqId : s.status === 'intent' || s.status === 'sent') ? { ...s, status: 'done' as const } : s));
}

/** Mark the send matching a dead remote job as failed so `activeRemoteJob()` never resurrects it (legacy fallback). */
export function markRemoteJobFailed(sends: SendRecord[] | undefined, job: RemoteJob): SendRecord[] | undefined {
  if (!sends?.length) return sends;
  return sends.map((s) => (s.remoteJob?.id === job.id && s.remoteJob?.provider === job.provider ? { ...s, status: 'failed' as const } : s));
}

/** Best-effort immediate flush to IndexedDB after storing job results or progress. */
export async function flushSendSave(): Promise<void> {
  await saveNow().catch(() => undefined);
}

/** What a reload leaves on a generation that was running: transitions open ticket sends to uncertain (keeping reservation) and returns the generation patch. */
export function interruptedByReload(g: Generation, job: RemoteJob | undefined): Partial<Generation> {
  const fromTicket = interruptTicketOnReload(g, job);
  const free = fromTicket.handled ? !fromTicket.maybeCharged && wasFreeSend(g) : wasFreeSend(g);
  const hasUncertainRecord = Boolean(g.sends?.some((s) => !s.remoteJob && (s.status === 'intent' || s.status === 'uncertain')));
  const maybeCharged = fromTicket.handled ? fromTicket.maybeCharged : (!free && !job && (g.sending != null || hasUncertainRecord || hasUnstoredPaidResult(g, g.sends ?? [])));
  if (maybeCharged && !isMuted('send-uncertain')) {
    toast(`${g.modelName}: this may have been sent and charged; check the provider before regenerating.`, 'error', 12000, { label: 'Don\u2019t show again', run: () => setMuted('send-uncertain', true) });
  }
  const error = job ? `Interrupted by a page reload or tab change. Connect ${PROVIDER_LABELS[job.provider]} and use Check again.`
    : maybeCharged ? 'Interrupted by a page reload or tab change while the request was being sent. It may have been sent and charged: check the provider before regenerating.'
    : 'Interrupted by a page reload or tab change. Regenerate to try again.';
  if (fromTicket.handled) {
    return { error, sending: undefined, ...(maybeCharged ? { lostJob: true } : {}) };
  }
  const cleanedFree = free ? g.sends?.filter((s) => s.status !== 'intent' && s.status !== 'uncertain') : undefined;
  const sends = free
    ? (cleanedFree?.length ? cleanedFree : undefined)
    : g.sends?.length
      ? g.sends.map((s) => (!job && !s.remoteJob && s.status === 'intent' ? { ...s, status: 'uncertain' as const } : s))
      : undefined;
  return { error, sending: undefined, ...(maybeCharged ? { lostJob: true } : {}), ...(sends ? { sends } : {}) };
}
