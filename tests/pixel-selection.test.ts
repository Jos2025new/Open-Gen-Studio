import { describe, expect, it } from 'vitest';
import { getSelection, invertSelection, rectPoints, selectAll, selectionBox, setSelection } from '../src/engine/design/pixelSelection';

const doc = { id: 'd1', width: 100, height: 80 } as Parameters<typeof selectAll>[0];

describe('pixel selection', () => {
  it('box is clamped to the page; inverted means the whole page; fewer than 3 points is no selection', () => {
    expect(selectionBox(doc, { points: rectPoints(-10, 10.4, 50.2, 200) })).toEqual({ x: 0, y: 10, w: 51, h: 70 });
    expect(selectionBox(doc, { points: rectPoints(10, 10, 20, 20), inverted: true })).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    setSelection('d1', { points: [[0, 0], [1, 1]] });
    expect(getSelection('d1')).toBeNull();
  });
  it('select all, invert twice, deselect', () => {
    selectAll(doc);
    expect(selectionBox(doc, getSelection('d1')!)).toEqual({ x: 0, y: 0, w: 100, h: 80 });
    invertSelection(doc);
    expect(getSelection('d1')!.inverted).toBe(true);
    invertSelection(doc);
    expect(getSelection('d1')!.inverted).toBe(false);
    setSelection('d1', null);
    expect(getSelection('d1')).toBeNull();
  });
});
