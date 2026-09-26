import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined }, cacheDb: { get: async () => undefined, set: async () => undefined } }));

import { addSpend, setSettings, useStore } from '../src/store/store';
import { acceptOverLimit, overLimit, remainingBudget } from '../src/engine/budget';
import { budgetProblem } from '../src/engine/actions';
import { periodStart, summarizeSpend } from '../src/engine/spending';
import { llmCallUsd } from '../src/engine/agent/runtime';
import type { SpendEntry } from '../src/engine/types';

const entry = { category: 'video' as const, provider: 'atlas', model: 'atlas::wan', sessionId: 's', estimated: false };
const toasts = () => useStore.getState().ui.toasts.map((t) => t.text);

beforeEach(() => {
  useStore.setState((s) => ({ spentUsd: 0, spendLog: [], ui: { ...s.ui, toasts: [] }, settings: { ...s.settings, budgetOn: true, budgetUsd: 1, budgetAccepted: null } }));
});

describe('spend log (G1)', () => {
  it('itemizes each charge and keeps the total', () => {
    addSpend(0.4, entry);
    addSpend(0.1, { ...entry, category: 'agent', provider: 'nanogpt', model: 'glm', estimated: true });
    expect(useStore.getState().spentUsd).toBeCloseTo(0.5);
    expect(useStore.getState().spendLog.map((e) => [e.category, e.usd, e.estimated])).toEqual([
      ['video', 0.4, false],
      ['agent', 0.1, true],
    ]);
  });

  it('agent calls cost what the provider reports, else tokens at the catalog price', () => {
    expect(llmCallUsd('openrouter', 'm', { inputTokens: 1000, outputTokens: 100, costUsd: 0.02 })).toBe(0.02);
    useStore.setState((s) => ({ catalog: { ...s.catalog, llm: { ...s.catalog.llm, nanogpt: [{ id: 'm', name: 'M', tools: true, inputPrice: 1, outputPrice: 10 }] } } }));
    expect(llmCallUsd('nanogpt', 'm', { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(2);
    expect(llmCallUsd('nanogpt', 'm', undefined)).toBe(0);
  });
});

describe('the limit warns, it does not block (G2)', () => {
  it('crossing the limit while something runs only shows one notice', () => {
    addSpend(0.9, entry);
    expect(toasts()).toEqual([]);
    addSpend(0.3, entry);
    addSpend(0.3, entry);
    expect(useStore.getState().spentUsd).toBeCloseTo(1.5);
    expect(toasts().filter((t) => /passed your spending limit/.test(t))).toHaveLength(1);
  });

  it('a run over the limit asks first; after "Continue anyway" it does not ask again until the limit changes', () => {
    addSpend(0.9, entry);
    const run = { usd: 0.5, approximate: false };
    expect(overLimit(run)).toBe(true);
    expect(budgetProblem(run)).toMatch(/Continue anyway/);
    acceptOverLimit();
    expect(overLimit(run)).toBe(false);
    expect(budgetProblem(run)).toBeNull();
    setSettings({ budgetUsd: 2 });
    expect(overLimit({ usd: 1.5, approximate: false })).toBe(true);
  });

  it('without a limit nothing asks and nothing is left to count', () => {
    setSettings({ budgetOn: false });
    addSpend(5, entry);
    expect(remainingBudget()).toBeNull();
    expect(overLimit({ usd: 100, approximate: false })).toBe(false);
    expect(toasts()).toEqual([]);
  });

  it('an unknown price does not count as over (its confirmation says it is billed at cost)', () => {
    addSpend(0.99, entry);
    expect(overLimit({ usd: null, approximate: true })).toBe(false);
  });
});

describe('spending panel aggregates (G3)', () => {
  const now = Date.now();
  const log: SpendEntry[] = [
    { ...entry, at: now - 40 * 86_400_000, usd: 5 },
    { ...entry, at: now - 2 * 86_400_000, usd: 1, model: 'atlas::seedance' },
    { ...entry, at: now - 1000, usd: 0.5 },
    { ...entry, at: now, usd: 0.02, category: 'agent', provider: 'nanogpt', model: 'glm', estimated: true },
  ];

  it('filters by period and groups by type, model, provider and session, largest first', () => {
    const week = summarizeSpend(log, periodStart('7d', now));
    expect(week.total).toBeCloseTo(1.52);
    expect(week.agent).toBeCloseTo(0.02);
    expect(week.media).toBeCloseTo(1.5);
    expect(week.byModel.map((r) => [r.key, r.count])).toEqual([
      ['atlas::seedance', 1],
      ['atlas::wan', 1],
      ['glm', 1],
    ]);
    expect(week.byCategory[0]).toMatchObject({ key: 'video', usd: 1.5 });
    expect(week.byCategory.find((r) => r.key === 'agent')?.estimated).toBe(true);
    expect(week.recent[0].model).toBe('glm');
    expect(summarizeSpend(log, periodStart('all', now)).total).toBeCloseTo(6.52);
  });
});
