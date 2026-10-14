import { describe, expect, it, vi } from 'vitest';
import { SnapWatchdog } from '../src/engine/design/snapSession';
import { SNAP_IDLE_MS, snapNow } from '../src/engine/design/snap';

describe('snap watchdog: a real timer for the delayed snap', () => {
  it('fires after the idle time with no new motion, and asks for the snap then', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const wd = new SnapWatchdog((fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as never));
    wd.arm(SNAP_IDLE_MS, fired);
    vi.advanceTimersByTime(SNAP_IDLE_MS - 1);
    expect(fired).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(wd.armed).toBe(false);
    vi.useRealTimers();
  });

  it('re-arming pushes the snap forward; cancel stops it', () => {
    vi.useFakeTimers();
    const fired = vi.fn();
    const wd = new SnapWatchdog((fn, ms) => setTimeout(fn, ms), (h) => clearTimeout(h as never));
    wd.arm(100, fired);
    vi.advanceTimersByTime(90);
    wd.arm(100, fired); // a new fast motion event
    vi.advanceTimersByTime(90);
    expect(fired).not.toHaveBeenCalled();
    wd.cancel();
    vi.advanceTimersByTime(1000);
    expect(fired).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('a slow pointer snaps at once; a fast one waits for the watchdog', () => {
    expect(snapNow(0, 0)).toBe(true);
    expect(snapNow(1, 0)).toBe(false);
    expect(snapNow(1, SNAP_IDLE_MS)).toBe(true);
  });
});
