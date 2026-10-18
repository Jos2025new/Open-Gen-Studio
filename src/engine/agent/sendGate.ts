import { useStore } from '../../store/store';

/** Whether the agent takes a message now: the active session exists and is not busy. Read fresh from the store (the same test sendAgentMessage makes, synchronously). */
export function agentAccepts(): boolean {
  const st = useStore.getState();
  const s = st.sessions[st.activeSessionId];
  return Boolean(s) && !s.agent.busy;
}
