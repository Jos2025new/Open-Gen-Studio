// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, Fragment, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider, type Edge, type EdgeChange, type Node, type NodeChange, type NodeTypes } from '@xyflow/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as equality from 'zustand/shallow';
import { EmbeddedNodeCanvas, NodeWorkspace } from '../src/components/node/NodeWorkspace';
import * as links from '../src/components/node/LinkBar';
import * as panels from '../src/components/node/SelectionPanel';
import * as arrange from '../src/engine/flow/arrange';
import * as fromChat from '../src/engine/flow/fromChat';
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
  renders: 0,
}));
vi.mock('@xyflow/react', async importOriginal => {
  const actual = await importOriginal<typeof import('@xyflow/react')>();
  return {
    ...actual,
    ReactFlow(props: NonNullable<typeof flow.props> & { nodeTypes: NodeTypes }) {
      flow.props = props;
      flow.renders++;
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
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  peekAssetUrl: () => undefined,
  loadAssetUrl: async () => undefined,
}));
vi.mock('zustand/shallow', async importOriginal => {
  const actual = await importOriginal<typeof equality>();
  return { ...actual, shallow: vi.fn(actual.shallow) };
});

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
  vi.mocked(equality.shallow).mockClear();
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
  vi.mocked(equality.shallow).mockClear();
  for (let x = 1; x <= 6; x++) act(() => flow.props!.onNodesChange([{ id: 'image', type: 'position', position: { x, y: 0 }, dragging: true }]));
  expect(flow.props!.nodes.find(n => n.id === 'image')?.position.x).toBe(6);
  expect.soft(calculate).toHaveBeenCalledTimes(1);
  expect.soft(readText).toHaveBeenCalledTimes(initialReads);
  expect.soft(equality.shallow).not.toHaveBeenCalled();
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

it('does only the affected work during drags and store ticks in NodeWorkspace', () => {
  const output: GraphNode = { ...text, id: 'outside', position: { x: 800, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId: 'input' } };
  const pending = { ...image, data: { ...image.data, generationId: 'job' } } as GraphNode;
  const parked = ['left', 'right'].map((id, i) => ({ ...text, id, position: { x: 400 * i, y: 600 } }));
  const { root, container } = fixture({ ...graph, nodes: [pending, text, output, ...parked], groups: [
    ...graph.groups!, { id: 'parked', title: 'Parked', nodeIds: parked.map(n => n.id) },
  ], edges: [
    { id: 'prompt', source: 'text', sourceHandle: 'out', target: 'image', targetHandle: 'prompt' },
    { id: 'reference', source: 'outside', sourceHandle: 'out', target: 'image', targetHandle: 'ref' },
  ] });
  const job = { id: 'job', sessionId, status: 'running', assetIds: [] } as unknown as Generation;
  const input = { id: 'input', kind: 'image', mime: 'image/png' } as Asset;
  useStore.setState({ generations: { job }, assets: { input } });
  const calculate = vi.spyOn(notices, 'graphNotices');
  const bounds = vi.spyOn(arrange, 'groupBounds');
  const cables = vi.spyOn(links, 'flowEdges');
  const importable = vi.spyOn(fromChat, 'chatWorkNotInNodes');
  const selection = vi.spyOn(panels, 'CanvasPanels');
  act(() => root.render(createElement(NodeWorkspace)));
  act(() => flow.props!.onNodesChange([{ id: 'text', type: 'select', selected: true }]));
  const frame = (id = 'group') => flow.props!.nodes.find(node => node.id === id && node.type === 'group')!;
  const firstFrame = frame();
  const parkedFrame = frame('parked');
  const firstEdges = flow.props!.edges;
  const firstSelection = selection.mock.lastCall![0].nodes;
  const renderCount = flow.renders;
  expect(firstEdges.every(edge => edge.animated)).toBe(true);
  for (const progress of [0.2, 0.4, 0.6]) {
    act(() => useStore.setState({ generations: { job: { ...job, progress } } }));
  }
  act(() => useStore.setState({ assets: { input, other: { id: 'other', kind: 'image' } as Asset } }));
  expect.soft(flow.renders).toBe(renderCount);
  expect.soft(importable).toHaveBeenCalledTimes(1);
  expect.soft(flow.props!.edges).toBe(firstEdges);
  for (const x of [801, 802, 803]) {
    act(() => flow.props!.onNodesChange([{ id: 'outside', type: 'position', position: { x, y: 0 }, dragging: true }]));
    expect.soft(frame()).toBe(firstFrame);
    expect.soft(flow.props!.edges).toBe(firstEdges);
    expect.soft(selection.mock.lastCall![0].nodes).toBe(firstSelection);
  }
  expect.soft(bounds).toHaveBeenCalledTimes(2);
  expect.soft(cables).toHaveBeenCalledTimes(1);
  expect.soft(calculate).toHaveBeenCalledTimes(1);
  act(() => flow.props!.onNodesChange([{ id: 'image', type: 'position', position: { x: -30, y: 0 }, dragging: true }]));
  expect(frame().position.x).toBe(firstFrame.position.x - 30);
  expect.soft(frame('parked')).toBe(parkedFrame);
  expect.soft(bounds).toHaveBeenCalledTimes(3);
  expect.soft(flow.props!.edges).toBe(firstEdges);
  act(() => useStore.setState({ generations: { job: { ...job, status: 'error' } } }));
  expect(flow.props!.edges.every(edge => !edge.animated)).toBe(true);
  expect.soft(cables).toHaveBeenCalledTimes(1);
  act(() => useStore.setState({ assets: { input: { ...input, kind: 'audio', mime: 'audio/wav' } } }));
  expect(flow.props!.edges.find(edge => edge.id === 'reference')?.type).toBe('notice');
  expect.soft(cables).toHaveBeenCalledTimes(2);
  const beforeChat = flow.renders;
  act(() => useStore.setState(s => ({ generations: { ...s.generations, ready: {
    ...job, id: 'ready', status: 'done', kind: 'text', prompt: 'Ready', text: 'A chat result',
  } } })));
  expect(container.querySelector('.node-from-chat')?.textContent).toContain('1 result');
  expect(importable).toHaveBeenCalledTimes(2);
  expect(flow.renders).toBe(beforeChat);
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
  expect.soft(container.querySelector<HTMLElement>('.group-dot')!.style.background).toBe('rgb(255, 0, 0)');
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
