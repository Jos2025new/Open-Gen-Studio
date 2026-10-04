import { uid } from '../../lib/id';
import type { Graph, GraphEdge, GraphGroup, GraphNode, GenNodeData } from '../types';
import { setGraph, toast, useStore } from '../../store/store';
import { connect, connectionError, inputPorts, NODE_WIDTH, runsGeneration } from './graph';
import { deleteNodes } from './actions';
import { graphEditProblem } from './locks';

/*
 * Several selected nodes: align and distribute them, group them under a frame, copy, cut and paste them.
 * Pure helpers work on a Graph; the store versions apply them to the session.
 */

const get = () => useStore.getState();

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v';
/** Align to the selection's own box, or to the first node selected (it stays put). */
export type AlignTo = 'selection' | 'first';
export type Sizes = Map<string, { width: number; height: number }>;

const sizeOf = (n: GraphNode, sizes: Sizes) => sizes.get(n.id) ?? { width: NODE_WIDTH, height: 220 };

/** New positions for `ids` (in selection order): alignment by edges or centers, or even gaps between them. */
export function alignPositions(graph: Graph, ids: string[], mode: AlignMode, to: AlignTo, sizes: Sizes): Map<string, { x: number; y: number }> {
  const nodes = ids.map((id) => graph.nodes.find((n) => n.id === id)).filter((n): n is GraphNode => Boolean(n));
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 2) return out;
  const box = (n: GraphNode) => {
    const s = sizeOf(n, sizes);
    return { l: n.position.x, t: n.position.y, r: n.position.x + s.width, b: n.position.y + s.height, w: s.width, h: s.height };
  };
  const boxes = nodes.map(box);
  const ref = to === 'first'
    ? boxes[0]
    : { l: Math.min(...boxes.map((b) => b.l)), t: Math.min(...boxes.map((b) => b.t)), r: Math.max(...boxes.map((b) => b.r)), b: Math.max(...boxes.map((b) => b.b)), w: 0, h: 0 };
  if (mode === 'distribute-h' || mode === 'distribute-v') {
    const h = mode === 'distribute-h';
    const order = nodes.map((n, i) => ({ n, b: boxes[i] })).sort((a, z) => (h ? a.b.l - z.b.l : a.b.t - z.b.t));
    if (order.length < 3) return out;
    const first = order[0].b, last = order[order.length - 1].b;
    const span = h ? last.r - first.l : last.b - first.t;
    const used = order.reduce((sum, o) => sum + (h ? o.b.w : o.b.h), 0);
    const gap = (span - used) / (order.length - 1);
    let at = h ? first.l : first.t;
    for (const o of order) {
      out.set(o.n.id, h ? { x: at, y: o.n.position.y } : { x: o.n.position.x, y: at });
      at += (h ? o.b.w : o.b.h) + gap;
    }
    return out;
  }
  nodes.forEach((n, i) => {
    const b = boxes[i];
    if (to === 'first' && i === 0) return;
    const x = mode === 'left' ? ref.l : mode === 'right' ? ref.r - b.w : mode === 'center' ? (ref.l + ref.r) / 2 - b.w / 2 : n.position.x;
    const y = mode === 'top' ? ref.t : mode === 'bottom' ? ref.b - b.h : mode === 'middle' ? (ref.t + ref.b) / 2 - b.h / 2 : n.position.y;
    out.set(n.id, { x, y });
  });
  return out;
}

export function alignNodes(sessionId: string, ids: string[], mode: AlignMode, to: AlignTo, sizes: Sizes): void {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return;
  const pos = alignPositions(graph, ids, mode, to, sizes);
  if (pos.size) setGraph(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) }));
}

/** The group every one of `ids` is in, when they are exactly one whole group. */
export function wholeGroup(graph: Graph, ids: string[]): GraphGroup | undefined {
  const g = graph.groups?.find((x) => x.nodeIds.includes(ids[0]));
  return g && g.nodeIds.length === ids.length && ids.every((id) => g.nodeIds.includes(id)) ? g : undefined;
}

