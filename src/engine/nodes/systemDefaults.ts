import type { Session, SystemNodeType } from '../types';

/** What a default ref may depend on: the session the node lands in, the composer's image model and that session's data. */
export interface SystemRefCtx { sessionId: string; imageModelRef: string; session?: Session }

/**
 * What a new system node starts with, one entry per type (the exhaustive record makes `tsc` ask for a new type's entry).
 * `ref`: what it points at when nothing is given (`addSystemNode` uses the same value: prompt starts linked to the
 * composer, mediaSettings on 'image', which is what their consumers read).
 * The menu side of each type (label, icon, keywords) is `SYSTEM_UIS` in components/node/systemUi.ts.
 */
export const SYSTEM_DEFAULTS: Record<SystemNodeType, { ref: (c: SystemRefCtx) => string }> = {
  chat: { ref: (c) => c.sessionId },
  agent: { ref: (c) => c.sessionId },
  session: { ref: (c) => c.sessionId },
  model: { ref: (c) => c.imageModelRef },
  provider: { ref: () => 'openrouter' },
  space: { ref: () => 'create' },
  'designer.doc': { ref: (c) => c.session?.activeDocId ?? c.session?.docs[0]?.id ?? 'active' },
  library: { ref: () => 'library' },
  toolset: { ref: () => 'toolset' },
  prompt: { ref: () => 'composer' },
  mediaSettings: { ref: () => 'image' },
};

/** What a new system node points at when nothing is given: the active session, the composer's model, and so on. */
export function systemRefDefault(type: SystemNodeType, activeSessionId: string, imageModelRef: string, session?: Session): string {
  return SYSTEM_DEFAULTS[type].ref({ sessionId: activeSessionId, imageModelRef, session });
}
