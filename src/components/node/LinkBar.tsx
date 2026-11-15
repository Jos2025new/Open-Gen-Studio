import { useMemo, useState } from 'react';
import { Panel, type Edge } from '@xyflow/react';
import { disconnectEdges, deleteNodes } from '../../engine/flow/actions';
import { GONE_HANDLE, NO_RESULT, outputPort, resultHandle } from '../../engine/flow/graph';
import { setLinkBoth } from '../../engine/nodes/system';
import type { Asset, Graph } from '../../engine/types';
import { useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { linkClassProps } from './SystemNode';

/* The canvas's links and the removal of system nodes: the edges React Flow draws, a bar for the selected link (Both,
 * Remove) and the contextual confirmation before a system node that holds model links is taken off the canvas. */

export function flowEdges(graph: Graph, assets: Record<string, Asset>, running: Set<string>, selected: Set<string>): Edge[] {
  return graph.edges.map((e) => {
    const src = graph.nodes.find((n) => n.id === e.source);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.outputIndex == null ? e.sourceHandle : e.outputIndex === NO_RESULT ? GONE_HANDLE : resultHandle(e.outputIndex),
      targetHandle: e.targetHandle,
      ...linkClassProps(e, src ? outputPort(src.data, assets) : null),
      animated: running.has(e.target),
      selected: selected.has(e.id),
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

/** A system node is a pointer: removing it only takes it off the canvas. When it holds model links, ask first. */
export function useDeleteRequest(sessionId: string, afterDelete: () => void) {
  const [ask, setAsk] = useState<string[] | null>(null);
  const graph = useStore((s) => s.sessions[sessionId]?.graph);
  const needsConfirm = (ids: string[]) => {
    if (!graph) return false;
    const model = (id: string) => { const d = graph.nodes.find((n) => n.id === id)?.data; return d?.kind === 'ref' && d.type === 'model'; };
    return ids.some((id) => {
      const d = graph.nodes.find((n) => n.id === id)?.data;
      return d?.kind === 'ref' && graph.edges.some((e) => (e.kind ?? 'data') === 'control' && (e.source === id || e.target === id) && (model(e.source) || model(e.target)));
    });
  };
  const request = (ids: string[]) => {
    if (needsConfirm(ids)) setAsk(ids);
    else { deleteNodes(sessionId, ids); afterDelete(); }
  };
  const card = useMemo(() => {
    if (!ask || !graph) return null;
    const names = ask.map((id) => graph.nodes.find((n) => n.id === id)?.data.title ?? id).join(', ');
    const links = graph.edges.filter((e) => ask.includes(e.source) || ask.includes(e.target)).length;
    return (
      <Panel position="top-center" className="link-bar confirm-pop" role="alertdialog" aria-label="Remove from canvas">
        <p>Remove <strong>{names}</strong> from the canvas? It only takes the node off the canvas; the data stays where it is. {links} link{links === 1 ? '' : 's'} (models included) will be detached.</p>
        <div className="spend-actions">
          <Button variant="ghost" onClick={() => setAsk(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => { deleteNodes(sessionId, ask); setAsk(null); afterDelete(); }}>Remove</Button>
        </div>
      </Panel>
    );
  }, [ask, graph, sessionId]);
  /** React Flow's Delete key: ask first when needed, and cancel its own removal. */
  const before = async ({ nodes }: { nodes: Array<{ id: string }> }) => {
    if (!nodes.length || !needsConfirm(nodes.map((n) => n.id))) return true;
    setAsk(nodes.map((n) => n.id));
    return false;
  };
  return { request, card, before };
}
