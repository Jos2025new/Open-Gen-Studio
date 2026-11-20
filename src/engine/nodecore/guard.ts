import type { Graph } from '../types';
import { findCycle } from './deps';
import { descriptorOf } from './registry';
import { resolveInputs, storeEnv, type ResolveEnv } from './resolver';

/**
 * What stops an action before anything is spent (ADR 0031 points 2 and 4): a cycle through a node it runs, and an
 * invalid cable on a required input. The planner handles unpinned type mismatches as absent inputs. A deletion tombstone
 * only blocks while the required port it used is still empty.
 */
export function runProblems(graph: Graph, runIds: string[], env: ResolveEnv): string[] {
  const problems: string[] = [];
  const cycle = findCycle(graph, env.assets);
  if (cycle && cycle.some((id) => runIds.includes(id))) problems.push(`The graph contains a cycle (${cycle.join(' → ')}).`);
  for (const id of runIds) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) continue;
    const required = descriptorOf(node.data.kind)?.required ?? [];
    const inputs = resolveInputs(graph, node, env);
    for (const input of inputs) {
      if (input.status !== 'invalid' || (input.incompatible && input.mode === 'moving') || !required.includes(input.port)) continue;
      if (input.lost && inputs.some(i => i.port === input.port && i.status !== 'invalid' && !i.incompatible)) continue;
      // A deleted source is not an invalid cable: the input is simply empty, and the run waits for it.
      problems.push(input.lost ? `“${node.data.title}”: the ${input.port} input is empty (its source was deleted).` : `“${node.data.title}”: the ${input.port} cable is invalid. ${input.reason ?? ''}`.trim());
    }
  }
  return problems;
}

/** What the approval also covers: each node's type version and the revision and validity of every input it reads. */
export function coreSignature(graph: Graph, ids: string[]) {
  const env = storeEnv();
  return ids.map((id) => {
    const n = graph.nodes.find((x) => x.id === id);
    if (!n) return [id, 'missing'];
    return [id, descriptorOf(n.data.kind)?.version, resolveInputs(graph, n, env).map((i) => [i.port, i.edgeId, i.revision, i.status])];
  });
}
