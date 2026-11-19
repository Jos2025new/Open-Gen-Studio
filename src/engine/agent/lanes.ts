import { patchSession, useStore } from '../../store/store';
import type { AgentState, Session } from '../types';
import { allThreads, feedOwner, firstAgentId, freshAgent, shownThread, threadOf, withThread } from './threads';

export { allThreads, freshAgent, shownThread, threadOf };

/*
 * One thread per agent node, `session.agents[id]` (agent/threads.ts). An operation names the agent it belongs to and reads or
 * writes that thread (`laneState`, `patchLane`), so agent A can be mid-turn while B answers and nothing crosses.
 * `session.agentLane` only says which thread the UI shows.
 */
/** Choices that belong to the work, not to one agent: they carry across instances. */
const SHARED = ['settings', 'switchedTo', 'enhance'] as const;

/** A deleted agent's thread goes with it. */
const removed = new Set<string>();
const RETIRED_KEPT = 8;
export function dropThread(sessionId: string, nodeId: string): void {
  removed.add(`${sessionId}|${nodeId}`);
  // The thread leaves the live ones but is kept (the last RETIRED_KEPT): undoing the deletion, by any path, gives the agent its memory back.
  patchSession(sessionId, (x) => (x.agents[nodeId] ? { ...x, agents: Object.fromEntries(Object.entries(x.agents).filter(([k]) => k !== nodeId)), retired: Object.fromEntries(Object.entries({ ...x.retired, [nodeId]: x.agents[nodeId] }).slice(-RETIRED_KEPT)), ...(x.agentLane === nodeId ? { agentLane: undefined } : {}) } : x));
}

/** Show `nodeId`'s agent. Only the pointer moves; no state is copied away, so another agent's turn is untouched. */
export function enterLane(sessionId: string, nodeId: string): void {
  removed.delete(`${sessionId}|${nodeId}`); // a node that comes back (undo) starts a thread again
  const s = useStore.getState().sessions[sessionId];
  if (!s || s.agentLane === nodeId) return;
  patchSession(sessionId, (x) => {
    const from = shownThread(x);
    const agents = withThread(x.agents, nodeId, firstAgentId(x.graph), x.retired);
    // The shared choices fill what the target lacks; they never overwrite its own (it may be mid-turn).
    const target = agents[nodeId];
    const shared = from && from !== target ? Object.fromEntries(SHARED.filter((k) => from[k] !== undefined && target[k] === undefined).map((k) => [k, from[k]])) : {};
    return { ...x, agentLane: nodeId, agents: { ...agents, [nodeId]: { ...target, ...shared } } };
  });
}

/** The agent whose thread a thing belongs to: the one named, else the session's first agent node, else its main thread. Never the one on screen. */
export function resolveOwner(sessionId: string, named?: string): string {
  if (named) return named;
  return firstAgentId(useStore.getState().sessions[sessionId]?.graph);
}

/** The agent that owns a feed item (its message or card): the one it names, else (a row from before agent ids) the first. */
export function laneOfItem(sessionId: string, itemId: string): string {
  const s = useStore.getState().sessions[sessionId];
  const item = s?.feed.find((f) => f.id === itemId);
  return (item && feedOwner(item, 'agent', undefined)) || firstAgentId(s?.graph);
}

/** A card action belongs to the agent that raised the card: bring its thread forward first, and say who it is. */
export function claimLaneOfItem(sessionId: string, itemId: string): string {
  const owner = laneOfItem(sessionId, itemId);
  enterLane(sessionId, owner);
  return owner;
}

/** Which agent's thread the UI shows (a choice of display only: nothing is ever written through it). */
export const viewedLane = (s: Session | undefined): string | undefined => s?.agentLane;

/** The state of an agent instance (read-only). An id the session has no thread for reads as no state. */
export const laneState = (sessionId: string, nodeId: string): AgentState | undefined => threadOf(useStore.getState().sessions[sessionId], nodeId);

/** The same thread, or a fresh one when the agent has none (a read that must not fail). `laneState` tells a missing thread from an empty one. */
export const agentOf = (sessionId: string, nodeId: string): AgentState => laneState(sessionId, nodeId) ?? freshAgent();

/**
 * Write to one agent's state by id: an operation that belongs to an agent (its turn, the end of its plan, a rewrite on
 * its card, the edit of its message) never lands in whichever agent happens to be on screen. Without an id it is the
 * agent on screen.
 */
export function patchLane(sessionId: string, nodeId: string, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  patchSession(sessionId, (x) => {
    const key = nodeId;
    // A turn that outlives its agent node (deleted in flight) writes nothing: its thread is gone and does not come back.
    if (!x.agents[key] && removed.has(`${sessionId}|${key}`) && !x.graph.nodes.some((n) => n.id === key)) return x;
    const agents = withThread(x.agents, key, firstAgentId(x.graph), x.retired);
    const a = agents[key];
    return { ...x, agents: { ...agents, [key]: { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } } };
  });
}
