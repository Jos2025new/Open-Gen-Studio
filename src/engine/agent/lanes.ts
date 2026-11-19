import { patchSession, toast, useStore } from '../../store/store';
import type { AgentState } from '../types';

/*
 * One agent state per agent node (ADR 0031, strip 2). `session.agent` stays the state of the agent that is active
 * (every existing reader keeps working); the others are parked in `agentLanes`. Switching the recipient parks the
 * current state and loads the target's: its own history, open cards, notes and request. The first agent to be written
 * to inherits whatever the session already had, so no saved conversation is lost or split.
 */
declare module '../types' {
  interface Session {
    /** The agent node whose state `agent` currently holds. Absent: a session from before agent instances. */
    agentLane?: string;
    /** The parked states of the other agent nodes. */
    agentLanes?: Record<string, AgentState>;
  }
}

/** Choices that belong to the work, not to one agent: they carry across instances. */
const SHARED = ['settings', 'switchedTo', 'enhance'] as const;

export const freshAgent = (): AgentState => ({ history: [], questionRound: 0, notes: [], busy: false });

/** Make `nodeId`'s state the active one. Returns why it cannot (an agent is mid-turn), or null. */
export function enterLane(sessionId: string, nodeId: string): string | null {
  const s = useStore.getState().sessions[sessionId];
  if (!s || s.agentLane === nodeId) return null;
  if (s.agentLane === undefined) { patchSession(sessionId, (x) => ({ ...x, agentLane: nodeId })); return null; }
  if (s.agent.busy) return 'The other agent is still working. Wait for it or stop it before writing to this one.';
  patchSession(sessionId, (x) => {
    const { [nodeId]: parked, ...others } = x.agentLanes ?? {};
    const shared = Object.fromEntries(SHARED.filter((k) => x.agent[k] !== undefined).map((k) => [k, x.agent[k]]));
    return { ...x, agentLane: nodeId, agentLanes: { ...others, [x.agentLane!]: x.agent }, agent: { ...(parked ?? freshAgent()), ...shared } };
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

/** The state of an agent instance, active or parked (read-only). */
export function laneState(sessionId: string, nodeId: string): AgentState | undefined {
  const s = useStore.getState().sessions[sessionId];
  if (!s) return undefined;
  return s.agentLane === nodeId ? s.agent : s.agentLanes?.[nodeId];
}
