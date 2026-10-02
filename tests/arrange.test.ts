import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
}));

import { useStore } from '../src/store/store';
import { alignPositions, copyNodes, cutNodes, groupNodes, pasteNodes, ungroup, wholeGroup } from '../src/engine/flow/arrange';
import { deleteNodes } from '../src/engine/flow/actions';
import type { Graph } from '../src/engine/types';

const img = (title: string) => ({ kind: 'image', title, prompt: title, modelRef: 'atlas::nb', settings: { count: 1, advanced: {} }, outputIndex: 0 });
const graph = (): Graph => ({
  nodes: [
    { id: 'a', position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'up' } },
    { id: 'b', position: { x: 400, y: 50 }, data: { ...img('B'), generationId: 'gB' } as never },
    { id: 'c', position: { x: 1000, y: 200 }, data: img('C') as never },
  ],
  edges: [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 'out', targetHandle: 'ref' }, { id: 'e2', source: 'b', target: 'c', sourceHandle: 'out', targetHandle: 'ref' }],
});
const sizes = new Map([['a', { width: 300, height: 200 }], ['b', { width: 300, height: 300 }], ['c', { width: 300, height: 100 }]]);
const setup = () => {
  const st = useStore.getState();
  const sid = st.activeSessionId;
  useStore.setState({ assets: { ...st.assets, up: { id: 'up', kind: 'image', mime: 'image/png', width: 10, height: 10, sessionId: sid, origin: 'upload', stored: true, favorite: false, createdAt: 1 } }, sessions: { ...st.sessions, [sid]: { ...st.sessions[sid], graph: graph(), feed: [] } } });
  return sid;
};
const g = (sid: string) => useStore.getState().sessions[sid].graph;

describe('arrange several nodes', () => {
  it('aligns edges and centers to the selection or to the first selected, and spaces them evenly', () => {
    const gr = graph();
    expect([...alignPositions(gr, ['a', 'b', 'c'], 'top', 'selection', sizes).values()].map((p) => p.y)).toEqual([0, 0, 0]);
    expect([...alignPositions(gr, ['a', 'b', 'c'], 'bottom', 'selection', sizes).values()].map((p) => p.y)).toEqual([150, 50, 250]); // b's bottom (350) is the lowest
    const toFirst = alignPositions(gr, ['b', 'a', 'c'], 'middle', 'first', sizes);
    expect(toFirst.has('b')).toBe(false); // the first one stays
    expect(toFirst.get('a')!.y).toBe(100); // b's middle is 200: a (200 tall) at 100
    const spread = alignPositions(gr, ['a', 'b', 'c'], 'distribute-h', 'selection', sizes);
    expect(spread.get('b')!.x).toBe(500); // span 0..1300, 900 used: gaps of 200 → a 0–300, b 500–800, c 1000
  });

  it('groups (one group per node), ungroups, and deleting a node takes it out of its group', () => {
    const sid = setup();
    const id = groupNodes(sid, ['a', 'b'])!;
    expect(wholeGroup(g(sid), ['b', 'a'])?.id).toBe(id);
    groupNodes(sid, ['b', 'c']);
    expect(g(sid).groups!.map((x) => x.nodeIds)).toEqual([['b', 'c']]); // a group of one is dropped
    deleteNodes(sid, ['c']);
    expect(g(sid).groups).toEqual([]);
    const again = groupNodes(sid, ['a', 'b'])!;
    ungroup(sid, again);
    expect(g(sid).groups).toEqual([]);
  });

  it('copy/paste keeps params and links (inside and from outside) without results; cut removes the originals', () => {
    const sid = setup();
    copyNodes(sid, ['b', 'c']);
    const ids = pasteNodes(sid);
    const added = g(sid).nodes.filter((n) => ids.includes(n.id));
    expect(added.map((n) => n.data.title)).toEqual(['B', 'C']);
    expect('generationId' in added[0].data && added[0].data.generationId).toBeFalsy();
    const links = g(sid).edges.filter((e) => ids.includes(e.target)).map((e) => [e.source === 'a' ? 'a' : ids.indexOf(e.source), ids.indexOf(e.target)]);
    expect(links).toEqual([['a', 0], [0, 1]]);
    cutNodes(sid, ['c']);
    expect(g(sid).nodes.some((n) => n.id === 'c')).toBe(false);
    expect(pasteNodes(sid)).toHaveLength(1);
  });
});
