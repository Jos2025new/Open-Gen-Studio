import { describe, expect, it } from 'vitest';
import { checkJobsNow, failedJobMessage, pollJob } from '../src/engine/providers/shared';
import { HttpError, JobFailedError } from '../src/lib/http';

describe('Check status on a job in progress', () => {
  it('ends the current wait (even a long backoff) and asks the provider now', async () => {
    let calls = 0;
    const started = Date.now();
    const done = pollJob({ kind: 'image', onStatus: () => undefined } as never, 'atlas', 60_000, async () => {
      calls++;
      return calls < 2 ? 'running' : { outputs: [] };
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
    checkJobsNow();
    await done;
    expect(calls).toBe(2);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('a failed job reported with an error status', () => {
  // Real Atlas answer (2026-10-03): HTTP 511, the prediction itself failed.
  const atlas511 = { code: 511, message: 'Upstream access denied, please contact administrator.', data: { id: '9fdd', status: 'failed', error: 'Upstream access denied, please contact administrator.', error_code: 1013002 } };
  it('is final: the error is shown at once instead of retrying forever', async () => {
    expect(failedJobMessage(atlas511)).toBe('Upstream access denied, please contact administrator.');
    let calls = 0;
    const p = pollJob({ kind: 'image', onStatus: () => undefined } as never, 'Atlas Cloud', 10, async () => {
      calls++;
      throw new HttpError(511, 'HTTP 511', atlas511);
    });
    await expect(p).rejects.toBeInstanceOf(JobFailedError);
    await expect(p).rejects.toThrow(/Atlas Cloud: Upstream access denied/);
    expect(calls).toBe(1);
  });
  it('a plain server error with no failed job in it still retries', () => {
    expect(failedJobMessage({ message: 'Bad gateway' })).toBeUndefined();
    expect(failedJobMessage({ data: { status: 'processing' } })).toBeUndefined();
  });
});
