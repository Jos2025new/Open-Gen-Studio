import { createSession, useStore } from './store';

/** Archive without deleting or rewriting a session's contents or last activity time. */
export function setSessionsArchived(ids: string[], archived: boolean): void {
  const selected = new Set(ids);
  useStore.setState((state) => {
    const sessions = { ...state.sessions };
    let changed = false;
    for (const id of selected) {
      const session = sessions[id];
      if (!session || session.hidden || Boolean(session.archived) === archived) continue;
      sessions[id] = { ...session, archived: archived || undefined };
      changed = true;
    }
    if (!changed) return {};
    let activeSessionId = state.activeSessionId;
    if (sessions[activeSessionId]?.archived) {
      const recent = Object.values(sessions).filter((s) => !s.hidden && !s.archived).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (recent) activeSessionId = recent.id;
      else {
        const fresh = createSession();
        sessions[fresh.id] = fresh;
        activeSessionId = fresh.id;
      }
    }
    return { sessions, activeSessionId };
  });
}
