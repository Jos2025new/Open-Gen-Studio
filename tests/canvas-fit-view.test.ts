// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const rf = vi.hoisted(() => ({ fitView: vi.fn(), getNodes: vi.fn(() => [] as Array<{ id: string; hidden?: boolean }>), zoomIn: vi.fn(), zoomOut: vi.fn(), zoomTo: vi.fn() }));
vi.mock('@xyflow/react', async (orig) => ({ ...(await orig<typeof import('@xyflow/react')>()), useReactFlow: () => rf, useViewport: () => ({ x: 0, y: 0, zoom: 1 }) }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined, putAssetBlob: async () => undefined,
}));
import { CanvasNavigation } from '../src/components/node/CanvasNavigation';
import { fitTargets } from '../src/engine/flow/fitTargets';
import { ensureOmniNodes } from '../src/engine/nodes/omni';
import { newSession, setGraph, useStore } from '../src/store/store';
import type { GraphNode } from '../src/engine/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const note = (id: string): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'text', title: id, text: id } as never });
const card = (id: string): GraphNode => ({ id, position: { x: 0, y: 0 }, data: { kind: 'ref', type: 'chat', ref: 'chat', title: id } as never });

describe('fitTargets', () => {
  const nodes = [card('sys'), note('a'), note('b')];
  it('frames the selection when there is one, else what the user made', () => {
    expect(fitTargets(nodes, ['b'])).toEqual(['b']);
    expect(fitTargets(nodes, [])).toEqual(['a', 'b']);
  });
  it('Shift+1 ignores the selection; Shift+2 needs one', () => {
    expect(fitTargets(nodes, ['b'], 'all')).toEqual(['a', 'b']);
    expect(fitTargets(nodes, [], 'selection')).toEqual([]);
  });
  it('a selected system card is framed (the user chose it); with only system cards, they are what fits', () => {
    expect(fitTargets(nodes, ['sys'])).toEqual(['sys']);
    expect(fitTargets([card('x'), card('y')], [])).toEqual(['x', 'y']);
  });
  it('ignores selected ids that are not drawn', () => {
    expect(fitTargets(nodes, ['ghost'])).toEqual(['a', 'b']);
  });
});

describe('Fit view in the toolbox', () => {
  afterEach(() => { rf.fitView.mockClear(); document.body.innerHTML = ''; });
  function mount(selectedIds: string[], omni = false) {
    const sid = newSession();
    if (omni) ensureOmniNodes(sid);
    setGraph(sid, (g) => ({ ...g, nodes: [...g.nodes, note('a'), note('b')] }));
    useStore.setState({ activeSessionId: sid });
    rf.getNodes.mockImplementation(() => useStore.getState().sessions[sid].graph.nodes.map((n) => ({ id: n.id })));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(ReactFlowProvider, null, createElement(CanvasNavigation, { sessionId: sid, onSelect: () => undefined, tool: 'pan', onTool: () => undefined, selectedCount: selectedIds.length, selectedIds, onDelete: () => undefined, omni }))));
    return { sid, host, stop: () => act(() => root.unmount()) };
  }
  const framed = () => (rf.fitView.mock.calls.at(-1)?.[0] as { nodes: Array<{ id: string }> }).nodes.map((n) => n.id).sort();
  const press = (init: KeyboardEventInit, target: EventTarget = window) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); });

  it('the button frames the selection, and without one the user\'s nodes and not the system cards (omnicanvas)', () => {
    const m = mount(['b'], true);
    act(() => (m.host.querySelector('[aria-label^="Fit view"]') as HTMLElement).click());
    expect(framed()).toEqual(['b']);
    m.stop();
    const n = mount([], true);
    rf.fitView.mockClear();
    act(() => (n.host.querySelector('[aria-label^="Fit view"]') as HTMLElement).click());
    expect(framed()).toEqual(['a', 'b']);
    n.stop();
  });

  it('Shift+1 fits all, Shift+2 the selection, by key position (a Spanish keyboard types ! and " there)', () => {
    const m = mount(['a'], true);
    press({ shiftKey: true, code: 'Digit1', key: '!' });
    expect(framed()).toEqual(['a', 'b']);
    press({ shiftKey: true, code: 'Digit2', key: '"' });
    expect(framed()).toEqual(['a']);
    m.stop();
  });

  it('Shift+2 with nothing selected does nothing; other modifiers and plain digits do not fire', () => {
    const m = mount([]);
    press({ shiftKey: true, code: 'Digit2', key: '@' });
    press({ code: 'Digit1', key: '1' });
    press({ shiftKey: true, ctrlKey: true, code: 'Digit1', key: '!' });
    press({ shiftKey: true, altKey: true, code: 'Digit1', key: '!' });
    expect(rf.fitView).not.toHaveBeenCalled();
    m.stop();
  });

  it('typing in a text field never fits the view', () => {
    const m = mount(['a']);
    for (const tag of ['input', 'textarea']) {
      const field = document.body.appendChild(document.createElement(tag));
      press({ shiftKey: true, code: 'Digit1', key: '!' }, field);
    }
    const editable = document.body.appendChild(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    press({ shiftKey: true, code: 'Digit1', key: '!' }, editable);
    expect(rf.fitView).not.toHaveBeenCalled();
    m.stop();
  });
});
