import { agentNodeOf, chatAgents, chatNodeOf, get } from './runtimeShared';

/**
 * Who a chat message is for (ADR 0031, strip 2): the agent named by the caller, else the one the chat node was set
 * to, else the first agent wired to the chat (what always happened), else the session's first agent. An id that is
 * not an agent node of the session is an error, never a silent fallback to another agent.
 */
export function recipientOf(sessionId: string, explicit?: string): { id?: string; error?: string } {
  const nodes = get().sessions[sessionId]?.graph.nodes ?? [];
  const isAgent = (id: string | undefined) => nodes.some((n) => n.id === id && n.data.kind === 'ref' && n.data.type === 'agent');
  if (explicit !== undefined) return isAgent(explicit) ? { id: explicit } : { error: `No such agent node: ${explicit}.` };
  const chat = nodes.find((n) => n.id === chatNodeOf(sessionId))?.data;
  const set = chat?.kind === 'ref' ? chat.recipient : undefined;
  const connected = chatAgents(sessionId);
  if (set && isAgent(set) && (!connected.length || connected.includes(set))) return { id: set };
  return { id: connected[0] ?? agentNodeOf(sessionId)?.id };
}
