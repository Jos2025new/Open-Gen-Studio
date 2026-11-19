import { useStore } from '../../store/store';
import { threadOf } from './lanes';
import { getWriterState, mayStartWork } from '../../lib/writerLock';

/** Whether the agent takes a message now: the active session exists, is not busy and this tab holds the writer lock. Read fresh from the store (the same test sendAgentMessage makes, synchronously). */
export function agentAccepts(agentNodeId: string): boolean {
  const st = useStore.getState();
  const s = st.sessions[st.activeSessionId];
  // The agent addressed decides, not the one on screen: A at work does not stop a message to B.
  const a = threadOf(s, agentNodeId);
  // A message is new work: with another tab asking for the lock it waits, even if some other agent is still finishing (`mayStartWork` lets that one continue its own turn).
  return Boolean(s) && !a?.busy && mayStartWork() && !getWriterState().requested;
}
