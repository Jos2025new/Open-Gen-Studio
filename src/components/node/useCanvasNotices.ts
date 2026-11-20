import { useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { graphNotices, summarizeNotices, type CableNotice, type PortNotice } from '../../engine/flow/notices';
import { ordinaryGraph } from '../../engine/nodes/omniSpaces';
import { sessionChatText, type ResolveEnv } from '../../engine/nodecore/resolver';
import type { Asset, Generation, Graph } from '../../engine/types';
import { useStore, type AppState } from '../../store/store';

/** The canvas uses immutable node data and edges. Layout can reuse the last content revision. */
function useCanvasGraphRevision(graph: Graph): Graph {
  const revisionOf = useMemo(() => {
    let previous: Graph | undefined;
    let revision: Graph;
    return (next: Graph) => {
      if (previous === next) return revision;
      if (!previous || next.edges !== previous.edges || next.groups !== previous.groups ||
          (next.nodes !== previous.nodes && (next.nodes.length !== previous.nodes.length ||
            next.nodes.some((n, i) => n.id !== previous!.nodes[i].id || n.data !== previous!.nodes[i].data || n.omni !== previous!.nodes[i].omni)))) {
        revision = next;
      }
      previous = next;
      return revision;
    };
  }, []);
  return revisionOf(graph);
}

export function useCanvasGraphs(fullGraph: Graph, omni: boolean) {
  const fullRevision = useCanvasGraphRevision(fullGraph);
  const ordinaryRevision = useMemo(() => ordinaryGraph(fullRevision), [fullRevision]);
  const revision = omni ? fullRevision : ordinaryRevision;
  const visible = useMemo(() => new Set(ordinaryRevision.nodes.map(n => n.id)), [ordinaryRevision]);
  const graph = useMemo(() => {
    if (omni || ordinaryRevision === fullRevision) return fullGraph;
    if (fullGraph === fullRevision) return ordinaryRevision;
    return { ...ordinaryRevision, nodes: fullGraph.nodes.filter(n => visible.has(n.id)) };
  }, [fullGraph, fullRevision, ordinaryRevision, omni, visible]);
  return { graph, revision, fullRevision, ordinaryRevision };
}

function noticeEnvironment(graph: Graph, sessionId: string) {
  const sources = new Set(graph.edges.filter(e => (e.kind ?? 'data') === 'data').map(e => e.source));
  const nodes = graph.nodes.filter(n => sources.has(n.id));
  const assetIds = new Set(nodes.flatMap(({ data: d }) => d.kind === 'asset' && d.assetId ? [d.assetId] : []));
  const generationIds = new Set(nodes.flatMap(({ data: d }) => 'generationId' in d && d.generationId ? [d.generationId] : []));
  const refs = nodes.filter(({ data: d }) => d.kind === 'ref' &&
    (d.type === 'chat' || d.type === 'agent' || (d.type === 'prompt' && d.ref === 'composer')));
  const reads = new Map<string, { keys: unknown[]; value: string | undefined }>();
  const firstOwners = new WeakMap<Graph['nodes'], Map<string, string>>();
  const firstOwner = (nodes: Graph['nodes'], type: string) => {
    let owners = firstOwners.get(nodes);
    if (!owners) {
      owners = new Map<string, string>();
      for (const n of nodes) if (n.data.kind === 'ref' && !owners.has(n.data.type)) owners.set(n.data.type, n.id);
      firstOwners.set(nodes, owners);
    }
    return owners.get(type);
  };
  let previous: AppState | undefined;
  let revision: unknown[] | undefined;
  let env: ResolveEnv;
  return (s: AppState): ResolveEnv => {
    const before = previous;
    previous = s;
    if (before && s.assets === before.assets && s.generations === before.generations &&
        ((s.sessions === before.sessions && s.composer.text === before.composer.text) || refs.every(({ data: d }) => {
          if (d.kind !== 'ref') return true;
          if (d.type === 'prompt') return s.composer.text === before.composer.text;
          const session = s.sessions[d.ref];
          const old = before.sessions[d.ref];
          if (session?.feed !== old?.feed) return false;
          const nodes = session?.graph.nodes;
          const oldNodes = old?.graph.nodes;
          return d.ref === sessionId || nodes === oldNodes ||
            (nodes && firstOwner(nodes, d.type)) === (oldNodes && firstOwner(oldNodes, d.type));
        }))) return env;

    const keys: unknown[] = [];
    const assets: Record<string, Asset> = {};
    const generations: Record<string, Generation> = {};
    const texts = new Map<string, string | undefined>();
    for (const id of assetIds) {
      const asset = s.assets[id];
      keys.push(asset);
      if (asset) assets[id] = asset;
    }
    for (const id of generationIds) {
      const gen = s.generations[id];
      keys.push(gen?.id, gen?.text, gen?.assetIds);
      if (gen) generations[id] = gen;
    }
    for (const node of refs) {
      const d = node.data;
      if (d.kind !== 'ref') continue;
      const session = d.type === 'prompt' ? undefined : s.sessions[d.ref];
      const owners = session && (d.ref === sessionId ? graph.nodes : session.graph.nodes);
      const input = d.type === 'prompt' ? [s.composer.text] : [session?.feed, owners && firstOwner(owners, d.type)];
      let read = reads.get(node.id);
      if (!read || !shallow(read.keys, input)) {
        read = { keys: input, value: sessionChatText(node) };
        reads.set(node.id, read);
      }
      texts.set(node.id, read.value);
      keys.push(read.value);
    }
    if (!revision || !shallow(revision, keys)) {
      revision = keys;
      env = { assets, generations, chatText: node => {
        const d = node.data;
        return d.kind === 'ref' && d.type === 'prompt' && d.ref !== 'composer' ? d.promptText ?? '' : texts.get(node.id);
      } };
    }
    return env;
  };
}

export function useCanvasNotices(fullRevision: Graph, ordinaryRevision: Graph, omni: boolean, sessionId: string) {
  const selectEnv = useMemo(() => noticeEnvironment(fullRevision, sessionId), [fullRevision, sessionId]);
  const env = useStore(selectEnv);
  const all = useMemo(() => graphNotices(fullRevision, env), [fullRevision, env]);
  const ordinary = useMemo(() => {
    if (ordinaryRevision === fullRevision) return all;
    const nodeIds = new Set(ordinaryRevision.nodes.map(n => n.id));
    const edgeIds = new Set(ordinaryRevision.edges.map(e => e.id));
    return all.filter(n => nodeIds.has(n.nodeId) && (n.kind === 'port' || edgeIds.has(n.edgeId)));
  }, [all, fullRevision, ordinaryRevision]);
  const notices = omni ? all : ordinary;
  const spaceProblems = useMemo(() => summarizeNotices(ordinary), [ordinary]);
  const keepPorts = useMemo(() => {
    let previous = new Map<string, PortNotice[]>();
    return (byPort: Map<string, PortNotice[]>) => {
      for (const [id, current] of byPort) {
        const ports = previous.get(id);
        if (ports?.length === current.length && ports.every((p, i) => shallow(p, current[i]))) byPort.set(id, ports);
      }
      if (!shallow(previous, byPort)) previous = byPort;
      return previous;
    };
  }, []);
  const { byPort, byCable } = useMemo(() => {
    const byPort = new Map<string, PortNotice[]>();
    const byCable = new Map<string, CableNotice>();
    for (const notice of notices) {
      if (notice.kind !== 'port') byCable.set(notice.edgeId, notice);
      else {
        const ports = byPort.get(notice.nodeId);
        if (ports) ports.push(notice);
        else byPort.set(notice.nodeId, [notice]);
      }
    }
    return { byPort: keepPorts(byPort), byCable };
  }, [notices, keepPorts]);
  return { notices, byPort, byCable, spaceProblems };
}
