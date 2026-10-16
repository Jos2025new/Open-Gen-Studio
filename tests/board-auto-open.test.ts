// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { getStudioBoard, installBoardAutoOpen, setStudioBoard } from '../src/lib/studioBoard';
import { newSession, setUi, upsertGeneration, useStore } from '../src/store/store';
import type { Generation } from '../src/engine/types';

installBoardAutoOpen();
const gen = (id: string, sessionId: string) => ({ id, sessionId, kind: 'image', prompt: id, status: 'running', assetIds: [], settings: { count: 1 }, estimate: { usd: 0 }, createdAt: 1 }) as unknown as Generation;

describe('Studio board opens on the first generation of a session', () => {
  it('opens once per session; a closed board stays closed; another session opens once', () => {
    setUi({ workspace: 'chat' });
    const a = useStore.getState().activeSessionId;
    setStudioBoard({ open: false, view: 'nodes' });
    upsertGeneration(gen('g1', a));
    expect(getStudioBoard()).toMatchObject({ open: true, view: 'assets' });
    setStudioBoard({ open: false });
    upsertGeneration(gen('g2', a));
    expect(getStudioBoard().open).toBe(false);
    newSession();
    const b = useStore.getState().activeSessionId;
    expect(b).not.toBe(a);
    upsertGeneration(gen('g3', b));
    expect(getStudioBoard().open).toBe(true);
    setStudioBoard({ open: false });
    upsertGeneration(gen('g4', b));
    expect(getStudioBoard().open).toBe(false);
  });
});
