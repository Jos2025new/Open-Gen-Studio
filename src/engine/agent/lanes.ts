import { patchSession, toast, useStore } from '../../store/store';
import type { AgentState } from '../types';

/*
 * One live state per agent node, in a map by agent id inside the session (ADR 0031, strip 2): `session.agents`.
 * Nothing is parked or restored: an operation names the agent it belongs to and reads or writes that entry
 * (`laneState`, `patchLane`), so agent A can be mid-turn while B answers and nothing crosses. `session.agentLane` is
 * only which agent is on screen, and `session.agent` is that entry projected for the readers of the UI (the store keeps
 * both in step in one place: `syncAgents`). A session saved before agents had instances is migrated on load.
 */
declare module '../types' {
  interface Session {
    /** The agent node on screen. Absent: a session from before agent instances. */
    agentLane?: string;
    /** The live state of every agent node, by node id. */
    agents?: Record<string, AgentState>;
  }
}

/** Choices that belong to the work, not to one agent: they carry across instances. */
const SHARED = ['settings', 'switchedTo', 'enhance'] as const;

export const freshAgent = (): AgentState => ({ history: [], questionRound: 0, notes: [], busy: false });

/** Show `nodeId`'s agent. Only the pointer moves; no state is copied away, so another agent's turn is untouched. Always null. */
export function enterLane(sessionId: string, nodeId: string): string | null {
  const s = useStore.getState().sessions[sessionId];
  if (!s || s.agentLane === nodeId) return null;
  patchSession(sessionId, (x) => {
    if (x.agentLane === undefined) return { ...x, agentLane: nodeId, agents: { ...x.agents, [nodeId]: x.agent } }; // the first agent inherits what the session had
    // The shared choices fill what the target lacks; they never overwrite its own (it may be mid-turn).
    const target = x.agents?.[nodeId] ?? freshAgent();
    const shared = Object.fromEntries(SHARED.filter((k) => x.agent[k] !== undefined && target[k] === undefined).map((k) => [k, x.agent[k]]));
    const mine = { ...target, ...shared };
    return { ...x, agentLane: nodeId, agents: { ...x.agents, [nodeId]: mine }, agent: mine };
  });
  return null;
}

/** The agent node that owns a feed item (its message or card), when it names one. */
export function laneOfItem(sessionId: string, itemId: string): string | undefined {
  const item = useStore.getState().sessions[sessionId]?.feed.find((f) => f.id === itemId) as { meta?: { agentNodeId?: string } } | undefined;
  return item?.meta?.agentNodeId;
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

/** The state of an agent instance (read-only). An id the session has no entry for reads as no state. */
export function laneState(sessionId: string, nodeId: string | undefined): AgentState | undefined {
  const s = useStore.getState().sessions[sessionId];
  if (!s) return undefined;
  if (!nodeId || s.agentLane === undefined) return s.agent;
  return s.agents?.[nodeId] ?? (s.agentLane === nodeId ? s.agent : undefined);
}

/**
 * Write to one agent's state by id: an operation that belongs to an agent (its turn, the end of its plan, a rewrite on
 * its card, the edit of its message) never lands in whichever agent happens to be on screen. Without an id it is the
 * agent on screen.
 */
export function patchLane(sessionId: string, nodeId: string | undefined, patch: Partial<AgentState> | ((a: AgentState) => Partial<AgentState>)): void {
  const resolve = (a: AgentState) => ({ ...a, ...(typeof patch === 'function' ? patch(a) : patch) });
  patchSession(sessionId, (x) => {
    if (nodeId && x.agentLane !== undefined) return { ...x, agents: { ...x.agents, [nodeId]: resolve(x.agents?.[nodeId] ?? (x.agentLane === nodeId ? x.agent : freshAgent())) } };
    return { ...x, agent: resolve(x.agent) };
  });
}
