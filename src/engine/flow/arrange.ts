import { uid } from '../../lib/id';
import type { Graph, GraphEdge, GraphGroup, GraphNode, GenNodeData } from '../types';
import { toast, useStore } from '../../store/store';
import { editCompound, editPresentation } from '../nodecore/edit';
import { connectionError, inputPorts, NODE_WIDTH, runsGeneration } from './graph';
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
  if (pos.size) editPresentation(sessionId, (g) => ({ ...g, nodes: g.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n)) }));
}

export type GroupRect = { x: number; y: number; width: number; height: number };
export const DEFAULT_GROUP_BOUNDS: GroupRect = { x: 0, y: 0, width: 320, height: 220 };

/** Ancestor chain of `id` (self first); stops on missing parent or cycle (like objectGroupTree.ts). */
export function groupChain(groups: readonly GraphGroup[] | undefined, id: string | undefined): GraphGroup[] {
  if (!groups?.length || !id) return [];
  const byId = new Map(groups.map((g) => [g.id, g])), out: GraphGroup[] = [];
  for (let g = byId.get(id); g && !out.includes(g); g = g.parentId ? byId.get(g.parentId) : undefined) out.push(g);
  return out;
}

/** Group `id` and all descendant groups/nodes (cycle-safe; unknown parentId is ignored). */
export function groupSubtree(groups: readonly GraphGroup[] | undefined, id: string) {
  const groupIds = new Set<string>(), nodeIds = new Set<string>();
  const byId = new Map((groups ?? []).map((g) => [g.id, g]));
  const q = byId.has(id) ? [id] : [];
  for (const cur of q) {
    if (groupIds.has(cur)) continue;
    groupIds.add(cur);
    for (const nid of byId.get(cur)!.nodeIds) nodeIds.add(nid);
    for (const g of groups ?? []) if (g.parentId === cur && !groupIds.has(g.id)) q.push(g.id);
  }
  return { groupIds, nodeIds };
}

export const isEmptyGroup = (groups: readonly GraphGroup[] | undefined, g: GraphGroup): boolean =>
  !g.nodeIds.length && !(groups ?? []).some((c) => c.parentId === g.id && c.id !== g.id);

export const isSpecialGroup = (g: GraphGroup): boolean =>
  'detachedOutputs' in g || g.id.startsWith('grp_sys_') || g.id.startsWith('sys_grp_');

/** The group every one of `ids` is in, when they are exactly one whole group. */
export function wholeGroup(graph: Graph, ids: string[]): GraphGroup | undefined {
  const g = graph.groups?.find((x) => x.nodeIds.includes(ids[0]));
  return g && g.nodeIds.length === ids.length && ids.every((id) => g.nodeIds.includes(id)) ? g : undefined;
}

/** Group nodes and/or whole groups (they leave any group they were in). Optional `parentId` nests it; cycles rejected. */
export function groupNodes(sessionId: string, ids: string[], title?: string, parentId?: string): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return null;
  const groupSet = new Set((graph.groups ?? []).map((g) => g.id));
  const rawGids = ids.filter((id) => groupSet.has(id));
  const topGids = rawGids.filter((gid) => !groupChain(graph.groups, gid).slice(1).some((a) => rawGids.includes(a.id)));
  const covered = new Set(topGids.flatMap((gid) => [...groupSubtree(graph.groups, gid).nodeIds]));
  const looseNids = ids.filter((id) => !groupSet.has(id) && !covered.has(id) && graph.nodes.some((n) => n.id === id));
  if (topGids.length + looseNids.length < 2) return null;
  if (looseNids.some((id) => detachedOutputGroup(graph, id)) || topGids.some((gid) => 'detachedOutputs' in (graph.groups!.find((g) => g.id === gid) ?? {}))) {
    toast('Reattach these outputs before changing their group.', 'error');
    return null;
  }
  const parent = parentId && groupSet.has(parentId) ? parentId : undefined;
  if (parent && topGids.some((gid) => groupChain(graph.groups, parent).some((a) => a.id === gid))) return null;
  const id = uid('grp'), n = (graph.groups?.length ?? 0) + 1;
  const topSet = new Set(topGids);
  const kept = (graph.groups ?? [])
    .map((g) => (topSet.has(g.id) ? { ...g, parentId: id } : { ...g, nodeIds: g.nodeIds.filter((x) => !looseNids.includes(x)) }))
    .filter((g) => !('detachedOutputs' in g) || g.nodeIds.length > 0);
  editPresentation(sessionId, (g) => ({ ...g, groups: [...kept, { id, title: title ?? `Group ${n}`, nodeIds: [...looseNids], ...(parent ? { parentId: parent } : {}) }] }));
  return id;
}

