import { expect, it } from 'vitest';
import { EDITABLE_LIMIT, splitRasterLimit } from '../bench/engines/limit';

it('keeps 64 editable strokes and flattens the rest', () => {
  const strokes = Array.from({ length: 300 }, (_, i) => i);
  const { flat, editable } = splitRasterLimit(strokes);
  expect(EDITABLE_LIMIT).toBe(64);
  expect(flat).toHaveLength(236);
  expect(editable).toHaveLength(64);
  expect([...flat, ...editable]).toEqual(strokes);
  expect(editable[0]).toBe(236);
});

it('flattens nothing below the limit and keeps order', () => {
  const { flat, editable } = splitRasterLimit([1, 2, 3]);
  expect(flat).toEqual([]);
  expect(editable).toEqual([1, 2, 3]);
});
