import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, deleteAssetBlobs: async () => undefined }));
import { createSession, useStore } from '../src/store/store';
import { setSessionsArchived } from '../src/store/sessionArchive';
import { persistState } from '../src/store/persistJson';
import { deleteSession } from '../src/engine/actions';

describe('session archive', () => {
  it('keeps session contents and activity time through serialization and restore', () => {
    const first = { ...createSession('One'), updatedAt: 1234 };
    const second = createSession('Two');
    useStore.setState({ sessions: { [first.id]: first, [second.id]: second }, activeSessionId: first.id });
    setSessionsArchived([first.id], true);
    const state = useStore.getState();
    expect(state.sessions[first.id]).toEqual({ ...first, archived: true });
    expect(state.activeSessionId).toBe(second.id);
    const saved = JSON.parse(persistState({ state: { sessions: state.sessions } }).text());
    expect(saved.state.sessions[first.id].archived).toBe(true);
    expect(saved.state.sessions[first.id].updatedAt).toBe(1234);
    setSessionsArchived([first.id], false);
    expect(useStore.getState().sessions[first.id]).toEqual({ ...first, archived: undefined });
  });

  it('keeps the archived session and creates a new active session when archiving the last one', () => {
    const only = createSession('Last');
    useStore.setState({ sessions: { [only.id]: only }, activeSessionId: only.id });
    setSessionsArchived([only.id], true);
    const state = useStore.getState();
    expect(state.sessions[only.id].archived).toBe(true);
    expect(state.activeSessionId).not.toBe(only.id);
    expect(state.sessions[state.activeSessionId].archived).toBeFalsy();
  });

  it('does not open an archived session when the last recent session is deleted', () => {
    const archived = { ...createSession('Archived'), archived: true };
    const recent = createSession('Recent');
    useStore.setState({ sessions: { [archived.id]: archived, [recent.id]: recent }, activeSessionId: recent.id, assets: {}, generations: {}, library: [] });
    deleteSession(recent.id);
    const state = useStore.getState();
    expect(state.sessions[archived.id].archived).toBe(true);
    expect(state.activeSessionId).not.toBe(archived.id);
    expect(state.sessions[state.activeSessionId].archived).toBeFalsy();
  });
});
