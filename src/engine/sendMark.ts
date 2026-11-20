import { sleep } from '../lib/http';
import { patchGeneration, saveNow, toast } from '../store/store';
import { isMuted, setMuted } from './notices';
import { PROVIDER_LABELS } from './providers/types';
import type { Generation, RemoteJob } from './types';

/**
 * The request is about to leave for the provider: the generation keeps `sending` (saved, within a short wait) until a
 * job id or result comes back, so a reload in between is not mistaken for "nothing was sent".
 */
export async function markSending(id: string): Promise<void> {
  patchGeneration(id, { sending: Date.now() });
  await Promise.race([saveNow().catch(() => undefined), sleep(400)]);
}

/** What a reload leaves on a generation that was running: the error, no mark, and (when a send was in flight) a toast unless silenced. */
export function interruptedByReload(g: Generation, job: RemoteJob | undefined): Partial<Generation> {
  const maybeCharged = !job && g.sending != null;
  if (maybeCharged && !isMuted('send-uncertain')) {
    toast(`${g.modelName}: this may have been sent and charged; check the provider before regenerating.`, 'error', 12000, { label: 'Don\u2019t show again', run: () => setMuted('send-uncertain', true) });
  }
  const error = job ? `Interrupted by a page reload or tab change. Connect ${PROVIDER_LABELS[job.provider]} and use Check again.`
    : maybeCharged ? 'Interrupted by a page reload or tab change while the request was being sent. It may have been sent and charged: check the provider before regenerating.'
    : 'Interrupted by a page reload or tab change. Regenerate to try again.';
  return { error, sending: undefined, ...(maybeCharged ? { lostJob: true } : {}) };
}
