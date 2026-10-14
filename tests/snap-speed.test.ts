import { describe, expect, it } from 'vitest';
import { snapNow, SNAP_IDLE_MS, SNAP_SPEED } from '../src/engine/design/snap';

describe('snap delay by speed', () => {
  it('a fast pointer is not snapped; a slow one is', () => {
    expect(snapNow(SNAP_SPEED * 5, 0)).toBe(false);
    expect(snapNow(SNAP_SPEED / 2, 0)).toBe(true);
  });
  it('the watchdog snaps a fast pointer that stops abruptly after the idle time', () => {
    expect(snapNow(1, SNAP_IDLE_MS - 1)).toBe(false);
    expect(snapNow(1, SNAP_IDLE_MS)).toBe(true);
  });
});
