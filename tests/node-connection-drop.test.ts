// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { OnConnectEnd } from '@xyflow/react';
import { connectionDrop } from '../src/components/node/connectionDrop';

type State = Parameters<OnConnectEnd>[1];
const state = (over = {}) => ({ isValid: false, toNode: null, fromNode: { id: 'source' }, fromHandle: { type: 'source' }, ...over }) as unknown as State;
function surface() {
  const canvas = document.createElement('div');
  const pane = document.createElement('div');
  pane.className = 'react-flow__pane'; canvas.append(pane);
  canvas.getBoundingClientRect = () => ({ left: 50, top: 70 }) as DOMRect;
  return { canvas, pane };
}
function release(target: Element, type = 'mouseup') {
  const event = new MouseEvent(type, { clientX: 350, clientY: 270 });
  target.dispatchEvent(event); return event;
}
describe('release an output on empty canvas', () => {
  it('uses the release position relative to its canvas, not page coordinates', () => {
    const { canvas, pane } = surface();
    expect(connectionDrop(release(pane), state(), canvas)).toEqual({ from: 'source', x: 300, y: 200 });
  });
  it.each([{ isValid: true }, { toNode: { id: 'target' } }, { fromHandle: { type: 'target' } }, { fromNode: null }])('ignores completed or reverse connections: %j', (over) => {
    const { canvas, pane } = surface();
    expect(connectionDrop(release(pane), state(over), canvas)).toBeNull();
  });
  it('ignores releases outside this canvas or over another node, edge or control panel', () => {
    const { canvas, pane } = surface();
    expect(connectionDrop(release(document.body), state(), canvas)).toBeNull();
    for (const name of ['react-flow__node', 'react-flow__edge', 'react-flow__panel']) {
      const target = document.createElement('div'); target.className = name; pane.append(target);
      expect(connectionDrop(release(target), state(), canvas)).toBeNull();
    }
  });
  it('hit-tests the touch release instead of the originating handle, and ignores touch cancellation', () => {
    const { canvas, pane } = surface();
    const touch = { type: 'touchend', changedTouches: [{ clientX: 350, clientY: 270 }] } as unknown as TouchEvent;
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => pane) });
    expect(connectionDrop(touch, state(), canvas)).toEqual({ from: 'source', x: 300, y: 200 });
    expect(connectionDrop({ ...touch, type: 'touchcancel' } as TouchEvent, state(), canvas)).toBeNull();
    delete (document as unknown as Record<string, unknown>).elementFromPoint;
  });
});
