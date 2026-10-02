import { canvasIndex } from '../canvas';
import { OPS } from '../ops';
import { uid } from '../../lib/id';
import type { Generation, GraphEdge, GraphNode, GraphNodeData } from '../types';
import { setGraph, useStore } from '../../store/store';
import { autoLayout, NODE_WIDTH } from './graph';

const get = () => useStore.getState();

/** Finished chat generations of the session not yet on the node canvas, oldest first. */
export function chatWorkNotInNodes(sessionId: string): Generation[] {
  const st = get();
  const s = st.sessions[sessionId];
  if (!s) return [];
  const index = canvasIndex(s, st.generations);
  const onCanvas = new Set(s.graph.nodes.map((n) => ('generationId' in n.data ? n.data.generationId : undefined)).filter(Boolean));
  return Object.values(st.generations)
    .filter((g) => g.sessionId === sessionId && g.status === 'done' && (g.assetIds.length || g.text != null) && !onCanvas.has(g.id) && index.generation(g) === 'chat')
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The chat's work as nodes: each generation a node with its own result, prompt, model and settings, connected by
 * the inputs it used (references, start and end frames, the operation's source); the user's images as Asset nodes.
 * Nodes carry the stored request unchanged, so they count as up to date: nothing runs again unless edited.
 * Operations the node canvas cannot run (join_clips, mask edits) come in as their result. No calls, no cost.
 */
export function chatToNodes(sessionId: string): { added: GraphNode[]; edges: GraphEdge[] } {
  const st = get();
  const s = st.sessions[sessionId];
  const gens = chatWorkNotInNodes(sessionId);
  if (!s || !gens.length) return { added: [], edges: [] };

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  // Asset → the node that delivers it (existing graph first, then what is added here).
  const source = new Map<string, string>();
  for (const n of s.graph.nodes) {
    const d = n.data;
    if (d.kind === 'asset' && d.assetId) source.set(d.sketchAssetId ?? d.assetId, n.id);
    else if ('generationId' in d && d.generationId) {
      const out = st.generations[d.generationId]?.assetIds[d.outputIndex];
      if (out) source.set(d.sketchAssetId ?? out, n.id);
    }
  }
  const nodeOfGen = new Map<string, GraphNode>();
  const assetNode = (assetId: string): string => {
    const known = source.get(assetId);
    if (known) return known;
    const id = uid('nd');
    nodes.push({ id, position: { x: 0, y: 0 }, data: { kind: 'asset', title: 'Asset', assetId } });
    source.set(assetId, id);
    return id;
  };
  // A result used downstream: its generation's node when that node can show it (one output index per node).
  const from = (assetId: string): string => {
    const known = source.get(assetId);
    if (known) return known;
    const g = st.assets[assetId]?.generationId ? st.generations[st.assets[assetId].generationId!] : undefined;
    const n = g ? nodeOfGen.get(g.id) : undefined;
    if (n && 'outputIndex' in n.data && !edges.some((e) => e.source === n.id)) {
      for (const [a, nid] of source) if (nid === n.id) source.delete(a);
      n.data.outputIndex = g!.assetIds.indexOf(assetId);
      source.set(assetId, n.id);
      return n.id;
    }
    return assetNode(assetId);
  };
  const link = (assetId: string | undefined, target: string, handle: string) => {
    if (assetId && st.assets[assetId]) edges.push({ id: uid('edge'), source: from(assetId), target, sourceHandle: 'out', targetHandle: handle });
  };

  for (const g of gens) {
    const op = g.op ? OPS[g.op.id] : undefined;
    let data: GraphNodeData;
    if (g.kind === 'text') data = { kind: 'text', title: 'Text', text: g.text ?? '' };
    else if (op && (op.multiInput || op.viaSketch)) {
      // Not runnable on the node canvas: its result, as an asset.
      g.assetIds.forEach((a) => assetNode(a));
      continue;
    } else if (g.op) data = { kind: 'tool', title: op?.label ?? g.op.id, op: g.op.id, params: structuredClone(g.op.params), generationId: g.id, outputIndex: 0 };
    else data = { kind: g.kind, title: g.prompt.split(/[.,\n]/)[0].slice(0, 40) || 'Result', prompt: g.prompt, modelRef: g.modelRef, settings: structuredClone(g.settings), generationId: g.id, outputIndex: 0 };
    const id = uid('nd');
    const node: GraphNode = { id, position: { x: 0, y: 0 }, data };
    nodes.push(node);
    nodeOfGen.set(g.id, node);
    if (g.op) link(g.op.sourceAssetId, id, 'input');
    else if (g.kind !== 'text') {
      link(g.inputs.firstFrame, id, 'first');
      link(g.inputs.lastFrame, id, 'last');
      for (const r of g.inputs.refs) {
        const k = st.assets[r]?.kind;
        const port = g.kind === 'video' ? (k === 'audio' ? 'audio' : k === 'video' ? 'refVideo' : 'ref') : k === 'video' ? 'clip' : 'ref';
        link(r, id, port);
      }
    }
    // Every result is reachable from its node: the first one shows unless a later step picks another.
    g.assetIds.forEach((a, i) => {
      if (!source.has(a) && i === 0) source.set(a, id);
    });
  }

  // To the right of what is already on the canvas, laid out left to right by dependency.
  const right = s.graph.nodes.reduce((x, n) => Math.max(x, n.position.x + NODE_WIDTH), -Infinity);
  const top = s.graph.nodes.reduce((y, n) => Math.min(y, n.position.y), Infinity);
  const pos = autoLayout(nodes, edges, { x: Number.isFinite(right) ? right + 200 : 0, y: Number.isFinite(top) ? top : 0 });
  for (const n of nodes) n.position = pos.get(n.id) ?? n.position;
  setGraph(sessionId, (graph) => ({ ...graph, nodes: [...graph.nodes, ...nodes], edges: [...graph.edges, ...edges] }));
  return { added: nodes, edges };
}
