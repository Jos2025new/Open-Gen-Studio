// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  getAssetBlob: async () => undefined,
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { NodeLibrary, type OmniEntries } from '../src/components/node/AddNodeItems';
import { addSystemNode, ensureSystemNodes } from '../src/engine/nodes/system';
import { deleteNodes } from '../src/engine/flow/actions';
import { ordinaryGraph } from '../src/engine/nodes/omni';
import { createSession, setGraph, useStore } from '../src/store/store';
import type { SystemNodeType } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let sid = '';
const selected: SystemNodeType[] = [];
const spaces: Array<'studio' | 'nodes' | 'designer'> = [];
const omni: OmniEntries = {
  spaces: false,
  has: () => false,
  onSpace: (space) => { spaces.push(space); },
  onSystem: (type) => {
    selected.push(type);
    const id = addSystemNode(sid, { type });
    expect(deleteNodes(sid, [id])).toBeNull();
  },
};
const labels = (section: string) => [...host.querySelectorAll<HTMLElement>(`.node-lib-sec[aria-label="${section}"] [role="option"] .node-lib-text > span`)].map((el) => el.textContent);

beforeEach(async () => {
  selected.length = 0;
  spaces.length = 0;
  const session = createSession('P7 adversarial');
  sid = session.id;
  useStore.setState((state) => ({ sessions: { ...state.sessions, [sid]: session }, assets: {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(NodeLibrary, { onPick: vi.fn(), onAsset: vi.fn(), onImport: vi.fn(), omni })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('P7 Add node adversarial coverage', () => {
  it('ordinary Nodes offers NO system node and no Space (user rule 2026-11-17: system nodes belong to the omnicanvas)', () => {
    expect(host.querySelector('.node-lib-sec[aria-label="System"]')).toBeNull();
    expect(host.querySelector('.node-lib-sec[aria-label="Spaces"]')).toBeNull();
    expect(labels('System')).toEqual([]);
    expect(selected).toEqual([]);
  });

  it('the omnicanvas offers every system part, Chat included, and the Spaces', async () => {
    await act(async () => root.render(createElement(NodeLibrary, { onPick: vi.fn(), onAsset: vi.fn(), onImport: vi.fn(), omni: { ...omni, spaces: true } })));
    const expected = ['Chat', 'Agent', 'Model', 'Designer Doc', 'Library', 'Tools'];
    expect(labels('System')).toEqual(expect.arrayContaining(expected));
    expect(host.querySelector('.node-lib-sec[aria-label="Spaces"]')).not.toBeNull();
    for (const label of expected) {
      const option = [...host.querySelectorAll<HTMLElement>('.node-lib-sec[aria-label="System"] [role="option"]')]
        .find((el) => el.querySelector('.node-lib-text > span')?.textContent === label);
      expect(option, `Add node entry ${label}`).toBeDefined();
      await act(async () => option!.click());
    }
    expect(selected).toHaveLength(expected.length);
  });

  it('removes an added system node without removing the omnicanvas Space or asset and without leaving dangling edges', () => {
    ensureSystemNodes(sid);
    const sysId = addSystemNode(sid, { type: 'library', id: 'sys_library_adversarial' });
    const spaceId = addSystemNode(sid, { type: 'space', ref: 'studio', id: 'sys_space_studio' });
    const ownAsset = { id: 'omni_asset_fixture', position: { x: 900, y: 0 }, omni: true as const, data: { kind: 'asset' as const, title: 'Fixture', assetId: 'fixture' } };
    setGraph(sid, (graph) => ({ ...graph, nodes: [...graph.nodes, ownAsset], edges: [...graph.edges, { id: 'adversarial-link', source: sysId, target: spaceId, sourceHandle: 'out', targetHandle: 'ref', kind: 'ref' as const }] }));
    expect(deleteNodes(sid, [sysId])).toBeNull();
    const graph = useStore.getState().sessions[sid].graph;
    expect(graph.nodes.some((node) => node.id === sysId)).toBe(false);
    expect(graph.nodes.some((node) => node.id === spaceId)).toBe(true);
    expect(graph.nodes).toContainEqual(ownAsset);
    expect(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.source) && graph.nodes.some((node) => node.id === edge.target))).toBe(true);
    expect(ordinaryGraph(graph).nodes.some((node) => node.id === spaceId || node.id === ownAsset.id)).toBe(false);
  });

  it('keeps each added system node as a distinct ID when adding the same type twice', () => {
    const first = addSystemNode(sid, { type: 'agent' });
    const second = addSystemNode(sid, { type: 'agent' });
    const agents = useStore.getState().sessions[sid].graph.nodes.filter((node) => node.data.kind === 'ref' && node.data.type === 'agent');
    expect(first).not.toBe(second);
    expect(new Set(agents.map((node) => node.id)).size).toBe(agents.length);
    expect(agents).toHaveLength(2);
  });

  it('exposes the P7 normal-canvas behavior in the generated node map contract', () => {
    const contracts = readFileSync('scripts/map-contracts-nodes.mjs', 'utf8');
    expect(contracts).toContain('src/components/node/AddNodeItems.tsx');
    expect(contracts).toContain('src/engine/nodes/omniSpaces.ts');
    expect(contracts).toContain('hiddenInOrdinary');
    expect(contracts).toContain('tests/adversarial-p7-add-node.test.ts');
  });
});
