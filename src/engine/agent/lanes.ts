import { patchSession, toast, useStore } from '../../store/store';
import type { AgentState, Session } from '../types';
import { allThreads, firstAgentId, freshAgent, shownKey, shownThread, threadOf, withThread } from './threads';

export { allThreads, freshAgent, shownThread, threadOf };

/*
 * One thread per agent node, `session.agents[id]` (agent/threads.ts). An operation names the agent it belongs to and reads or
 * writes that thread (`laneState`, `patchLane`), so agent A can be mid-turn while B answers and nothing crosses.
 * `session.agentLane` only says which thread the UI shows.
 */
/** Choices that belong to the work, not to one agent: they carry across instances. */
const SHARED = ['settings', 'switchedTo', 'enhance'] as const;

/** Show `nodeId`'s agent. Only the pointer moves; no state is copied away, so another agent's turn is untouched. Always null. */
export function enterLane(sessionId: string, nodeId: string): string | null {
  const s = useStore.getState().sessions[sessionId];
  if (!s || s.agentLane === nodeId) return null;
  patchSession(sessionId, (x) => {
    const from = shownThread(x);
    const agents = withThread(x.agents, nodeId);
    // The shared choices fill what the target lacks; they never overwrite its own (it may be mid-turn).
    const target = agents[nodeId];
    const shared = from && from !== target ? Object.fromEntries(SHARED.filter((k) => from[k] !== undefined && target[k] === undefined).map((k) => [k, from[k]])) : {};
    return { ...x, agentLane: nodeId, agents: { ...agents, [nodeId]: { ...target, ...shared } } };
  });
  return null;
}

/** The agent whose thread a thing belongs to: the one named, else the session's first agent node, else its main thread. Never the one on screen. */
export function resolveOwner(sessionId: string, named?: string): string {
  if (named) return named;
  return firstAgentId(useStore.getState().sessions[sessionId]?.graph);
}

/** The agent that owns a feed item (its message or card): the one it names, else (a row from before agent ids) the first. */
export function laneOfItem(sessionId: string, itemId: string): string {
  const item = useStore.getState().sessions[sessionId]?.feed.find((f) => f.id === itemId) as { meta?: { agentNodeId?: string } } | undefined;
  return resolveOwner(sessionId, item?.meta?.agentNodeId);
}

/**
 * A card action belongs to the agent that raised the card: bring its state forward first. Returns the reason it cannot
 * (another agent is mid-turn) after telling the user, so the caller stops before changing anything.
 */
export function claimLaneOfItem(sessionId: string, itemId: string): string | null {
  const owner = laneOfItem(sessionId, itemId);
  const why = owner ? enterLane(sessionId, owner) : null;
  if (why) toast(why, 'error');
  return why;
}

/** Which agent's thread the UI shows (a choice of display only: nothing is ever written through it). */
export const viewedLane = (s: Session | undefined): string | undefined => s?.agentLane;

/** The state of an agent instance (read-only). An id the session has no thread for reads as no state. */
export const laneState = (sessionId: string, nodeId: string): AgentState | undefined => threadOf(useStore.getState().sessions[sessionId], nodeId);

/**
 * Write to one agent's state by id: an operation that belongs to an agent (its turn, the end of its plan, a rewrite on
 * its card, the edit of its message) never lands in whichever agent happens to be on screen. Without an id it is the
 * agent on screen.
 */
export function patchLane(sessionId: string, nodeId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  patchSession(sessionId, (x) => {
    const key = nodeId ?? shownKey(x);
    const agents = withThread(x.agents, key);
    const a = agents[key];
    return { ...x, agents: { ...agents, [key]: { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } } };
  });
}
