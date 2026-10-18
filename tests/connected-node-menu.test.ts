// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined, peekAssetUrl: () => undefined, loadAssetUrl: async () => undefined }));
const viewport = vi.hoisted(() => ({ x: 0, y: 0, zoom: 1 }));
vi.mock('@xyflow/react', async (orig) => {
  const real = await orig<typeof import('@xyflow/react')>();
  return { ...real, useViewport: () => viewport, useInternalNode: () => ({ internals: { positionAbsolute: { x: 20, y: 50 }, handleBounds: { source: [{ id: 'out', x: 270, y: 65, width: 22, height: 22 }] } } }), useReactFlow: () => ({ flowToScreenPosition: (p: { x: number; y: number }) => p }) };
});
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReactFlow } from '@xyflow/react';
import { AddNext } from '../src/components/node/ConnectedNodeMenu';
import { useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';
const node: GraphNode = { id: 'prompt', position: { x: 20, y: 50 }, data: { kind: 'text', title: 'Prompt', text: 'A cat' } };
const types = { fixture: () => createElement(AddNext, { node, out: 'text' }) };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, DOMMatrixReadOnly: class { m22 = 1; }, requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0), cancelAnimationFrame: clearTimeout });
  const st = useStore.getState();
  useStore.setState({ sessions: { ...st.sessions, [st.activeSessionId]: { ...st.sessions[st.activeSessionId], graph: { nodes: [node], edges: [] } } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const mount = async () => { await act(async () => root.render(createElement(ReactFlow, { nodes: [{ id: 'prompt', type: 'fixture', position: node.position, data: {}, measured: { width: 260, height: 130 } }], edges: [], nodeTypes: types, connectOnClick: false }))); };
const click = async (el: Element) => { await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };
describe('the + output and persistent connection menu', () => {
  it('uses the actual ReactFlow source handle, shows the curve and compatible choices, and Escape cancels without changing the graph', async () => {
    await mount();
    const handle = host.querySelector('[aria-label="Add connected node"]')!;
    expect(handle.classList.contains('react-flow__handle')).toBe(true);
    expect(handle.getAttribute('data-handleid')).toBe('out');
    const before = useStore.getState().sessions[useStore.getState().activeSessionId].graph;
    await click(handle);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('.node-connection-preview path')?.getAttribute('d')).toMatch(/^M/);
    expect(document.querySelector('input[type="search"]')).toBe(document.activeElement);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Image');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Asset');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('.node-connection-preview')).toBeNull();
    expect(document.activeElement).toBe(handle);
    expect(useStore.getState().sessions[useStore.getState().activeSessionId].graph).toBe(before);
  });
  it('opens with the keyboard and creates a connected node when a compatible choice is picked', async () => {
    await mount();
    const handle = host.querySelector('[aria-label="Add connected node"]')!;
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    const image = [...document.querySelectorAll('.menu-item')].find(b => b.querySelector('.menu-label')?.textContent === 'Image')!;
    await click(image);
    const st = useStore.getState(), graph = st.sessions[st.activeSessionId].graph;
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toMatchObject([{ source: 'prompt', target: graph.nodes[1].id, targetHandle: 'prompt' }]);
    expect(document.querySelector('.node-connection-preview')).toBeNull();
  });
});
