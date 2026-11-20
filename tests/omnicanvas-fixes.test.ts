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
import { NodeLibrary } from '../src/components/node/AddNodeItems';
import { AddNodeMenu } from '../src/components/node/NodeCanvasParts';
import { useDeleteRequest } from '../src/components/node/LinkBar';
import { ensureOmniNodes, omniSpaceNodeId } from '../src/engine/nodes/omni';
import { addNode, deleteNodes } from '../src/engine/flow/actions';
import { estimatedHeight, findFreePosition, nodeRect, NODE_WIDTH, rectsOverlap, settleFresh } from '../src/engine/flow/graph';
import { travelGraph } from '../src/engine/flow/history';
import { appendFeed, newSession, reconcileDeletionNotices, setGraph, useStore } from '../src/store/store';

const get = useStore.getState;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('omnicanvas deletion and undo', () => {
  it('deletes only the selected edge and restores both node and links in one undo step', async () => {
    const sid = newSession();
    ensureOmniNodes(sid);
    const spaceId = omniSpaceNodeId('nodes');
    const edgeId = 'sys_edge_agent_nodes';
    expect(get().sessions[sid].graph.nodes.some((n) => n.id === spaceId)).toBe(true);
    expect(get().sessions[sid].graph.edges.some((e) => e.id === edgeId)).toBe(true);

    let api!: ReturnType<typeof useDeleteRequest>;
    const afterDelete = vi.fn();
    function Harness() {
      api = useDeleteRequest(sid, afterDelete);
      return api.card;
    }
    await act(async () => { root.render(createElement(Harness)); });

    // 1. Selecting an edge and pressing Delete removes only the link, never the target node.
    let rfProceed = true;
    await act(async () => {
      rfProceed = await api.before({ nodes: [], edges: [{ id: edgeId }] });
    });
    expect(rfProceed).toBe(false);
    expect(get().sessions[sid].graph.edges.some((e) => e.id === edgeId)).toBe(false);
    expect(get().sessions[sid].graph.nodes.some((n) => n.id === spaceId)).toBe(true);
    expect(afterDelete).toHaveBeenCalledWith([], [edgeId]);

    // Single Undo restores the removed link.
    await act(async () => {
      travelGraph(sid, get().sessions[sid].graph, 'undo', 1, (next) => { setGraph(sid, () => next); return true; });
    });
    expect(get().sessions[sid].graph.edges.some((e) => e.id === edgeId)).toBe(true);

    // 2. Deleting a node together with its attached link (as React Flow passes both) is one atomic undo step.
    await act(async () => {
      rfProceed = await api.before({ nodes: [{ id: spaceId }], edges: [{ id: edgeId }] });
    });
    expect(rfProceed).toBe(false);
    expect(get().sessions[sid].graph.nodes.some((n) => n.id === spaceId)).toBe(false);
    expect(get().sessions[sid].graph.edges.some((e) => e.id === edgeId)).toBe(false);

    await act(async () => {
      travelGraph(sid, get().sessions[sid].graph, 'undo', 1, (next) => { setGraph(sid, () => next); return true; });
    });
    expect(get().sessions[sid].graph.nodes.some((n) => n.id === spaceId)).toBe(true);
    expect(get().sessions[sid].graph.edges.some((e) => e.id === edgeId)).toBe(true);
  });

  it('clears stale Agent deletion notices on open and does not pile up ref-node notices', () => {
    const sid = newSession();
    ensureOmniNodes(sid);
    const agent = get().sessions[sid].graph.nodes.find((n) => n.id === 'sys_agent')!;
    expect(agent).toBeDefined();

    // Simulate a persisted stale notice left in session.feed before re-opening omnicanvas.
    appendFeed(sid, {
      id: 'stale_agent_notice',
      createdAt: Date.now(),
      workspace: 'node',
      type: 'notice',
      level: 'info',
      text: 'Deleted nodes: Agent. Results remain in the gallery.',
      undoNodes: { nodes: [structuredClone(agent)], edges: [] },
    });
    ensureOmniNodes(sid);
    expect(get().sessions[sid].feed.some((f) => f.id === 'stale_agent_notice')).toBe(false);

    // Deleting ref/system pointers must not emit gallery deletion notices.
    deleteNodes(sid, ['sys_agent', omniSpaceNodeId('nodes')]);
    expect(get().sessions[sid].feed.some((f) => f.type === 'notice' && f.undoNodes)).toBe(false);

    // Creative nodes still get a deletion notice, which clears when undone via canvas history.
    const textId = addNode(sid, { kind: 'text', title: 'Prompt', text: 'hello' }, { x: 1200, y: 0 });
    deleteNodes(sid, [textId]);
    expect(get().sessions[sid].feed.filter((f) => f.type === 'notice' && f.undoNodes)).toHaveLength(1);
    travelGraph(sid, get().sessions[sid].graph, 'undo', 1, (next) => {
      setGraph(sid, () => next);
      reconcileDeletionNotices(sid);
      return true;
    });
    expect(get().sessions[sid].feed.some((f) => f.type === 'notice' && f.undoNodes)).toBe(false);
  });

  it('lays out initial omni nodes and legacy overlapping sessions without overlaps, and places new nodes clear of headers', () => {
    // 1. Fresh omnicanvas layout has zero overlaps across all pairs.
    const freshSid = newSession();
    ensureOmniNodes(freshSid);
    const freshNodes = get().sessions[freshSid].graph.nodes;
    for (let i = 0; i < freshNodes.length; i++) {
      for (let j = i + 1; j < freshNodes.length; j++) {
        expect(rectsOverlap(nodeRect(freshNodes[i]), nodeRect(freshNodes[j]), 20, 20), `${freshNodes[i].id} vs ${freshNodes[j].id}`).toBe(false);
      }
    }

    // 2. Legacy overlapping nodes (Chat, Local Sketch, offline-llm, Designer Doc) are separated on open.
    const legacySid = newSession();
    setGraph(legacySid, (g) => ({
      ...g,
      nodes: [
        { id: 'sys_chat', position: { x: -340, y: 0 }, data: { kind: 'ref', type: 'chat', ref: legacySid, title: 'Chat' } },
        { id: 'sys_model_image', position: { x: -340, y: 120 }, data: { kind: 'ref', type: 'model', ref: 'local::sketch', title: 'Local Sketch', mediaKind: 'image' } },
        { id: 'sys_model_llm', position: { x: -300, y: 20 }, data: { kind: 'ref', type: 'model', ref: 'offline', title: 'offline-llm', mediaKind: 'llm' } },
        { id: 'sys_doc_active', position: { x: -200, y: 80 }, data: { kind: 'ref', type: 'designer.doc', ref: 'active', title: 'Designer Doc' } },
        { id: 'sys_agent', position: { x: -340, y: 340 }, data: { kind: 'ref', type: 'agent', ref: legacySid, title: 'Agent' } },
      ],
    }));
    ensureOmniNodes(legacySid);
    const fixedNodes = get().sessions[legacySid].graph.nodes;
    for (let i = 0; i < fixedNodes.length; i++) {
      for (let j = i + 1; j < fixedNodes.length; j++) {
        expect(rectsOverlap(nodeRect(fixedNodes[i]), nodeRect(fixedNodes[j]), 20, 20), `legacy ${fixedNodes[i].id} vs ${fixedNodes[j].id}`).toBe(false);
      }
    }
    expect(ensureOmniNodes(legacySid)).toEqual([]);

    // 3. Adding a new Prompt node at Create Space's position finds a free spot clear of its header.
    const createSpace = freshNodes.find((n) => n.id === 'sys_space_create')!;
    expect(createSpace).toBeDefined();
    const occ = freshNodes.map((n) => nodeRect(n));
    const h = estimatedHeight({ kind: 'text', title: 'Prompt', text: '' });
    const placed = findFreePosition(createSpace.position, { width: NODE_WIDTH, height: h }, occ, { gapX: 48, gapY: 56 });
    const promptRect = { x: placed.x, y: placed.y, width: NODE_WIDTH, height: h };
    expect(occ.some((o) => rectsOverlap(promptRect, o, 48, 56))).toBe(false);
  });

  it('shows Nodes -> Text before Spaces/System in omnicanvas Add node and adds on click without hover scroll-jump', async () => {
    const onPick = vi.fn();
    await act(async () => {
      root.render(createElement(NodeLibrary, {
        onPick,
        onImport: vi.fn(),
        onAsset: vi.fn(),
        omni: { has: () => false, onSpace: vi.fn(), onSystem: vi.fn() },
      }));
    });
    const secs = [...host.querySelectorAll('.node-lib-sec')].map((s) => s.getAttribute('aria-label'));
    expect(secs.slice(0, 4)).toEqual(['Media', 'Nodes', 'Spaces', 'System']);
    const textBtn = [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (el) => el.querySelector('.node-lib-text > span')?.textContent === 'Text',
    )!;
    expect(textBtn).toBeDefined();
    const scrollIntoView = vi.fn();
    textBtn.scrollIntoView = scrollIntoView;
    await act(async () => { textBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); });
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => { textBtn.click(); });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0]).toMatchObject({ kind: 'text' });
  });
});

