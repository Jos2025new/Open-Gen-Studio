import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined }, getAssetBlob: async () => undefined, putAssetBlob: async () => undefined }));
import { createSession, useStore } from '../src/store/store';
import { addSpend } from '../src/store/spend';

/* The "you passed your limit" notice is silenced only by the lasting rules, and does not depend on budget.ts having loaded (Neon, SOLID A). */
const passed = () => useStore.getState().ui.toasts.some((t) => /passed your spending limit/.test(t.text));
function setup(settings: Record<string, unknown>, session: Record<string, unknown> = {}) {
  const a = { ...createSession('a'), ...session };
  useStore.setState((s) => ({ sessions: { ...s.sessions, [a.id]: a }, activeSessionId: a.id, spentUsd: 0, ui: { ...s.ui, toasts: [] }, settings: { ...s.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false, ...settings } }));
  return a.id;
}

describe('over-limit notice and the lasting no-ask rules', () => {
  beforeEach(() => useStore.setState((s) => ({ ui: { ...s.ui, toasts: [] } })));

  it('with budget.ts never loaded, the lasting rules still silence it', () => {
    const id = setup({ budgetNoAsk: true });
    addSpend(2, { sessionId: id } as never);
    expect(passed()).toBe(false);
    setup({}, { noAskOverLimit: true });
    addSpend(2, { sessionId: useStore.getState().activeSessionId } as never);
    expect(passed()).toBe(false);
  });

  it('without any rule the notice appears', () => {
    const id = setup({});
    addSpend(2, { sessionId: id } as never);
    expect(passed()).toBe(true);
  });

  it('a one-off pass does not silence it: the next run asks', async () => {
    const { withOncePass, beginOncePass } = await import('../src/engine/budget');
    const id = setup({});
    withOncePass(id, () => addSpend(2, { sessionId: id } as never), 2);
    expect(passed()).toBe(true);
    setup({});
    const grant = beginOncePass(id, 2);
    addSpend(2, { sessionId: id } as never);
    grant.end();
    expect(passed()).toBe(true);
  });

  it('until next session silences it while its chat stays open', async () => {
    const { dontAskUntilNextSession, askAgain } = await import('../src/engine/budget');
    const id = setup({});
    dontAskUntilNextSession();
    addSpend(2, { sessionId: id } as never);
    expect(passed()).toBe(false);
    askAgain(id);
  });
});
