import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { beginOncePass, consumeOnce, overLimitAccepted, dontAskUntilNextSession, untilNextSessionActive, askAgain, withOncePass } from '../src/engine/budget';
import { createSession, useStore } from '../src/store/store';

describe('budget grants', () => {
  it('keeps overlapping approved sequences valid until each finishes', () => {
    const a = createSession('a'), b = createSession('b');
    useStore.setState((s) => ({ sessions: { ...s.sessions, [a.id]: a, [b.id]: b }, activeSessionId: a.id, settings: { ...s.settings, budgetOn: true, budgetUsd: 10, budgetAccepted: undefined, budgetNoAsk: false } }));
    const endA = beginOncePass(a.id);
    const endB = beginOncePass(b.id);
    try {
      expect(overLimitAccepted(a.id)).toBe(true);
      expect(overLimitAccepted(b.id)).toBe(true);
      endB();
      expect(overLimitAccepted(a.id)).toBe(true);
    } finally {
      endA();
      endB();
    }
  });

  it('permanently expires grant after switching away and back', () => {
    const a = createSession('a'), b = createSession('b');
    useStore.setState((s) => ({ sessions: { ...s.sessions, [a.id]: a, [b.id]: b }, activeSessionId: a.id }));
    dontAskUntilNextSession();
    expect(untilNextSessionActive()).toBe(true);
    useStore.setState({ activeSessionId: b.id });
    useStore.setState({ activeSessionId: a.id });
    expect(untilNextSessionActive()).toBe(false);
    askAgain(a.id);
  });

  it('isolates overlapping passes within the same session, across withOncePass, and on askAgain', async () => {
    const a = createSession('a'), b = createSession('b');
    useStore.setState((s) => ({
      sessions: { ...s.sessions, [a.id]: a, [b.id]: b },
      activeSessionId: a.id,
      settings: { ...s.settings, budgetOn: true, budgetUsd: 10, budgetAccepted: undefined, budgetNoAsk: false },
    }));

    const endA1 = beginOncePass(a.id);
    const endA2 = beginOncePass(a.id);
    const endB = beginOncePass(b.id);
    try {
      consumeOnce(a.id); // sequence passes survive spend steps
      expect(overLimitAccepted(a.id)).toBe(true);
      endA1();
      endA1(); // idempotent cleanup must not remove endA2's token
      expect(overLimitAccepted(a.id)).toBe(true);
      askAgain(a.id);
      expect(overLimitAccepted(a.id)).toBe(false);
      expect(overLimitAccepted(b.id)).toBe(true);
      endA2();
      expect(overLimitAccepted(b.id)).toBe(true);
    } finally {
      endA1();
      endA2();
      endB();
    }

    await withOncePass(a.id, async () => {
      await withOncePass(b.id, async () => {
        expect(overLimitAccepted(a.id)).toBe(true);
        expect(overLimitAccepted(b.id)).toBe(true);
        consumeOnce(b.id);
        expect(overLimitAccepted(b.id)).toBe(false);
        expect(overLimitAccepted(a.id)).toBe(true);
      });
      expect(overLimitAccepted(a.id)).toBe(true);
    });
    expect(overLimitAccepted(a.id)).toBe(false);
  });
});
