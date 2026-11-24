import { uid } from '../../lib/id';
import { useStore } from '../../store/store';
import { isKit, type KitActor, type KitGroupLink, type KitKind } from '../libraryTypes';
import { createItem, saveItem } from '../libraryVersions';
import { editCompound, editPresentation } from '../nodecore/edit';
import type { Asset, Graph, GraphEdge, GraphGroup, GraphNode, Subject } from '../types';
import { NODE_WIDTH, nodeOutputAsset } from './graph';
import { assetRatio } from '../libraryBoard';
import { placedAt, placeNodes, unplaced } from '../libraryLayout';

/* Sister of chatToNodes: import Library graphs into Nodes as a named group (1 undo step, no run) and save back. */
const refEdge = (e: GraphEdge, id: string, source: string, target: string): GraphEdge => ({
  id, source, target, sourceHandle: e.sourceHandle || 'out_ref', targetHandle: e.targetHandle || 'sys_ref',
  kind: e.kind ?? 'ref', ...(e.label ? { label: e.label } : {}), ...(e.both ? { both: true } : {}),
});

export function kitImageAssetIds(subject: Subject, assets: Record<string, Asset>): string[] {
  const ver = subject.versions?.find((v) => v.id === subject.versionId) ?? subject.versions?.at(-1);
  return [...new Set(ver?.assetIds ?? [])].filter((id) => assets[id]?.kind === 'image');
}

const edgeKey = (e: { source: string; target: string }) => `${e.source}>${e.target}`;
const contentOf = ({ data: d }: GraphNode): string => (d.kind === 'text' ? `t:${d.title}:${d.text}` : d.kind === 'asset' ? `a:${d.title}:${d.assetId}` : JSON.stringify(d));

const cents = (v: number): number => Math.round(v * 100) / 100 || 0;

/** The entry's graph with what this group changed since both last agreed: what others saved meanwhile stays, and what
    they removed does not come back. Moving the whole group is not a change. */
function mergeGroup(cur: Graph | undefined, link: KitGroupLink, nodes: GraphNode[], edges: GraphEdge[], keepAll: boolean): { graph: Graph; origin: { x: number; y: number }; ids: Map<string, string> } {
  const at = link.at ?? {}, theirs = new Map((cur?.nodes ?? []).map((n) => [n.id, n])), counts = new Map<string, { n: number; x: number; y: number }>([['0,0', { n: 0, x: 0, y: 0 }]]);
  for (const n of nodes) if (at[n.id]) { const x = cents(n.position.x - at[n.id].x), y = cents(n.position.y - at[n.id].y), c = counts.get(`${x},${y}`); counts.set(`${x},${y}`, { n: (c?.n ?? 0) + 1, x, y }); }
  // The shift most elements share is the group's own; on a tie, none.
  const d = [...counts.values()].reduce((best, c) => (c.n > best.n ? c : best)), base = { x: (link.origin?.x ?? 0) + d.x, y: (link.origin?.y ?? 0) + d.y };
  const ids = new Map(nodes.map((n) => [n.id, at[n.id]?.id ?? (theirs.has(n.id) ? uid('nd') : n.id)])), out: GraphNode[] = [];
  for (const n of nodes) {
    const e = at[n.id], c = e && theirs.get(e.id), id = ids.get(n.id)!, position = placedAt(n.position.x - base.x, n.position.y - base.y), edited = !e || contentOf(n) !== e.content;
    if (!c && !edited && !keepAll) continue;
    const moved = !c || unplaced(c.position) || cents(n.position.x - e!.x) !== d.x || cents(n.position.y - e!.y) !== d.y;
    out.push({ id, position: moved ? position : c.position, data: edited || !c ? n.data : c.data });
  }
  const here = new Set(Object.values(at).map((e) => e.id));
  out.push(...(cur?.nodes ?? []).filter((n) => !here.has(n.id)));
  const kept = new Set(out.map((n) => n.id)), known = new Set(link.edges ?? []), curKeys = new Set((cur?.edges ?? []).map(edgeKey));
  const mine = edges.map((e) => ({ ...e, source: ids.get(e.source)!, target: ids.get(e.target)! })).filter((e) => curKeys.has(edgeKey(e)) || !known.has(edgeKey(e)));
  const mineKeys = new Set(mine.map(edgeKey)), others = (cur?.edges ?? []).filter((e) => !mineKeys.has(edgeKey(e)) && !known.has(edgeKey(e)));
  return { graph: { ...cur, nodes: out, edges: [...mine, ...others].filter((e) => kept.has(e.source) && kept.has(e.target)) }, origin: base, ids };
}
const linkOf = (subjectId: string, origin: { x: number; y: number }, nodes: GraphNode[], edges: GraphEdge[], ids: ReadonlyMap<string, string>): KitGroupLink => ({
  subjectId, origin, at: Object.fromEntries(nodes.flatMap((n) => (ids.has(n.id) ? [[n.id, { id: ids.get(n.id)!, x: n.position.x, y: n.position.y, content: contentOf(n) }]] : []))),
  edges: edges.flatMap((e) => (ids.has(e.source) && ids.has(e.target) ? [edgeKey({ source: ids.get(e.source)!, target: ids.get(e.target)! })] : [])),
});

