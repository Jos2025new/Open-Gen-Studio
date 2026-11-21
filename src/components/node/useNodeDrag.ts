import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NodeChange } from '@xyflow/react';
import { editPresentation } from '../../engine/nodecore/edit';
import { groupBounds } from '../../engine/flow/arrange';
import type { Graph } from '../../engine/types';
import { useStore } from '../../store/store';
import type { FlowNode } from './nodes';

type Pt = { x: number; y: number };
type Sizes = Map<string, { width: number; height: number }>;
type DragNodes = ReadonlyArray<{ id: string; position: Pt }>;
/** Positions React Flow reports while a gesture is in flight (nodes and frames), and each frame's position at gesture start. */
interface Flight { pos: Map<string, Pt>; start: Map<string, Pt>; event?: unknown }

const EMPTY = new Map<string, Pt>();
const graphOf = (sessionId: string) => useStore.getState().sessions[sessionId]?.graph;
const newFlight = (event?: unknown): Flight => ({ pos: new Map(), start: new Map(), event });

/** Positions a flight gives to the live graph: dragged nodes as reported; a dragged frame shifts its live members by its own offset. */
function project(f: Flight | null, graph: Graph | undefined): Map<string, Pt> {
  if (!f || !graph) return EMPTY;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Pt>();
  for (const [id, p] of f.pos) if (byId.has(id)) out.set(id, p);
  for (const g of graph.groups ?? []) {
    const p = f.pos.get(g.id), s = f.start.get(g.id);
    if (!p || !s) continue;
    for (const id of g.nodeIds) {
      const n = byId.get(id);
      if (n && !out.has(id)) out.set(id, { x: n.position.x + p.x - s.x, y: n.position.y + p.y - s.y });
    }
  }
  return out;
}

/**
 * Drag cycle («one gesture = one write»): React Flow's `onNodeDragStart` opens a flight; position changes only update it
 * (cards are projected from graph + flight); `onNodeDragStop` writes one `editPresentation` with React Flow's final positions
 * onto the live graph and empties the flight. Graph changes mid-gesture never cancel it. Position changes with no flight
 * (arrow keys) are written directly, as in main. Unmount or a session change empties the flight without writing.
 */
export function useNodeDrag(sessionId: string, measuredRef: RefObject<Sizes>) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const sessionRef = useRef<string | null>(null);
  const graph = useStore((s) => s.sessions[sessionId]?.graph);
  const dragPos = useMemo(() => project(flight, graph), [flight, graph]);

  useEffect(() => {
    sessionRef.current = sessionId;
    flightRef.current = null;
    setFlight(null);
    return () => {
      sessionRef.current = null;
      flightRef.current = null;
    };
  }, [sessionId]);

  const live = useCallback(() => sessionRef.current === sessionId, [sessionId]);
  const publish = useCallback((f: Flight | null) => {
    flightRef.current = f;
    setFlight(f && { ...f });
  }, []);

  /** Records reported positions; a frame without a start position starts at its current bounds. */
  const track = useCallback((f: Flight, changes: NodeChange<FlowNode>[]) => {
    const g = graphOf(sessionId);
    for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue;
      f.pos.set(c.id, c.position);
      const group = g?.groups?.find((gr) => gr.id === c.id);
      if (!group || f.start.has(c.id)) continue;
      const ids = new Set(group.nodeIds);
      const b = groupBounds(g!.nodes.filter((n) => ids.has(n.id)), measuredRef.current);
      if (b) f.start.set(c.id, { x: b.x, y: b.y });
    }
  }, [sessionId, measuredRef]);

  /** Writes a flight onto the live graph as one step, only for live IDs with net movement. */
  const commit = useCallback((f: Flight) => {
    const moves = project(f, graphOf(sessionId));
    const moved = (n: { id: string; position: Pt }) => {
      const p = moves.get(n.id);
      return p !== undefined && (p.x !== n.position.x || p.y !== n.position.y);
    };
    if (!graphOf(sessionId)?.nodes.some(moved)) return;
    editPresentation(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (moved(n) ? { ...n, position: moves.get(n.id)! } : n)) }));
  }, [sessionId]);

  const endDrag = useCallback((_event?: unknown, _node?: unknown, nodes?: DragNodes) => {
    const f = flightRef.current;
    if (!f || !live()) return;
    for (const n of nodes ?? []) f.pos.set(n.id, n.position);
    publish(null);
    commit(f);
  }, [live, publish, commit]);

  const startDrag = useCallback((event?: unknown, _node?: unknown, nodes?: DragNodes) => {
    if (!live()) return;
    // React Flow 12 calls onNodeDragStart and onSelectionDragStart with the same event for one selection drag.
    if (event !== undefined && flightRef.current?.event === event) return;
    // A flight still open here lost its end (React Flow always stops or aborts first): it is discarded.
    const f = newFlight(event);
    for (const n of nodes ?? []) f.start.set(n.id, n.position);
    publish(f);
  }, [live, publish]);

  const applyDragChanges = useCallback((changes: NodeChange<FlowNode>[]) => {
    if (!live() || !changes.some((c) => c.type === 'position' && c.position)) return;
    let gesture = flightRef.current;
    if (!gesture && changes.some((c) => c.type === 'position' && c.dragging === true)) gesture = newFlight();
    if (gesture) {
      const f = gesture;
      track(f, changes);
      publish(f);
      // An aborted drag (second finger, grabbed node deleted) ends with `dragging: false` and no stop event: commit it then.
      for (const c of changes) {
        if (c.type === 'position' && c.dragging === false) { queueMicrotask(() => { if (flightRef.current === f) endDrag(); }); break; }
      }
      return;
    }
    const direct = newFlight();
    track(direct, changes);
    commit(direct);
  }, [live, track, publish, commit, endDrag]);

  const startSelection = useCallback((event: unknown, nodes: DragNodes) => startDrag(event, undefined, nodes), [startDrag]);
  const endSelection = useCallback((event: unknown, nodes: DragNodes) => endDrag(event, undefined, nodes), [endDrag]);
  return { dragPos, applyDragChanges, startDrag, endDrag, startSelection, endSelection };
}

export function liveGroupsMap(sessionId: string) {
  const liveGraph = graphOf(sessionId);
  return { liveGraph, groupById: new Map((liveGraph?.groups ?? []).map((g) => [g.id, g])) };
}
