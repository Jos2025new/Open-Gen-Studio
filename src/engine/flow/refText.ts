import { useStore } from '../../store/store';
import type { GraphNode } from '../types';

/**
 * The real text a chat or agent node delivers through its data `out` port: the chat's last user message, the agent's
 * last reply. Undefined when the node is not a chat/agent or its session is gone (an invalid ref delivers nothing).
 */
export function refNodeText(node: GraphNode | undefined): string | undefined {
  const d = node?.data;
  if (d?.kind !== 'ref' || (d.type !== 'chat' && d.type !== 'agent')) return undefined;
  const feed = useStore.getState().sessions[d.ref]?.feed ?? [];
  const wanted = d.type === 'chat' ? 'user' : 'assistant';
  const last = [...feed].reverse().find((f) => f.type === wanted && 'text' in f);
  return last && 'text' in last ? last.text : undefined;
}
