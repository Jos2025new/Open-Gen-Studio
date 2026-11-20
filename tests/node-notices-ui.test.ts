// @vitest-environment jsdom
import { Position, ReactFlowProvider } from '@xyflow/react';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CableMarker, NOTICE_IN, noticeEdgeTypes, ProblemBadge, ProblemList } from '../src/components/node/CanvasNotices';
import { TooltipLayer } from '../src/components/ui/TooltipLayer';
import { canvasGroups, closedGroupNotices } from '../src/components/node/CanvasElements';
import { flowEdges } from '../src/components/node/LinkBar';
import type { CableNotice, PortNotice } from '../src/engine/flow/notices';
import type { Graph } from '../src/engine/types';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

const prompt: PortNotice = { kind: 'port', nodeId: 'image', title: 'Image', port: 'prompt', message: 'Missing prompt' };
const invalid: CableNotice = { kind: 'cable', nodeId: 'text', title: 'Text', edgeId: 'edge', message: 'This node has no such input.' };
const graph: Graph = {
  nodes: [
    { id: 'image', position: { x: 0, y: 0 }, data: { kind: 'image', title: 'Image', modelRef: 'local::image', settings: { count: 1, advanced: {} }, prompt: '', outputIndex: 0 } },
    { id: 'text', position: { x: 300, y: 0 }, data: { kind: 'text', title: 'Text', text: 'Hello' } },
  ],
  edges: [{ id: 'edge', source: 'image', sourceHandle: 'out', target: 'text', targetHandle: 'old-input' }],
  groups: [{ id: 'group', title: 'Group', nodeIds: ['image', 'text'] }],
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

it('keeps an invalid cable drawable using an anchor when the old port is gone', () => {
  const edges = flowEdges(graph, {}, new Set(['text']), new Set(), new Map([['edge', invalid]]));
  expect(edges[0]).toMatchObject({ id: 'edge', targetHandle: NOTICE_IN, sourceHandle: 'out', animated: false, className: 'edge-image is-incompatible' });
  expect(graph.edges[0].targetHandle).toBe('old-input');
  act(() => root.render(createElement(CableMarker, { notice: invalid, sessionId: 'session' })));
  expect(container.querySelector('[data-tip]')?.getAttribute('data-tip')).toBe(invalid.message);
  expect(container.textContent).toBe('');
});

it('shows the problem count and each row dispatches its own jump', () => {
  const jump = vi.fn();
  act(() => root.render(createElement(ProblemList, { notices: [prompt, invalid], onJump: jump })));
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('2 problems');
  expect(container.querySelector('button')?.textContent).toBe('2');
  for (const row of container.querySelectorAll('li button')) act(() => (row as HTMLButtonElement).click());
  expect(jump.mock.calls).toEqual([['image'], ['text']]);
  act(() => root.render(createElement(ProblemList, { notices: [prompt], onJump: jump })));
  expect(container.querySelector('button')?.getAttribute('aria-label')).toBe('1 problem');
  expect(container.querySelectorAll('li button')).toHaveLength(1);
});

it('projects a count for closed groups and hides only their nodes and drawn cables', () => {
  const notices = [prompt, { ...invalid, nodeId: 'other' }];
  const folded = new Set(['group']);
  const open = canvasGroups(graph, new Map(), 'session', new Set(), new Map(), vi.fn());
  const closed = canvasGroups(graph, new Map(), 'session', folded, closedGroupNotices(graph.groups, folded, notices), vi.fn());
  expect(open.frames[0].data.problems).toBe(0);
  expect(closed.frames[0].data.problems).toBe(1);
  expect([...closed.hidden]).toEqual(['image', 'text']);
  expect(flowEdges(graph, {}, new Set(), new Set(), undefined, 'session', closed.hidden)[0].hidden).toBe(true);
  expect(graph.edges).toHaveLength(1);
  act(() => root.render(createElement(ProblemBadge, { count: closed.frames[0].data.problems })));
  expect(container.querySelector('[data-tip]')?.getAttribute('data-tip')).toBe('1 problem');
  expect(container.textContent).toBe('1');
});

it('keeps a moved pin visible and explains why the old value cannot be used', () => {
  const moved: CableNotice = { ...invalid, kind: 'pin', pin: 'old', next: 'new' };
  act(() => root.render(createElement(CableMarker, { notice: moved, sessionId: 'session' })));
  expect(container.querySelector('.node-cable-marker')?.classList.contains('is-invalid')).toBe(false);
  const [useNew, keep] = container.querySelectorAll<HTMLButtonElement>('.node-pin-actions button');
  expect(useNew.textContent).toBe('Use new value');
  expect(keep.textContent).toBe('Keep pinned');
  expect(keep.disabled).toBe(true);
  expect(keep.getAttribute('aria-description')).toMatch(/unavailable/i);
  act(() => keep.click());
  expect(container.querySelector('.node-pin-actions')).not.toBeNull();
  expect(container.querySelector('.node-cable-marker')).not.toBeNull();
});


it('shows the incompatible-cable reason when hovering over its interaction stroke', () => {
  vi.useFakeTimers();
  act(() => root.render(createElement(ReactFlowProvider, null,
    createElement('svg', null, createElement(noticeEdgeTypes.notice, {
      id: 'edge', data: { notice: invalid, sessionId: 'session' },
      source: 'image', target: 'text', sourceX: 10, sourceY: 10, targetX: 200, targetY: 90,
      sourcePosition: Position.Right, targetPosition: Position.Left, interactionWidth: 20,
    })),
    createElement(TooltipLayer),
  )));
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  const path = container.querySelector('.react-flow__edge-interaction')!;
  act(() => path.dispatchEvent(new Event('pointerover', { bubbles: true })));
  act(() => vi.advanceTimersByTime(400));
  expect(document.querySelector('[role=tooltip]')?.textContent).toBe(invalid.message);
});
