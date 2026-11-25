import { useStore } from '../../store/store';

/** The Designer document the user is on, if any. */
export function useDesign() {
  const sessionId = useStore((s) => s.activeSessionId);
  const docId = useStore((s) => {
    if (s.ui.workspace !== 'designer' || s.ui.home) return undefined;
    const docs = s.sessions[s.activeSessionId]?.docs.filter((d) => d.view !== 'studio' && d.library?.view !== 'studio') ?? [];
    return (docs.find((d) => d.id === s.sessions[s.activeSessionId].activeDocId) ?? docs[0])?.id;
  });
  return { sessionId, docId };
}
