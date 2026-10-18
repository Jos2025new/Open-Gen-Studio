import { uid } from '../../lib/id';
import { setGraph, toast, useStore } from '../../store/store';
import { isAutoOption, matchInputOption, nearestAspect, paramByRole } from '../params';
import type { GraphNode, GraphNodeData } from '../types';
import { connect, connectionError, estimatedHeight, inputPorts, NODE_WIDTH, nodeOutputAsset, outputPort, portFits } from './graph';
import { graphEditProblem } from './locks';

const get = useStore.getState;

/** Add a node to the right of `fromId`, wired to its first input that accepts the source's output. */
/** `at`: where to put it (a connection dropped on empty canvas); otherwise to the right of the source, below its other children. */
export function addConnected(sessionId: string, fromId: string, data: GraphNodeData, at?: { x: number; y: number }): string | null {
  const st = get();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph) return null;
  const from = graph.nodes.find((n) => n.id === fromId);
  if (!from) return null;
  const type = outputPort(from.data, st.assets);
  const port = inputPorts(data).find((p) => p.type === type) ?? inputPorts(data).find((p) => portFits(type, p.type));
  if (!port) return null;
  // A node of the same kind keeps the source's current model and settings.
  if ('modelRef' in data && 'modelRef' in from.data && from.data.kind === data.kind) {
    data = { ...data, modelRef: from.data.modelRef, settings: { ...structuredClone(from.data.settings), seed: undefined } } as GraphNodeData;
  }
  // A node made from an image keeps that image's shape, not the composer's format.
  const src = st.assets[nodeOutputAsset(from, st.generations) ?? ''];
  const view = src?.kind === 'model3d' ? st.assets[src.viewImageId ?? ''] : src;
  if ((data.kind === 'image' || data.kind === 'video') && view?.kind === 'image' && view.width && view.height) {
    const options = paramByRole(st.catalog.schemas[data.modelRef], 'aspect')?.options ?? [];
    const aspect = matchInputOption(options) ?? nearestAspect(options.filter((o) => !isAutoOption(o)), `${view.width}:${view.height}`);
    if (aspect) data = { ...data, settings: { ...data.settings, aspect } };
  }
  // Stack below the nodes this one already feeds, so new cards never land on top of them.
  const children = graph.edges.filter((e) => e.source === fromId).map((e) => graph.nodes.find((n) => n.id === e.target)).filter((n): n is GraphNode => Boolean(n));
  const y = children.length ? Math.max(...children.map((n) => n.position.y + estimatedHeight(n.data))) + 60 : from.position.y;
  const id = uid('nd');
  const next = { ...graph, nodes: [...graph.nodes, { id, data, position: at ?? { x: from.position.x + NODE_WIDTH + 100, y } }] };
  const edge = { source: fromId, target: id, targetHandle: port.id };
  if (connectionError(next, st.assets, edge)) return null;
  // The picker is one action: rejected connections leave no orphan, and Undo removes node and edge together.
  const connected = connect(next, edge);
  const error = graphEditProblem(sessionId, graph, connected);
  if (error) { toast(error, 'error'); return null; }
  setGraph(sessionId, () => connected);
  return id;
}
