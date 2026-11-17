import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Declared ports do something real: a model linked to the agent changes the agent's configuration. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { addSystemNode, attachModelToNode, ensureSystemNodes, linkSystemNodes } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
const agentSettings = () => useStore.getState().sessions[sid].agent.settings;
beforeEach(() => {
  const session = createSession('Ports');
  sid = session.id;
  useStore.setState((st) => ({ sessions: { ...st.sessions, [sid]: session } }));
});

describe('model → agent control port', () => {
  it('attaching a video model changes the agent video model for real', () => {
    ensureSystemNodes(sid);
    const res = attachModelToNode(sid, { modelRef: 'atlas::port-test-video', mode: 'wired', mediaKind: 'video' });
    expect(res.error).toBeNull();
    expect(agentSettings()?.video?.modelRef).toBe('atlas::port-test-video');
  });
  it('a plain control link from a model node does the same', () => {
    ensureSystemNodes(sid);
    const id = addSystemNode(sid, { type: 'model', ref: 'atlas::port-test-image', mediaKind: 'image' });
    expect(linkSystemNodes(sid, { source: id, target: 'sys_agent', kind: 'control' }).error).toBeNull();
    expect(agentSettings()?.image?.modelRef).toBe('atlas::port-test-image');
  });
});
