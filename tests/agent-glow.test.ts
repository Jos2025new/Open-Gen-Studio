import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
import { agentChangedIds, glowingLayers, GLOW_MS, markAgentEdit, subscribeGlow } from '../src/engine/design/agentGlow';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import { addDoc, getDoc } from '../src/engine/design/actions';
import { setDoc, useStore } from '../src/store/store';
import type { DesignDoc } from '../src/engine/types';

const doc = (id: string): DesignDoc => {
  const a = { ...newVectorLayer('A'), id: 'a' }, b = { ...newVectorLayer('B'), id: 'b' };
  return { ...createDoc(id, 100, 80), id, layers: [a, b], activeLayerId: 'b' };
};

afterEach(() => vi.useRealTimers());

describe('agent glow: which layers the agent changed', () => {
  it('a new layer or a layer replaced by a new object counts; untouched layers do not', () => {
    const before = doc('d1');
    const after = { ...before, layers: [before.layers[0], { ...before.layers[1], x: 5 }, { ...newVectorLayer('C'), id: 'c' }] };
    expect(agentChangedIds(before, after)).toEqual(['b', 'c']);
  });

  it('no change, no glow', () => {
    const before = doc('d1');
    markAgentEdit('d1', before, { ...before }, 0);
    expect(glowingLayers('d1', 0)).toEqual([]);
  });
});

describe('agent glow: transient and only for agent edits', () => {
  it('an agent edit glows the changed layers for 1.2 s, then they are gone', () => {
    const before = doc('d2');
    const after = { ...before, layers: [{ ...before.layers[0], opacity: 0.1 }, before.layers[1]] };
    markAgentEdit('d2', before, after, 1000);
    expect(glowingLayers('d2', 1000 + GLOW_MS - 1)).toEqual(['a']);
    expect(glowingLayers('d2', 1000 + GLOW_MS)).toEqual([]);
  });

  it('a user edit through the store does not glow', () => {
    const d = doc('d3');
    const sid = useStore.getState().activeSessionId;
    addDoc(sid, d);
    setDoc(sid, 'd3', (x) => ({ ...x, layers: x.layers.map((l) => ({ ...l, opacity: 0.4 })) }));
    expect(getDoc(sid, 'd3')?.layers[0].opacity).toBe(0.4);
    expect(glowingLayers('d3', Date.now())).toEqual([]);
  });

  it('the signal expires on its own: subscribers are told when it fades', () => {
    vi.useFakeTimers();
    const d = doc('d4');
    const seen = vi.fn();
    const off = subscribeGlow(seen);
    markAgentEdit('d4', d, { ...d, layers: [{ ...d.layers[0], opacity: 0.2 }, d.layers[1]] });
    expect(glowingLayers('d4')).toEqual(['a']);
    vi.advanceTimersByTime(GLOW_MS + 10);
    expect(seen).toHaveBeenCalled();
    expect(glowingLayers('d4')).toEqual([]);
    off();
  });

  it('nothing is written to storage', () => {
    const set = vi.fn();
    const storage = { setItem: set, getItem: () => null, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    try {
      const d = doc('d5');
      markAgentEdit('d5', d, { ...d, layers: [{ ...d.layers[0], opacity: 0.3 }, d.layers[1]] });
      expect(glowingLayers('d5')).toEqual(['a']);
      expect(set).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
