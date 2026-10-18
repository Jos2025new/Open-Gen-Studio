import type { OnConnectEnd } from '@xyflow/react';

/** Only an output released on this canvas's empty pane opens the connected-node picker. */
export function connectionDrop(event: MouseEvent | TouchEvent, state: Parameters<OnConnectEnd>[1], canvas: HTMLElement | null): { x: number; y: number; from: string } | null {
  if (!canvas || event.type === 'touchcancel' || state.isValid || state.toNode || state.fromHandle?.type !== 'source' || !state.fromNode) return null;
  const touch = 'changedTouches' in event;
  const point = touch ? event.changedTouches[0] : event;
  if (!point) return null;
  // Touch events keep their original handle as target: hit-test where the finger ended instead.
  const target = touch ? canvas.ownerDocument.elementFromPoint?.(point.clientX, point.clientY) : event.target;
  if (!(target instanceof Element) || !canvas.contains(target) || !target.closest('.react-flow__pane') || target.closest('.react-flow__node, .react-flow__edge, .react-flow__panel')) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: point.clientX - rect.left, y: point.clientY - rect.top, from: state.fromNode.id };
}
