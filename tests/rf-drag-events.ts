import { act } from 'react';

type Pt = { x: number; y: number };
type DragNode = { id: string; position: Pt };
type DragProps = {
  nodes: DragNode[];
  onNodeDragStart?(event: unknown, node: DragNode | undefined, nodes: DragNode[]): void;
  onNodeDragStop?(event: unknown, node: DragNode | undefined, nodes: DragNode[]): void;
};

/**
 * React Flow's gesture bounds as XYDrag fires them around the `onNodesChange` batches a test sends:
 * `start` with the dragged nodes at their rendered positions, `stop` with their final positions (rendered, or `at`).
 */
export function rfDrag(props: () => unknown, event: (phase: 'start' | 'stop') => unknown = (phase) => new MouseEvent(phase === 'start' ? 'mousedown' : 'mouseup')) {
  const p = () => props() as DragProps;
  const items = (ids: string[], at: Record<string, Pt> = {}) =>
    ids.flatMap((id) => {
      const position = at[id] ?? p().nodes.find((n) => n.id === id)?.position;
      return position ? [{ id, position }] : [];
    });
  return {
    start(...ids: string[]) {
      const ns = items(ids);
      act(() => p().onNodeDragStart!(event('start'), ns[0], ns));
    },
    stop(ids: string[], at?: Record<string, Pt>) {
      const ns = items(ids, at);
      act(() => p().onNodeDragStop!(event('stop'), ns[0], ns));
    },
  };
}

/** A touch as d3 hands it to React Flow: `touches` are the fingers down, `changedTouches` this one. */
export const touch = (identifier: number, down: number[] = [identifier]) => (phase: 'start' | 'stop') => ({
  type: phase === 'start' ? 'touchstart' : 'touchend',
  changedTouches: [{ identifier }],
  touches: (phase === 'start' ? down : down.filter((d) => d !== identifier)).map((d) => ({ identifier: d })),
});

/** A window pointer event with the fields jsdom's plain Event lacks. */
export const pointerEvent = (type: string, pointerType: 'mouse' | 'touch', isPrimary = true) =>
  Object.assign(new Event(type), { pointerType, isPrimary });

/** Runs `fn` inside a keydown dispatch, as React Flow moves selected nodes on an arrow key. */
export function arrowKey(fn: () => void) {
  act(() => {
    window.addEventListener('keydown', fn, { once: true });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}
