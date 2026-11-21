import { uid } from '../lib/id';
import { guard } from '../lib/saveGuard';
import { holdsWriterLock } from '../lib/writerLock';
import { patchGeneration, saveNow, toast, useStore } from '../store/store';
import { isMuted, setMuted } from './notices';
import { PROVIDER_LABELS } from './providers/types';
import type { Generation, RemoteJob, SendRecord } from './types';

const SEND_SAVE_TIMEOUT_MS = 8000;
const NOT_SENT_MESSAGE = 'Not sent: could not save before sending. Nothing was charged; retry to try again.';

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

async function saveWithinCap(timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      saveNow(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SendNotCommittedError()), timeoutMs);
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
  if (!holdsWriterLock() || guard.discarding) throw new SendNotCommittedError();
  const g = useStore.getState().generations[id];
  const sends = upsertIntent(g?.sends, reqId, index);
  patchGeneration(id, { sending: Date.now(), sends });
  try {
    await saveWithinCap(SEND_SAVE_TIMEOUT_MS);
  } catch {
    dropIntent(id, reqId);
    throw new SendNotCommittedError();
  }
  if (!holdsWriterLock() || guard.discarding) {
    dropIntent(id, reqId);
    throw new SendNotCommittedError();
  }
  return reqId;
}

/** What a reload leaves on a generation that was running: the error, no mark, and (when a send was in flight) a toast unless silenced. */
export function interruptedByReload(g: Generation, job: RemoteJob | undefined): Partial<Generation> {
  const hasUncertainRecord = Boolean(g.sends?.some((s) => !s.remoteJob && (s.status === 'intent' || s.status === 'uncertain')));
  const maybeCharged = !job && (g.sending != null || hasUncertainRecord);
  if (maybeCharged && !isMuted('send-uncertain')) {
    toast(`${g.modelName}: this may have been sent and charged; check the provider before regenerating.`, 'error', 12000, { label: 'Don\u2019t show again', run: () => setMuted('send-uncertain', true) });
  }
  const error = job ? `Interrupted by a page reload or tab change. Connect ${PROVIDER_LABELS[job.provider]} and use Check again.`
    : maybeCharged ? 'Interrupted by a page reload or tab change while the request was being sent. It may have been sent and charged: check the provider before regenerating.'
    : 'Interrupted by a page reload or tab change. Regenerate to try again.';
  const sends = g.sends?.length
    ? g.sends.map((s) => (!job && !s.remoteJob && s.status === 'intent' ? { ...s, status: 'uncertain' as const } : s))
    : undefined;
  return { error, sending: undefined, ...(maybeCharged ? { lostJob: true } : {}), ...(sends ? { sends } : {}) };
}
