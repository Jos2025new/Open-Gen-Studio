import { truncate } from '../../lib/format';
import { OPS } from '../ops';
import type { Generation, Graph, GraphNode } from '../types';
import { nodeOutputAsset, runsGeneration } from './graph';

/* Compact views of the node graph for the agent: an index in the context and read_graph on demand.
   Derived on each call from session.graph; nothing is stored. */

export const GRAPH_PAGE = 40;
const MAX_DETAIL = 10;

function kindOf(n: GraphNode): string {
  return n.data.kind === 'tool' ? `tool:${n.data.op}` : n.data.kind;
}

function statusOf(n: GraphNode, generations: Record<string, Generation>): string {
  const d = n.data;
  if (d.kind === 'text') return d.text.trim() ? 'text' : 'empty';
  if (d.kind === 'asset') return d.assetId ? 'done' : 'empty';
  if (runsGeneration(d)) {
    const g = d.generationId ? generations[d.generationId] : undefined;
    return g ? g.status : 'not run';
  }
  return '';
}

function indexLine(graph: Graph, n: GraphNode, generations: Record<string, Generation>, selected: Set<string>): string {
  const ins = graph.edges.filter((e) => e.target === n.id).length;
  const outs = graph.edges.filter((e) => e.source === n.id).length;
  const asset = nodeOutputAsset(n, generations);
  return `  ${n.id} ${kindOf(n)} "${truncate(n.data.title, 40)}" ${statusOf(n, generations)}${asset ? ` → asset:${asset}` : ''} · in ${ins} · out ${outs}${selected.has(n.id) ? ' (selected)' : ''}`;
}

/** Context index: at most `limit` nodes, selected ones always included. */
export function graphIndex(graph: Graph, generations: Record<string, Generation>, selectedIds: string[], limit = GRAPH_PAGE): string {
  const selected = new Set(selectedIds.filter((id) => graph.nodes.some((n) => n.id === id)));
  const shown = graph.nodes.filter((n) => selected.has(n.id));
  for (const n of graph.nodes) {
    if (shown.length >= Math.max(limit, selected.size)) break;
    if (!selected.has(n.id)) shown.push(n);
  }
  const lines = [`node graph: ${graph.nodes.length} nodes, ${graph.edges.length} connections (new flows are placed beside existing ones)`];
  lines.push(...shown.map((n) => indexLine(graph, n, generations, selected)));
  const more = graph.nodes.length - shown.length;
  if (more > 0) lines.push(`  +${more} more: read_graph({offset}) lists them`);
  lines.push(
    selected.size
      ? 'The user selected the nodes marked (selected): they are what "this", "it" or an unnamed image refers to.'
      : 'No node is selected: if the request could mean several nodes, ask which one.',
  );
  return lines.join('\n');
}

/** read_graph: a page of the index without ids; details of up to 10 nodes with ids. */
export function readGraph(graph: Graph, generations: Record<string, Generation>, selectedIds: string[], input: { node_ids?: string[]; offset?: number }): string {
  const selected = new Set(selectedIds);
  if (!input.node_ids?.length) {
    const offset = Math.max(0, Math.floor(input.offset ?? 0));
    const page = graph.nodes.slice(offset, offset + GRAPH_PAGE);
    if (!page.length) return `No nodes from offset ${offset} (the graph has ${graph.nodes.length}).`;
    const end = offset + page.length;
    return [
      `nodes ${offset + 1}–${end} of ${graph.nodes.length}:`,
      ...page.map((n) => indexLine(graph, n, generations, selected)),
      ...(end < graph.nodes.length ? [`next page: read_graph({offset: ${end}})`] : []),
    ].join('\n');
  }
  const title = (id: string) => graph.nodes.find((n) => n.id === id)?.data.title ?? '?';
  return input.node_ids
    .slice(0, MAX_DETAIL)
    .map((id) => {
      const n = graph.nodes.find((x) => x.id === id);
      if (!n) return `${id}: no such node`;
      const d = n.data;
      const lines = [`${n.id} ${kindOf(n)} "${d.title}"${selected.has(n.id) ? ' (selected)' : ''}`, `  status: ${statusOf(n, generations)}`];
      if (runsGeneration(d) && d.generationId) {
        const g = generations[d.generationId];
        if (g?.error) lines.push(`  error: ${truncate(g.error, 160)}`);
      }
      if (d.kind === 'text') lines.push(`  text: ${truncate(d.text, 400)}`);
      if (d.kind === 'tool') lines.push(`  op: ${OPS[d.op].label}`);
      if (d.kind === 'image' || d.kind === 'video' || d.kind === 'audio' || d.kind === 'model3d') {
        lines.push(`  model: ${d.modelRef}`);
        if (d.prompt.trim()) lines.push(`  prompt: ${truncate(d.prompt, 400)}`);
      }
      const asset = nodeOutputAsset(n, generations);
      lines.push(asset ? `  output: asset:${asset} (use it in plans)` : '  output: none yet');
      const ins = graph.edges.filter((e) => e.target === n.id).map((e) => `${e.targetHandle} ← ${e.source} "${title(e.source)}"`);
      const outs = graph.edges.filter((e) => e.source === n.id).map((e) => `${e.target} "${title(e.target)}" (${e.targetHandle})`);
      lines.push(`  inputs: ${ins.join('; ') || 'none'}`, `  feeds: ${outs.join('; ') || 'nothing'}`);
      return lines.join('\n');
    })
    .join('\n\n');
}
