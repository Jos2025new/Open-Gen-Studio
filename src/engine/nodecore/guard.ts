import type { Graph } from '../types';
import { findCycle } from './deps';
import { descriptorOf } from './registry';
import { resolveInputs, type ResolveEnv } from './resolver';

/**
 * What stops an action before anything is spent (ADR 0031 points 2 and 4): a cycle through a node it runs, and an
 * invalid cable on an input the node's descriptor marks required. Optional inputs that are broken stay visible in the
 * inspector but do not block, so deleting a reference image never stops a prompt-only run.
 */
export function runProblems(graph: Graph, runIds: string[], env: ResolveEnv): string[] {
  const problems: string[] = [];
  const cycle = findCycle(graph);
  if (cycle && cycle.some((id) => runIds.includes(id))) problems.push(`The graph contains a cycle (${cycle.join(' → ')}).`);
  for (const id of runIds) {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) continue;
    const required = descriptorOf(node.data.kind)?.required ?? [];
    for (const input of resolveInputs(graph, node, env)) {
      if (input.status === 'invalid' && required.includes(input.port)) problems.push(`“${node.data.title}”: the ${input.port} cable is invalid. ${input.reason ?? ''}`.trim());
    }
  }
  return problems;
}
