import { describe, expect, it } from 'vitest';
import { CHECK_RESTART } from '../src/engine/checkStatus';
import { pollJob } from '../src/engine/providers/shared';
import { HttpError, JobFailedError } from '../src/lib/http';

const ok = { outputs: [] };
const ctxFor = (signal = new AbortController().signal) => {
  const statuses: string[] = [];
  return { statuses, ctx: { kind: 'video' as const, apiKey: 'k', signal, onStatus: (t: string) => statuses.push(t) } };
};

describe('following a submitted job keeps it alive', () => {
  it('a non-transient error while asking about the job is retried, not final', async () => {
    const { ctx, statuses } = ctxFor();
    let calls = 0;
    const res = await pollJob(ctx, 'Atlas Cloud', 1, async () => {
      calls++;
      if (calls === 1) throw new HttpError(404, 'not found', 'Atlas Cloud: not found');
      return ok;
    });
    expect(res).toEqual(ok);
    expect(calls).toBe(2);
    expect(statuses.some((s) => s.startsWith('Could not check the job'))).toBe(true);
  });

  it('a provider failure is still final', async () => {
    const { ctx } = ctxFor();
    await expect(pollJob(ctx, 'Atlas Cloud', 1, async () => { throw new JobFailedError('Atlas Cloud: boom'); })).rejects.toBeInstanceOf(JobFailedError);
  });

  it('an abort ends the wait without retrying', async () => {
    const controller = new AbortController();
    const { ctx } = ctxFor(controller.signal);
    let calls = 0;
    await expect(pollJob(ctx, 'Atlas Cloud', 1, async () => { calls++; controller.abort(CHECK_RESTART); throw new Error('aborted'); })).rejects.toThrow();
    expect(calls).toBe(1);
  });
});

describe('Check status restarts the follower without a user cancel', () => {
  it('aborts the old follower with the restart reason', async () => {
    const { statusChecker } = await import('../src/engine/checkStatus');
    const controller = new AbortController();
    const done = new Promise<void>((r) => setTimeout(r, 0));
    const check = statusChecker({ job: () => ({ remoteJob: {}, status: 'running' }), pending: () => done, controller: () => controller, wake: () => undefined, resume: async () => undefined });
    check('gen_1');
    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe(CHECK_RESTART);
  });
});
