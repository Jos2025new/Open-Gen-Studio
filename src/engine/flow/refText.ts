import type { GraphNode } from '../types';
import { sessionChatText } from '../nodecore/resolver';

/** The real text a chat or agent node delivers through its data `out` port (the resolver owns the read). */
export function refNodeText(node: GraphNode | undefined): string | undefined {
  return node ? sessionChatText(node) : undefined;
}
