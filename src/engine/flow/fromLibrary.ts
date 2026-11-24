import { uid } from '../../lib/id';
import { useStore } from '../../store/store';
import { isKit, type KitActor, type KitKind } from '../libraryTypes';
import { createItem, saveItem } from '../libraryVersions';
import { editCompound, editPresentation } from '../nodecore/edit';
import type { Asset, Graph, GraphEdge, GraphGroup, GraphNode, Subject } from '../types';
import { autoLayout, NODE_WIDTH, nodeOutputAsset } from './graph';

/* Sister of chatToNodes: import Library graphs into Nodes as a named group (1 undo step, no run) and save back. */
const refEdge = (e: GraphEdge, id: string, source: string, target: string): GraphEdge => ({
  id, source, target, sourceHandle: e.sourceHandle || 'out_ref', targetHandle: e.targetHandle || 'sys_ref',
  kind: e.kind ?? 'ref', ...(e.label ? { label: e.label } : {}), ...(e.both ? { both: true } : {}),
});

export function kitImageAssetIds(subject: Subject, assets: Record<string, Asset>): string[] {
  const ver = subject.versions?.find((v) => v.id === subject.versionId) ?? subject.versions?.at(-1);
  return [...new Set(ver?.assetIds ?? [])].filter((id) => assets[id]?.kind === 'image');
}

export function libraryToNodes(sessionId: string, subjectId: string): { added: GraphNode[]; edges: GraphEdge[]; groupId: string | null } {
  const st = useStore.getState(), session = st.sessions[sessionId];
  if (!session) throw new Error(`No session "${sessionId}".`);
  const subject = st.library.find((s) => s.id === subjectId);
  if (!subject || !isKit(subject)) throw new Error(`No Library item "${subjectId}".`);
  const src = subject.graph, imgIds = src?.nodes.length ? [] : kitImageAssetIds(subject, st.assets);
  if (!src?.nodes.length && !imgIds.length) return { added: [], edges: [], groupId: null };

  const idMap = new Map<string, string>();
  const nodes: GraphNode[] = src?.nodes.length
    ? src.nodes.map((n) => {
        const id = uid('nd'); idMap.set(n.id, id);
        return { id, position: { ...n.position }, data: structuredClone(n.data) };
      })
    : imgIds.map((assetId) => ({ id: uid('nd'), position: { x: 0, y: 0 }, data: { kind: 'asset', title: st.assets[assetId]?.name || 'Asset', assetId } }));
  const edges = (src?.edges ?? []).filter((e) => idMap.has(e.source) && idMap.has(e.target)).map((e) => refEdge(e, uid('edge'), idMap.get(e.source)!, idMap.get(e.target)!));
  const right = session.graph.nodes.reduce((x, n) => Math.max(x, n.position.x + NODE_WIDTH), -Infinity);
  const top = session.graph.nodes.reduce((y, n) => Math.min(y, n.position.y), Infinity);
  const baseX = Number.isFinite(right) ? right + 200 : 0, baseY = Number.isFinite(top) ? top : 0;
  if (nodes.some((n) => n.position.x !== 0 || n.position.y !== 0)) {
    const minX = Math.min(...nodes.map((n) => n.position.x)), minY = Math.min(...nodes.map((n) => n.position.y));
    for (const n of nodes) n.position = { x: n.position.x - minX + baseX, y: n.position.y - minY + baseY };
  } else {
    const pos = autoLayout(nodes, edges, { x: baseX, y: baseY });
    for (const n of nodes) n.position = pos.get(n.id) ?? n.position;
  }
  const srcGrp = src?.groups?.[0];
  const group: GraphGroup = {
    id: uid('grp'), title: srcGrp?.title || subject.name, nodeIds: nodes.map((n) => n.id),
    ...(srcGrp?.color ? { color: srcGrp.color } : {}), library: { subjectId: subject.id },
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
    if (n.data.kind === 'asset' || n.data.kind === 'text' || n.data.kind === 'part') return { id: n.id, position: { ...n.position }, data: structuredClone(n.data) };
    const out = nodeOutputAsset(n, st.generations);
    if (!out) throw new Error(`Node "${n.id}" (${n.data.kind}) cannot be saved to Library without a finished asset.`);
    return { id: n.id, position: { ...n.position }, data: { kind: 'asset', title: n.data.title, assetId: out } };
  });
  const kept = new Set(nodes.map((n) => n.id));
  const edges = session.graph.edges.filter((e) => kept.has(e.source) && kept.has(e.target)).map((e) => refEdge({ ...e, sourceHandle: 'out_ref', targetHandle: 'sys_ref', kind: 'ref' }, e.id, e.source, e.target));
  const title = opts.name?.trim() || srcGrp?.title;
  const graph: Graph = { nodes, edges, ...(title ? { groups: [{ id: srcGrp?.id ?? uid('grp'), title, nodeIds: nodes.map((n) => n.id), ...(srcGrp?.color ? { color: srcGrp.color } : {}) }] } : {}) };
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
    editPresentation(opts.sessionId, (g) => ({ ...g, groups: (g.groups ?? []).map((gr) => (gr.id === srcGrp.id ? { ...gr, library: { subjectId: saved.id } } : gr)) }));
  }
  return saved;
}
