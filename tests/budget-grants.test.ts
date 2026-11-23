import { describe, it, expect, vi } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { beginOncePass, consumeOnce, overLimitAccepted, dontAskUntilNextSession, untilNextSessionActive, askAgain, withOncePass } from '../src/engine/budget';
import { createSession, useStore } from '../src/store/store';

describe('budget grants', () => {
  it('keeps overlapping approved sequences valid until each finishes', () => {
    const a = createSession('a'), b = createSession('b');
    useStore.setState((s) => ({ sessions: { ...s.sessions, [a.id]: a, [b.id]: b }, activeSessionId: a.id, settings: { ...s.settings, budgetOn: true, budgetUsd: 10, budgetAccepted: undefined, budgetNoAsk: false } }));
    const grantA = beginOncePass(a.id, 0.1);
    const grantB = beginOncePass(b.id, 0.1);
    try {
      expect(overLimitAccepted(a.id, grantA.pass)).toBe(true);
      expect(overLimitAccepted(b.id, grantB.pass)).toBe(true);
      grantB.end();
      expect(overLimitAccepted(a.id, grantA.pass)).toBe(true);
    } finally {
      grantA.end();
      grantB.end();
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

    const grantA1 = beginOncePass(a.id, 0.1);
    const grantA2 = beginOncePass(a.id, 0.1);
    const grantB = beginOncePass(b.id, 0.1);
    try {
      consumeOnce(grantA1.pass); // sequence passes survive spend steps
      expect(overLimitAccepted(a.id, grantA1.pass)).toBe(true);
      grantA1.end();
      grantA1.end(); // idempotent cleanup must not remove grantA2's token
      expect(overLimitAccepted(a.id, grantA1.pass)).toBe(false);
      expect(overLimitAccepted(a.id, grantA2.pass)).toBe(true);
      askAgain(a.id);
      expect(overLimitAccepted(a.id, grantA2.pass)).toBe(false);
      expect(overLimitAccepted(b.id, grantB.pass)).toBe(true);
      grantA2.end();
      expect(overLimitAccepted(b.id, grantB.pass)).toBe(true);
    } finally {
      grantA1.end();
      grantA2.end();
      grantB.end();
    }

    await withOncePass(a.id, async (passA) => {
      await withOncePass(b.id, async (passB) => {
        expect(overLimitAccepted(a.id, passA)).toBe(true);
        expect(overLimitAccepted(b.id, passB)).toBe(true);
        consumeOnce(passB);
        expect(overLimitAccepted(b.id, passB)).toBe(false);
        expect(overLimitAccepted(a.id, passA)).toBe(true);
      }, 0.1);
      expect(overLimitAccepted(a.id, passA)).toBe(true);
    }, 0.1);
    expect(overLimitAccepted(a.id)).toBe(false);
  });
});
