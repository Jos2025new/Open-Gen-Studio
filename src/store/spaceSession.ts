import type { Session } from '../engine/types';
import { createSession, useStore } from './store';

/** The container is marked, never stored by id: it survives being recreated. */
export const isSpaceSession = (s: Session | undefined): boolean => s?.hidden === true;

const marked = (sessions: Record<string, Session>): Session | undefined => Object.values(sessions).find(isSpaceSession);

/** Preview a direct send's budget in its destination without creating a session. */
export function sendSessionId(st: ReturnType<typeof useStore.getState>): string {
  return st.ui.space ? marked(st.sessions)?.id ?? '__pending_space_session__' : st.activeSessionId;
}

/** Resolve the same destination when the user confirms or starts a send. */
export function ensureSendSession(): string {
  const st = useStore.getState();
  return st.ui.space ? ensureSpaceSession() : st.activeSessionId;
}

/** Session lists, Home and the search: never the hidden container. */
export function visibleSessions(sessions: Record<string, Session>): Session[] {
  return Object.values(sessions).filter((s) => !isSpaceSession(s));
}

/** Find the container or add an empty one, without touching the active session (that would close the Space). */
export function ensureSpaceSession(): string {
  const found = marked(useStore.getState().sessions);
  if (found) return found.id;
  const s: Session = { ...createSession('Spaces'), hidden: true, titleLocked: true };
  useStore.setState((cur) => ({ sessions: { ...cur.sessions, [s.id]: s } }));
  return s.id;
}
