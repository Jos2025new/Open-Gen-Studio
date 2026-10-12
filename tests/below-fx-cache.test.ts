import { beforeEach, expect, it } from 'vitest';
import { BELOW_CACHE_PX, cachedBelow, clearBelowCache, keepBelow } from '../src/engine/design/belowFxCache';

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

it('drops the oldest results first once they exceed the pixel budget', () => {
  const side = Math.floor(Math.sqrt(BELOW_CACHE_PX / 2)) + 1; // two of these do not fit
  keepBelow('old', ['k'], canvas(side, side));
  keepBelow('new', ['k'], canvas(side, side));
  expect(cachedBelow('old', ['k'])).toBeUndefined();
  expect(cachedBelow('new', ['k'])).toBeDefined();
});
