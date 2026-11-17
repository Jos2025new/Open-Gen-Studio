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
import { addSystemNode, ensureSystemNodes } from '../src/engine/nodes/system';
import { ensureOmniNodes, ordinaryGraph } from '../src/engine/nodes/omni';
import { persistJson } from '../src/store/persistJson';
import { createSession, setGraph, useStore } from '../src/store/store';
import { StudioBoard } from '../src/components/studio/StudioBoard';
import { setStudioBoard, reloadStudioBoard, BOARD_MIN } from '../src/lib/studioBoard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.assign(globalThis, {
  ResizeObserver: ResizeObserverStub,
  DOMMatrixReadOnly: class { m22 = 1; constructor(_init?: string) {} },
});
let host: HTMLDivElement;
let root: Root;
let sid = '';
beforeEach(() => {
  const session = createSession('P7 persistence');
  sid = session.id;
  useStore.setState((state) => ({ sessions: { ...state.sessions, [sid]: session }, activeSessionId: sid, assets: {} }));
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  reloadStudioBoard();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('P7 persistence and embedded canvas adversarial coverage', () => {
  it('serializes system nodes and edges stably and restores them without loss', () => {
    ensureSystemNodes(sid);
    addSystemNode(sid, { type: 'library', id: 'sys_library_saved' });
    addSystemNode(sid, { type: 'toolset', id: 'sys_toolset_saved' });
    const session = useStore.getState().sessions[sid];
    const value = { version: 1, state: { sessions: { [sid]: session }, activeSessionId: sid } };
    const first = persistJson(value, 1);
    const second = persistJson(value, 2);
    expect(second).toBe(first);
    const restored = JSON.parse(first).state.sessions[sid].graph;
    expect(restored).toEqual(session.graph);
    expect(restored.nodes.map((node: { id: string }) => node.id)).toEqual(session.graph.nodes.map((node) => node.id));
    expect(restored.edges).toEqual(session.graph.edges);
  });

  it('keeps system nodes visible in a narrow embedded Studio Nodes canvas without Spaces or assets', async () => {
    ensureSystemNodes(sid);
    const space = addSystemNode(sid, { type: 'space', ref: 'studio', id: 'sys_space_studio' });
    const asset = { id: 'omni_asset_narrow', position: { x: 0, y: 0 }, omni: true as const, data: { kind: 'asset' as const, title: 'Hidden asset', assetId: 'a' } };
    setGraph(sid, (graph) => ({ ...graph, nodes: [...graph.nodes, asset] }));
    ensureOmniNodes(sid);
    setStudioBoard({ open: true, width: BOARD_MIN, view: 'nodes' });
    await act(async () => root.render(createElement(StudioBoard)));
    expect(host.querySelector('.node-canvas.is-embedded')).not.toBeNull();
    expect(host.querySelector('[aria-label="Add node"]')).toBeNull();
    const drawn = ordinaryGraph(useStore.getState().sessions[sid].graph);
    expect(drawn.nodes.some((node) => node.data.kind === 'ref' && node.data.type === 'chat')).toBe(true);
    expect(drawn.nodes.some((node) => node.id === space || node.id === asset.id)).toBe(false);
    expect(host.querySelector('.studio-board')?.getAttribute('style')).toContain(`width: ${BOARD_MIN}px`);
  });
});
