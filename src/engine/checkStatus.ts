/** Abort reason of a follower that Check status restarts: it is not a user Stop and must not mark the job canceled. */
export const CHECK_RESTART = 'check-restart';

/** Restart only the local follower of an existing remote job; never submit another generation. */
export function statusChecker(deps: {
  job: (id: string) => { remoteJob?: unknown; status: string } | undefined;
  pending: (id: string) => Promise<unknown> | undefined;
  controller: (id: string) => AbortController | undefined;
  wake: () => void;
  restartable?: (id: string) => boolean;
  resume: (id: string) => Promise<unknown>;
}): (id: string) => void {
  const checking = new Set<string>();
  return (id) => {
    if (!deps.job(id)?.remoteJob || checking.has(id)) return;
    const pending = deps.pending(id), controller = deps.controller(id);
    if (!pending) { void deps.resume(id); return; }
    if (!controller || deps.restartable?.(id) === false) { deps.wake(); return; }
    checking.add(id);
    controller.abort(CHECK_RESTART);
    // Wait for the old follower's cleanup before creating the new one; otherwise it can delete the new tracking.
    void pending.catch(() => undefined).then(() => {
      const job = deps.job(id);
      if (job?.remoteJob && job.status !== 'done') return deps.resume(id);
    }).finally(() => checking.delete(id)).catch(() => undefined);
  };
}
