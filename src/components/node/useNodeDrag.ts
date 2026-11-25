import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NodeChange } from '@xyflow/react';
import { editPresentation } from '../../engine/nodecore/edit';
import { DEFAULT_GROUP_BOUNDS, groupBounds } from '../../engine/flow/arrange';
import { asNudge } from '../../engine/flow/history';
import type { Graph } from '../../engine/types';
import { useStore } from '../../store/store';
import type { FlowNode } from './nodes';

type Pt = { x: number; y: number };
type Sizes = Map<string, { width: number; height: number }>;
type DragNodes = ReadonlyArray<{ id: string; position: Pt }>;
type Pointer = { touch: false } | { touch: true; id: number; primary: boolean };
/**
 * One gesture's identity and state: its start event (token), its pointer, its items at start (nodes and frames, with
 * their start positions), the positions React Flow reported since, and the items deleted mid-gesture (out for good).
 */
interface Flight { event?: unknown; pointer: Pointer; start: Map<string, Pt>; pos: Map<string, Pt>; gone: Set<string> }

const EMPTY = new Map<string, Pt>();
const graphOf = (sessionId: string) => useStore.getState().sessions[sessionId]?.graph;
const newFlight = (event?: unknown): Flight => ({ event, pointer: pointerOf(event), start: new Map(), pos: new Map(), gone: new Set() });
/** The d3 source event's pointer: a touch by its identifier (primary when it is the only finger down), else the mouse. */
function pointerOf(event: unknown): Pointer {
  const e = event as { changedTouches?: ArrayLike<{ identifier: number }>; touches?: ArrayLike<unknown> } | undefined;
  const t = e?.changedTouches?.[0];
  return t ? { touch: true, id: t.identifier, primary: (e?.touches?.length ?? 1) <= 1 } : { touch: false };
}
const samePointer = (a: Pointer, b: Pointer) => a.touch === b.touch && (!a.touch || (b.touch && a.id === b.id));
/** React Flow moves selected nodes on arrow keys from its keydown handler: only such batches are written without a flight. */
const isArrowBatch = () => typeof window !== 'undefined' && window.event?.type === 'keydown';
const liveIds = (g: Graph | undefined) => new Set([...(g?.nodes ?? []), ...(g?.groups ?? [])].map((x) => x.id));

/** Positions a flight gives to the live graph: dragged nodes as reported; a dragged frame shifts its live members by its own offset. */
function project(f: Flight | null, graph: Graph | undefined): Map<string, Pt> {
  if (!f || !graph) return EMPTY;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Pt>();
  for (const [id, p] of f.pos) if (byId.has(id)) out.set(id, p);
  for (const g of graph.groups ?? []) {
    const p = f.pos.get(g.id), s = f.start.get(g.id);
    if (!p || !s) continue;
    const dx = p.x - s.x, dy = p.y - s.y;
    if (!g.nodeIds.length) {
      const b = g.bounds ?? DEFAULT_GROUP_BOUNDS;
      if (!out.has(g.id)) out.set(g.id, { x: b.x + dx, y: b.y + dy });
      continue;
    }
    for (const id of g.nodeIds) {
      const n = byId.get(id);
      if (n && !out.has(id)) out.set(id, { x: n.position.x + dx, y: n.position.y + dy });
    }
  }
  return out.size ? out : EMPTY;
}

/**
 * Drag cycle («one gesture = one write»): React Flow's `onNodeDragStart` opens a flight with its own identity; batches only
 * update its items (cards are projected from graph + flight); its own `onNodeDragStop` (same pointer) writes one
 * `editPresentation` onto the live graph and empties it. A second simultaneous gesture is ignored until the first ends.
 * With no flight, only arrow-key batches are written (as in main); drag residuals are dropped. Unmount or a session change
 * empties the flight without writing.
 */
