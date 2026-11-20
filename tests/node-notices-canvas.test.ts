// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, type Edge, type EdgeChange, type Node, type NodeChange, type NodeTypes } from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EmbeddedNodeCanvas } from '../src/components/node/NodeWorkspace';
import { SpaceNode } from '../src/components/omni/SpaceNode';
import { TooltipLayer } from '../src/components/ui/TooltipLayer';
import * as notices from '../src/engine/flow/notices';
import * as resolver from '../src/engine/nodecore/resolver';
import type { Asset, Generation, Graph, GraphNode } from '../src/engine/types';
import { useStore } from '../src/store/store';
const noticeCss = readFileSync('src/styles/node-notices.css', 'utf8');

const flow = vi.hoisted(() => ({
  props: null as null | { nodes: Node[]; edges: Edge[]; children: ReactNode; onNodesChange(changes: NodeChange[]): void; onEdgesChange(changes: EdgeChange[]): void },
  fitView: vi.fn(),
}));
vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow(props: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
      flow.props = props;
      return createElement(Fragment, null, props.children, ...props.nodes.filter(n => !n.hidden).map(n =>
        createElement(props.nodeTypes[n.type!], {
          ...n, key: n.id, type: n.type!, selected: Boolean(n.selected), dragging: false,
          draggable: n.draggable ?? true, selectable: n.selectable ?? true, deletable: n.deletable ?? true,
          isConnectable: n.connectable ?? true, zIndex: n.zIndex ?? 0,
          positionAbsoluteX: n.position.x, positionAbsoluteY: n.position.y,
        })));
    },
    useReactFlow: () => ({ fitView: flow.fitView }),
    Background: () => null,
    NodeToolbar: ({ isVisible, children }: { isVisible?: boolean; children: ReactNode }) => isVisible ? children : null,
  };
});
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

const sessionId = useStore.getState().activeSessionId;
const position = { x: 0, y: 0 };
const image: GraphNode = { id: 'image', position, data: { kind: 'image', title: 'Image', prompt: '', modelRef: 'local::image', settings: { count: 1, advanced: {} }, outputIndex: 0 } };
const text: GraphNode = { id: 'text', position: { x: 400, y: 0 }, data: { kind: 'text', title: 'Text', text: '' } };
const chat: GraphNode = { id: 'chat', position, data: { kind: 'ref', title: 'Chat', type: 'chat', ref: sessionId } };
const graph: Graph = { nodes: [image, text], edges: [], groups: [{ id: 'group', title: 'Group', color: '#f00', nodeIds: ['image', 'text'] }] };

function fixture(g: Graph) {
  useStore.setState(s => ({ generations: {}, assets: {}, sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], graph: g, feed: [] } } }));
  const container = document.createElement('div');
  const style = document.createElement('style');
  style.textContent = noticeCss;
  document.head.append(style);
  document.body.append(container);
  const root = createRoot(container);
  clean = () => { act(() => root.unmount()); container.remove(); style.remove(); };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return { container, root };
}
let clean: (() => void) | undefined;
afterEach(() => {
  clean?.();
  clean = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  flow.fitView.mockClear();
});

it('reuses notices during a drag and reads external text again only when its feed changes', () => {
  const { root } = fixture({ ...graph, nodes: [...graph.nodes, chat], edges: [
    { id: 'prompt', source: 'chat', sourceHandle: 'out', target: 'image', targetHandle: 'prompt' },
  ] });
  const calculate = vi.spyOn(notices, 'graphNotices');
  const readText = vi.spyOn(resolver, 'sessionChatText');
  act(() => root.render(createElement(EmbeddedNodeCanvas)));
  expect(calculate).toHaveBeenCalledTimes(1);
  const initialReads = readText.mock.calls.length;
  const stationary = flow.props!.nodes.find(n => n.id === 'text');
  for (let x = 1; x <= 6; x++) act(() => flow.props!.onNodesChange([{ id: 'image', type: 'position', position: { x, y: 0 }, dragging: true }]));
  expect(flow.props!.nodes.find(n => n.id === 'image')?.position.x).toBe(6);
  expect.soft(calculate).toHaveBeenCalledTimes(1);
  expect.soft(readText).toHaveBeenCalledTimes(initialReads);
  expect.soft(flow.props!.nodes.find(n => n.id === 'text')).toBe(stationary);
  act(() => useStore.setState(s => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], feed: [{ id: 'say', type: 'user', text: 'A prompt', attachments: [], createdAt: 1, workspace: 'chat', mode: 'agent' }] } } })));
  expect(calculate).toHaveBeenCalledTimes(2);
  expect(readText).toHaveBeenCalledTimes(initialReads + 1);
  expect(flow.props!.nodes.find(n => n.id === 'image')?.data.missing).toBeUndefined();
});

