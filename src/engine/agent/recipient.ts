import { resolveOwner } from './lanes';
import { chatAgents, chatNodeOf, get } from './runtimeShared';

/**
 * Who a chat message is for (ADR 0031, strip 2): the agent named by the caller, else the one the chat node was set
 * to, else the first agent wired to the chat (what always happened), else the session's first agent. A name that is
 * not an agent node, or a setting whose agent was deleted or disconnected, is an error: it is never replaced by
 * another agent. `chatNodeId` is the chat the message comes from (the composer inside that chat node).
 */
export function recipientOf(sessionId: string, explicit?: string, chatNodeId?: string): { id: string; error?: string } {
  const nodes = get().sessions[sessionId]?.graph.nodes ?? [];
  const isAgent = (id: string | undefined) => nodes.some((n) => n.id === id && n.data.kind === 'ref' && n.data.type === 'agent');
  if (explicit !== undefined) return isAgent(explicit) ? { id: explicit } : { id: resolveOwner(sessionId), error: `No such agent node: ${explicit}.` };
  const chatId = chatNodeId ?? chatNodeOf(sessionId);
  const chat = nodes.find((n) => n.id === chatId)?.data;
  const set = chat?.kind === 'ref' ? chat.recipient : undefined;
  const connected = chatAgents(sessionId, chatId);
  if (set) {
    if (isAgent(set) && connected.includes(set)) return { id: set };
    return { id: resolveOwner(sessionId), error: 'The agent chosen for this chat is no longer connected. Choose another one in “To”.' };
  }
  // A chat with no agent wired to it sends nowhere: it never falls back to some agent that merely exists in the graph.
  if (chat && !connected.length) return { id: resolveOwner(sessionId), error: 'This chat has no agent connected. Connect one to it.' };
  return { id: resolveOwner(sessionId, connected[0]) };
}
