import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { NodeChange } from '@xyflow/react';
import { editPresentation } from '../../engine/nodecore/edit';
import { groupBounds } from '../../engine/flow/arrange';
import type { Graph, GraphGroup, GraphNode } from '../../engine/types';
import { useStore } from '../../store/store';
import type { FlowNode } from './nodes';

const EMPTY_DRAG_POS = new Map<string, { x: number; y: number }>();

type Pt = { x: number; y: number };

interface DragGesture {
  ids: Set<string>;
  frames: Map<string, Set<string>>;
  base: Map<string, { node: GraphNode; x: number; y: number }>;
  preview: Map<string, Pt>;
  final: Map<string, Pt>;
  active: Set<string>;
  dragging: boolean;
}

/**
 * Explicit drag-gesture lifecycle («one gesture = one write»):
 * - Starts on the first `dragging: true` when no gesture is active, recording gesture IDs, base positions, previews, and dropped finals.
 * - During the gesture, `dragging: true` updates only that ID's preview without clearing any other ID's dropped final position.
 * - Ends once all gesture IDs release (`dragging: false`), committing one `editPresentation` for surviving nodes with net movement.
 * - Discards without writing on canvas unmount, session change, or if a new `dragging: true` arrives with IDs outside the unfinished gesture.
 */
