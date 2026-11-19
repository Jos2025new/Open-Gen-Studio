import { beforeEach, describe, expect, it, vi } from 'vitest';

/* Declared ports do something real: a model linked to the agent changes the agent's configuration. */
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));
import { threadOf } from '../src/engine/agent/lanes';
import { addSystemNode, attachModelToNode, ensureSystemNodes, linkSystemNodes } from '../src/engine/nodes/system';
import { createSession, useStore } from '../src/store/store';

let sid = '';
// The agent node's own thread (the model link writes by agent id).
const agentSettings = () => { const s = useStore.getState().sessions[sid]; return threadOf(s, s.graph.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'agent')?.id)?.settings; };
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

import { graphToSteps } from '../src/engine/flow/graph';
describe('chat/agent data out port', () => {
  it('delivers the real text to a generation prompt', () => {
    const st = useStore.getState();
    useStore.setState({ sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], feed: [{ id: 'u1', type: 'user', text: 'a red fox' } as never] } } });
    const graph = { nodes: [
      { id: 'chat', position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'chat', ref: sid, title: 'Chat' } },
      { id: 'img', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Img', prompt: '', modelRef: 'local::studio-image', settings: { count: 1, advanced: {} }, outputIndex: 0 } },
    ], edges: [{ id: 'e', source: 'chat', target: 'img', sourceHandle: 'out', targetHandle: 'prompt', kind: 'data' }], groups: [] } as never;
    const plan = graphToSteps(graph, ['img'], {});
    expect(plan.errors).toEqual([]);
    expect(plan.steps.find((s) => s.kind === 'text')).toMatchObject({ text: 'a red fox' });
  });
});
