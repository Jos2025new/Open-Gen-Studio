import { useOnViewportChange, type OnConnectEnd } from '@xyflow/react';
import type { RefObject } from 'react';
import { connectionError } from '../../engine/flow/graph';
import type { Asset, Graph } from '../../engine/types';

/** An output released on a port that cannot take it: the connection that was tried, to say why it is refused. */
export function rejectedDrop(state: Parameters<OnConnectEnd>[1]): { source: string; target: string; sourceHandle: string | null; targetHandle: string | null } | null {
  if (state.isValid || !state.toNode || !state.toHandle || state.fromHandle?.type !== 'source' || state.toHandle.type !== 'target' || !state.fromNode) return null;
  return { source: state.fromNode.id, target: state.toNode.id, sourceHandle: state.fromHandle.id ?? null, targetHandle: state.toHandle.id ?? null };
}

/** Why a drop on an incompatible port is refused (both port types named by connectionError), or null when it is not one. */
export function refusedDropReason(state: Parameters<OnConnectEnd>[1], graph: Graph, assets: Record<string, Asset>): string | null {
  const refused = rejectedDrop(state);
  return refused ? connectionError(graph, assets, refused) : null;
}

/** The omnicanvas can sit far below 100 %: ports keep a minimum on-screen size through --rf-zoom (no re-render per frame). */
export function usePortZoom(omni: boolean, canvas: RefObject<HTMLElement | null>) {
  useOnViewportChange({ onChange: (v) => { if (omni) canvas.current?.style.setProperty('--rf-zoom', String(v.zoom)); } });
}

/** Only an output released on this canvas's empty pane opens the connected-node picker. */
export function connectionDrop(event: MouseEvent | TouchEvent, state: Parameters<OnConnectEnd>[1], canvas: HTMLElement | null): { x: number; y: number; from: string; handle?: string | null } | null {
  if (!canvas || event.type === 'touchcancel' || state.isValid || state.toNode || state.fromHandle?.type !== 'source' || !state.fromNode) return null;
  const touch = 'changedTouches' in event;
  const point = touch ? event.changedTouches[0] : event;
  if (!point) return null;
  // Touch events keep their original handle as target: hit-test where the finger ended instead.
  const target = touch ? canvas.ownerDocument.elementFromPoint?.(point.clientX, point.clientY) : event.target;
  if (!(target instanceof Element) || !canvas.contains(target) || !target.closest('.react-flow__pane') || target.closest('.react-flow__node, .react-flow__edge, .react-flow__panel')) return null;
  const rect = canvas.getBoundingClientRect();
  return { x: point.clientX - rect.left, y: point.clientY - rect.top, from: state.fromNode.id, handle: state.fromHandle.id };
}
