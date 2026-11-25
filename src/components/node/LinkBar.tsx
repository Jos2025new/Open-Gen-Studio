import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Panel, type Edge } from '@xyflow/react';
import { disconnectEdges, deleteNodes } from '../../engine/flow/actions';
import { groupSubtree, isEmptyGroup, isSpecialGroup, ungroup } from '../../engine/flow/arrange';
import { GONE_HANDLE, NO_RESULT, nodePorts, outputPort, resultHandle } from '../../engine/flow/graph';
import { openHistoryGroup } from '../../engine/flow/history';
import { setLinkBoth } from '../../engine/nodes/system';
import type { Asset, Graph } from '../../engine/types';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { NOTICE_IN, NOTICE_OUT, type NoticeEdge } from './CanvasNotices';
import type { CableNotice } from '../../engine/flow/notices';
import { linkClassProps } from './SystemNode';

/* The canvas's links and the removal of system nodes: the edges React Flow draws, a bar for the selected link (Both,
 * Remove) and the contextual confirmation before a system node that holds model links is taken off the canvas. */

export function flowEdges(graph: Graph, assets: Record<string, Asset>, running: Set<string>, selected: Set<string>,
  notices: ReadonlyMap<string, CableNotice> = new Map(), sessionId = '', hidden: ReadonlySet<string> = new Set()): Edge[] {
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  return graph.edges.map((e): Edge | NoticeEdge => {
    const src = nodes.get(e.source), tgt = nodes.get(e.target);
    const output = src ? outputPort(src.data, assets) : null;
    const notice = notices.get(e.id);
    const classes = linkClassProps(e, output);
    let sourceHandle = e.outputIndex == null ? e.sourceHandle : e.outputIndex === NO_RESULT ? GONE_HANDLE : resultHandle(e.outputIndex);
    let targetHandle = e.targetHandle;
    if (notice?.kind === 'cable' && src && tgt) {
      const hasSource = src.data.kind !== 'ref' && e.outputIndex != null
        ? Boolean(output)
        : nodePorts(src.data, assets).some(p => p.direction === 'out' && p.id === (sourceHandle ?? 'out'));
      const hasTarget = nodePorts(tgt.data, assets).some(p => p.direction === 'in' && p.id === targetHandle);
      if (!hasSource) sourceHandle = NOTICE_OUT;
      if (!hasTarget) targetHandle = NOTICE_IN;
    }
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
      ...classes,
      ...(notice ? { type: 'notice', data: { notice, sessionId }, className: `${classes.className}${notice.kind === 'cable' ? ' is-incompatible' : ''}` } : {}),
      animated: !notice && running.has(e.target),
      selected: selected.has(e.id),
      hidden: hidden.has(e.source) || hidden.has(e.target),
    };
  });
}

const LINK_NAME = { data: 'Data link', ref: 'Reference link', control: 'Control link' } as const;

/** Shown while exactly one link is selected. Del on the link also removes it; both are one undo step. */
export function LinkBar({ sessionId, graph, selected }: { sessionId: string; graph: Graph; selected: Set<string> }) {
  const edge = selected.size === 1 ? graph.edges.find((e) => e.id === [...selected][0]) : undefined;
  // Data links keep the canvas as it was; only the new classes get the bar.
  if (!edge || (edge.kind ?? 'data') === 'data') return null;
  const kind = edge.kind ?? 'data';
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.data.title ?? id;
  return (
    <Panel position="top-center" className="link-bar" aria-label="Selected link">
      <span>{LINK_NAME[kind]}: {title(edge.source)} {edge.both ? '⇄' : '→'} {title(edge.target)}</span>
      {kind !== 'data' ? <Button variant="ghost" aria-pressed={Boolean(edge.both)} onClick={() => setLinkBoth(sessionId, edge.id, !edge.both)}>{edge.both ? 'One way' : 'Both ways'}</Button> : null}
      <Button variant="ghost" onClick={() => void disconnectEdges(sessionId, [edge.id])}>Remove link</Button>
    </Panel>
  );
}

export const DeleteRequestContext = createContext<((nodeIds: string[], edgeIds?: string[], beforeDelete?: () => void) => void) | null>(null);
export const useDeleteRequestContext = () => useContext(DeleteRequestContext);

/** A system node is a pointer: removing it only takes it off the canvas. When it holds model links, ask first.
 *  A non-empty ordinary group asks whether to ungroup or delete with contents; empty and special groups delete directly. */