/** Nest `groupId` inside `parentId` (or move to root when absent/unknown). Rejects cycles. */
export function reparentGroup(sessionId: string, groupId: string, parentId?: string): boolean {
  const graph = get().sessions[sessionId]?.graph;
  const g = graph?.groups?.find((x) => x.id === groupId);
  if (!graph || !g || 'detachedOutputs' in g) return false;
  const nextParent = parentId && graph.groups?.some((x) => x.id === parentId) ? parentId : undefined;
  if (nextParent && groupChain(graph.groups, nextParent).some((x) => x.id === groupId)) return false;
  if (g.parentId === nextParent) return true;
  editPresentation(sessionId, (cur) => ({
    ...cur,
    groups: (cur.groups ?? []).map((x) => {
      if (x.id !== groupId) return x;
      const { parentId: _, ...rest } = x;
      return nextParent ? { ...rest, parentId: nextParent } : rest;
    }),
  }));
  return true;
}

/** Create an empty group frame at `at` (survives empty, moves, resizes and deletes without prompt). */
export function createEmptyGroup(sessionId: string, at?: { x: number; y: number }, title?: string, parentId?: string): string | null {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return null;
  const id = uid('grp'), n = (graph.groups?.length ?? 0) + 1;
  const bounds: GroupRect = { x: Math.round(at?.x ?? 0), y: Math.round(at?.y ?? 0), width: DEFAULT_GROUP_BOUNDS.width, height: DEFAULT_GROUP_BOUNDS.height };
  const parent = parentId && graph.groups?.some((g) => g.id === parentId) ? parentId : undefined;
  editPresentation(sessionId, (g) => ({ ...g, groups: [...(g.groups ?? []), { id, title: title ?? `Group ${n}`, nodeIds: [], bounds, ...(parent ? { parentId: parent } : {}) }] }));
  return id;
}

export function resizeGroup(sessionId: string, groupId: string, bounds: GroupRect): void {
  const next: GroupRect = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.max(160, Math.round(bounds.width)), height: Math.max(100, Math.round(bounds.height)) };
  editPresentation(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((x) => (x.id === groupId ? { ...x, bounds: next } : x)) }));
}

/** Remove a group frame; its direct nodes and subgroups move up to its parent (or root). Detached outputs reattach. */
export function ungroup(sessionId: string, groupId: string): void {
  const graph = get().sessions[sessionId]?.graph;
  if (graph?.groups?.some((g) => g.id === groupId && 'detachedOutputs' in g)) { reattachOutputs(sessionId, groupId); return; }
  editPresentation(sessionId, (g) => {
    const target = g.groups?.find((x) => x.id === groupId);
    if (!target) return g;
    const parentId = target.parentId && g.groups?.some((x) => x.id === target.parentId && x.id !== groupId) ? target.parentId : undefined;
    const groups = (g.groups ?? []).flatMap((x) => {
      if (x.id === groupId) return [];
      if (parentId && x.id === parentId) return [{ ...x, nodeIds: [...new Set([...x.nodeIds, ...target.nodeIds])] }];
      if (x.parentId !== groupId) return [x];
      const { parentId: _, ...rest } = x;
      return [parentId ? { ...rest, parentId } : rest];
    });
    return { ...g, groups };
  });
}