describe('new nodes learn their real size and step off their neighbours', () => {
  const card = (id: string, x: number, y: number) => ({ id, position: { x, y }, data: { kind: 'asset' as const, title: 'Image', assetId: id } });
  it('three imported images placed with estimated heights do not stack once measured', () => {
    // Placed side by side with the estimated 220 px height; the real cards are taller (320 px).
    const nodes = [card('a', 0, 0), card('b', NODE_WIDTH + 60, 0), card('c', 2 * (NODE_WIDTH + 60), 0)];
    const measured = new Map(nodes.map((n) => [n.id, { width: NODE_WIDTH, height: 320 }]));
    const moves = settleFresh(nodes, new Set(['a', 'b', 'c']), measured);
    const placed = nodes.map((n) => ({ ...n, position: moves.get(n.id) ?? n.position }));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
      expect(rectsOverlap(nodeRect(placed[i], measured), nodeRect(placed[j], measured), 0, 0)).toBe(false);
    }
  });
  it('a fresh node that does not touch anything stays where it is; settled nodes are not moved', () => {
    const nodes = [card('old', 0, 0), card('new', 0, 2000)];
    expect(settleFresh(nodes, new Set(['new']), new Map()).size).toBe(0);
    const stacked = [card('old', 0, 0), card('new', 40, 40)];
    const moves = settleFresh(stacked, new Set(['new']), new Map());
    expect(moves.has('old')).toBe(false);
    expect(moves.has('new')).toBe(true);
  });
});

describe('Add node on the omnicanvas: one click adds and closes the menu', () => {
  it('a Provider entry calls the omnicanvas add and closes the menu', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom has none */ } unobserve() { /* none */ } disconnect() { /* none */ } });
    const onSystem = vi.fn();
    await act(async () => {
      root.render(createElement(AddNodeMenu, { onAdd: vi.fn(), onImport: vi.fn(), omni: { has: () => false, onSpace: vi.fn(), onSystem } }));
    });
    const open = host.querySelector<HTMLButtonElement>('button[aria-label="Add node…"]')!;
    await act(async () => { open.click(); });
    const provider = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((el) => el.querySelector('.node-lib-text > span')?.textContent === 'Provider')!;
    expect(provider).toBeDefined();
    await act(async () => { provider.click(); });
    expect(onSystem).toHaveBeenCalledWith('provider');
    expect(document.querySelector('.node-lib')).toBeNull();
  });
});