export function libraryToNodes(sessionId: string, subjectId: string): { added: GraphNode[]; edges: GraphEdge[]; groupId: string | null } {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) throw new Error(`No session "${sessionId}".`);
  const subject = st.library.find((s) => s.id === subjectId);
  if (!subject || !isKit(subject)) throw new Error(`No Library item "${subjectId}".`);
  const src = subject.graph, srcNodes = src?.nodes ?? [];
  const inGraph = new Set(srcNodes.flatMap((n) => (n.data.kind === 'asset' && n.data.assetId ? [n.data.assetId] : [])));
  const extraIds = (subject.kind === 'moodboard' && srcNodes.length ? [] : kitImageAssetIds(subject, st.assets)).filter((id) => !inGraph.has(id));
  if (!srcNodes.length && !extraIds.length) return { added: [], edges: [], groupId: null };

  const idMap = new Map<string, string>(), elementOf = new Map<string, string>();
  const nodes: GraphNode[] = srcNodes.map((n) => { const id = uid('nd'); idMap.set(n.id, id); elementOf.set(id, n.id); return { id, position: { ...n.position }, data: structuredClone(n.data) }; });
  for (const assetId of extraIds) nodes.push({ id: uid('nd'), position: { x: 0, y: 0 }, data: { kind: 'asset', title: st.assets[assetId]?.name || 'Asset', assetId } });
  const edges = (src?.edges ?? []).filter((e) => idMap.has(e.source) && idMap.has(e.target)).map((e) => refEdge(e, uid('edge'), idMap.get(e.source)!, idMap.get(e.target)!));
  const right = session.graph.nodes.reduce((x, n) => Math.max(x, n.position.x + NODE_WIDTH), -Infinity);
  const top = session.graph.nodes.reduce((y, n) => Math.min(y, n.position.y), Infinity);
  const baseX = Number.isFinite(right) ? right + 200 : 0, baseY = Number.isFinite(top) ? top : 0;
  const placed = placeNodes(nodes, assetRatio), minX = Math.min(...placed.map((r) => r.x)), minY = Math.min(...placed.map((r) => r.y));
  nodes.forEach((n, i) => { n.position = { x: placed[i].x - minX + baseX, y: placed[i].y - minY + baseY }; });
  const srcGrp = src?.groups?.[0];
  const link = linkOf(subjectId, { x: baseX - minX, y: baseY - minY }, nodes, edges, elementOf);
  const group: GraphGroup = {
    id: uid('grp'), title: srcGrp?.title || subject.name, nodeIds: nodes.map((n) => n.id),
    ...(srcGrp?.color ? { color: srcGrp.color } : {}), library: link,
  };
  const err = editCompound(sessionId, 'from-library', (g) => ({ ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges], groups: [...(g.groups ?? []), group] }));
  if (err) throw new Error(err);
  return { added: nodes, edges, groupId: group.id };
}