/** Delete a group and its whole subtree (descendant groups, nodes and their cables) in one undo step. */
export function deleteGroupWithContents(sessionId: string, groupId: string): string | null {
  const graph = get().sessions[sessionId]?.graph;
  const target = graph?.groups?.find((g) => g.id === groupId);
  if (!graph || !target) return `No such group: ${groupId}.`;
  if (isSpecialGroup(target)) { ungroup(sessionId, groupId); return null; }
  const sub = groupSubtree(graph.groups, groupId);
  const live = new Set(graph.nodes.map((n) => n.id));
  return deleteNodes(sessionId, [...sub.nodeIds].filter((id) => live.has(id)), [...sub.groupIds]);
}

export function renameGroup(sessionId: string, groupId: string, title: string): void {
  const t = title.trim().slice(0, 80);
  if (t) editPresentation(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((x) => (x.id === groupId ? { ...x, title: t } : x)) }));
}

export function setGroupColor(sessionId: string, groupId: string, color: string | undefined): void {
  editPresentation(sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((x) => (x.id === groupId ? { ...x, color } : x)) }));
}

function wrapRects(rects: GroupRect[], pad = 28): GroupRect | null {
  if (!rects.length) return null;
  const l = Math.min(...rects.map((r) => r.x)), t = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((x) => x.x + x.width)), b = Math.max(...rects.map((x) => x.y + x.height));
  return { x: l - pad, y: t - pad - 18, width: r - l + pad * 2, height: b - t + pad * 2 + 18 };
}

/** The frame around a group's nodes (flow coordinates), from their real sizes: it follows them as they move. */
export function groupBounds(members: GraphNode[], sizes: Sizes, pad = 28): GroupRect | null {
  return wrapRects(members.map((n) => ({ ...n.position, ...sizeOf(n, sizes) })), pad);
}

/** Frame rectangle for a group (wraps direct nodes and child frames; falls back to stored bounds when empty). */
export function groupFrameBounds(
  graph: Graph, groupId: string, sizes: Sizes,
  posOf?: (id: string, fallback: { x: number; y: number }) => { x: number; y: number },
  pad = 28, visiting = new Set<string>(),
): GroupRect | null {
  const g = graph.groups?.find((x) => x.id === groupId);
  if (!g || visiting.has(groupId)) return null;
  visiting.add(groupId);
  const rects: GroupRect[] = [];
  for (const nid of g.nodeIds) {
    const n = graph.nodes.find((x) => x.id === nid);
    if (n) rects.push({ ...(posOf ? posOf(nid, n.position) : n.position), ...sizeOf(n, sizes) });
  }
  for (const c of graph.groups ?? []) if (c.parentId === groupId && !visiting.has(c.id)) { const cb = groupFrameBounds(graph, c.id, sizes, posOf, pad, visiting); if (cb) rects.push(cb); }
  visiting.delete(groupId);
  if (rects.length) return wrapRects(rects, pad);
  const base = g.bounds ?? DEFAULT_GROUP_BOUNDS;
  return { ...base, ...(posOf ? posOf(g.id, base) : { x: base.x, y: base.y }) };
}

/** Move every descendant node and empty subgroup frame of a group by (dx, dy). */
export function moveGroup(sessionId: string, groupId: string, dx: number, dy: number): void {
  editPresentation(sessionId, (g) => {
    const sub = groupSubtree(g.groups, groupId);
    const groups = g.groups?.map((gr) => {
      if (!sub.groupIds.has(gr.id) || !isEmptyGroup(g.groups, gr)) return gr;
      const b = gr.bounds ?? DEFAULT_GROUP_BOUNDS;
      return { ...gr, bounds: { ...b, x: b.x + dx, y: b.y + dy } };
    });
    return {
      ...g,
      nodes: g.nodes.map((n) => (sub.nodeIds.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n)),
      ...(groups ? { groups } : {}),
    };
  });
}

