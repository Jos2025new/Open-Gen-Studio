import { describe, expect, it } from 'vitest';
import { buildEtaIndex, etaKey, etaLabel, median } from '../src/engine/eta';
import type { Generation } from '../src/engine/types';

const gen = (id: string, over: Partial<Generation> = {}): Generation => ({
  id, kind: 'video', modelRef: 'm/a', status: 'done', startedAt: 0, finishedAt: 10_000, createdAt: 0, ...over,
} as Generation);
const rec = (...gs: Generation[]) => Object.fromEntries(gs.map((g) => [g.id, g]));

describe('eta', () => {
  it('median of odd and even lists', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it('needs 3 done samples of the same model, kind and op', () => {
    const two = rec(gen('1'), gen('2'));
    expect(buildEtaIndex(two).size).toBe(0);
    const three = rec(gen('1', { finishedAt: 10_000 }), gen('2', { finishedAt: 30_000 }), gen('3', { finishedAt: 20_000 }),
      gen('x', { status: 'error', finishedAt: 999_000 }), gen('y', { modelRef: 'm/b' }));
    expect(buildEtaIndex(three).get(etaKey(gen('z')))).toBe(20_000);
    expect(buildEtaIndex(three).has(etaKey(gen('z', { modelRef: 'm/b' })))).toBe(false);
  });
  it('uses only the last 20 (newest by finish time)', () => {
    const gs = Array.from({ length: 25 }, (_, i) => gen(`g${i}`, { startedAt: 0, finishedAt: i < 5 ? 900_000 : 5_000 }));
    // The 5 slow ones finished first (smaller `at` is simulated through startedAt): make them the oldest.
    gs.forEach((g, i) => { g.startedAt = i < 5 ? -1_000_000 + i : 1_000_000 + i; g.finishedAt = g.startedAt + (i < 5 ? 900_000 : 5_000); });
    expect(buildEtaIndex(rec(...gs)).get(etaKey(gs[0]))).toBe(5_000);
  });
  it('label counts down and never goes negative', () => {
    expect(etaLabel(45_000, 25_000)).toBe('~45 s typical · ~20 s left');
    expect(etaLabel(45_000, 45_000)).toBe('taking longer than usual');
    expect(etaLabel(45_000, 90_000)).toBe('taking longer than usual');
    expect(etaLabel(90_000, 0)).toBe('~1 min 30 s typical · ~1 min 30 s left');
  });
});