/** Group the nodes (they leave any group they were in). Returns the group id. */
export function groupNodes(sessionId: string, ids: string[], title?: string): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph || ids.length < 2) return null;
  if (ids.some(id => detachedOutputGroup(graph, id))) { toast('Reattach these outputs before changing their group.', 'error'); return null; }
  const id = uid('grp');
  const n = (graph.groups?.length ?? 0) + 1;
  const kept = (graph.groups ?? []).map((g) => ({ ...g, nodeIds: g.nodeIds.filter((x) => !ids.includes(x)) })).filter((g) => g.nodeIds.length > 1 || (g.nodeIds.length > 0 && 'detachedOutputs' in g));
  setGraph(sessionId, (g) => ({ ...g, groups: [...kept, { id, title: title ?? `Group ${n}`, nodeIds: [...ids] }] }));
  return id;
}

export function ungroup(sessionId: string, groupId: string): void {
  const graph = get().sessions[sessionId]?.graph;
  if (graph?.groups?.some(g => g.id === groupId && 'detachedOutputs' in g)) { reattachOutputs(sessionId, groupId); return; }
  setGraph(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).filter((x) => x.id !== groupId) }));
}

export function renameGroup(sessionId: string, groupId: string, title: string): void {
  const t = title.trim().slice(0, 80);
  if (t) setGraph(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((x) => (x.id === groupId ? { ...x, title: t } : x)) }));
}

export function setGroupColor(sessionId: string, groupId: string, color: string | undefined): void {
  setGraph(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((x) => (x.id === groupId ? { ...x, color } : x)) }));
}

/** The frame around a group's nodes (flow coordinates), from their real sizes: it follows them as they move. */
export function groupBounds(graph: Graph, group: GraphGroup, sizes: Sizes, pad = 28): { x: number; y: number; width: number; height: number } | null {
  const members = graph.nodes.filter((n) => group.nodeIds.includes(n.id));
  if (!members.length) return null;
  const l = Math.min(...members.map((n) => n.position.x)) - pad;
  const t = Math.min(...members.map((n) => n.position.y)) - pad - 18;
  const r = Math.max(...members.map((n) => n.position.x + sizeOf(n, sizes).width)) + pad;
  const b = Math.max(...members.map((n) => n.position.y + sizeOf(n, sizes).height)) + pad;
  return { x: l, y: t, width: r - l, height: b - t };
}

/** Move every node of a group by (dx, dy). */
export function moveGroup(sessionId: string, groupId: string, dx: number, dy: number): void {
  setGraph(sessionId, (g) => {
    const members = new Set(g.groups?.find((x) => x.id === groupId)?.nodeIds ?? []);
    return { ...g, nodes: g.nodes.map((n) => (members.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)) };
  });
}

// ---------------------------------------------------------------------------
// Clipboard (inside the app: nodes with their parameters, the links between them and the inputs from outside)

