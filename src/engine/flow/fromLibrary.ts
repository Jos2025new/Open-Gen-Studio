import { uid } from '../../lib/id';
import { useStore } from '../../store/store';
import { isKit, type KitActor, type KitGroupLink, type KitKind } from '../libraryTypes';
import { createItem, saveItem } from '../libraryVersions';
import { editCompound, editPresentation } from '../nodecore/edit';
import { descriptorOf } from '../nodecore/registry';
import type { Asset, Graph, GraphEdge, GraphGroup, GraphNode, Subject } from '../types';
import { groupSubtree } from './groupTree';
import { NODE_WIDTH, nodeOutputAsset } from './graph';
import { assetRatio } from '../libraryBoard';
import { placedAt, placeNodes } from '../libraryLayout';

/* Sister of chatToNodes: import Library graphs into Nodes as a named group (1 undo step, no run) and save back. */
const refEdge = (e: GraphEdge, id: string, source: string, target: string): GraphEdge => ({
  id, source, target, sourceHandle: e.sourceHandle || 'out_ref', targetHandle: e.targetHandle || 'sys_ref',
  kind: e.kind ?? 'ref', ...(e.label ? { label: e.label } : {}), ...(e.both ? { both: true } : {}),
});

export function kitImageAssetIds(subject: Subject, assets: Record<string, Asset>): string[] {
  const ver = subject.versions?.find((v) => v.id === subject.versionId) ?? subject.versions?.at(-1);
  return [...new Set(ver?.assetIds ?? [])].filter((id) => assets[id]?.kind === 'image');
}

const cornerOf = (nodes: readonly GraphNode[]) => ({ x: Math.min(...nodes.map((n) => n.position.x)), y: Math.min(...nodes.map((n) => n.position.y)) });

