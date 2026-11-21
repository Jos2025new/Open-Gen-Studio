import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { NodeChange } from '@xyflow/react';
import { editPresentation } from '../../engine/nodecore/edit';
import { groupBounds } from '../../engine/flow/arrange';
import type { Graph, GraphGroup, GraphNode } from '../../engine/types';
import { useStore } from '../../store/store';
import type { FlowNode } from './nodes';

const EMPTY_DRAG_POS = new Map<string, { x: number; y: number }>();

/** Keeps in-flight drag positions local to the canvas and commits one `editPresentation` on drop (`dragging: false`). */
export function useNodeDrag(
  sessionId: string,
  measuredRef: RefObject<Map<string, { width: number; height: number }>>,
) {
  const [dragPos, setDragPos] = useState<Map<string, { x: number; y: number }>>(EMPTY_DRAG_POS);
  const dragPosRef = useRef(dragPos);
  dragPosRef.current = dragPos;
  useEffect(() => {
    dragPosRef.current = EMPTY_DRAG_POS;
    setDragPos(EMPTY_DRAG_POS);
  }, [sessionId]);

  const applyDragChanges = useCallback(
    (
      changes: NodeChange<FlowNode>[],
      liveGraph: Graph | undefined,
      groupById: Map<string, GraphGroup>,
      removed: string[],
    ) => {
      const previewMoves = new Map<string, { x: number; y: number }>();
      const commitMoves = new Map<string, { x: number; y: number }>();
      const droppedIds = new Set<string>();
      const frameChanges: Array<{ group: GraphGroup; pos?: { x: number; y: number }; dragging: boolean }> = [];
      for (const c of changes) {
        if (c.type !== 'position') continue;
        if (groupById.has(c.id)) {
          if (c.dragging === true) {
            if (c.position) frameChanges.push({ group: groupById.get(c.id)!, pos: c.position, dragging: true });
          } else {
            frameChanges.push({ group: groupById.get(c.id)!, pos: c.position, dragging: false });
          }
          continue;
        }
        if (c.dragging === true) {
          if (c.position) previewMoves.set(c.id, c.position);
        } else {
          const pos = c.position ?? dragPosRef.current.get(c.id);
          if (pos) commitMoves.set(c.id, pos);
          droppedIds.add(c.id);
        }
      }
      const currentDrag = dragPosRef.current;
      if (frameChanges.length && liveGraph) {
        const liveNodesById = new Map(liveGraph.nodes.map((n) => [n.id, n]));
        const previewPosOf = (n: GraphNode) =>
          commitMoves.get(n.id) ?? previewMoves.get(n.id) ?? currentDrag.get(n.id) ?? n.position;
        for (const { group: g, pos: p, dragging } of frameChanges) {
          if (g.nodeIds.some((id) => previewMoves.has(id) || commitMoves.has(id))) continue;
          const members: GraphNode[] = [];
          for (const id of g.nodeIds) {
            const n = liveNodesById.get(id);
            if (n) members.push({ ...n, position: previewPosOf(n) });
          }
          const b = groupBounds(members, measuredRef.current);
          const dx = p && b ? p.x - b.x : 0;
          const dy = p && b ? p.y - b.y : 0;
          if (dragging && !b) continue;
          for (const m of members) {
            const nextPos = { x: m.position.x + dx, y: m.position.y + dy };
            if (dragging) previewMoves.set(m.id, nextPos);
            else {
              commitMoves.set(m.id, nextPos);
              droppedIds.add(m.id);
            }
          }
        }
      }
      if (previewMoves.size || droppedIds.size || removed.length) {
        const next = new Map(currentDrag);
        for (const id of droppedIds) next.delete(id);
        for (const id of removed) next.delete(id);
        for (const [id, pos] of previewMoves) next.set(id, pos);
        const resolved = next.size ? next : EMPTY_DRAG_POS;
        dragPosRef.current = resolved;
        setDragPos(resolved);
      }
      if (commitMoves.size && liveGraph) {
        const moved = liveGraph.nodes.some((n) => {
          const p = commitMoves.get(n.id);
          return p !== undefined && (p.x !== n.position.x || p.y !== n.position.y);
        });
        if (moved) {
          editPresentation(sessionId, (g) => ({
            ...g,
            nodes: g.nodes.map((n) => {
              const p = commitMoves.get(n.id);
              return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n;
            }),
          }));
        }
      }
    },
    [sessionId, measuredRef],
  );

  return { dragPos, applyDragChanges };
}

export function liveGroupsMap(sessionId: string) {
  const liveGraph = useStore.getState().sessions[sessionId]?.graph;
  return { liveGraph, groupById: new Map((liveGraph?.groups ?? []).map((g) => [g.id, g])) };
}