export async function nodesToLibrary(opts: {
  sessionId: string; mode: 'overwrite' | 'copy' | 'new'; subjectId?: string; kind?: KitKind;
  name?: string; description?: string; groupId?: string; nodeIds?: string[]; by?: KitActor; label?: string;
}): Promise<Subject> {
  const st = useStore.getState(), session = st.sessions[opts.sessionId];
  if (!session) throw new Error(`No session "${opts.sessionId}".`);
  const srcGrp = opts.groupId ? session.graph.groups?.find((g) => g.id === opts.groupId) : undefined;
  if (opts.groupId && !srcGrp) throw new Error(`No group "${opts.groupId}" in this session.`);
  const rawIds = srcGrp ? srcGrp.nodeIds : opts.nodeIds ?? [];
  if (!rawIds.length) throw new Error('Select nodes or a group to save to Library.');

  const byId = new Map(session.graph.nodes.map((n) => [n.id, n]));
  const nodes: GraphNode[] = [...new Set(rawIds)].map((nid) => {
    const n = byId.get(nid);
    if (!n) throw new Error(`No node "${nid}" in this session.`);
    if (n.data.kind === 'text' || n.data.kind === 'part') return { id: n.id, position: { ...n.position }, data: structuredClone(n.data) };
    const out = nodeOutputAsset(n, st.generations);
    if (!out) throw new Error(`Node "${n.id}" (${n.data.kind}) cannot be saved to Library without a finished asset.`);
    return { id: n.id, position: { ...n.position }, data: { kind: 'asset', title: n.data.title, assetId: out } };
  });
  const kept = new Set(nodes.map((n) => n.id));
  const edges = session.graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)).map((e) => refEdge({ ...e, sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' }, e.id, e.source, e.target));
  const title = opts.name?.trim() || srcGrp?.title;
  const link = srcGrp?.library?.at && srcGrp.library.subjectId === opts.subjectId ? srcGrp.library : undefined;
  let origin = { x: 0, y: 0 }, ids: ReadonlyMap<string, string> = new Map(nodes.map((n) => [n.id, n.id]));
  const graphOf = (cur?: Graph): Graph => {
    const m = link ? mergeGroup(cur, link, nodes, edges, opts.mode === 'copy') : { graph: { nodes: nodes.map((n) => ({ ...n, position: placedAt(n.position.x, n.position.y) })), edges }, origin, ids };
    origin = m.origin; ids = m.ids;
    return { ...m.graph, ...(title ? { groups: [{ id: srcGrp?.id ?? uid('grp'), title, nodeIds: m.graph.nodes.map((n) => n.id), ...(srcGrp?.color ? { color: srcGrp.color } : {}) }] } : {}) };
  };
  const by = opts.by ?? 'user';
  let saved: Subject;
  if (opts.mode === 'new') {
    if (!opts.kind) throw new Error('Kind is required when saving as a new Library item.');
    saved = (await createItem({ name: title || 'Nodes item', kind: opts.kind, space: 'nodes', by, sessionId: opts.sessionId, description: opts.description, graph: graphOf(), draft: false })).subject;
  } else {
    if (!opts.subjectId) throw new Error('Library item id is required for overwrite or copy.');
    saved = await saveItem({ subjectId: opts.subjectId, mode: opts.mode, space: 'nodes', by, sessionId: opts.sessionId, name: opts.name, description: opts.description, label: opts.label, graph: graphOf });
  }
  if (srcGrp && opts.mode !== 'copy') {
    const library = linkOf(saved.id, origin, nodes, edges, ids);
    editPresentation(opts.sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((gr) => (gr.id === srcGrp.id ? { ...gr, library } : gr)) }), { silent: true });
  }
  return saved;
}
