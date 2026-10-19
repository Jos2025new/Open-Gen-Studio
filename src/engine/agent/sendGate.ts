import { useStore } from '../../store/store';
import { mayStartWork } from '../../lib/writerLock';

/** Whether the agent takes a message now: the active session exists, is not busy and this tab holds the writer lock. Read fresh from the store (the same test sendAgentMessage makes, synchronously). */
export function agentAccepts(): boolean {
  const st = useStore.getState();
  const s = st.sessions[st.activeSessionId];
  return Boolean(s) && !s.agent.busy && mayStartWork();
}
