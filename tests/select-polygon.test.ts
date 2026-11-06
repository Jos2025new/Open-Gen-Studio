import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/design/history', () => ({ record: vi.fn() }));
vi.mock('../src/engine/design/pixelSelection', () => ({ setSelection: vi.fn(), combineSelection: vi.fn() }));

import { record } from '../src/engine/design/history';
import { combineSelection, setSelection } from '../src/engine/design/pixelSelection';
import { polygonCancel, polygonDown, polygonDraft, polygonHover, polygonKey } from '../src/components/designer/selectPolygon';

const doc = { id: 'd', width: 100, height: 100 } as never;
const none = { shift: false, alt: false, ctrl: false };
const click = (x: number, y: number, mods = none, combine: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace') => polygonDown({ doc, p: { x, y }, shape: 'polygon', mods, zoom: 1 }, combine);
const key = (k: string) => polygonKey({ key: k } as KeyboardEvent);

beforeEach(() => { polygonCancel(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('polygon selection', () => {
  it('clicking the first vertex closes it', () => {
    click(10, 10); click(60, 10); click(60, 60);
    click(12, 11);
    expect(setSelection).toHaveBeenCalledWith('d', { points: [[10, 10], [60, 10], [60, 60]] });
    expect(record).toHaveBeenCalledTimes(1);
    expect(polygonDraft()).toBeNull();
  });
  it('Enter closes; fewer than 3 vertices or zero area is discarded', () => {
    click(10, 10); click(60, 10); click(60, 60);
    expect(key('Enter')).toBe(true);
    expect(setSelection).toHaveBeenCalledTimes(1);
    click(10, 10); click(60, 10); key('Enter');
    click(0, 0); click(10, 0); click(20, 0); key('Enter');
    expect(setSelection).toHaveBeenCalledTimes(1);
  });
  it('a double click closes without a duplicate vertex', () => {
    vi.useFakeTimers();
    click(10, 10); vi.advanceTimersByTime(1000); click(60, 10); vi.advanceTimersByTime(1000); click(60, 60);
    vi.advanceTimersByTime(100); click(61, 61);
    expect(setSelection).toHaveBeenCalledWith('d', { points: [[10, 10], [60, 10], [60, 60]] });
  });
  it('Esc leaves the selection alone; Backspace drops the last vertex and, with none, cancels', () => {
    click(10, 10); click(60, 10);
    expect(key('Escape')).toBe(true);
    expect(setSelection).not.toHaveBeenCalled();
    expect(polygonDraft()).toBeNull();
    click(10, 10); click(60, 10); click(60, 60);
    key('Backspace');
    expect(polygonDraft()).toEqual([[10, 10], [60, 10]]);
    key('Backspace'); key('Backspace');
    expect(polygonDraft()).toBeNull();
    expect(key('Escape')).toBe(false);
  });
  it('the rubber band follows the pointer; Shift snaps to 45 degrees', () => {
    click(10, 10);
    expect(polygonHover({ x: 50, y: 12 }, { ...none, shift: true })).toEqual([[10, 10], [expect.any(Number), expect.closeTo(10, 6)]]);
    expect(polygonHover({ x: 50, y: 12 }, none)).toEqual([[10, 10], [50, 12]]);
  });
  it('a Shift held for the Mode does not snap until it is released and pressed again', () => {
    click(10, 10, { ...none, shift: true }, 'add');
    expect(polygonHover({ x: 50, y: 12 }, { ...none, shift: true })).toEqual([[10, 10], [50, 12]]);
    polygonHover({ x: 50, y: 12 }, none);
    expect(polygonHover({ x: 50, y: 12 }, { ...none, shift: true })![1][1]).toBeCloseTo(10, 6);
  });
  it('combines with the selection as the first press set the Mode; changing document starts afresh', () => {
    click(10, 10, none, 'intersect'); click(60, 10); click(60, 60); key('Enter');
    expect(combineSelection).toHaveBeenCalledWith(doc, { points: [[10, 10], [60, 10], [60, 60]] }, 'intersect');
    click(1, 1); polygonDown({ doc: { id: 'other' } as never, p: { x: 5, y: 5 }, shape: 'polygon', mods: none, zoom: 1 }, 'replace');
    expect(polygonDraft()).toEqual([[5, 5]]);
  });
  it('ignores keys when no polygon is open', () => {
    expect(key('Enter')).toBe(false);
    expect(key('Backspace')).toBe(false);
  });
});
