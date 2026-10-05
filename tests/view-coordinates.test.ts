import { describe, expect, it } from 'vitest';
import { documentToScreen, screenToDocument, zoomAt } from '../src/engine/design/viewCoordinates';
const origin = { left: 130, top: 60 }, pointer = { x: 430, y: 260 };

describe('pointer stays under the mouse when the canvas view changes', () => {
  it.each([.05, .5, 1, 2, 8])('screen ↔ document round trip at zoom %s', zoom => {
    const view = { x: -70, y: 40, zoom };
    const point = screenToDocument(pointer, view, origin);
    expect(documentToScreen(point, view, origin)).toEqual(pointer);
  });
  it('a stationary screen pointer selects new document coordinates after panning', () => {
    const before = { x: 100, y: 50, zoom: 2 }, after = { ...before, x: 20, y: -10 };
    expect(screenToDocument(pointer, before, origin)).toEqual({ x: 100, y: 75 });
    const point = screenToDocument(pointer, after, origin);
    expect(point).toEqual({ x: 140, y: 105 });
    expect(documentToScreen(point, after, origin)).toEqual(pointer);
  });
  it('zooming at another anchor recomputes the pointer without moving it on screen', () => {
    const before = { x: 100, y: 50, zoom: 2 }, after = zoomAt(before, 10, 10, 1.5);
    expect(screenToDocument(pointer, after, origin)).not.toEqual(screenToDocument(pointer, before, origin));
    expect(documentToScreen(screenToDocument(pointer, after, origin), after, origin)).toEqual(pointer);
  });
  it('zoomAt retains the document point under its anchor and clamps zoom', () => {
    const view = { x: -20, y: 70, zoom: 1 }, anchor = { x: 300, y: 400 }, local = { left: 0, top: 0 };
    const point = screenToDocument(anchor, view, local);
    expect(documentToScreen(point, zoomAt(view, anchor.x, anchor.y, 2), local)).toEqual(anchor);
    expect(zoomAt(view, 0, 0, 100).zoom).toBe(8);
    expect(zoomAt(view, 0, 0, .001).zoom).toBe(.05);
  });
});
