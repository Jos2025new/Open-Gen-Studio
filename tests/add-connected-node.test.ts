import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener() {} }, document: { addEventListener() {}, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { addConnected, newNodeData } from '../src/engine/flow/actions';
import { graphHistory, travelGraph } from '../src/engine/flow/history';
import { useStore, setGraph } from '../src/store/store';
import type { Graph } from '../src/engine/types';
let counter = 0;
let sid: string;
const graph = (): Graph => ({ nodes: [{ id: 'prompt', position: { x: 10, y: 20 }, data: { kind: 'text', title: 'Prompt', text: 'A cat' } }], edges: [] });
beforeEach(() => {
  const st = useStore.getState(); sid = `connected-${++counter}`;
  useStore.setState({ activeSessionId: sid, sessions: { ...st.sessions, [sid]: { ...st.sessions[st.activeSessionId], id: sid, graph: graph() } } });
});
const current = () => useStore.getState().sessions[sid].graph;
describe('creating a connected node', () => {
  it('adds the node at the drop point with a real prompt edge, in one undo/redo operation', () => {
    const before = structuredClone(current());
    const id = addConnected(sid, 'prompt', newNodeData('image'), { x: 310, y: 180 });
    expect(current().nodes.find(n => n.id === id)?.position).toEqual({ x: 310, y: 180 });
    expect(current().edges).toMatchObject([{ source: 'prompt', sourceHandle: 'out', target: id, targetHandle: 'prompt' }]);
    expect(graphHistory(sid, 'undo')).toHaveLength(1);
    const after = structuredClone(current());
    expect(travelGraph(sid, current(), 'undo', 1, g => { setGraph(sid, () => g); return true; })).toBe(true);
    expect(current().nodes).toEqual(before.nodes); expect(current().edges).toEqual([]);
    expect(travelGraph(sid, current(), 'redo', 1, g => { setGraph(sid, () => g); return true; })).toBe(true);
    expect(current().nodes).toEqual(after.nodes); expect(current().edges).toEqual(after.edges);
  });
  it('rejects incompatible inputs without adding an orphan or changing history', () => {
    const before = current();
    expect(addConnected(sid, 'prompt', newNodeData('tool', { op: 'relight' }))).toBeNull();
    expect(current()).toBe(before); expect(graphHistory(sid, 'undo')).toHaveLength(0);
  });
  it('safely rejects a source or session removed while the menu was open', () => {
    const before = current();
    expect(addConnected(sid, 'deleted', newNodeData('image'))).toBeNull();
    expect(addConnected('deleted-session', 'prompt', newNodeData('image'))).toBeNull();
    expect(current()).toBe(before);
  });
  it('prefers an exact input and preserves 3D-to-image compatibility', () => {
    setGraph(sid, () => ({ nodes: [{ id: 'model', position: { x: 0, y: 0 }, data: newNodeData('model3d') }], edges: [] }));
    const id = addConnected(sid, 'model', newNodeData('image'));
    expect(current().edges).toMatchObject([{ source: 'model', target: id, targetHandle: 'ref' }]);
  });
});
