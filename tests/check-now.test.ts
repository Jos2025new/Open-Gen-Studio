import { describe, expect, it } from 'vitest';
import { checkJobsNow, pollJob } from '../src/engine/providers/shared';

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
