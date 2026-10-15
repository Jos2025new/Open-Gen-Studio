import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inheritApproved } from '../src/engine/agent/inherit';
import { useStore } from '../src/store/store';
import type { PlanStep } from '../src/engine/types';

const initial = useStore.getState();
afterEach(() => useStore.setState({ composer: initial.composer }));
const clip = { id: 's1', kind: 'video', modelRef: 'local::studio-video', prompt: 'x', settings: { aspect: '9:16', resolution: '1080p', duration: 8, count: 1, advanced: {} } } as unknown as PlanStep;

describe('Direct inherits the values of the plan the user approves', () => {
  it('the approved 9:16 / 1080p clip is where the next video request starts', () => {
    inheritApproved([clip]);
    const v = useStore.getState().composer.video.settings;
    expect(v.aspect).toBe('9:16');
    expect(v.resolution).toBe('1080p');
    expect(v.duration).toBe(8);
  });
  it('a plan nobody approved changes nothing', () => {
    expect(useStore.getState().composer.video.settings).toEqual(initial.composer.video.settings);
  });
});
