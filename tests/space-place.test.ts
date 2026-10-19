// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { modeFor, placeFor, placeLabel } from '../src/engine/place';
import { ensureSpaceSession, isSpaceSession, visibleSessions } from '../src/store/spaceSession';
import { useStore } from '../src/store/store';
import { matchesMode, matchesPlace } from '../src/components/ui/PlaceModeFilter';

describe('place and mode at launch', () => {
  it('an open Space wins over the workspace under it', () => {
    expect(placeFor({ space: 'create' }, 'chat')).toBe('space-create');
    expect(placeFor({ space: 'tools' }, 'chat')).toBe('space-tools');
    expect(placeFor({}, 'chat')).toBe('studio');
    expect(placeFor({}, 'node')).toBe('canvas');
    expect(placeFor({}, 'designer')).toBe('designer');
  });
  it('mode is the composer mode, or the operation tab kind in Tools', () => {
    expect(modeFor('video')).toBe('video');
    expect(modeFor('agent', 'upscale')).toBe('image');
    expect(modeFor('agent', 'transcribe')).toBe('audio');
  });
  it('labels a Space by its own name, and old data has none', () => {
    expect(placeLabel({ place: 'space-create' })).toBe('Create');
    expect(placeLabel({ place: 'space-tools' })).toBe('Tools');
    expect(placeLabel({})).toBe('');
  });
  it('filters include old data as “none”', () => {
    expect(matchesPlace(undefined, 'none')).toBe(true);
    expect(matchesPlace('space-tools', 'none')).toBe(false);
    expect(matchesPlace('space-tools', 'space-tools')).toBe(true);
    expect(matchesMode(undefined, 'none')).toBe(true);
    expect(matchesMode('image', 'video')).toBe(false);
  });
});

describe('the hidden Space container', () => {
  it('is created without changing the active session, found by its mark and left out of lists', () => {
    const before = useStore.getState().activeSessionId;
    const id = ensureSpaceSession();
    const st = useStore.getState();
    expect(st.activeSessionId).toBe(before);
    expect(isSpaceSession(st.sessions[id])).toBe(true);
    expect(visibleSessions(st.sessions).some((s) => s.id === id)).toBe(false);
    expect(ensureSpaceSession()).toBe(id);
  });
});
