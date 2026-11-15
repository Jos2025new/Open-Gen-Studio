import { reconcileDeletionNotices, setComposer, useStore } from '../../store/store';
import { selectDoc } from '../design/actions';
import type { AgentStyle, ComposerMode, Graph, GraphEdge, GraphNode, RefNodeData } from '../types';
import { estimatedHeight, findFreePosition, NODE_WIDTH, nodeRect, rectsOverlap, type NodeRect } from '../flow/graph';
import { COL, ROW, addSystemNode, ensureSystemNodes, sysOrigin } from './system';
import { OMNI_SPACES, OMNI_SPACE_TITLES, isOmniSpace, omniSpaceNodeId, type OmniSpace } from './omniSpaces';

export { OMNI_SPACES, OMNI_SPACE_TITLES, isOmniSpace, omniSpaceNodeId, omniOnly, ordinaryGraph, type OmniSpace } from './omniSpaces';

/** The most assets the omnicanvas brings in at once; the user adds the rest from the library. */
const ASSETS_AT_ONCE = 8;
const PER_ROW = 5;

function writeGraph(sessionId: string, graph: Graph): void {
  useStore.setState((s) => {
    const cur = s.sessions[sessionId];
    return cur ? { sessions: { ...s.sessions, [sessionId]: { ...cur, graph } } } : s;
  });
}

/**
 * Open the omnicanvas for a session: its parts as nodes (chat, agent, models, docs), one Studio, one Nodes and one
 * Designer node, and the assets made since the last time. Nothing is copied: the nodes point at the data where it
 * lives. No undo step (like the system nodes); what is already there is left alone, so it can be called again.
 */
export function ensureOmniNodes(sessionId: string): string[] {
  const added = ensureSystemNodes(sessionId);
  const st = useStore.getState();
  const session = st.sessions[sessionId];
  if (!session) return added;
  const graph = session.graph;
  const nodes: GraphNode[] = [...graph.nodes];
  const edges: GraphEdge[] = [...graph.edges];
  const ox = sysOrigin(graph);
  const put = (node: GraphNode) => { nodes.push(node); added.push(node.id); };
  const isRef = (n: GraphNode, type: string) => n.data.kind === 'ref' && n.data.type === type;

  OMNI_SPACES.forEach((space, i) => {
    if (nodes.some((n) => isRef(n, 'space') && n.data.kind === 'ref' && n.data.ref === space)) return;
    const id = omniSpaceNodeId(space);
    put({ id, position: { x: ox + i * COL, y: -460 }, data: { kind: 'ref', type: 'space', ref: space, title: OMNI_SPACE_TITLES[space], view: 'thumb' } });
    const agent = nodes.find((n) => isRef(n, 'agent'));
    // The agent works in every Space: a reference link, drawn dotted.
    if (agent) edges.push({ id: `sys_edge_agent_${space}`, source: agent.id, target: id, sourceHandle: 'target', targetHandle: 'ref', kind: 'ref' });
  });

  // Legacy sessions can open with overlapping system/Space cards (e.g. hiding the chat composer): separate only colliding cards.
  const rank = (n: GraphNode) => {
    if (n.data.kind !== 'ref') return 5;
    if (n.data.type === 'chat') return 0;
    if (n.data.type === 'agent') return 1;
    if (n.data.type === 'space') return 2;
    if (n.data.type === 'model') return 3;
    return 4;
  };
  const occupied: NodeRect[] = [];
  const managedIdx: number[] = [];
  nodes.forEach((n, idx) => {
    if (n.data.kind === 'ref' || n.omni) managedIdx.push(idx);
    else occupied.push(nodeRect(n));
  });
  managedIdx.sort((a, b) => rank(nodes[a]) - rank(nodes[b]));
  let moved = false;
  for (const idx of managedIdx) {
    const cur = nodes[idx];
    const r = nodeRect(cur);
    if (occupied.some((o) => rectsOverlap(r, o, 48, 56))) {
      const pos = findFreePosition(cur.position, { width: r.width, height: r.height }, occupied, { gapX: 48, gapY: 56 });
      nodes[idx] = { ...cur, position: pos };
      moved = true;
      occupied.push({ x: pos.x, y: pos.y, width: r.width, height: r.height });
    } else {
      occupied.push(r);
    }
  }

  // Assets made since the last time, newest first, that no node shows yet. Ones the user took off do not come back.
  const shown = new Set<string>();
  for (const n of nodes) {
    const d = n.data;
    if (d.kind === 'asset') [d.assetId, d.sketchAssetId].forEach((id) => id && shown.add(id));
    else if ('generationId' in d && d.generationId) st.generations[d.generationId]?.assetIds.forEach((id) => shown.add(id));
  }
  const mine = Object.values(st.assets)
    .filter((a) => a.sessionId === sessionId && a.origin !== 'sketch' && a.origin !== 'mask' && a.origin !== 'view3d')
    .sort((a, b) => b.createdAt - a.createdAt);
  const seenAt = new Set(graph.omniAtIds);
  const isNew = (createdAt: number, id: string) =>
    graph.omniAt === undefined || createdAt > graph.omniAt || (createdAt === graph.omniAt && !seenAt.has(id));
  const fresh = mine.filter((a) => isNew(a.createdAt, a.id) && !shown.has(a.id)).slice(0, ASSETS_AT_ONCE);
  const rows = Math.max(session.docs.length, 1) + 3;
  fresh.forEach((a, i) => {
    const data: GraphNode['data'] = { kind: 'asset', title: a.kind === 'image' ? 'Image' : a.kind === 'video' ? 'Video' : a.kind === 'audio' ? 'Audio' : '3D', assetId: a.id };
    const h = estimatedHeight(data);
    const pos = findFreePosition({ x: ox + (i % PER_ROW) * (NODE_WIDTH + 48), y: (rows + Math.floor(i / PER_ROW)) * ROW }, { width: NODE_WIDTH, height: h }, occupied, { gapX: 48, gapY: 56 });
    occupied.push({ x: pos.x, y: pos.y, width: NODE_WIDTH, height: h });
    put({ id: `omni_asset_${a.id}`, position: pos, data, omni: true });
  });
  const omniAt = mine[0] ? (graph.omniAt === undefined ? mine[0].createdAt : Math.max(mine[0].createdAt, graph.omniAt)) : graph.omniAt;
  const omniAtIds = omniAt !== undefined ? mine.filter((a) => a.createdAt === omniAt).map((a) => a.id) : graph.omniAtIds;
  const idsChanged = (omniAtIds?.length ?? 0) !== (graph.omniAtIds?.length ?? 0)
    || Boolean(omniAtIds?.some((id, i) => id !== graph.omniAtIds?.[i]));
  if (moved || nodes.length !== graph.nodes.length || edges.length !== graph.edges.length || omniAt !== graph.omniAt || idsChanged) {
    writeGraph(sessionId, { ...graph, nodes, edges, ...(omniAt !== undefined ? { omniAt, omniAtIds } : {}) });
  }
  reconcileDeletionNotices(sessionId);
  return added;
}

