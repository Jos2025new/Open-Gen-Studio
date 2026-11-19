import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Graph, GraphNode } from '../src/engine/types';

vi.hoisted(() => Object.assign(globalThis, {
  window: { setTimeout, clearTimeout, addEventListener() {} },
  document: { addEventListener() {}, visibilityState: 'visible' },
}));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async (id: string) => id,
  deleteAssetBlobs: async () => undefined,
}));

import { editCompound } from '../src/engine/nodecore/edit';
import { createSession, useStore } from '../src/store/store';
import { check } from '../scripts/check-graph-writes.mjs';

const position = { x: 0, y: 0 };
const text = (id: string): GraphNode => ({ id, position, data: { kind: 'text', title: id, text: 'red' } });
const edge = (id: string, source: string, target: string) => ({ id, source, target, sourceHandle: 'out', targetHandle: 'in' });
let session: string;
const graph = () => useStore.getState().sessions[session].graph;
const arrange = (initial: Graph) => {
  const entry = { ...createSession('escapes'), graph: initial };
  session = entry.id;
  useStore.setState({ activeSessionId: session, sessions: { [session]: entry }, generations: {} });
};

describe('compound changes and invalid cables', () => {
  beforeEach(() => arrange({ nodes: [text('a'), text('b')], edges: [] } as unknown as Graph));

  it('refuses an invalid cable that belongs to a node that is not there', () => {
    const problem = editCompound(session, 'ghost', (g) => ({ ...g, broken: [{ edge: edge('e9', 'gone', 'nobody'), missing: 'source', at: 1 }] }));
    expect(problem).toMatch(/real loss/);
    expect(graph().broken).toBeUndefined();
  });

  it('refuses a change that keeps a cable\'s endpoints but changes what it delivers (result, pin or kind)', () => {
    const base = { ...edge('e1', 'a', 'b'), outputIndex: 0 } as unknown as Graph['edges'][number];
    arrange({ nodes: [text('a'), text('b')], edges: [base] } as unknown as Graph);
    for (const patch of [{ outputIndex: 1 }, { outputIndex: undefined }, { pin: 'x' }, { kind: 'order' }]) {
      const problem = editCompound(session, 'swap', (g) => ({ ...g, edges: g.edges.map((e) => ({ ...e, ...patch })) as Graph['edges'] }));
      expect(problem, JSON.stringify(patch)).toMatch(/rewire/);
    }
    expect(graph().edges[0]).toEqual(base);
  });

  it('refuses a cable that would be live and invalid at once', () => {
    arrange({ nodes: [text('a'), text('b')], edges: [edge('e1', 'a', 'b')] } as unknown as Graph);
    const problem = editCompound(session, 'both', (g) => ({ ...g, broken: [{ edge: edge('e1', 'gone', 'b'), missing: 'source', at: 1 }] }));
    expect(problem).toMatch(/real loss/);
  });

  it('a silent change still prunes invalid cables whose source came back', () => {
    arrange({ nodes: [text('a'), text('b')], edges: [], broken: [{ edge: edge('e1', 'a', 'b'), missing: 'source', at: 1 }] } as unknown as Graph);
    // The source `a` is present: the tombstone is stale whichever way the graph is written.
    expect(editCompound(session, 'tidy', (g) => ({ ...g, nodes: g.nodes.map((n) => n.id === 'b' ? { ...n, data: { ...n.data, title: 'B' } } as GraphNode : n) }), { silent: true })).toBeNull();
    expect(graph().broken).toBeUndefined();
  });
});

describe('check-graph-writes reads the syntax, not lines', () => {
  const fixture = (code: string) => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-gw-'));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'x.ts'), code);
    return check(root) as string[];
  };
  it('finds a call split over lines', () => expect(fixture('setGraph(\n  id,\n  (g) => g,\n);')).toHaveLength(1));
  it('finds a session rebuilt by hand across lines', () => expect(fixture('const s = {\n  ...session,\n  feed: [],\n  graph: {\n    ...session.graph,\n  },\n};')).toHaveLength(1));
  it('lets harmless code through', () => expect(fixture("import { setGraph } from './s';\n// setGraph(x)\nconst a = { graph: 1 };")).toEqual([]));
  it('the app itself has no write outside the layer', () => expect(check('.')).toEqual([]));
});
