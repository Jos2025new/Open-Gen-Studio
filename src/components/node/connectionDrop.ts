import { useOnViewportChange, useReactFlow, type OnConnectEnd } from '@xyflow/react';
import { useCallback, useEffect, type RefObject } from 'react';
import { connectionError } from '../../engine/flow/graph';
import type { Asset, Graph } from '../../engine/types';

type Tried = { source: string; target: string; sourceHandle: string | null; targetHandle: string | null };

/** A cable released on a port that cannot take it, in either direction (output→input or input→output): the connection tried,
 * oriented source→target, or 'same' when both ends are outputs (or both inputs). */
export function rejectedDrop(state: Parameters<OnConnectEnd>[1]): Tried | 'same' | null {
  const { fromNode, fromHandle, toNode, toHandle } = state;
  if (state.isValid || !fromNode || !toNode || !fromHandle || !toHandle) return null;
  if (fromNode.id === toNode.id && fromHandle.id === toHandle.id) return null; // released on the handle it started from
  if (fromHandle.type === toHandle.type) return 'same';
  const [out, outH, inn, inH] = fromHandle.type === 'source' ? [fromNode, fromHandle, toNode, toHandle] : [toNode, toHandle, fromNode, fromHandle];
  return { source: out.id, target: inn.id, sourceHandle: outH.id ?? null, targetHandle: inH.id ?? null };
}

/** Why a drop on an incompatible port is refused (both port types named by connectionError), or null when it is not one. */
export function refusedDropReason(state: Parameters<OnConnectEnd>[1], graph: Graph, assets: Record<string, Asset>): string | null {
  const refused = rejectedDrop(state);
  if (refused === 'same') return 'an output connects to an input, not to another output (or input to input)';
  return refused ? connectionError(graph, assets, refused) : null;
}

/** Says once why a refused drop was refused; true when the drop was one (so no picker opens). */
export function reportRefusedDrop(state: Parameters<OnConnectEnd>[1], graph: Graph, assets: Record<string, Asset>, notify: (text: string, kind: 'error') => void): boolean {
  const why = refusedDropReason(state, graph, assets);
  if (why) notify(`Cannot connect: ${why}`, 'error');
  return Boolean(why);
}

/** Below this zoom ports stop growing: the enlarged hit area is capped at 12 px / 0.25 = 48 px (never larger than a card). */
export const PORT_MIN_ZOOM = 0.25;
export const portZoom = (zoom: number): number => Math.max(PORT_MIN_ZOOM, zoom);

/** The omnicanvas can sit far below 100 %: ports keep a minimum on-screen size through --rf-zoom (no re-render per frame).
 * Only the ::before of .port scales (node-system.css): the port box React Flow measures for cable anchors never changes. */
export function usePortZoom(omni: boolean, canvas: RefObject<HTMLElement | null>) {
  const rf = useReactFlow();
  const onChange = useCallback((v: { zoom: number }) => { if (omni) canvas.current?.style.setProperty('--rf-zoom', String(portZoom(v.zoom))); }, [omni, canvas]);
  useOnViewportChange({ onChange });
  useEffect(() => { if (omni) canvas.current?.style.setProperty('--rf-zoom', String(portZoom(rf.getZoom()))); }, [omni, canvas, rf]);
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
