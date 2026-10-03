import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { addDoc, getDoc, patchLayer, undoDoc } from '../src/engine/design/actions';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { groupLayers, liveGroups, selectGroup, setGroupFlag, ungroup } from '../src/engine/design/groups';
import { useLayerSelection } from '../src/engine/design/selection';
import { useStore } from '../src/store/store';

describe('layer groups', () => {
  it('groups gather the layers next to each other, act on their layers, select them all, and ungroup', () => {
    const sid = useStore.getState().activeSessionId;
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => newVectorLayer(n));
    const doc = { ...createDoc('t', 100, 100), layers: [a, b, c, d] };
    addDoc(sid, doc);
    const gid = groupLayers(sid, doc.id, [a.id, c.id])!;
    let cur = getDoc(sid, doc.id)!;
    expect(cur.layers.map((l) => l.name)).toEqual(['b', 'a', 'c', 'd']);
    expect(liveGroups(cur)).toHaveLength(1);
    setGroupFlag(sid, doc.id, gid, 'visible', false);
    cur = getDoc(sid, doc.id)!;
    expect(cur.layers.filter((l) => !l.visible).map((l) => l.name)).toEqual(['a', 'c']);
    // A layer hidden on purpose stays hidden when the group is shown again.
    setGroupFlag(sid, doc.id, gid, 'visible', true);
    expect(getDoc(sid, doc.id)!.layers.filter((l) => !l.visible)).toHaveLength(0);
    setGroupFlag(sid, doc.id, gid, 'visible', false);
    setGroupFlag(sid, doc.id, gid, 'visible', true);
    const c0 = getDoc(sid, doc.id)!;
    expect(c0.layers.every((l) => l.visible)).toBe(true);
    expect(selectGroup(cur, gid)).toBe(c.id);
    expect(useLayerSelection.getState().byDoc[doc.id]).toEqual([a.id, c.id]);
    // Hide only "a", then hide and show the group: "a" stays hidden.
    patchLayer(sid, doc.id, a.id, { visible: false });
    setGroupFlag(sid, doc.id, gid, 'visible', false);
    setGroupFlag(sid, doc.id, gid, 'visible', true);
    expect(getDoc(sid, doc.id)!.layers.filter((l) => !l.visible).map((l) => l.name)).toEqual(['a']);
    ungroup(sid, doc.id, gid);
    cur = getDoc(sid, doc.id)!;
    expect(cur.layers.some((l) => l.groupId)).toBe(false);
    expect(liveGroups(cur)).toHaveLength(0);
    undoDoc(sid, doc.id);
    expect(getDoc(sid, doc.id)!.layers.filter((l) => l.groupId === gid)).toHaveLength(2);
  });
});
