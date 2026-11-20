import type { GraphNodeData } from '../graphTypes';

/** Pure pieces of what a node computes from its parameters and resolved inputs. */

/** The prompt a generation sends: the text wired into `prompt` first, then the node's own words. */
export function composePrompt(data: GraphNodeData, wired: unknown): string {
  return 'prompt' in data ? [typeof wired === 'string' ? wired.trim() : '', data.prompt.trim()].filter(Boolean).join('\n') : '';
}
