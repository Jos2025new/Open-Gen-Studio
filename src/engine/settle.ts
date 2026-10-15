import { isRunning } from './jobs';
import { useStore } from '../store/store';

/** A step whose generation is still in progress: the plan waits for it instead of failing. */
export class StepStillRunning extends Error {
  constructor(name: string) {
    super(`${name} is still running at the provider`);
    this.name = 'StepStillRunning';
  }
}

export const isLiveStatus = (status: string) => status === 'running' || status === 'queued';

/**
 * Waits while a follower of the generation runs (a Check status restart hands over to a new one) or while its submitted
 * job is still live with no follower. Returns when the generation is over, or when nothing follows it any more.
 */
export async function settleGeneration(id: string): Promise<void> {
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 300));
  let idle = 0;
  while (idle < 4) {
    if (isRunning(id)) {
      idle = 0;
      await pause();
      continue;
    }
    const g = useStore.getState().generations[id];
    if (!g || !isLiveStatus(g.status) || !g.remoteJob) return;
    idle++;
    await pause();
  }
}