// ---------------------------------------------------------------------------
// Clipboard (inside the app: nodes with their parameters, groups/subgroups, links between them and inputs from outside)

interface Clip {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups?: GraphGroup[];
}
let clip: Clip | null = null;

export function hasNodeClipboard(): boolean {
  return Boolean(clip?.nodes.length || clip?.groups?.length);
}

function collectCopyGroups(graph: Graph, nodeSet: Set<string>, groupIds: string[] = []): GraphGroup[] {
  const gSet = new Set<string>();
  for (const gid of groupIds) {
    const sub = groupSubtree(graph.groups, gid);
    sub.groupIds.forEach((id) => gSet.add(id));
    sub.nodeIds.forEach((id) => nodeSet.add(id));
  }
  if (!gSet.size && nodeSet.size) {
    for (const gr of graph.groups ?? []) {
      if ('detachedOutputs' in gr) continue;
      const sub = groupSubtree(graph.groups, gr.id);
      if (sub.nodeIds.size && [...sub.nodeIds].every((id) => nodeSet.has(id))) sub.groupIds.forEach((id) => gSet.add(id));
    }
  }
  return (graph.groups ?? []).filter((g) => gSet.has(g.id) && !('detachedOutputs' in g)).map((g) => {
    const { library: _, ...rest } = structuredClone(g);
    return rest;
  });
}

export function copyNodes(sessionId: string, ids: string[], groupIds: string[] = []): number {
  const graph = get().sessions[sessionId]?.graph;
  if (!graph) return 0;
  const set = new Set(ids);
  const groups = collectCopyGroups(graph, set, groupIds);
  clip = { nodes: structuredClone(graph.nodes.filter((n) => set.has(n.id))), edges: structuredClone(graph.edges.filter((e) => set.has(e.target))), ...(groups.length ? { groups } : {}) };
  return clip.nodes.length || groups.length;
}

export function cutNodes(sessionId: string, ids: string[]): number {
  const n = copyNodes(sessionId, ids);
  if (n) deleteNodes(sessionId, ids);
  return n;
}

function cloneClipInto(graph: Graph, assets: ReturnType<typeof get>['assets'], src: Clip, offset: { x: number; y: number }, keepRootParent = false) {
  const ids = new Map(src.nodes.map((n) => [n.id, uid('nd')]));
  const gids = new Map((src.groups ?? []).map((g) => [g.id, uid('grp')]));
  const added: GraphNode[] = src.nodes.map((n) => {
    const data = structuredClone(n.data);
    if (runsGeneration(data)) { delete (data as GenNodeData).generationId; delete (data as GenNodeData).sketchAssetId; (data as GenNodeData).outputIndex = 0; }
    return { id: ids.get(n.id)!, position: { x: n.position.x + offset.x, y: n.position.y + offset.y }, data };
  });
  const addedGroups: GraphGroup[] = (src.groups ?? []).map((g) => {
    const { parentId, bounds, ...rest } = structuredClone(g);
    const mappedParent = parentId ? (gids.get(parentId) ?? (keepRootParent && graph.groups?.some((x) => x.id === parentId) ? parentId : undefined)) : undefined;
    return {
      ...rest,
      id: gids.get(g.id)!,
      nodeIds: g.nodeIds.map((id) => ids.get(id)).filter((id): id is string => Boolean(id)),
      ...(mappedParent ? { parentId: mappedParent } : {}),
      ...(bounds ? { bounds: { ...bounds, x: bounds.x + offset.x, y: bounds.y + offset.y } } : {}),
    };
  });
  let next: Graph = { ...graph, nodes: [...graph.nodes, ...added], ...(addedGroups.length ? { groups: [...(graph.groups ?? []), ...addedGroups] } : {}) };
  for (const e of src.edges) {
    const source = ids.get(e.source) ?? (graph.nodes.some((n) => n.id === e.source) ? e.source : undefined);
    const target = ids.get(e.target);
    if (!source || !target) continue;
    const c = { source, target, targetHandle: e.targetHandle, sourceHandle: e.sourceHandle, kind: e.kind, both: e.both };
    const port = (e.kind ?? 'data') === 'data' ? inputPorts(added.find((n) => n.id === target)!.data).find((p) => p.id === e.targetHandle) : {};
    // The copy keeps the cable whole (kind, both, output, and the revision it was fixed to): a pasted invalid reference stays invalid.
    if (port && !connectionError(next, assets, c)) next = { ...next, edges: [...next.edges, { ...e, id: uid('edge'), source, target }] };
  }
  return { next, added, addedGroups, gids };
}

