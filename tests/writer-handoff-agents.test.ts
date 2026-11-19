import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async (id: string) => id }));

import { useStore } from '../src/store/store';
import { workReport } from '../src/store/writerHandoff';
import { patchLane } from '../src/engine/agent/lanes';

/** Agents run in parallel (ADR 0031): a session with an agent mid-turn in the background is busy for the handoff, whatever is on screen. */
describe('writer handoff counts every agent of a session', () => {
  it('an agent working in the background makes the session busy; idle agents do not', () => {
    const id = useStore.getState().activeSessionId;
    useStore.setState((st) => ({ sessions: { ...st.sessions, [id]: { ...st.sessions[id], agent: { history: [], questionRound: 0, notes: [], busy: false }, agentLane: 'b', agents: undefined } } }));
    patchLane(id, 'a', { busy: true });
    patchLane(id, 'b', { busy: false });
    expect(workReport().agent).toBe(1); // A is busy, B (on screen) is not
    patchLane(id, 'a', { busy: false });
    expect(workReport().agent).toBe(0);
  });
});
