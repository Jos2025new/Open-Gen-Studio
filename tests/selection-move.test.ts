import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/design/history', () => ({ record: vi.fn() }));
vi.mock('../src/engine/design/actions', () => ({ getDoc: () => undefined }));

import { record } from '../src/engine/design/history';
import { getSelection, setSelection, rectPoints, type PixelSelection } from '../src/engine/design/pixelSelection';
import { moveOffset, pointInSelection, translateSelection } from '../src/engine/design/selectionMove';
import { moveMove, moveOutlineDown, moveUp } from '../src/components/designer/selectMove';
import * as media from '../src/lib/media';

const doc = { id: 'dm', width: 100, height: 80 } as never;
const none = { shift: false, alt: false, ctrl: false };

describe('moving a selection outline', () => {
  it('a polygon moves by its points, inverted stays inverted, the offset is as dragged', () => {
    const sel = { points: rectPoints(10, 10, 30, 20), inverted: true };
    const t = translateSelection(doc, sel, 5.5, -2)!;
    expect(t.points).toEqual(rectPoints(15.5, 8, 35.5, 18));
    expect(t.inverted).toBe(true);
    expect(moveOffset(sel, 5.5, -2)).toEqual({ dx: 5.5, dy: -2 });
  });
  it('inside tests: polygon, inverted (page only), mask by box then pixel', () => {
    const rect = { points: rectPoints(10, 10, 30, 20) };
    expect(pointInSelection(doc, rect, 20, 15)).toBe(true);
    expect(pointInSelection(doc, rect, 40, 15)).toBe(false);
    const inv = { ...rect, inverted: true };
    expect(pointInSelection(doc, inv, 20, 15)).toBe(false);
    expect(pointInSelection(doc, inv, 50, 50)).toBe(true);
    expect(pointInSelection(doc, inv, 150, 50)).toBe(false);
    const getImageData = vi.fn(() => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }));
    const spy = vi.spyOn(media, 'ctx2d').mockReturnValue({ getImageData } as never);
    const mask = { points: [], mask: {} as HTMLCanvasElement, box: { x: 10, y: 10, w: 5, h: 5 } } as PixelSelection;
    expect(pointInSelection(doc, mask, 50, 50)).toBe(false);
    expect(getImageData).not.toHaveBeenCalled();
    expect(pointInSelection(doc, mask, 12.7, 11.2)).toBe(true);
    expect(getImageData).toHaveBeenCalledWith(12, 11, 1, 1);
    spy.mockRestore();
  });
  it('a mask is redrawn once, in whole pixels', () => {
    const draws: number[][] = [];
    const ctx = { drawImage: (_i: unknown, x: number, y: number) => draws.push([x, y]), getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {} };
    const c = vi.spyOn(media, 'createCanvas').mockImplementation((w, h) => ({ width: w, height: h }) as HTMLCanvasElement);
    const x = vi.spyOn(media, 'ctx2d').mockReturnValue(ctx as never);
    const mask = { width: 100, height: 80 } as HTMLCanvasElement;
    const t = translateSelection(doc, { points: [], mask }, 3.6, -2.4);
    expect(draws).toEqual([[4, -2]]);
    expect(t?.mask).toBeDefined();
    c.mockRestore(); x.mockRestore();
  });
  it('a press inside grabs it only with Mode New, no keys and a rect, ellipse or lasso', () => {
    setSelection('dm', { points: rectPoints(10, 10, 30, 20) });
    const at = (x: number, y: number, shape: 'rect' | 'polygon' | 'wand' | 'ellipse' | 'lasso' = 'rect', mods = none) => moveOutlineDown({ doc, p: { x, y }, shape, mods });
    expect(at(20, 15)).not.toBeNull();
    expect(at(50, 15)).toBeNull();
    expect(at(20, 15, 'polygon')).toBeNull();
    expect(at(20, 15, 'wand')).toBeNull();
    expect(at(20, 15, 'ellipse')).not.toBeNull();
    expect(at(20, 15, 'rect', { ...none, shift: true })).toBeNull();
  });
  it('dragging moves the selection in one undo step; a click without a drag changes nothing', () => {
    setSelection('dm', { points: rectPoints(10, 10, 30, 20) });
    const g = moveOutlineDown({ doc, p: { x: 20, y: 15 }, shape: 'rect', mods: none })!;
    moveMove(g, { x: 21, y: 15 }, 1);
    moveUp(g, { sessionId: 's', doc });
    expect(record).not.toHaveBeenCalled();
    expect(getSelection('dm')!.points).toEqual(rectPoints(10, 10, 30, 20));
    const h = moveOutlineDown({ doc, p: { x: 20, y: 15 }, shape: 'rect', mods: none })!;
    moveMove(h, { x: 30, y: 25 }, 1);
    moveUp(h, { sessionId: 's', doc });
    expect(record).toHaveBeenCalledTimes(1);
    expect(getSelection('dm')!.points).toEqual(rectPoints(20, 20, 40, 30));
  });
});
