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
export function rfDrag(props: () => unknown) {
  const p = () => props() as DragProps;
  const items = (ids: string[], at: Record<string, Pt> = {}) =>
    ids.flatMap((id) => {
      const position = at[id] ?? p().nodes.find((n) => n.id === id)?.position;
      return position ? [{ id, position }] : [];
    });
  return {
    start(...ids: string[]) {
      const ns = items(ids);
      act(() => p().onNodeDragStart!(new MouseEvent('mousedown'), ns[0], ns));
    },
    stop(ids: string[], at?: Record<string, Pt>) {
      const ns = items(ids, at);
      act(() => p().onNodeDragStop!(new MouseEvent('mouseup'), ns[0], ns));
    },
  };
}
