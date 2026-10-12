import { describe, expect, it } from 'vitest';
import { CacheBudget } from '../src/engine/design/cacheBudget';

describe('cache budget in bytes', () => {
  it('never exceeds the limit: the least recently used entries are dropped first', () => {
    const dropped: string[] = [];
    const b = new CacheBudget(100);
    b.put('a', 40, () => dropped.push('a'));
    b.put('b', 40, () => dropped.push('b'));
    b.touch('a');
    b.put('c', 40, () => dropped.push('c'));
    expect(dropped).toEqual(['b']);
    expect(b.usedBytes).toBeLessThanOrEqual(100);
    expect(b.count).toBe(2);
  });

  it('keeps the entry just stored even when it alone is larger than the budget', () => {
    const dropped: string[] = [];
    const b = new CacheBudget(50);
    b.put('small', 10, () => dropped.push('small'));
    b.put('big', 80, () => dropped.push('big'));
    expect(dropped).toEqual(['small']);
    expect(b.count).toBe(1);
    expect(b.usedBytes).toBe(80);
  });

  it('replacing an entry does not count it twice and removing frees its bytes', () => {
    const b = new CacheBudget(100);
    b.put('a', 60, () => undefined);
    b.put('a', 30, () => undefined);
    expect(b.usedBytes).toBe(30);
    b.remove('a');
    expect(b.usedBytes).toBe(0);
  });

  it('lowering the limit evicts down to it, oldest first, and never the newest', () => {
    const dropped: string[] = [];
    const b = new CacheBudget(1000);
    for (const k of ['a', 'b', 'c']) b.put(k, 100, () => dropped.push(k));
    b.setLimit(150);
    expect(dropped).toEqual(['a', 'b']);
    expect(b.usedBytes).toBe(100);
  });

  it('drawing is not an entry: a budget with no caches evicts nothing', () => {
    const b = new CacheBudget(10);
    expect(b.usedBytes).toBe(0);
    expect(b.count).toBe(0);
  });
});
