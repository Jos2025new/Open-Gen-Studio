import { beforeEach, expect, it } from 'vitest';
import { cachedBelow, clearBelowCache, keepBelow } from '../src/engine/design/belowFxCache';

const canvas = (w: number, h: number) => ({ width: w, height: h }) as unknown as HTMLCanvasElement;
beforeEach(() => clearBelowCache());

it('returns the kept result only for the same composite inputs, in the same order', () => {
  const layer = { id: 'a' }, fx = { id: 'fx' }, out = canvas(4, 4);
  keepBelow('fx', [layer, 1, fx], out);
  expect(cachedBelow('fx', [layer, 1, fx])).toBe(out);
  expect(cachedBelow('fx', [layer, 2, fx])).toBeUndefined();
  expect(cachedBelow('fx', [{ id: 'a' }, 1, fx])).toBeUndefined();
  expect(cachedBelow('fx', [layer, 1])).toBeUndefined();
  expect(cachedBelow('fx', [layer, 1, fx, 'extra'])).toBeUndefined();
});

it('drops the oldest results first once they exceed the shared byte budget', async () => {
  const { editorCacheBudget } = await import('../src/engine/design/cacheBudget');
  const side = 100; // 100 x 100 px = 40 000 bytes each
  editorCacheBudget.setLimit(side * side * 4 * 1.5); // one fits, two do not
  keepBelow('old', ['k'], canvas(side, side));
  keepBelow('new', ['k'], canvas(side, side));
  expect(cachedBelow('old', ['k'])).toBeUndefined();
  expect(cachedBelow('new', ['k'])).toBeDefined();
  editorCacheBudget.setLimit(256 * 1024 * 1024);
});
