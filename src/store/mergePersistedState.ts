import type { Session, Subject } from '../engine/types';
import { keptDrafts } from './homeDrafts';
import { sanitizeUi, type PersistedUi } from './persistUi';
import type { AppState } from './store';
import type { ComposerState, Settings } from './storeTypes';

export type Persisted = Pick<AppState, 'settings' | 'spentUsd' | 'spendLog' | 'sessions' | 'activeSessionId' | 'generations' | 'tickets' | 'assets' | 'library'> & {
  composer: Omit<ComposerState, 'editing'>;
  ui: PersistedUi;
};

export function mergePersistedState(
  persisted: unknown,
  current: AppState,
  defaults: Settings,
  loadedSession: (session: Session) => Session,
): AppState {
  const p = (persisted ?? {}) as Partial<Persisted>;
  const restored = p.sessions && Object.keys(p.sessions).length ? p.sessions : current.sessions;
  // A reload interrupts agent calls; nodes saved at an older descriptor version are migrated.
  const sessions = Object.fromEntries(Object.entries(restored).map(([id, s]) => [id, loadedSession(s)]));
  const activeSessionId = p.activeSessionId && sessions[p.activeSessionId] && !sessions[p.activeSessionId].hidden ? p.activeSessionId : Object.keys(sessions).find((id) => !sessions[id].hidden) ?? Object.keys(sessions)[0];
  const assets = p.assets ?? {};
  const ui = sanitizeUi({ ...current.ui, ...p.ui, homeDrafts: keptDrafts(p.ui?.homeDrafts, sessions) });
  // Home and a Space never show together; a missing tool input is dropped.
  if (ui.home && ui.space) ui.home = false;
  if (ui.toolAsset && !assets[ui.toolAsset]) ui.toolAsset = undefined;
  return {
    ...current,
    settings: {
      ...defaults,
      ...p.settings,
      keys: { ...defaults.keys, ...p.settings?.keys },
      agent: { ...defaults.agent, ...p.settings?.agent },
      ops: { ...defaults.ops, ...p.settings?.ops },
      notifications: { ...defaults.notifications, ...p.settings?.notifications },
    },
    spentUsd: p.spentUsd ?? 0,
    spendLog: p.spendLog ?? [],
    sessions,
    activeSessionId,
    generations: p.generations ?? {},
    tickets: p.tickets ?? {},
    assets,
    library: p.library ?? legacySubjects(restored),
    composer: { ...current.composer, ...p.composer, editing: null },
    ui,
  };
}

/** Before the global library, subjects lived in each session: copied once (first name wins); sessions keep theirs. */
export function legacySubjects(sessions: Record<string, Session>): Subject[] {
  const out: Subject[] = [];
  for (const s of Object.values(sessions)) {
    for (const x of s.subjects ?? []) if (!out.some((y) => y.name.toLowerCase() === x.name.toLowerCase())) out.push(x);
  }
  return out;
}
