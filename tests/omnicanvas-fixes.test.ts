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
import { useDeleteRequest } from '../src/components/node/LinkBar';
import { ensureOmniNodes, omniSpaceNodeId } from '../src/engine/nodes/omni';
import { addNode, deleteNodes } from '../src/engine/flow/actions';
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
});