export function libraryToNodes(sessionId: string, subjectId: string): { added: GraphNode[]; edges: GraphEdge[]; groupId: string | null } {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) throw new Error(`No session "${sessionId}".`);
  const subject = st.library.find((s) => s.id === subjectId);
  if (!subject || !isKit(subject)) throw new Error(`No Library item "${subjectId}".`);
  const src = subject.graph, srcNodes = (src?.nodes ?? []).filter((n) => Boolean(descriptorOf(n.data.kind)));
  const inGraph = new Set(srcNodes.flatMap((n) => (n.data.kind === 'asset' && n.data.assetId ? [n.data.assetId] : [])));
  const extraIds = (subject.kind === 'moodboard' && (src?.nodes.length ?? 0) > 0 ? [] : kitImageAssetIds(subject, st.assets)).filter((id) => !inGraph.has(id));
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
  // One frame for the entry; the groups inside it keep their place. Several loose groups go inside a frame with its name.
  const saved = src?.groups ?? [], outer = saved.filter((g) => !saved.some((o) => o.id === g.parentId && o !== g)), srcGrp = outer.length === 1 ? outer[0] : undefined;
  const rootId = uid('grp'), gids = new Map(saved.map((g) => [g.id, g === srcGrp ? rootId : uid('grp')])), taken = new Set<string>();
  const inner: GraphGroup[] = saved.filter((g) => g !== srcGrp).map((g) => ({
    id: gids.get(g.id)!, title: g.title, parentId: gids.get(g.parentId ?? '') ?? rootId, ...(g.color ? { color: g.color } : {}),
    ...(g.bounds ? { bounds: { ...g.bounds, x: g.bounds.x - minX + baseX, y: g.bounds.y - minY + baseY } } : {}),
    nodeIds: g.nodeIds.flatMap((id) => { const to = idMap.get(id); if (!to || taken.has(to)) return []; taken.add(to); return [to]; }),
  }));
  for (const g of saved) elementOf.set(gids.get(g.id)!, g.id);
  const link: KitGroupLink = { subjectId, ...(subject.versionId ? { versionId: subject.versionId } : {}), corner: { x: minX, y: minY }, ids: Object.fromEntries(elementOf) };
  const group: GraphGroup = {
    id: rootId, title: srcGrp?.title || subject.name, nodeIds: nodes.map((n) => n.id).filter((id) => !taken.has(id)),
    ...(srcGrp?.color ? { color: srcGrp.color } : {}), library: link,
  };
  const err = editCompound(sessionId, 'from-library', (g) => ({ ...g, nodes: [...g.nodes, ...nodes], edges: [...g.edges, ...edges], groups: [...(g.groups ?? []), group, ...inner] }));
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
  const all = session.graph.groups ?? [], tree = srcGrp ? groupSubtree(all, srcGrp.id) : undefined;
  const rawIds = tree ? [...tree.nodeIds] : opts.nodeIds ?? [];
  if (!rawIds.length) throw new Error('Select nodes or a group to save to Library.');

  const byId = new Map(session.graph.nodes.map((n) => [n.id, n]));
  const nodes: GraphNode[] = [...new Set(rawIds)].map((nid) => {
    const n = byId.get(nid);
    if (!n) throw new Error(`No node "${nid}" in this session.`);
    if (n.data.kind === 'text') return { id: n.id, position: { ...n.position }, data: structuredClone(n.data) };
    const out = nodeOutputAsset(n, st.generations);
    if (!out) throw new Error(`Node "${n.id}" (${n.data.kind}) cannot be saved to Library without a finished asset.`);
    return { id: n.id, position: { ...n.position }, data: { kind: 'asset', title: n.data.title, assetId: out, ...(n.data.section ? { section: n.data.section } : {}) } };
  });
  const kept = new Set(nodes.map((n) => n.id));
  const edges = session.graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)).map((e) => refEdge({ ...e, sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' }, e.id, e.source, e.target));
  const title = opts.name?.trim() || srcGrp?.title;
  // Saving replaces the entry with this group. Where the group sits on the canvas is not part of it.
  const link = srcGrp?.library?.subjectId === opts.subjectId && opts.mode !== 'new' ? srcGrp?.library : undefined, here = cornerOf(nodes), corner = link?.corner ?? here;
  const inner = all.filter((g) => g !== srcGrp && tree?.groupIds.has(g.id)), moved = (p: { x: number; y: number }) => placedAt(p.x - here.x + corner.x, p.y - here.y + corner.y);
  const ids = Object.fromEntries([...nodes, ...(srcGrp ? [srcGrp] : []), ...inner].map((n) => [n.id, link?.ids?.[n.id] ?? n.id]));
  const graph: Graph = {
    nodes: nodes.map((n) => ({ ...n, id: ids[n.id], position: moved(n.position) })),
    edges: edges.map((e) => ({ ...e, source: ids[e.source], target: ids[e.target] })),
    ...(title ? { groups: [
      { id: srcGrp ? ids[srcGrp.id] : uid('grp'), title, nodeIds: (srcGrp?.nodeIds ?? nodes.map((n) => n.id)).flatMap((id) => ids[id] ?? []), ...(srcGrp?.color ? { color: srcGrp.color } : {}) },
      ...inner.map((g) => ({ id: ids[g.id], title: g.title, nodeIds: g.nodeIds.flatMap((id) => ids[id] ?? []), parentId: ids[g.parentId!], ...(g.color ? { color: g.color } : {}), ...(g.bounds ? { bounds: { ...g.bounds, ...moved(g.bounds) } } : {}) })),
    ] } : {}),
  };
  const by = opts.by ?? 'user';
  let saved: Subject;
  if (opts.mode === 'new') {
    if (!opts.kind) throw new Error('Kind is required when saving as a new Library item.');
    saved = (await createItem({ name: title || 'Nodes item', kind: opts.kind, space: 'nodes', by, sessionId: opts.sessionId, description: opts.description, graph, draft: false })).subject;
  } else {
    if (!opts.subjectId) throw new Error('Library item id is required for overwrite or copy.');
    saved = await saveItem({ subjectId: opts.subjectId, mode: opts.mode, space: 'nodes', by, sessionId: opts.sessionId, name: opts.name, description: opts.description, label: opts.label, graph });
  }
  if (srcGrp && opts.mode !== 'copy') {
    const library: KitGroupLink = { subjectId: saved.id, ...(saved.versionId ? { versionId: saved.versionId } : {}), corner, ids };
    editPresentation(opts.sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((gr) => (gr.id === srcGrp.id ? { ...gr, library } : gr)) }), { silent: true });
  }
  return saved;
}
