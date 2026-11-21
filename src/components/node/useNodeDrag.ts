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
  const framePreviewsRef = useRef<Map<string, Set<string>>>(new Map());
  const draggingIdsRef = useRef<Set<string>>(new Set());
  const pendingCommitsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const baseNodesRef = useRef<Map<string, { node: GraphNode; x: number; y: number }>>(new Map());

  const reconcileWithGraph = useCallback((g: Graph | undefined) => {
    if (!dragPosRef.current.size && !framePreviewsRef.current.size && !draggingIdsRef.current.size && !pendingCommitsRef.current.size) return;
    const liveNodesById = new Map((g?.nodes ?? []).map((n) => [n.id, n]));
    const liveGroups = new Map((g?.groups ?? []).map((gr) => [gr.id, new Set(gr.nodeIds)]));
    const isNodeStale = (id: string) => {
      const live = liveNodesById.get(id);
      if (!live) return true;
      const base = baseNodesRef.current.get(id);
      return Boolean(base && (live !== base.node || live.position.x !== base.x || live.position.y !== base.y));
    };
    const staleIds = new Set<string>();
    for (const [gid, memberIds] of framePreviewsRef.current) {
      const liveMembers = liveGroups.get(gid);
      if (!liveMembers) {
        for (const id of memberIds) staleIds.add(id);
        framePreviewsRef.current.delete(gid);
        draggingIdsRef.current.delete(gid);
      } else {
        for (const id of memberIds) {
          if (!liveMembers.has(id) || isNodeStale(id)) {
            staleIds.add(id);
            memberIds.delete(id);
          }
        }
        if (!memberIds.size) {
          framePreviewsRef.current.delete(gid);
          draggingIdsRef.current.delete(gid);
        }
      }
    }
    for (const id of dragPosRef.current.keys()) {
      if (isNodeStale(id)) staleIds.add(id);
    }
    for (const id of [...draggingIdsRef.current]) {
      if (!liveGroups.has(id) && isNodeStale(id)) staleIds.add(id);
    }
    for (const id of [...pendingCommitsRef.current.keys()]) {
      if (isNodeStale(id)) staleIds.add(id);
    }
    if (staleIds.size) {
      for (const id of staleIds) {
        draggingIdsRef.current.delete(id);
        pendingCommitsRef.current.delete(id);
        baseNodesRef.current.delete(id);
      }
      const next = new Map(dragPosRef.current);
      let changed = false;
      for (const id of staleIds) if (next.delete(id)) changed = true;
      if (changed) {
        const resolved = next.size ? next : EMPTY_DRAG_POS;
        dragPosRef.current = resolved;
        setDragPos(resolved);
      }
    }
  }, []);

  useEffect(() => {
    framePreviewsRef.current.clear();
    draggingIdsRef.current.clear();
    pendingCommitsRef.current.clear();
    baseNodesRef.current.clear();
    dragPosRef.current = EMPTY_DRAG_POS;
    setDragPos(EMPTY_DRAG_POS);
    return useStore.subscribe((state, prev) => {
      const nextGraph = state.sessions[sessionId]?.graph;
      if (nextGraph !== prev.sessions[sessionId]?.graph) reconcileWithGraph(nextGraph);
    });
  }, [sessionId, reconcileWithGraph]);

  const applyDragChanges = useCallback(
    (
      changes: NodeChange<FlowNode>[],
      liveGraph: Graph | undefined,
      groupById: Map<string, GraphGroup>,
      removed: string[],
    ) => {
      reconcileWithGraph(liveGraph);
      const removedSet = new Set(removed);
      const liveNodesById = liveGraph
        ? new Map(liveGraph.nodes.filter((n) => !removedSet.has(n.id)).map((n) => [n.id, n]))
        : undefined;
      const activeNodesInBatch = new Set<string>();
      const activeFramesInBatch = new Set<string>();
      const droppingInBatch = new Set<string>();
      for (const c of changes) {
        if (c.type !== 'position') continue;
        if (groupById.has(c.id)) {
          const g = groupById.get(c.id)!;
          if (c.dragging === true) {
            if (c.position) {
              activeFramesInBatch.add(c.id);
              for (const id of g.nodeIds) if (!removedSet.has(id) && (!liveNodesById || liveNodesById.has(id))) activeNodesInBatch.add(id);
            }
          } else {
            droppingInBatch.add(c.id);
            for (const id of g.nodeIds) droppingInBatch.add(id);
          }
        } else if (!removedSet.has(c.id) && (!liveNodesById || liveNodesById.has(c.id))) {
          if (c.dragging === true) {
            if (c.position) activeNodesInBatch.add(c.id);
          } else {
            droppingInBatch.add(c.id);
          }
        }
      }
      const droppedIds = new Set<string>();
      if (activeNodesInBatch.size > 0 || activeFramesInBatch.size > 0) {
        const restartGesture = pendingCommitsRef.current.size > 0;
        for (const [gid, memberIds] of [...framePreviewsRef.current]) {
          if (restartGesture || (!activeFramesInBatch.has(gid) && !droppingInBatch.has(gid))) {
            for (const id of memberIds) {
              if (!activeNodesInBatch.has(id)) droppedIds.add(id);
              draggingIdsRef.current.delete(id);
              pendingCommitsRef.current.delete(id);
              baseNodesRef.current.delete(id);
            }
            framePreviewsRef.current.delete(gid);
            draggingIdsRef.current.delete(gid);
          }
        }
        for (const id of [...dragPosRef.current.keys(), ...draggingIdsRef.current, ...pendingCommitsRef.current.keys()]) {
          if (restartGesture || (!activeNodesInBatch.has(id) && !activeFramesInBatch.has(id) && !droppingInBatch.has(id))) {
            if (!activeNodesInBatch.has(id)) droppedIds.add(id);
            draggingIdsRef.current.delete(id);
            pendingCommitsRef.current.delete(id);
            baseNodesRef.current.delete(id);
          }
        }
        for (const gid of activeFramesInBatch) {
          if (!framePreviewsRef.current.has(gid)) {
            for (const id of groupById.get(gid)!.nodeIds) {
              droppedIds.add(id);
              pendingCommitsRef.current.delete(id);
              baseNodesRef.current.delete(id);
            }
          }
        }
      }
      const currentDrag = droppedIds.size
        ? new Map([...dragPosRef.current].filter(([id]) => !droppedIds.has(id)))
        : dragPosRef.current;
      const previewMoves = new Map<string, { x: number; y: number }>();
      const frameChanges: Array<{ group: GraphGroup; pos?: { x: number; y: number }; dragging: boolean }> = [];
      for (const c of changes) {
        if (c.type !== 'position') continue;
        if (groupById.has(c.id)) {
          if (c.dragging === true) {
            draggingIdsRef.current.add(c.id);
            if (c.position) frameChanges.push({ group: groupById.get(c.id)!, pos: c.position, dragging: true });
          } else {
            draggingIdsRef.current.delete(c.id);
            frameChanges.push({ group: groupById.get(c.id)!, pos: c.position, dragging: false });
          }
          continue;
        }
        if (framePreviewsRef.current.has(c.id)) {
          for (const id of framePreviewsRef.current.get(c.id)!) {
            droppedIds.add(id);
            draggingIdsRef.current.delete(id);
            pendingCommitsRef.current.delete(id);
          }
          framePreviewsRef.current.delete(c.id);
          draggingIdsRef.current.delete(c.id);
          continue;
        }
        if (removedSet.has(c.id) || (liveNodesById && !liveNodesById.has(c.id))) {
          if (currentDrag.has(c.id)) droppedIds.add(c.id);
          draggingIdsRef.current.delete(c.id);
          pendingCommitsRef.current.delete(c.id);
          continue;
        }
        if (c.dragging === true) {
          draggingIdsRef.current.add(c.id);
          pendingCommitsRef.current.delete(c.id);
          if (c.position) previewMoves.set(c.id, c.position);
        } else {
          draggingIdsRef.current.delete(c.id);
          const pos = c.position ?? currentDrag.get(c.id);
          if (pos) {
            pendingCommitsRef.current.set(c.id, pos);
            previewMoves.set(c.id, pos);
          }
          droppedIds.add(c.id);
        }
      }
      if (frameChanges.length && liveGraph && liveNodesById) {
        const preBatchPosOf = (n: GraphNode) => currentDrag.get(n.id) ?? n.position;
        for (const { group: g, pos: p, dragging } of frameChanges) {
          if (!dragging) {
            draggingIdsRef.current.delete(g.id);
            const tracked = framePreviewsRef.current.get(g.id);
            if (tracked) {
              for (const id of tracked) {
                droppedIds.add(id);
                draggingIdsRef.current.delete(id);
              }
              framePreviewsRef.current.delete(g.id);
            }
          }
          const members: GraphNode[] = [];
          for (const id of g.nodeIds) {
            const n = liveNodesById.get(id);
            if (n) members.push({ ...n, position: preBatchPosOf(n) });
          }
          const b = groupBounds(members, measuredRef.current);
          const dx = p && b ? p.x - b.x : 0;
          const dy = p && b ? p.y - b.y : 0;
          if (dragging && !b) continue;
          if (dragging) {
            let tracked = framePreviewsRef.current.get(g.id);
            if (!tracked) {
              tracked = new Set();
              framePreviewsRef.current.set(g.id, tracked);
            }
            for (const m of members) tracked.add(m.id);
          }
          for (const m of members) {
            const nextPos = { x: m.position.x + dx, y: m.position.y + dy };
            if (dragging) {
              if (!previewMoves.has(m.id)) previewMoves.set(m.id, nextPos);
            } else {
              if (!pendingCommitsRef.current.has(m.id)) pendingCommitsRef.current.set(m.id, nextPos);
              if (!previewMoves.has(m.id)) previewMoves.set(m.id, nextPos);
              droppedIds.add(m.id);
              draggingIdsRef.current.delete(m.id);
            }
          }
        }
      }
      for (const id of removed) {
        draggingIdsRef.current.delete(id);
        pendingCommitsRef.current.delete(id);
      }
      if (liveNodesById) {
        for (const id of [...draggingIdsRef.current]) {
          if (!liveNodesById.has(id) && !groupById.has(id)) draggingIdsRef.current.delete(id);
        }
        for (const id of [...pendingCommitsRef.current.keys()]) {
          if (!liveNodesById.has(id)) pendingCommitsRef.current.delete(id);
        }
      }
      const stillDragging = draggingIdsRef.current.size > 0 || framePreviewsRef.current.size > 0;
      if (previewMoves.size || droppedIds.size || removed.length || (!stillDragging && dragPosRef.current.size)) {
        const next = new Map(dragPosRef.current);
        let changed = false;
        if (!stillDragging) {
          for (const id of droppedIds) if (next.delete(id)) changed = true;
          for (const id of pendingCommitsRef.current.keys()) if (next.delete(id)) changed = true;
        } else {
          for (const id of droppedIds) {
            if (!pendingCommitsRef.current.has(id) && !previewMoves.has(id) && next.delete(id)) changed = true;
          }
        }
        for (const id of removed) if (next.delete(id)) changed = true;
        for (const [id, pos] of previewMoves) {
          if (!stillDragging && (droppedIds.has(id) || pendingCommitsRef.current.has(id))) continue;
          if (!removedSet.has(id) && (!liveNodesById || liveNodesById.has(id))) {
            const liveNode = liveNodesById?.get(id);
            if (liveNode && !baseNodesRef.current.has(id)) {
              baseNodesRef.current.set(id, { node: liveNode, x: liveNode.position.x, y: liveNode.position.y });
            }
            const prev = next.get(id);
            if (!prev || prev.x !== pos.x || prev.y !== pos.y) {
              next.set(id, pos);
              changed = true;
            }
          }
        }
        if (liveNodesById) {
          for (const id of next.keys()) {
            if (!liveNodesById.has(id)) {
              next.delete(id);
              baseNodesRef.current.delete(id);
              changed = true;
            }
          }
        }
        for (const id of [...baseNodesRef.current.keys()]) {
          if (!next.has(id)) baseNodesRef.current.delete(id);
        }
        if (!next.size) {
          framePreviewsRef.current.clear();
          baseNodesRef.current.clear();
        } else if (droppedIds.size || removed.length) {
          for (const [gid, memberIds] of framePreviewsRef.current) {
            for (const id of droppedIds) if (!pendingCommitsRef.current.has(id) && !previewMoves.has(id)) memberIds.delete(id);
            for (const id of removed) memberIds.delete(id);
            if (!memberIds.size) framePreviewsRef.current.delete(gid);
          }
        }
        if (changed) {
          const resolved = next.size ? next : EMPTY_DRAG_POS;
          dragPosRef.current = resolved;
          setDragPos(resolved);
        }
      }
      if (!stillDragging && pendingCommitsRef.current.size) {
        const commitMoves = new Map(pendingCommitsRef.current);
        pendingCommitsRef.current.clear();
        if (liveGraph) {
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
      }
    },
    [sessionId, measuredRef, reconcileWithGraph],
  );

  return { dragPos, applyDragChanges };
}

export function liveGroupsMap(sessionId: string) {
  const liveGraph = useStore.getState().sessions[sessionId]?.graph;
  return { liveGraph, groupById: new Map((liveGraph?.groups ?? []).map((g) => [g.id, g])) };
}