interface Clip {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
let clip: Clip | null = null;

export function hasNodeClipboard(): boolean {
  return Boolean(clip?.nodes.length);
}

export function copyNodes(sessionId: string, ids: string[]): number {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 0;
  const set = new Set(ids);
  clip = { nodes: structuredClone(graph.nodes.filter((n) => set.has(n.id))), edges: structuredClone(graph.edges.filter((e) => set.has(e.target))) };
  return clip.nodes.length;
}

export function cutNodes(sessionId: string, ids: string[]): number {
  const n = copyNodes(sessionId, ids);
  if (n) deleteNodes(sessionId, ids);
  return n;
}

/**
 * Paste the clipboard: new ids, a little offset (or at `at`), the links between the pasted nodes, and the inputs
 * from nodes still on the canvas. A generation node comes without its result (it is a new node to run); an asset
 * node keeps its image. Returns the new ids.
 */
export function pasteNodes(sessionId: string, at?: { x: number; y: number }): string[] {
  const st = get();
  const graph = st.sessions[sessionId]?.graph;
  if (!graph || !clip?.nodes.length) return [];
  const minX = Math.min(...clip.nodes.map((n) => n.position.x));
  const minY = Math.min(...clip.nodes.map((n) => n.position.y));
  const offset = at ? { x: at.x - minX, y: at.y - minY } : { x: 60, y: 60 };
  const ids = new Map(clip.nodes.map((n) => [n.id, uid('nd')]));
  const added: GraphNode[] = clip.nodes.map((n) => {
    const data = structuredClone(n.data);
    if (runsGeneration(data)) {
      delete (data as GenNodeData).generationId;
      delete (data as GenNodeData).sketchAssetId;
      (data as GenNodeData).outputIndex = 0;
    }
    return { id: ids.get(n.id)!, position: { x: n.position.x + offset.x, y: n.position.y + offset.y }, data };
  });
  let next: Graph = { ...graph, nodes: [...graph.nodes, ...added] };
  for (const e of clip.edges) {
    const source = ids.get(e.source) ?? (graph.nodes.some((n) => n.id === e.source) ? e.source : undefined);
    const target = ids.get(e.target);
    if (!source || !target) continue;
    const c = { source, target, targetHandle: e.targetHandle };
    const port = inputPorts(added.find((n) => n.id === target)!.data).find((p) => p.id === e.targetHandle);
    if (port && !connectionError(next, st.assets, c)) next = connect(next, c);
  }
  setGraph(sessionId, () => next);
  return added.map((n) => n.id);
}

// Detached cards share their existing generation, while the selected card keeps the original node ID.
interface OutputSnapshot {
  node: GraphNode;
  nodeIndex: number;
  edges: Array<{ edge: GraphEdge; index: number }>;
  previousGroup?: { group: GraphGroup; index: number };
  hadGroups: boolean;
  copiedInputIds: string[];
}
export type DetachedOutputGroup = GraphGroup & { detachedOutputs: OutputSnapshot };

export function detachedOutputGroup(graph: Graph | undefined, nodeId: string): DetachedOutputGroup | undefined {
  return graph?.groups?.find(g => g.nodeIds.includes(nodeId) && 'detachedOutputs' in g) as DetachedOutputGroup | undefined;
}

export function detachOutputs(sessionId: string, nodeId: string): string[] {
  const state = get(), graph = state.sessions[sessionId]?.graph;
  const node = graph?.nodes.find(n => n.id === nodeId);
  if (!graph || !node || !runsGeneration(node.data) || detachedOutputGroup(graph, nodeId)) return [];
  const data = node.data as GenNodeData;
  const generation = data.generationId && state.generations[data.generationId];
  if (!generation || generation.status !== 'done' || generation.assetIds.length < 2 || data.sketchAssetId) return [];
  if (data.outputIndex < 0 || data.outputIndex >= generation.assetIds.length) return [];
  const cards: GraphNode[] = generation.assetIds.map((_, outputIndex) => ({
    ...structuredClone(node),
    id: outputIndex === data.outputIndex ? node.id : uid('nd'),
    position: { x: node.position.x + (outputIndex - data.outputIndex) * (NODE_WIDTH + 60), y: node.position.y },
    data: { ...structuredClone(data), outputIndex },
  }));
  const inputs = graph.edges.filter(e => e.target === nodeId);
  const copied = cards.filter(n => n.id !== nodeId).flatMap(n => inputs.map(e => ({ ...e, id: uid('edge'), target: n.id })));
  const previousIndex = graph.groups?.findIndex(g => g.nodeIds.includes(nodeId)) ?? -1;
  const group: DetachedOutputGroup = {
    id: uid('grp'), title: node.data.title, nodeIds: cards.map(n => n.id),
    detachedOutputs: {
      node: structuredClone(node), nodeIndex: graph.nodes.indexOf(node),
      edges: graph.edges.flatMap((edge, index) => edge.source === nodeId || edge.target === nodeId ? [{ edge: structuredClone(edge), index }] : []),
      previousGroup: previousIndex < 0 ? undefined : { group: structuredClone(graph.groups![previousIndex]), index: previousIndex },
      hadGroups: graph.groups !== undefined, copiedInputIds: copied.map(e => e.id),
    },
  };
  const groups = (graph.groups ?? []).map(g => g.nodeIds.includes(nodeId) ? { ...g, nodeIds: g.nodeIds.filter(id => id !== nodeId) } : g).filter(g => g.nodeIds.length > 1 || (g.nodeIds.length > 0 && 'detachedOutputs' in g));
  const next = { ...graph, nodes: graph.nodes.flatMap(n => n.id === nodeId ? cards : [n]), edges: [...graph.edges, ...copied], groups: [...groups, group] };
  const problem = graphEditProblem(sessionId, graph, next);
  if (problem) { toast(problem, 'error'); return []; }
  setGraph(sessionId, () => next);
  return group.nodeIds;
}

export function reattachOutputs(sessionId: string, groupId: string): void {
  const state = get(), graph = state.sessions[sessionId]?.graph;
  const group = graph?.groups?.find(g => g.id === groupId && 'detachedOutputs' in g) as DetachedOutputGroup | undefined;
  if (!graph || !group) return;
  const saved = group.detachedOutputs, members = new Set(group.nodeIds);
  const originalIds = new Set(saved.edges.map(e => e.edge.id));
  const copiedIds = new Set(saved.copiedInputIds);
  const touches = (edge: GraphEdge) => members.has(edge.source) || members.has(edge.target);
  const additions = graph.edges.filter(e => touches(e) && !originalIds.has(e.id) && !copiedIds.has(e.id));
  const next: Graph = { ...graph,
    nodes: graph.nodes.filter(n => !members.has(n.id)),
    edges: graph.edges.filter(e => !touches(e) && !originalIds.has(e.id) && !copiedIds.has(e.id)),
    groups: graph.groups?.filter(g => g.id !== groupId),
  };
  next.nodes.splice(saved.nodeIndex, 0, structuredClone(saved.node));
  const live = new Set(next.nodes.map(n => n.id));
  for (const { edge, index } of saved.edges) {
    if (live.has(edge.source) && live.has(edge.target)) next.edges.splice(index, 0, structuredClone(edge));
  }
  if (saved.previousGroup) {
    const previous = saved.previousGroup.group;
    const current = next.groups?.find(g => g.id === previous.id);
    const restored = { ...structuredClone(previous), nodeIds: [...new Set([...previous.nodeIds, ...(current?.nodeIds ?? [])])].filter(id => live.has(id)) };
    next.groups = next.groups?.filter(g => g.id !== previous.id) ?? [];
    next.groups.splice(saved.previousGroup.index, 0, restored);
  }
  if (!saved.hadGroups && !next.groups?.length) delete next.groups;
  const skipped: string[] = [];
  for (const added of additions) {
    const edge = { ...added, source: members.has(added.source) ? saved.node.id : added.source, target: members.has(added.target) ? saved.node.id : added.target };
    if (next.edges.some(e => e.source === edge.source && e.target === edge.target && e.targetHandle === edge.targetHandle && e.sourceHandle === edge.sourceHandle)) continue;
    const target = next.nodes.find(n => n.id === edge.target);
    const port = target && inputPorts(target.data).find(p => p.id === edge.targetHandle);
    const occupied = port && !port.multi && next.edges.some(e => e.target === edge.target && e.targetHandle === edge.targetHandle);
    const problem = occupied ? 'input port already connected' : connectionError(next, state.assets, edge);
    if (problem) skipped.push(`${edge.id}: ${problem}`);
    else next.edges.push(edge);
  }
  const problem = graphEditProblem(sessionId, graph, next);
  if (problem) { toast(problem, 'error'); return; }
  setGraph(sessionId, () => next);
  if (skipped.length) toast(`Could not keep ${skipped.length} new connection(s): ${skipped.join('; ')}`, 'error');
}
