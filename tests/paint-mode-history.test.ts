import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { getDoc, redoDoc, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { record } from '../src/engine/design/history';
import { createSession, setDoc, useStore } from '../src/store/store';

describe('paint mode survives undo and redo of legacy snapshots', () => {
  it('keeps an explicit toggle when the first undo snapshot has no paintMode', () => {
    const session = createSession('paint mode undo regression');
    const legacy = { ...createDoc('Legacy', 100, 100), paintMode: undefined, layers: [newVectorLayer('Shapes')] };
    session.docs = [legacy];
    session.activeDocId = legacy.id;
    useStore.setState((state) => ({ sessions: { ...state.sessions, [session.id]: session } }));

    const opened = getDoc(session.id, legacy.id)!;
    expect(opened.paintMode).toBeUndefined();
    record(opened); // Stage records the pre-drag document on the first moved frame.
    setDoc(session.id, legacy.id, (doc) => ({ ...doc, name: 'Moved' }));
    expect(getDoc(session.id, legacy.id)?.paintMode).toBe('design');

    setDoc(session.id, legacy.id, (doc) => ({ ...doc, paintMode: 'drawing' }));
    undoDoc(session.id, legacy.id);
    expect(getDoc(session.id, legacy.id)).toMatchObject({ name: 'Legacy', paintMode: 'drawing' });

    redoDoc(session.id, legacy.id);
    expect(getDoc(session.id, legacy.id)).toMatchObject({ name: 'Moved', paintMode: 'drawing' });
  });
});