/**
 * Paste the clipboard: new ids, a little offset (or at `at`), remapped groups/subgroups, links between pasted nodes,
 * and inputs from nodes still on the canvas. Returns the new node ids (or new group ids when pasting empty groups).
 */
export function pasteNodes(sessionId: string, at?: { x: number; y: number }): string[] {
  const st = get(), graph = st.sessions[sessionId]?.graph;
  if (!graph || !hasNodeClipboard()) return [];
  const emptyBounds = (clip!.groups ?? []).filter((g) => isEmptyGroup(clip!.groups, g) && g.bounds).map((g) => g.bounds!);
  const xs = [...clip!.nodes.map((n) => n.position.x), ...emptyBounds.map((b) => b.x)];
  const ys = [...clip!.nodes.map((n) => n.position.y), ...emptyBounds.map((b) => b.y)];
  const offset = at && xs.length ? { x: at.x - Math.min(...xs), y: at.y - Math.min(...ys) } : { x: 60, y: 60 };
  const { next, added, addedGroups } = cloneClipInto(graph, st.assets, clip!, offset);
  editCompound(sessionId, 'paste', () => next);
  return added.length ? added.map((n) => n.id) : addedGroups.map((g) => g.id);
}

/** Duplicate a group and its whole subtree (subgroups, nodes, internal links) with fresh ids in one undo step. */
export function duplicateGroup(sessionId: string, groupId: string): string | null {
  const st = get(), graph = st.sessions[sessionId]?.graph;
  if (!graph || !graph.groups?.some((g) => g.id === groupId && !('detachedOutputs' in g))) return null;
  const nodeSet = new Set<string>(), groups = collectCopyGroups(graph, nodeSet, [groupId]);
  const src: Clip = { nodes: structuredClone(graph.nodes.filter((n) => nodeSet.has(n.id))), edges: structuredClone(graph.edges.filter((e) => nodeSet.has(e.target))), groups };
  const { next, gids } = cloneClipInto(graph, st.assets, src, { x: 60, y: 60 }, true);
  editCompound(sessionId, 'duplicate-group', () => next);
  return gids.get(groupId) ?? null;
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
  const groups = (graph.groups ?? []).map(g => g.nodeIds.includes(nodeId) ? { ...g, nodeIds: g.nodeIds.filter(id => id !== nodeId) } : g).filter(g => !('detachedOutputs' in g) || g.nodeIds.length > 0);
  const next = { ...graph, nodes: graph.nodes.flatMap(n => n.id === nodeId ? cards : [n]), edges: [...graph.edges, ...copied], groups: [...groups, group] };
  const problem = graphEditProblem(sessionId, graph, next);
  if (problem) { toast(problem, 'error'); return []; }
  editCompound(sessionId, 'detach-outputs', () => next);
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
  editCompound(sessionId, 'reattach-outputs', () => ({ graph: next, dropped: additions.map(e => e.id) })); // the new cables come back under their ids, re-pointed at the node
  if (skipped.length) toast(`Could not keep ${skipped.length} new connection(s): ${skipped.join('; ')}`, 'error');
}
