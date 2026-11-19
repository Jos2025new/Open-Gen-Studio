import type { GraphNodeData } from '../graphTypes';

/** Pure pieces of what a node computes from its parameters and resolved inputs (ADR 0031 point 1: `evaluate`). */

/** The prompt a generation sends: the text wired into `prompt` first, then the node's own words. */
export function composePrompt(data: GraphNodeData, wired: unknown): string {
  return 'prompt' in data ? [typeof wired === 'string' ? wired.trim() : '', data.prompt.trim()].filter(Boolean).join('\n') : '';
}

export interface Evaluation { value?: string | null; prompt?: string }

export type ResolvedLite = { port: string; value: string | null }[];

export function evaluateNode(data: GraphNodeData, incoming: ResolvedLite): Evaluation {
  const wired = incoming.find((i) => i.port === 'prompt')?.value;
  switch (data.kind) {
    case 'text': return { value: data.text };
    case 'asset': return { value: data.sketchAssetId ?? data.assetId };
    case 'ref': return { value: null };
    default: return { prompt: composePrompt(data, wired) };
  }
}
