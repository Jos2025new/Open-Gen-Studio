import type { Session, SystemNodeType } from '../types';

/** What a new system node points at when nothing is given: the active session, the composer's model, and so on. */
export function systemRefDefault(type: SystemNodeType, activeSessionId: string, imageModelRef: string, session?: Session): string {
  const defaults: Record<SystemNodeType, string> = {
    chat: activeSessionId,
    agent: activeSessionId,
    session: activeSessionId,
    model: imageModelRef,
    provider: 'openrouter',
    space: 'create',
    'designer.doc': session?.activeDocId ?? session?.docs[0]?.id ?? 'active',
    library: 'library',
    toolset: 'toolset',
    prompt: 'composer',
    mediaSettings: 'image',
  };
  return defaults[type];
}
