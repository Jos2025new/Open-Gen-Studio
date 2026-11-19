import { useStore } from '../../store/store';
import { mayStartWork } from '../../lib/writerLock';

/** Whether the agent takes a message now: the active session exists, is not busy and this tab holds the writer lock. Read fresh from the store (the same test sendAgentMessage makes, synchronously). */
export function agentAccepts(agentNodeId?: string): boolean {
  const st = useStore.getState();
  const s = st.sessions[st.activeSessionId];
  // The agent addressed decides, not the one on screen: A at work does not stop a message to B.
  const a = agentNodeId && s?.agentLane !== undefined ? (s.agentLane === agentNodeId ? s.agent : s.agents?.[agentNodeId]) : s?.agent;
  return Boolean(s) && !a?.busy && mayStartWork();
}