export function useNodeDrag(
  sessionId: string,
  measuredRef: RefObject<Map<string, { width: number; height: number }>>,
) {
  const [dragPos, setDragPos] = useState<Map<string, { x: number; y: number }>>(EMPTY_DRAG_POS);
  const dragPosRef = useRef(dragPos);
  dragPosRef.current = dragPos;
  const gestureRef = useRef<DragGesture | null>(null);
  const mountedRef = useRef(true);

  const syncDragPos = useCallback(() => {
    const g = gestureRef.current;
    const next = g && g.preview.size ? g.preview : EMPTY_DRAG_POS;
    const prev = dragPosRef.current;
    if (next === EMPTY_DRAG_POS && prev === EMPTY_DRAG_POS) return;
    if (next.size === prev.size && [...next].every(([id, p]) => { const q = prev.get(id); return q !== undefined && q.x === p.x && q.y === p.y; })) return;
    const published = next === EMPTY_DRAG_POS ? EMPTY_DRAG_POS : new Map(next);
    dragPosRef.current = published;
    if (mountedRef.current) setDragPos(published);
  }, []);

  const reconcileWithGraph = useCallback(
    (g: Graph | undefined, removed?: ReadonlySet<string>) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const liveNodes = new Map<string, GraphNode>();
      for (const n of g?.nodes ?? []) if (!removed?.has(n.id)) liveNodes.set(n.id, n);
      const liveGroups = new Map((g?.groups ?? []).map((gr) => [gr.id, new Set(gr.nodeIds)]));
      const isNodeAlive = (id: string) => {
        const live = liveNodes.get(id);
        if (!live) return false;
        const base = gesture.base.get(id);
        if (!base) return true;
        if (live.position.x !== base.x || live.position.y !== base.y) return false;
        return gesture.final.has(id) || live === base.node;
      };
      const dead = new Set<string>();
      for (const [gid, memberIds] of gesture.frames) {
        const liveMembers = liveGroups.get(gid);
        if (!liveMembers) {
          for (const id of memberIds) if (!gesture.active.has(id)) dead.add(id);
          gesture.frames.delete(gid);
          gesture.ids.delete(gid);
          gesture.active.delete(gid);
        } else {
          for (const id of memberIds) {
            if (!liveMembers.has(id) || !isNodeAlive(id)) {
              memberIds.delete(id);
              if (!gesture.active.has(id)) dead.add(id);
            }
          }
          if (!memberIds.size) {
            gesture.frames.delete(gid);
            gesture.ids.delete(gid);
            gesture.active.delete(gid);
          }
        }
      }
      for (const id of gesture.ids) if (!gesture.frames.has(id) && !isNodeAlive(id)) dead.add(id);
      for (const id of dead) {
        gesture.ids.delete(id);
        gesture.active.delete(id);
        gesture.preview.delete(id);
        gesture.final.delete(id);
        gesture.base.delete(id);
      }
      if (!gesture.ids.size) gestureRef.current = null;
      else gesture.dragging = gesture.active.size > 0;
      syncDragPos();
    },
    [syncDragPos],
  );

  useEffect(() => {
    mountedRef.current = true;
    gestureRef.current = null;
    dragPosRef.current = EMPTY_DRAG_POS;
    setDragPos(EMPTY_DRAG_POS);
    const unsub = useStore.subscribe((state, prev) => {
      const nextGraph = state.sessions[sessionId]?.graph;
      if (nextGraph !== prev.sessions[sessionId]?.graph) reconcileWithGraph(nextGraph);
    });
    return () => {
      mountedRef.current = false;
      unsub();
      gestureRef.current = null;
      dragPosRef.current = EMPTY_DRAG_POS;
    };
  }, [sessionId, reconcileWithGraph]);

  const applyDragChanges = useCallback(
    (
      changes: NodeChange<FlowNode>[],
      liveGraph: Graph | undefined,
      groupById: Map<string, GraphGroup>,
      removed: string[],
    ) => {
      if (!mountedRef.current) return;
      const removedSet = new Set(removed);
      reconcileWithGraph(liveGraph, removedSet);
      const liveNodes = new Map<string, GraphNode>();
      for (const n of liveGraph?.nodes ?? []) if (!removedSet.has(n.id)) liveNodes.set(n.id, n);

      const dragStarts: Array<{ id: string; group?: GraphGroup }> = [];
      for (const c of changes) {
        if (c.type !== 'position' || c.dragging !== true || !c.position) continue;
        if (groupById.has(c.id)) {
          const group = groupById.get(c.id)!;
          if (group.nodeIds.some((id) => liveNodes.has(id))) dragStarts.push({ id: c.id, group });
        } else if (liveNodes.has(c.id)) {
          dragStarts.push({ id: c.id });
        }
      }

      // Discard any unfinished gesture without writing if a new gesture starts with IDs outside the active gesture.
      let gesture = gestureRef.current;
      if (dragStarts.length > 0) {
        const continues =
          gesture !== null &&
          dragStarts.every(
            ({ id }) => gesture!.ids.has(id) && !gesture!.final.has(id) && (!groupById.has(id) || gesture!.active.has(id)),
          );
        if (!continues) {
          gesture = {
            ids: new Set(),
            frames: new Map(),
            base: new Map(),
            preview: new Map(),
            final: new Map(),
            active: new Set(),
            dragging: true,
          };
          for (const { id, group } of dragStarts) {
            gesture.ids.add(id);
            gesture.active.add(id);
            if (group) {
              const members = new Set(group.nodeIds.filter((mid) => liveNodes.has(mid)));
              gesture.frames.set(id, members);
              for (const mid of members) {
                const n = liveNodes.get(mid)!;
                gesture.ids.add(mid);
                gesture.base.set(mid, { node: n, x: n.position.x, y: n.position.y });
              }
            } else {
              const n = liveNodes.get(id)!;
              gesture.base.set(id, { node: n, x: n.position.x, y: n.position.y });
            }
          }
          gestureRef.current = gesture;
        }
      }

      if (!gesture) return;

      const preBatch = new Map(gesture.preview);
      const directInBatch = new Set<string>();
      const frameChanges: Array<{ group: GraphGroup; pos?: Pt; dragging: boolean }> = [];

      for (const c of changes) {
        if (c.type !== 'position' || !gesture.ids.has(c.id)) continue;
        if (groupById.has(c.id)) {
          const group = groupById.get(c.id)!;
          if (c.dragging === true) {
            gesture.active.add(c.id);
            if (c.position) frameChanges.push({ group, pos: c.position, dragging: true });
          } else {
            gesture.active.delete(c.id);
            frameChanges.push({ group, pos: c.position, dragging: false });
          }
          continue;
        }
        if (!liveNodes.has(c.id)) continue;
        directInBatch.add(c.id);
        if (c.dragging === true) {
          gesture.active.add(c.id);
          if (c.position) gesture.preview.set(c.id, c.position);
        } else {
          gesture.active.delete(c.id);
          const pos = c.position ?? gesture.preview.get(c.id);
          if (pos) {
            gesture.preview.set(c.id, pos);
            gesture.final.set(c.id, pos);
          }
        }
      }

      for (const { group, pos, dragging } of frameChanges) {
        const memberIds = gesture.frames.get(group.id);
        if (!memberIds) continue;
        const members: GraphNode[] = [];
        for (const id of memberIds) {
          const n = liveNodes.get(id);
          if (n) members.push({ ...n, position: preBatch.get(id) ?? n.position });
        }
        const b = groupBounds(members, measuredRef.current);
        if (dragging && !b) continue;
        const dx = pos && b ? pos.x - b.x : 0;
        const dy = pos && b ? pos.y - b.y : 0;
        for (const m of members) {
          if (directInBatch.has(m.id)) continue;
          const nextPos = { x: m.position.x + dx, y: m.position.y + dy };
          if (dragging) {
            if (!gesture.final.has(m.id)) gesture.preview.set(m.id, nextPos);
          } else if (!gesture.active.has(m.id) && !gesture.final.has(m.id)) {
            gesture.preview.set(m.id, nextPos);
            gesture.final.set(m.id, nextPos);
          }
        }
      }

      gesture.dragging = gesture.active.size > 0;
      if (!gesture.dragging) {
        const finalMoves = gesture.final;
        gestureRef.current = null;
        syncDragPos();
        if (liveGraph && finalMoves.size) {
          const moved = liveGraph.nodes.some((n) => {
            const p = finalMoves.get(n.id);
            return p !== undefined && (p.x !== n.position.x || p.y !== n.position.y);
          });
          if (moved) {
            editPresentation(sessionId, (g) => ({
              ...g,
              nodes: g.nodes.map((n) => {
                const p = finalMoves.get(n.id);
                return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
              }),
            }));
          }
        }
      } else {
        syncDragPos();
      }
    },
    [sessionId, measuredRef, reconcileWithGraph, syncDragPos],
  );

  return { dragPos, applyDragChanges };
}

export function liveGroupsMap(sessionId: string) {
  const liveGraph = useStore.getState().sessions[sessionId]?.graph;
  return { liveGraph, groupById: new Map((liveGraph?.groups ?? []).map((g) => [g.id, g])) };
}
