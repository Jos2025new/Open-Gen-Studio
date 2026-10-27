import { afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));
import { inheritApproved } from '../src/engine/agent/inherit';
import { useStore } from '../src/store/store';
import type { PlanStep } from '../src/engine/types';

const initial = useStore.getState();
afterEach(() => useStore.setState({ composer: initial.composer, sessions: initial.sessions, settings: initial.settings }));
const clip = { id: 's1', kind: 'video', modelRef: 'local::studio-video', prompt: 'x', settings: { aspect: '9:16', resolution: '1080p', duration: 8, count: 1, advanced: {} } } as unknown as PlanStep;
const sid = initial.activeSessionId;

describe('Direct remembers the values of the approved plan in its session', () => {
  it('stores the approved model and settings without changing composer defaults', () => {
    const composer = useStore.getState().composer;
    inheritApproved(sid, [clip]);
    const choice = useStore.getState().sessions[sid].agent.settings?.video;
    expect(choice).toMatchObject({ modelRef: 'local::studio-video', aspect: '9:16', resolution: '1080p', duration: 8, needsImage: false });
    expect(useStore.getState().composer).toEqual(composer);
  });
  it('a plan nobody approved changes nothing', () => {
    expect(useStore.getState().sessions[sid].agent.settings).toBeUndefined();
    expect(useStore.getState().composer).toEqual(initial.composer);
  });
  it('a comparison between model lines changes neither the session choice nor composer defaults', () => {
    const composer = useStore.getState().composer;
    inheritApproved(sid, [clip, { ...clip, id: 's2', modelRef: 'local::another-video' } as PlanStep]);
    expect(useStore.getState().sessions[sid].agent.settings).toBeUndefined();
    expect(useStore.getState().composer).toEqual(composer);
  });
});
