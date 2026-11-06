import { describe, expect, it } from 'vitest';
import { lastPaintPoint, rememberPaintEnd } from '../src/engine/design/paintLastPoint';

const doc = (...ids: string[]) => ({ id: 'd1', layers: ids.map((id) => ({ id })) }) as any;

describe('last paint point', () => {
  it('only with Shift, per layer and brush/eraser', () => {
    rememberPaintEnd('d1', 'a', false, { x: 3, y: 4 });
    expect(lastPaintPoint(doc('a'), 'a', false, true)).toEqual({ x: 3, y: 4 });
    expect(lastPaintPoint(doc('a'), 'a', false)).toBeNull();
    expect(lastPaintPoint(doc('a'), 'a', true, true)).toBeNull();
    expect(lastPaintPoint(doc('a', 'b'), 'b', false, true)).toBeNull();
  });
  it('forgets a layer that is gone and a document that never painted', () => {
    rememberPaintEnd('d1', 'gone', true, { x: 1, y: 1 });
    expect(lastPaintPoint(doc('a'), 'gone', true, true)).toBeNull();
    expect(lastPaintPoint({ id: 'other', layers: [{ id: 'a' }] } as any, 'a', false, true)).toBeNull();
  });
  it('the newest end wins', () => {
    rememberPaintEnd('d1', 'a', false, { x: 9, y: 9 });
    expect(lastPaintPoint(doc('a'), 'a', false, true)).toEqual({ x: 9, y: 9 });
  });
});
