import { patchGeneration, useStore } from '../../store/store';
import { applyEdit } from '../nodecore/edit';
import { resolveInputs, storeEnv } from '../nodecore/resolver';
import { isVideoOpEngine, OPS } from '../ops';
import { opChoice, videoOpSettings } from '../opSpec';
import type { Generation, Graph, GraphNode, GraphNodeData, Subject } from '../types';
import { nodeIsCurrent, nodeRequest, stable, type RequestContext } from './freshness';
import { nodeOutputAsset, runsGeneration } from './graph';
import { attemptNode } from './locks';

const get = useStore.getState;

export function requestContext(sessionId: string) {
  const st = get(), graph = st.sessions[sessionId].graph;
  const env = storeEnv();
  return { schemas: st.catalog.schemas, assets: st.assets, operation: (n: GraphNode) => {
    if (n.data.kind !== 'tool') return undefined;
    const engine = OPS[n.data.op].engine;
    if (['local', 'voice'].includes(engine)) return undefined;
    const input = resolveInputs(graph, n, env).find(i => i.port === 'input' && i.from && i.status !== 'invalid' && !i.incompatible);
    const edge = input && graph.edges.find(e => e.id === input.edgeId);
    const sourceNode = input && graph.nodes.find(src => src.id === input.from);
    const source = sourceNode ? nodeOutputAsset(sourceNode, st.generations, edge?.outputIndex) : null;
    const sourceRef = sourceNode && 'modelRef' in sourceNode.data ? sourceNode.data.modelRef : undefined;
    // A step from a confirmed plan carries the model the user approved (and the estimate priced): opChoice puts it before the source's model.
    const { ref, viaEdit } = opChoice({ op: n.data.op, params: n.data.params, sourceAssetId: source && st.assets[source] ? source : '', upstreamModelRef: sourceRef });
    const choice = { ref, viaEdit };
    return { ...choice, ...(engine === 'video' ? { settings: st.composer.video.settings } : isVideoOpEngine(engine) ? { settings: videoOpSettings(engine, st.catalog.schemas[choice.ref], n.data.params) } : {}) };
  } };
}

function withResult(graph: Graph, node: GraphNode, generationId: string): { graph: Graph; node: GraphNode } {
  const linked = { ...node, data: { ...node.data, generationId } as GraphNodeData };
  return { graph: { ...graph, nodes: graph.nodes.map(n => n.id === node.id ? linked : n) }, node: linked };
}

/** Record the logical request before sending so recovery can reuse it after edits or a reload. */
export function rememberNodeRequest(id: string, graph: Graph, library: Subject[], context: RequestContext): void {
  const st = get();
  const g = st.generations[id];
  const node = g && attemptNode(g, graph.nodes);
  if (!node || g.nodeRequest) return;
  const snapshot = withResult(graph, node, id);
  patchGeneration(id, { nodeRequest: stable(nodeRequest(snapshot.graph, snapshot.node, st.generations, library, context)) });
}

/** Publish a finished result while retaining any edits made while it was running. */
export function linkCompletedNode(id: string): void {
  const st = get();
  const g: Generation | undefined = st.generations[id];
  if (g?.origin !== 'node' || g.status !== 'done') return;
  const graph = st.sessions[g.sessionId]?.graph;
  const node = graph && attemptNode(g, graph.nodes);
  if (!graph || !node || !runsGeneration(node.data)) return;
  const previous = node.data.generationId && st.generations[node.data.generationId];
  if (previous && previous.createdAt > g.createdAt) return;
  if (!g.nodeRequest) {
    // A legacy attempt has no frozen request. Only derive one if the saved send still matches the live inputs.
    const snapshot = withResult(graph, node, id);
    const context = requestContext(g.sessionId);
    const library = g.inputs.nodeLibrary ?? st.library;
    if (nodeIsCurrent(snapshot.graph, snapshot.node, st.generations, library, context)) {
      rememberNodeRequest(id, graph, library, context);
    }
  }
  if (node.data.generationId !== id) {
    applyEdit({ session: g.sessionId, op: { op: 'set', node: node.id, patch: { generationId: id } } });
  }
}