/** The Studio, Nodes or Designer node: the one that is there, or a new one at `position` (library entry). */
export function addOmniSpace(sessionId: string, space: OmniSpace, position?: { x: number; y: number }): { id: string; existed: boolean } {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  const there = graph?.nodes.find((n) => n.data.kind === 'ref' && n.data.type === 'space' && n.data.ref === space);
  if (there) return { id: there.id, existed: true };
  return { id: addSystemNode(sessionId, { id: omniSpaceNodeId(space), type: 'space', ref: space, title: OMNI_SPACE_TITLES[space], position }), existed: false };
}

const patchRef = (sessionId: string, nodeId: string, change: (d: RefNodeData) => RefNodeData): string | null => {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  const node = graph?.nodes.find((n) => n.id === nodeId);
  if (!graph || !node) return `No such node: ${nodeId}.`;
  if (node.data.kind !== 'ref') return `${nodeId} is not a system node.`;
  const data = change(node.data);
  writeGraph(sessionId, { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data } : n)) });
  return null;
};

/** The look the user chose for a Space node: thumbnail or node. A preference of the view, so no undo step. */
export function setSpaceView(sessionId: string, nodeId: string, view: 'thumb' | 'node'): string | null {
  const node = useStore.getState().sessions[sessionId]?.graph.nodes.find((n) => n.id === nodeId);
  if (node && !(node.data.kind === 'ref' && node.data.type === 'space' && isOmniSpace(node.data.ref))) return `${nodeId} is not a Studio, Nodes or Designer node.`;
  return patchRef(sessionId, nodeId, (d) => ({ ...d, view }));
}

/** The chat node undocked shows its agent and model connections; docked it looks like Studio's chat. */
export function setChatUndocked(sessionId: string, nodeId: string, undocked: boolean): string | null {
  const node = useStore.getState().sessions[sessionId]?.graph.nodes.find((n) => n.id === nodeId);
  if (node && !(node.data.kind === 'ref' && node.data.type === 'chat')) return `${nodeId} is not a chat node.`;
  return patchRef(sessionId, nodeId, (d) => {
    const { undocked: _old, ...rest } = d;
    return undocked ? { ...rest, undocked: true } : rest;
  });
}

const MODES: ComposerMode[] = ['agent', 'image', 'video', 'audio', 'model3d'];
const STYLES: AgentStyle[] = ['auto', 'guided', 'direct'];

/** Edit a parameter shown on a Space node: it changes the same setting the Space itself changes. */
export function setSpaceParam(sessionId: string, space: OmniSpace, id: string, value: string): string | null {
  if (space === 'studio' && id === 'mode' && MODES.includes(value as ComposerMode)) setComposer({ mode: value as ComposerMode });
  else if (space === 'studio' && id === 'style' && STYLES.includes(value as AgentStyle)) setComposer({ agentStyle: value as AgentStyle });
  else if (space === 'designer' && id === 'doc' && useStore.getState().sessions[sessionId]?.docs.some((d) => d.id === value)) selectDoc(sessionId, value);
  else return `${OMNI_SPACE_TITLES[space]} has no parameter "${id}" with that value.`;
  return null;
}
