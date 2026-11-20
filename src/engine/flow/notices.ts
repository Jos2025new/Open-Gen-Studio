import { useStore } from '../../store/store';
import { editCompound } from '../nodecore/edit';
import { resolveCableInput, resolveInputs, type ResolveEnv, type ResolvedInput, storeEnv } from '../nodecore/resolver';
import type { Graph, GraphNode } from '../types';
import { hasPromptAlternative, runsGeneration } from './graph';

type NodeNotice = { nodeId: string; title: string; message: string };
export type PortNotice = NodeNotice & { kind: 'port'; port: string };
export type CableNotice = NodeNotice & ({ kind: 'cable'; edgeId: string } | { kind: 'pin'; edgeId: string; pin: string; next: string | null });
export type GraphNotice = PortNotice | CableNotice;

function hasInput(inputs: ResolvedInput[], ports: string[], nodes: Map<string, GraphNode>): boolean {
  return inputs.some(i => {
    if (!ports.includes(i.port) || !i.from || i.status === 'invalid' || i.incompatible) return false;
    if (i.value?.trim()) return true;
    const source = nodes.get(i.from);
    // A compatible generation can supply an input as part of this run.
    return i.mode === 'moving' && !!source && runsGeneration(source.data) && i.value == null;
  });
}

export function graphNotices(graph: Graph, env: ResolveEnv): GraphNotice[] {
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const incoming = new Map<string, ResolvedInput[]>();
  for (const edge of graph.edges) {
    const target = nodes.get(edge.target);
    if (!target || (edge.kind ?? 'data') !== 'data') continue;
    const input = resolveCableInput(nodes.get(edge.source), target, edge, env);
    const inputs = incoming.get(target.id);
    if (inputs) inputs.push(input);
    else incoming.set(target.id, [input]);
  }
  return graph.nodes.flatMap(node => {
    const d = node.data;
    const inputs = incoming.get(node.id) ?? [];
    const at = { nodeId: node.id, title: d.title };
    const notices: GraphNotice[] = inputs.flatMap((i): CableNotice[] => {
      if (!i.from || (i.status !== 'invalid' && !i.incompatible)) return [];
      const cable = { ...at, edgeId: i.edgeId, message: i.reason ?? 'Invalid cable' };
      return i.pinMoved && i.revision
        ? [{ ...cable, kind: 'pin', pin: i.revision, next: i.currentRevision ?? null }]
        : [{ ...cable, kind: 'cable' }];
    });
    const missing = (port: string, message: string) => {
      // If a visible cable already explains the failure, mark the cable once.
      if (!inputs.some(i => i.port === port && i.from && (i.status === 'invalid' || i.incompatible))) {
        notices.push({ ...at, kind: 'port', port, message });
      }
    };
    if (d.kind === 'tool' && !hasInput(inputs, ['input'], nodes)) missing('input', 'Missing input');
    if (d.kind === 'image' || d.kind === 'model3d' || d.kind === 'video') {
      const refs = d.kind === 'video' ? ['ref', 'refVideo', 'audio'] : ['ref', 'clip'];
      if (!d.prompt.trim() && !hasInput(inputs, ['prompt'], nodes) &&
          !hasPromptAlternative(d.kind, Number(hasInput(inputs, refs, nodes)), hasInput(inputs, ['first'], nodes))) {
        missing('prompt', 'Missing prompt');
      }
    }
    return notices;
  });
}

export interface NoticeSummary { count: number; hasErrors: boolean }

export function summarizeNotices(notices: readonly GraphNotice[]): NoticeSummary {
  return { count: notices.length, hasErrors: notices.some(n => n.kind !== 'pin') };
}

export function groupNotices(notices: readonly GraphNotice[], nodeIds: readonly string[]) {
  const members = new Set(nodeIds);
  return summarizeNotices(notices.filter(n => members.has(n.nodeId)));
}

export function countNotices(notices: readonly GraphNotice[], nodeIds: readonly string[]): number {
  return groupNotices(notices, nodeIds).count;
}

/** Adopting a revision is an explicit edit of this cable. A stale hover action cannot fix it to a different revision. */
export function adoptCableRevision(sessionId: string, edgeId: string, pin: string, next: string): boolean {
  const graph = useStore.getState().sessions[sessionId]?.graph;
  const edge = graph?.edges.find(e => e.id === edgeId);
  const target = graph?.nodes.find(n => n.id === edge?.target);
  if (!graph || !target || edge?.pin !== pin) return false;
  const input = resolveInputs(graph, target, storeEnv()).find(i => i.edgeId === edgeId);
  if (!input?.pinMoved || input.currentRevision !== next) return false;
  return editCompound(sessionId, 'update-cable-pin', g => ({
    graph: { ...g, edges: g.edges.map(e => e.id === edgeId ? { ...e, pin: next } : e) },
    dropped: [edgeId],
  })) === null;
}