export function useDeleteRequest(sessionId: string, afterDelete: (nodes: string[], edges: string[]) => void) {
  const [ask, setAsk] = useState<{ nodes: string[]; edges: string[]; groups?: string[]; beforeDelete?: () => void } | null>(null);
  const graph = useStore((s) => s.sessions[sessionId]?.graph);
  const nonEmptyGroups = (ids: string[]) => {
    const g = useStore.getState().sessions[sessionId]?.graph ?? graph;
    if (!g?.groups?.length) return [];
    const byId = new Map(g.groups.map((gr) => [gr.id, gr]));
    return ids.filter((id) => { const gr = byId.get(id); return Boolean(gr && !isSpecialGroup(gr) && !isEmptyGroup(g.groups, gr)); });
  };
  const needsConfirm = (ids: string[]) => {
    const g = useStore.getState().sessions[sessionId]?.graph ?? graph;
    if (!g) return false;
    const model = (id: string) => { const d = g.nodes.find((n) => n.id === id)?.data; return d?.kind === 'ref' && d.type === 'model'; };
    return ids.some((id) => {
      const d = g.nodes.find((n) => n.id === id)?.data;
      return d?.kind === 'ref' && g.edges.some((e) => (e.kind ?? 'data') === 'control' && (e.source === id || e.target === id) && (model(e.source) || model(e.target)));
    });
  };
  const afterDeleteRef = useRef(afterDelete);
  afterDeleteRef.current = afterDelete;
  /** Deletes nodes (with their connected links), standalone links, and group frames as one atomic undo step. */
  const runDelete = useCallback((nodeIds: string[], edgeIds: string[] = [], beforeDelete?: () => void, groupMode: 'ungroup' | 'contents' = 'ungroup') => {
    const g = useStore.getState().sessions[sessionId]?.graph;
    if (!g) return;
    const byGroup = new Map((g.groups ?? []).map((gr) => [gr.id, gr]));
    const nodeSet = new Set(g.nodes.map((n) => n.id));
    const groupIds = nodeIds.filter((id) => byGroup.has(id));
    const normalGroupIds = groupIds.filter((id) => !isSpecialGroup(byGroup.get(id)!));
    const specialGroupIds = groupIds.filter((id) => isSpecialGroup(byGroup.get(id)!));
    const subGroups = new Set<string>(), subNodes = new Set<string>();
    for (const gid of normalGroupIds) {
      const sub = groupSubtree(g.groups, gid);
      sub.groupIds.forEach((id) => subGroups.add(id));
      sub.nodeIds.forEach((id) => subNodes.add(id));
    }
    const realNodes = groupMode === 'contents'
      ? [...new Set([...nodeIds.filter((id) => nodeSet.has(id)), ...[...subNodes].filter((id) => nodeSet.has(id))])]
      : nodeIds.filter((id) => nodeSet.has(id) && !subNodes.has(id));
    const dropGroups = groupMode === 'contents' ? [...subGroups] : [];
    const dropSet = new Set(realNodes);
    const edgeSet = new Set(g.edges.map((e) => e.id));
    const standaloneEdges = edgeIds.filter((id) => {
      if (!edgeSet.has(id)) return false;
      const e = g.edges.find((x) => x.id === id);
      return Boolean(e && !dropSet.has(e.source) && !dropSet.has(e.target));
    });
    if (!groupIds.length && !realNodes.length && !standaloneEdges.length) return;
    beforeDelete?.();
    const h = openHistoryGroup(sessionId);
    try {
      for (const gid of specialGroupIds) ungroup(sessionId, gid);
      if (groupMode === 'contents') {
        if (realNodes.length || dropGroups.length) deleteNodes(sessionId, realNodes, dropGroups);
      } else {
        for (const gid of normalGroupIds) ungroup(sessionId, gid);
        if (realNodes.length) deleteNodes(sessionId, realNodes);
      }
      if (standaloneEdges.length) void disconnectEdges(sessionId, standaloneEdges);
    } finally {
      h.close();
    }
    afterDeleteRef.current([...groupIds, ...dropGroups, ...realNodes], edgeIds);
  }, [sessionId]);
  const askOrRun = (nodeIds: string[], edgeIds: string[] = [], beforeDelete?: () => void) => {
    const groups = nonEmptyGroups(nodeIds);
    if (groups.length) { setAsk({ nodes: nodeIds, edges: edgeIds, groups, beforeDelete }); return; }
    if (needsConfirm(nodeIds)) { setAsk({ nodes: nodeIds, edges: edgeIds, beforeDelete }); return; }
    runDelete(nodeIds, edgeIds, beforeDelete);
  };
  const request = (nodeIds: string[], edgeIds: string[] = [], beforeDelete?: () => void) => askOrRun(nodeIds, edgeIds, beforeDelete);
  const card = useMemo(() => {
    if (!ask || !graph) return null;
    if (ask.groups?.length) {
      const names = ask.groups.map((id) => graph.groups?.find((gr) => gr.id === id)?.title ?? id).join(', ');
      return (
        <Panel position="top-center" className="link-bar confirm-pop" role="alertdialog" aria-label="Delete group">
          <p>Delete <strong>{names}</strong>?</p>
          <div className="spend-actions">
            <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
            <Button variant="secondary" onClick={() => { runDelete(ask.nodes, ask.edges, ask.beforeDelete, 'ungroup'); setAsk(null); }}>Ungroup</Button>
            <Button variant="danger" onClick={() => { runDelete(ask.nodes, ask.edges, ask.beforeDelete, 'contents'); setAsk(null); }}>Delete with contents</Button>
          </div>
        </Panel>
      );
    }
    const names = ask.nodes.map((id) => graph.nodes.find((n) => n.id === id)?.data.title ?? id).join(', ');
    const links = graph.edges.filter((e) => ask.nodes.includes(e.source) || ask.nodes.includes(e.target)).length;
    return (
      <Panel position="top-center" className="link-bar confirm-pop" role="alertdialog" aria-label="Remove from canvas">
        <p>Remove <strong>{names}</strong> from the canvas? It only takes the node off the canvas; the data stays where it is. {links} link{links === 1 ? '' : 's'} (models included) will be detached.</p>
        <div className="spend-actions">
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { runDelete(ask.nodes, ask.edges, ask.beforeDelete); setAsk(null); }}>Remove</Button>
        </div>
      </Panel>
    );
  }, [ask, graph, runDelete]);
  /** React Flow's Delete key: handle node/edge deletion atomically so node+link restore in one undo step. */
  const before = async ({ nodes, edges }: { nodes: Array<{ id: string }>; edges: Array<{ id: string }> }) => {
    const nodeIds = nodes.map((n) => n.id);
    const edgeIds = edges.map((e) => e.id);
    if (!nodeIds.length && !edgeIds.length) return false;
    askOrRun(nodeIds, edgeIds);
    return false;
  };
  return { request, card, before };
}
