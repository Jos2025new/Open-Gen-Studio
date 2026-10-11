import { describe, expect, it } from 'vitest';
import type { ShapeSpec } from '../src/engine/types';
import { editableShapeAt, blurFilterSvg, blurRegion, strokeReach, SHARP, blurKnots, blurPercent, blurSigma, clickKnot, cornerKnots, cornerRadii, dragBlur, dragRx, dragRy, roundRectPath, scaleLook, strokeLookSvg } from '../src/engine/design/shapeLook';
import { scaleLayer } from '../src/engine/design/doc';
import { transformShape } from '../src/engine/design/affine';
import { shapeSvg } from '../src/engine/design/export';
import { turnVector } from '../src/engine/design/transform';

/* Inkscape's formulas, as read from its source (shapeLook.ts names each file and function). */
const rect = (o: Partial<ShapeSpec> = {}): ShapeSpec => ({ type: 'rect', x: 10, y: 20, w: 100, h: 60, fill: '#000', stroke: '#fff', strokeWidth: 2, radius: 0, ...o });

describe('corner radii', () => {
  it('one radius set copies to the other; legacy radius fills both; each is capped at half its side', () => {
    expect(cornerRadii(rect({ rx: 8 }))).toEqual({ rx: 8, ry: 8 });
    expect(cornerRadii(rect({ ry: 5 }))).toEqual({ rx: 5, ry: 5 });
    expect(cornerRadii(rect({ radius: 6 }))).toEqual({ rx: 6, ry: 6 });
    expect(cornerRadii(rect({ rx: 80, ry: 80 }))).toEqual({ rx: 50, ry: 30 });
    expect(cornerRadii(rect({ rx: 4, ry: 9, radius: 20 }))).toEqual({ rx: 4, ry: 9 });
    // A legacy radius keeps the circular corner it always had.
    expect(cornerRadii(rect({ radius: 99 }))).toEqual({ rx: 30, ry: 30 });
  });

  it('knots sit where Inkscape puts them: Rx on the top edge, Ry on the right edge', () => {
    expect(cornerKnots(rect({ rx: 12, ry: 7 }))).toEqual({ rx: [98, 20], ry: [110, 27] });
    // A rectangle drawn right-to-left / bottom-up has the same knots.
    expect(cornerKnots(rect({ x: 110, y: 80, w: -100, h: -60, rx: 12, ry: 7 }))).toEqual({ rx: [98, 20], ry: [110, 27] });
  });

  it('dragging Rx: x + w − px, clamped to [0, w/2]; Ctrl makes both equal, clamped to min(w,h)/2', () => {
    const s = rect({ rx: 5, ry: 7 });
    expect(dragRx(s, 90, false)).toEqual({ rx: 20, ry: 7 });
    expect(dragRx(s, -500, false).rx).toBe(50);
    expect(dragRx(s, 500, false).rx).toBe(0);
    expect(dragRx(s, 0, true)).toEqual({ rx: 30, ry: 30 });
    // Ry unset follows Rx; a legacy radius becomes Ry.
    expect(dragRx(rect(), 90, false)).toEqual({ rx: 20, ry: undefined });
    expect(cornerRadii({ ...rect(), ...dragRx(rect(), 90, false) })).toEqual({ rx: 20, ry: 20 });
    expect(dragRx(rect({ radius: 6 }), 90, false)).toEqual({ rx: 20, ry: 6 });
  });

  it('dragging Ry: py − y, clamped to h/2; with no Rx yet both follow (min(w,h)/2); Ctrl equal', () => {
    expect(dragRy(rect({ rx: 5, ry: 5 }), 45, false)).toEqual({ rx: 5, ry: 25 });
    expect(dragRy(rect({ rx: 5, ry: 5 }), 999, false).ry).toBe(30);
    expect(dragRy(rect(), 35, false)).toEqual({ rx: undefined, ry: 15 });
    expect(cornerRadii({ ...rect(), ...dragRy(rect(), 35, false) })).toEqual({ rx: 15, ry: 15 });
    expect(dragRy(rect({ rx: 40 }), 999, true)).toEqual({ rx: 30, ry: 30 });
    // Review: Inkscape checks whether Rx is SET, not the radius drawn. Ry alone, capped by min(w,h)/2; Rx stays unset.
    expect(dragRy(rect({ w: 20, h: 100, ry: 8 }), 999, false)).toEqual({ rx: 8, ry: 10 });
    // User's rule: without Ctrl only the dragged radius moves; the other keeps what it shows (Rx was copying 8).
    expect(dragRx(rect({ rx: 10 }), 70, false)).toEqual({ rx: 40, ry: 10 });
    expect(dragRy(rect({ rx: 10 }), 45, false)).toEqual({ rx: 10, ry: 25 });
    expect(dragRy(rect({ rx: 0, ry: 3 }), 999, false)).toEqual({ rx: 0, ry: 30 });
    // A legacy radius becomes Rx and Ry moves alone.
    expect(dragRy(rect({ radius: 6 }), 45, false)).toEqual({ rx: 6, ry: 25 });
  });

  it('Shift-click makes corners sharp; Ctrl-click copies this radius to the other; a plain click changes nothing', () => {
    const s = rect({ rx: 12, ry: 4 });
    expect(clickKnot(s, 'rx', { shift: true, ctrl: false })).toEqual(SHARP);
    // Sharp means unset (as Inkscape removes the attributes): a later Ry drag rounds again.
    expect(cornerRadii({ ...s, ...SHARP, ...dragRy({ ...s, ...SHARP }, 40, false) })).toEqual({ rx: 20, ry: 20 });
    expect(clickKnot(s, 'rx', { shift: false, ctrl: true })).toEqual({ rx: 12, ry: 12 });
    expect(clickKnot(s, 'ry', { shift: false, ctrl: true })).toEqual({ rx: 4, ry: 4 });
    expect(clickKnot(s, 'ry', { shift: false, ctrl: false })).toBeNull();
  });

  it('the rounded path is elliptical when Rx ≠ Ry and plain when sharp', () => {
    expect(roundRectPath({ x: 0, y: 0, w: 10, h: 10 }, 0, 0)).toBe('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    const d = roundRectPath({ x: 0, y: 0, w: 100, h: 60 }, 20, 10);
    expect(d.startsWith('M 20 0 L 80 0 C')).toBe(true);
    expect(d).toContain('100 10 L 100 50');
  });
});

describe('shape edit mode', () => {
  it('double-click finds the topmost rectangle or ellipse under the point; paths and lines have no edit mode', () => {
    const shapes = [{ ...rect({ type: 'path', x: 0, y: 0, w: 500, h: 500 }), id: 'c' }, { ...rect(), id: 'a' }, { ...rect({ type: 'ellipse', x: 50 }), id: 'b' }];
    expect(editableShapeAt(shapes, 60, 40)?.id).toBe('b');
    expect(editableShapeAt(shapes, 20, 40)?.id).toBe('a');
    expect(editableShapeAt(shapes, 400, 400)).toBeNull();
    // Review: a path on top hides the rectangle under it.
    expect(editableShapeAt([{ ...rect(), id: 'a' }, { ...rect({ type: 'path' }), id: 'p' }], 20, 40)).toBeNull();
    expect(editableShapeAt([{ ...rect({ x: 110, y: 80, w: -100, h: -60 }), id: 'n' }], 20, 30)?.id).toBe('n');
  });
});

describe('blur', () => {
  it('σ = (b/100)² · (w + h) / 4, and the % comes back from σ', () => {
    expect(blurSigma(100, 100, 60)).toBe(40);
    expect(blurSigma(50, 100, 60)).toBe(10);
    expect(blurSigma(0, 100, 60)).toBe(0);
    for (const p of [1, 12.5, 50, 99]) expect(blurPercent(blurSigma(p, 100, 60), 100, 60)).toBeCloseTo(p, 9);
  });

  it('never divides by zero and stays within 0–100 %', () => {
    expect(blurPercent(5, 0, 0)).toBe(0);
    expect(blurPercent(0, 100, 60)).toBe(0);
    expect(blurPercent(1e6, 100, 60)).toBe(100);
    expect(blurSigma(250, 100, 60)).toBe(40);
  });

  it('blur knots sit 2.4σ out from the top and right edges; dragging one gives σ back', () => {
    const s = rect({ blur: 5 });
    const k = blurKnots(s);
    expect(k.top).toEqual([60, 8]);
    expect(k.right).toEqual([122, 50]);
    expect(dragBlur(s, 'top', 60, 20 - 24)).toBeCloseTo(10);
    expect(dragBlur(s, 'right', 110 + 12, 50)).toBeCloseTo(5);
    expect(dragBlur(s, 'right', 50, 50)).toBe(0);
  });

  it('the SVG filter is in page units and covers the stroke too (review: lines vanished, thick strokes were cut)', () => {
    const line: ShapeSpec = { type: 'line', x: 80, y: 130, w: 240, h: 0, fill: null, stroke: '#fff', strokeWidth: 20, radius: 0, blur: 5 };
    expect(blurRegion(line)).toEqual({ x: 80 - 23, y: 130 - 23, w: 240 + 46, h: 46 });
    expect(blurFilterSvg('b', line)).toBe('<filter id="b" filterUnits="userSpaceOnUse" x="57" y="107" width="286" height="46" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="5"/></filter>');
    expect(strokeReach(rect({ strokeWidth: 50 }))).toBe(25);
    expect(strokeReach(rect({ strokeWidth: 50, join: 'miter' }))).toBe(100);
    expect(strokeReach(rect({ strokeWidth: 10, cap: 'square' }))).toBeCloseTo(5 * Math.SQRT2);
    expect(strokeReach(rect({ stroke: null, strokeWidth: 50 }))).toBe(0);
  });
});

describe('scaling keeps the look', () => {
  it('each radius follows its own axis; only one set uses max(rx, ry) for both (compensateRxRy); σ by the mean scale', () => {
    expect(scaleLook(rect({ rx: 10, ry: 4, blur: 3 }), 2, 3)).toMatchObject({ rx: 20, ry: 12, blur: 3 * Math.sqrt(6) });
    expect(scaleLook(rect({ rx: 10 }), 2, 0.5)).toMatchObject({ rx: 20, ry: 5 });
    expect(scaleLook(rect({ radius: 6 }), 2, 2)).toMatchObject({ rx: 12, ry: 12, radius: 12 });
    expect(scaleLook(rect(), 2, 2)).toEqual({ radius: 0 });
  });

  it('doubling the shape doubles σ, so the % shown stays the same', () => {
    const s = rect({ blur: blurSigma(30, 100, 60) });
    const layer = { id: 'l', type: 'vector' as const, name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal' as const, shapes: [{ ...s, id: 's' }] };
    const out = scaleLayer(layer as never, 2, 2, 0, 0) as typeof layer;
    expect(out.shapes[0].blur).toBeCloseTo(2 * s.blur!);
    expect(blurPercent(out.shapes[0].blur!, out.shapes[0].w, out.shapes[0].h)).toBeCloseTo(30);
  });

  it('a quarter turn swaps Rx and Ry with the sides (review: the corners stayed put)', () => {
    const layer = { id: 'l', type: 'vector' as const, name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal' as const, shapes: [{ ...rect({ w: 400, h: 200, rx: 100, ry: 10 }), id: 's' }] };
    for (const turn of ['rotate-cw', 'rotate-ccw'] as const) expect(turnVector(layer as never, turn).shapes[0]).toMatchObject({ w: 200, h: 400, rx: 10, ry: 100 });
    const one = { ...layer, shapes: [{ ...rect({ ry: 7 }), id: 's' }] };
    const t = turnVector(one as never, 'rotate-cw').shapes[0];
    expect([t.rx, t.ry]).toEqual([7, undefined]);
  });

  it('a rotated rounded rectangle becomes a path with the same elliptical corners and keeps its blur', () => {
    const c = Math.cos(0.3), sn = Math.sin(0.3);
    const out = transformShape(rect({ rx: 12, ry: 6, blur: 4 }), [c, sn, -sn, c, 0, 0]);
    expect(out.type).toBe('path');
    expect(out.rx).toBeUndefined();
    expect(out.blur).toBeCloseTo(4);
    expect(out.d!.match(/C/g)).toHaveLength(4);
  });
});

describe('stroke style', () => {
  it('old shapes keep round joins and caps; dashes are in stroke widths; miter limit only with miter joins', () => {
    expect(strokeLookSvg(rect(), 2)).toBe(' stroke-linecap="round" stroke-linejoin="round"');
    expect(strokeLookSvg(rect({ join: 'miter', cap: 'butt', dash: [4, 2], dashOffset: 1, paintOrder: 'stroke' }), 3))
      .toBe(' stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4" stroke-dasharray="12 6" stroke-dashoffset="3" paint-order="stroke"');
  });

  it('the exported rectangle carries rx, ry, the stroke style and its blur filter', () => {
    const svg = shapeSvg({ ...rect({ rx: 12, ry: 6, join: 'bevel', blur: 2 }), id: 'shp1' });
    expect(svg).toContain('rx="12" ry="6"');
    expect(svg).toContain('stroke-linejoin="bevel"');
    expect(svg).toMatch(/^<g filter="url\(#blur-shp1\)"><defs><filter id="blur-shp1"/);
  });
});
