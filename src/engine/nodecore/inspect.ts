import { useStore } from '../../store/store';
import { nodeIsCurrent, nodeRequest, stable, type RequestContext } from '../flow/freshness';
import { runsGeneration } from '../flow/graph';
import { consumersOf } from './deps';
import { descriptorOf } from './registry';
import { resolveInputs, storeEnv, type ResolvedInput } from './resolver';
import { digest } from './address';
import { ownerRev } from './revision';
import { lastAttemptFor, lastRunFor } from './action';

/**
 * The inspector (ADR 0031): one node seen through the resolver. Not a second system: every field is what the
 * preview, the freshness check and the run already use, read together. It has no state of its own.
 */
export interface NodeInspection {
  node: string;
  kind: string;
  version: number;
  revision: string;
  inputs: ResolvedInput[];
  /** Digest of type, version, parameters and resolved inputs: what freshness compares. */
  signature: string;
  /** For a node that runs: whether its last result is current, and why not. */
  fresh: boolean | null;
  staleReason?: string;
  /** Nodes that become stale when this one changes. */
  consumers: string[];
  lastRun?: { generationId: string; status: string; runId?: string; sends?: number };
  /** The latest attempt that targeted this node, apart from the run that made the result shown. */
  lastAttempt?: { runId: string; status: string; sends: number; error?: string };
}

export function inspectNode(session: string, nodeId: string, ctx: RequestContext = {}): NodeInspection | null {
  const st = useStore.getState();
  const graph = st.sessions[session]?.graph;
  const node = graph?.nodes.find((n) => n.id === nodeId);
  if (!graph || !node) return null;
  const d = descriptorOf(node.data.kind);
  const inputs = resolveInputs(graph, node, storeEnv());
  const request = nodeRequest(graph, node, st.generations, st.library, { schemas: st.catalog.schemas, assets: st.assets, ...ctx });
  const runs = runsGeneration(node.data);
  const fresh = runs ? nodeIsCurrent(graph, node, st.generations, st.library, { schemas: st.catalog.schemas, assets: st.assets, ...ctx }) : null;
  const gen = 'generationId' in node.data && node.data.generationId ? st.generations[node.data.generationId] : undefined;
  let staleReason: string | undefined;
  if (runs && !fresh) {
    const bad = inputs.find((i) => i.status === 'invalid' && !i.lost);
    staleReason = !gen ? 'It has not run yet.' : gen.status !== 'done' ? `The last run is ${gen.status}.` : bad ? `An input is invalid: ${bad.reason}` : 'Its parameters or inputs changed since the last result.';
  }
  const run = gen ? lastRunFor(session, gen.id) : undefined;
  const attempt = lastAttemptFor(session, nodeId);
  return {
    node: nodeId, kind: node.data.kind, version: d?.version ?? 0, revision: ownerRev(graph, nodeId), inputs,
    signature: digest(`${node.data.kind}@${d?.version ?? 0}:${stable(request)}`), fresh, ...(staleReason ? { staleReason } : {}),
    consumers: consumersOf(graph, [nodeId]),
    ...(gen ? { lastRun: { generationId: gen.id, status: gen.status, ...(run ? { runId: run.runId, sends: run.sends } : {}) } } : {}),
    ...(attempt ? { lastAttempt: { runId: attempt.runId, status: attempt.status, sends: attempt.sends, ...(attempt.error ? { error: attempt.error } : {}) } } : {}),
  };
}
