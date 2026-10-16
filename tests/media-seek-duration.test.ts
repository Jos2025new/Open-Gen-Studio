import { afterEach, describe, expect, it, vi } from 'vitest';
import { seekToDuration } from '../src/lib/media';

const fake = (duration: number) => ({ duration, currentTime: 0, ontimeupdate: null, onerror: null, onabort: null }) as unknown as HTMLVideoElement & { ontimeupdate: (() => void) | null; onerror: (() => void) | null; onabort: (() => void) | null };

afterEach(() => vi.useRealTimers());

describe('seekToDuration', () => {
  it('resolves with the duration once the seek reports it, and clears its handlers', async () => {
    const v = fake(Infinity);
    const p = seekToDuration(v);
    expect(v.currentTime).toBe(1e9);
    (v as { duration: number }).duration = 12.5;
    v.ontimeupdate!();
    expect(await p).toBe(12.5);
    expect(v.ontimeupdate).toBeNull();
  });

  it('a stuck video resolves with an unknown duration after the timeout', async () => {
    vi.useFakeTimers();
    const v = fake(Infinity);
    const p = seekToDuration(v, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeUndefined();
    expect(v.onerror).toBeNull();
  });

  it('an error or abort resolves with an unknown duration', async () => {
    for (const event of ['onerror', 'onabort'] as const) {
      const v = fake(Infinity);
      const p = seekToDuration(v);
      v[event]!();
      expect(await p).toBeUndefined();
    }
  });
});