it('keeps nodes and their missing-port arrays stable on edge selection and progress ticks', () => {
  const source = { ...image, id: 'source', data: { ...image.data, generationId: 'job', prompt: 'Source' } } as GraphNode;
  const { root } = fixture({ nodes: [...graph.nodes, source], edges: [
    { id: 'invalid', source: 'source', sourceHandle: 'out', target: 'text', targetHandle: 'old' },
  ] });
  const job = { id: 'job', status: 'running', assetIds: [] } as unknown as Generation;
  useStore.setState({ generations: { job } });
  const calculate = vi.spyOn(notices, 'graphNotices');
  act(() => root.render(createElement(EmbeddedNodeCanvas)));
  const before = flow.props!.nodes;
  act(() => flow.props!.onEdgesChange([{ id: 'invalid', type: 'select', selected: true }]));
  expect(flow.props!.edges[0].selected).toBe(true);
  expect.soft(flow.props!.nodes).toBe(before);
  act(() => useStore.setState({ generations: { job: { ...job, progress: 0.5 } } }));
  expect.soft(flow.props!.nodes).toBe(before);
  act(() => useStore.setState({ assets: { unrelated: { id: 'unrelated', kind: 'image' } as Asset } }));
  expect.soft(flow.props!.nodes).toBe(before);
  expect.soft(calculate).toHaveBeenCalledTimes(1);
  act(() => useStore.setState(s => ({ sessions: { ...s.sessions, [sessionId]: { ...s.sessions[sessionId], graph: {
    nodes: s.sessions[sessionId].graph.nodes.map(n => n.id === 'text' ? { ...n, data: { ...text.data, text: 'Edited' } as GraphNode['data'] } : n),
    edges: s.sessions[sessionId].graph.edges,
  } } } })));
  expect.soft(flow.props!.nodes[0].data.missing).toBe(before[0].data.missing);
});

it('shows a marked PortHandle, hides its explanation at rest and opens the group on jump', () => {
  vi.useFakeTimers();
  const { root, container } = fixture(graph);
  act(() => root.render(createElement(Fragment, null, createElement(EmbeddedNodeCanvas), createElement(TooltipLayer))));
  const port = container.querySelector('.node-port-missing[data-handleid="prompt"]')!;
  expect(port.getAttribute('aria-label')).toBe('Missing prompt');
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  const details = container.querySelector('.node-problem-list .node-notice-details')!;
  expect(getComputedStyle(details).display).toBe('none');
  act(() => port.dispatchEvent(new Event('pointerover', { bubbles: true })));
  act(() => vi.advanceTimersByTime(400));
  expect(document.querySelector('[role=tooltip]')?.textContent).toBe('Missing prompt');
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Collapse group"]')!.click());
  expect(flow.props!.nodes.find(n => n.id === 'image')?.hidden).toBe(true);
  expect(container.querySelector<HTMLElement>('.group-frame.is-collapsed')!.style.background).toBe('');
  expect(container.querySelector('.group-frame .node-problem-badge.is-error')?.textContent).toBe('1');
  act(() => container.querySelector<HTMLButtonElement>('.node-problem-list li button')!.click());
  expect(flow.props!.nodes.find(n => n.id === 'image')).toMatchObject({ selected: true, hidden: false });
  expect(container.querySelector('[aria-label="Collapse group"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(150));
  expect(flow.fitView).toHaveBeenLastCalledWith(expect.objectContaining({ nodes: [{ id: 'image' }] }));
});

it('renders the Nodes Space count and the highest severity', () => {
  const { root, container } = fixture(graph);
  const node: GraphNode = { id: 'sys_space_nodes', position, data: { kind: 'ref', type: 'space', ref: 'nodes', title: 'Nodes' } };
  act(() => root.render(createElement(ReactFlowProvider, null, createElement(SpaceNode, {
    id: node.id, data: { node, solo: false, spaceProblems: 2, spaceHasErrors: true },
    type: 'studio', selected: false, isConnectable: true, dragging: false, draggable: true, selectable: true,
    deletable: true, zIndex: 0, positionAbsoluteX: 0, positionAbsoluteY: 0,
  }))));
  expect(container.querySelector('.node-problem-badge')?.getAttribute('aria-label')).toBe('2 problems');
  expect(container.querySelector('.node-problem-badge.is-error')).not.toBeNull();
});