export function useNodeDrag(sessionId: string, measuredRef: RefObject<Sizes>) {
  const [flight, setFlight] = useState<Flight | null>(null);
  const flightRef = useRef<Flight | null>(null);
  const sessionRef = useRef<string | null>(null);
  const graph = useStore((s) => s.sessions[sessionId]?.graph);
  const dragPos = useMemo(() => project(flight, graph), [flight, graph]);

  const publish = useCallback((f: Flight | null) => {
    flightRef.current = f;
    setFlight(f && { ...f });
  }, []);

  useEffect(() => {
    sessionRef.current = sessionId;
    publish(null);
    // An item deleted mid-gesture is out of it for good, so an Undo cannot bring it back as a ghost or into the commit.
    const unsub = useStore.subscribe((st, prev) => {
      const f = flightRef.current, g = st.sessions[sessionId]?.graph;
      if (!f || g === prev.sessions[sessionId]?.graph) return;
      const ids = liveIds(g), gone = [...f.start.keys()].filter((id) => !ids.has(id) && !f.gone.has(id));
      for (const id of gone) { f.gone.add(id); f.pos.delete(id); }
      if (gone.length) publish(f);
    });
    return () => {
      unsub();
      sessionRef.current = null;
      flightRef.current = null;
    };
  }, [sessionId, publish]);

  const live = useCallback(() => sessionRef.current === sessionId, [sessionId]);

  /** Records reported positions of this gesture's live items only (other IDs belong to another gesture or none). */
  const track = useCallback((f: Flight, changes: ReadonlyArray<NodeChange<FlowNode> | { id: string; position: Pt }>) => {
    const ids = liveIds(graphOf(sessionId));
    for (const c of changes) {
      if (('type' in c && c.type !== 'position') || !('position' in c) || !c.position) continue;
      if (f.start.has(c.id) && !f.gone.has(c.id) && ids.has(c.id)) f.pos.set(c.id, c.position);
    }
  }, [sessionId]);

  /** Arrow keys: positions of live nodes as React Flow reports them; a frame moves its members by its offset from its bounds. */
  const nudge = useCallback((changes: NodeChange<FlowNode>[]) => {
    const g = graphOf(sessionId), f = newFlight();
    for (const c of changes) {
      if (c.type !== 'position' || !c.position) continue;
      const group = g?.groups?.find((gr) => gr.id === c.id), members = new Set(group?.nodeIds);
      const b = group && (groupBounds(g!.nodes.filter((n) => members.has(n.id)), measuredRef.current) ?? group.bounds ?? DEFAULT_GROUP_BOUNDS);
      f.start.set(c.id, b ? { x: b.x, y: b.y } : c.position);
    }
    track(f, changes);
    return f;
  }, [sessionId, measuredRef, track]);

  /** Writes a flight onto the live graph as one step, only for live IDs with net movement. */
  const commit = useCallback((f: Flight) => {
    const cur = graphOf(sessionId);
    const moves = project(f, cur);
    const moved = (n: { id: string; position: Pt }) => {
      const p = moves.get(n.id);
      return p !== undefined && (p.x !== n.position.x || p.y !== n.position.y);
    };
    const movedGrp = (gr: { id: string; nodeIds: string[]; bounds?: { x: number; y: number; width: number; height: number } }) => {
      const p = moves.get(gr.id), b = gr.bounds ?? DEFAULT_GROUP_BOUNDS;
      return !gr.nodeIds.length && p !== undefined && (p.x !== b.x || p.y !== b.y);
    };
    if (!cur?.nodes.some(moved) && !cur?.groups?.some(movedGrp)) return;
    editPresentation(sessionId, (g) => ({
      ...g,
      nodes: g.nodes.map((n) => (moved(n) ? { ...n, position: moves.get(n.id)! } : n)),
      ...(g.groups?.some(movedGrp) ? { groups: g.groups.map((gr) => (movedGrp(gr) ? { ...gr, bounds: { ...(gr.bounds ?? DEFAULT_GROUP_BOUNDS), ...moves.get(gr.id)! } } : gr)) } : {}),
    }));
  }, [sessionId]);

  /** Ends the open flight: on its own stop (same pointer), or with no event from a fallback end. */
  const endDrag = useCallback((event?: unknown, _node?: unknown, nodes?: DragNodes) => {
    const f = flightRef.current;
    if (!f || !live() || (event !== undefined && !samePointer(pointerOf(event), f.pointer))) return;
    track(f, nodes ?? []);
    publish(null);
    commit(f);
  }, [live, track, publish, commit]);

  const startDrag = useCallback((event?: unknown, _node?: unknown, nodes?: DragNodes) => {
    const open = flightRef.current;
    if (!live()) return;
    // React Flow 12 calls onNodeDragStart and onSelectionDragStart with the same event for one selection drag.
    if (open && event !== undefined && open.event === event) return;
    const f = newFlight(event);
    // A second simultaneous gesture (another finger) is ignored until the open one ends.
    if (open && !samePointer(f.pointer, open.pointer)) return;
    // The same pointer starting again means the open flight lost its end: it is discarded.
    for (const n of nodes ?? []) f.start.set(n.id, n.position);
    publish(f);
  }, [live, publish]);

  const applyDragChanges = useCallback((changes: NodeChange<FlowNode>[]) => {
    if (!live() || !changes.some((c) => c.type === 'position' && c.position)) return;
    const gesture = flightRef.current;
    if (gesture) {
      track(gesture, changes);
      publish(gesture);
      return;
    }
    // No flight: a drag residual (autopan after an abort, the late end of a gesture closed early) is dropped by identity.
    if (!isArrowBatch()) return;
    const direct = nudge(changes);
    asNudge(sessionId, () => commit(direct));
  }, [sessionId, live, track, nudge, publish, commit]);

  // Fallback ends when React Flow sends none: an abort (second finger, grabbed node deleted) or an unmounted touch target
  // closes at the same pointer's window pointerup, after React Flow's own end had its turn; a lost mouseup (blur) at once.
  useEffect(() => {
    const up = (e: PointerEvent) => {
      const f = flightRef.current, p = f?.pointer;
      if (!f || !p || (e.pointerType === 'touch') !== p.touch || (p.touch && e.isPrimary !== p.primary)) return;
      window.setTimeout(() => { if (flightRef.current === f) endDrag(); }, 0);
    };
    const blur = () => { if (flightRef.current) endDrag(); };
    window.addEventListener('pointerup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('blur', blur);
    };
  }, [endDrag]);

  const startSelection = useCallback((event: unknown, nodes: DragNodes) => startDrag(event, undefined, nodes), [startDrag]);
  const endSelection = useCallback((event: unknown, nodes: DragNodes) => endDrag(event, undefined, nodes), [endDrag]);
  return { dragPos, applyDragChanges, startDrag, endDrag, startSelection, endSelection };
}

export function liveGroupsMap(sessionId: string) {
  const liveGraph = graphOf(sessionId);
  return { liveGraph, groupById: new Map((liveGraph?.groups ?? []).map((g) => [g.id, g])) };
}
