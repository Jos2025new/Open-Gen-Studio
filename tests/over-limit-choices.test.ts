import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { addSpend, createSession, setSettings, useStore } from '../src/store/store';
import { askAgain, continueOnce, dontAskAgain, ignoreExcess, noteExcess, overLimit, overLimitText } from '../src/engine/budget';
import type { Generation, NoticeFeedItem } from '../src/engine/types';

const known = { usd: 0.5, approximate: false };
const unknown = { usd: null, approximate: true };
const entry = { category: 'video' as const, provider: 'atlas', model: 'atlas::wan', sessionId: 'A', estimated: false };
const noticesOf = (id: string) => useStore.getState().sessions[id].feed.filter((f): f is NoticeFeedItem => f.type === 'notice');

beforeEach(() => {
  vi.useFakeTimers();
  const a = { ...createSession(), id: 'A' };
  const b = { ...createSession(), id: 'B' };
  useStore.setState((s) => ({ spentUsd: 0.9, spendLog: [], sessions: { A: a, B: b }, activeSessionId: 'A', ui: { ...s.ui, toasts: [] }, settings: { ...s.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null, budgetNoAsk: false } }));
});
afterEach(() => vi.useRealTimers());

describe('over the limit: Continue once, Don\u2019t ask again, app switch (2026-10-29)', () => {
  it('Continue once lets one action through; the next run over the limit asks again', () => {
    expect(overLimit(known)).toBe(true);
    continueOnce();
    expect(overLimit(known)).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(overLimit(known)).toBe(true);
    expect(useStore.getState().sessions.A.noAskOverLimit).toBeFalsy();
  });

  it('Don\u2019t ask again stops asking in that session only, and Ask again brings it back', () => {
    dontAskAgain('A');
    vi.advanceTimersByTime(10_000);
    expect(overLimit(known, 'A')).toBe(false);
    expect(overLimit(unknown, 'A')).toBe(false);
    expect(overLimit(known, 'B')).toBe(true);
    useStore.setState({ activeSessionId: 'B' });
    expect(overLimit(known)).toBe(true);
    useStore.setState({ activeSessionId: 'A' });
    askAgain('A');
    expect(overLimit(known, 'A')).toBe(true);
  });

  it('the app switch stops asking in every session; a budgetAccepted saved by an older version counts as the switch', () => {
    setSettings({ budgetNoAsk: true });
    expect(overLimit(known, 'A')).toBe(false);
    expect(overLimit(known, 'B')).toBe(false);
    setSettings({ budgetNoAsk: false, budgetAccepted: 1 });
    expect(overLimit(known, 'B')).toBe(false);
    setSettings({ budgetUsd: 2 });
    expect(overLimit({ usd: 1.5, approximate: false }, 'B')).toBe(true);
  });

  it('an unknown price asks while a limit is on, and never without one', () => {
    expect(overLimit(unknown)).toBe(true);
    setSettings({ budgetOn: false });
    expect(overLimit(unknown)).toBe(false);
  });

  it('the text describes both options and says nothing running stops', () => {
    for (const e of [known, unknown]) {
      const t = overLimitText(e);
      expect(t).toMatch(/Continue once/);
      expect(t).toMatch(/ask again|stops asking in this session/);
      expect(t).toMatch(/Nothing running is stopped/);
      expect(t).not.toMatch(/Further runs will not ask again/);
    }
  });

  it('the limit never blocks: spending past it is counted, with no error and nothing stopped', () => {
    addSpend(2, entry);
    expect(useStore.getState().spentUsd).toBeCloseTo(2.9);
    expect(useStore.getState().ui.toasts.every((t) => t.level !== 'error' || /What is running continues/.test(t.text))).toBe(true);
  });
});

describe('real cost of an unpriced run that took spending past the limit', () => {
  const gen = (over: Partial<Generation>) => ({ id: 'g1', sessionId: 'A', kind: 'video', prompt: 'a long dolly shot', modelRef: 'atlas::wan', estimate: { usd: null, approximate: true }, actualUsd: 0.4, ...over }) as unknown as Generation;
  const book = (g: Generation) => { useStore.setState((s) => ({ generations: { ...s.generations, [g.id]: g } })); addSpend(g.actualUsd ?? 0, entry); noteExcess(g.id); };

  it('warns once, naming the generation, with Review limit and Ignore; not again for the same one', () => {
    book(gen({}));
    noteExcess('g1');
    const n = noticesOf('A');
    expect(n).toHaveLength(1);
    expect(n[0].text).toMatch(/a long dolly shot/);
    expect(n[0].text).toMatch(/\$0\.4.*\$1\.3/);
    expect(n[0].overLimitFor).toEqual({ gen: 'g1' });
    ignoreExcess('A', n[0].id);
    noteExcess('g1');
    expect(noticesOf('A')).toHaveLength(1);
    expect(noticesOf('A')[0].overLimitFor?.ignored).toBe(true);
  });

  it('counts any excess (no margin) and ignores priced runs, runs within the limit and no limit', () => {
    useStore.setState({ spentUsd: 0 });
    book(gen({ actualUsd: 1.0 }));
    expect(noticesOf('A')).toHaveLength(0);
    useStore.setState({ spentUsd: 0 });
    book(gen({ id: 'g2', actualUsd: 1.01 }));
    expect(noticesOf('A')).toHaveLength(1);
    book(gen({ id: 'g3', estimate: { usd: 0.4, approximate: false } }));
    expect(noticesOf('A')).toHaveLength(1);
    setSettings({ budgetOn: false });
    book(gen({ id: 'g4' }));
    expect(noticesOf('A')).toHaveLength(1);
  });
});
