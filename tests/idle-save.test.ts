// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

/* The state is written when the browser is idle (never mid-gesture), within a deadline; hiding the page writes at once. */
const writes: string[] = [];
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async (_k: string, v: string | { text(): string }) => { writes.push(typeof v === "string" ? v : v.text()); }, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

const idle: Array<() => void> = [];
const deadlines: number[] = [];
window.requestIdleCallback = ((fn: () => void, o?: { timeout?: number }) => { idle.push(fn); deadlines.push(o?.timeout ?? 0); return idle.length; }) as never;
window.cancelIdleCallback = (() => undefined) as never;

describe('state save in idle time', () => {
  it('waits for the browser to be idle, with a deadline, and writes once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // idle callbacks stay the stub above
    const { setUi, useStore } = await import('../src/store/store');
    // Writes start once the saved state has been read back (hydration).
    await vi.waitFor(() => expect(useStore.getState().hydrated).toBe(true));
    vi.advanceTimersByTime(3000);
    idle.splice(0).forEach((fn) => fn());
    writes.length = 0;
    setUi({ brush: { ...useStore.getState().ui.brush, size: 31 } });
    await vi.advanceTimersByTimeAsync(400);
    expect(writes).toHaveLength(0);
    expect(idle.length).toBeGreaterThan(0);
    expect(deadlines.at(-1)).toBeGreaterThan(0);
    idle.splice(0).forEach((fn) => fn());
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).state.ui.brush.size).toBe(31);
    vi.useRealTimers();
  });
  it('hiding the page writes at once, without waiting for idle time', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); // idle callbacks stay the stub above
    const { setUi, useStore } = await import('../src/store/store');
    writes.length = 0;
    setUi({ brush: { ...useStore.getState().ui.brush, size: 32 } });
    window.dispatchEvent(new Event('pagehide'));
    expect(writes).toHaveLength(1);
    vi.useRealTimers();
  });
  it('never starts mid-gesture: a pressed pointer delays the write to its release, 10 s at most', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const { setUi, useStore, MAX_GESTURE_WAIT_MS } = await import('../src/store/store');
    const press = (type: string) => window.dispatchEvent(Object.assign(new Event(type), { pointerId: 1 }));
    const runIdle = () => idle.splice(0).forEach((fn) => fn());
    writes.length = 0;
    press('pointerdown');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 33 } });
    await vi.advanceTimersByTimeAsync(400);
    runIdle(); // idle time between the frames of a stroke
    expect(writes).toHaveLength(0);
    press('pointerup');
    runIdle();
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0]).state.ui.brush.size).toBe(33);

    // A pointerup that never comes: the write still happens once the cap is reached.
    press('pointerdown');
    setUi({ brush: { ...useStore.getState().ui.brush, size: 34 } });
    await vi.advanceTimersByTimeAsync(400);
    runIdle();
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(MAX_GESTURE_WAIT_MS);
    expect(writes).toHaveLength(2);
    expect(JSON.parse(writes[1]).state.ui.brush.size).toBe(34);

    // Hiding the page mid-gesture writes at once.
    setUi({ brush: { ...useStore.getState().ui.brush, size: 35 } });
    window.dispatchEvent(new Event('pagehide'));
    expect(writes).toHaveLength(3);
    press('pointerup');
    vi.useRealTimers();
  });
});
