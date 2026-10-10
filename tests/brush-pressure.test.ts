import { describe, expect, it } from 'vitest';
import { lastPressure, penPressure } from '../src/engine/design/brushStroke';

/* Pen pressure reaches the brush, and what the device sends is shown (a missing pressure is not silent). */
describe('pressure from the pointer', () => {
  it('a pen gives its pressure; a mouse (0.5 pressed) paints at full pressure and says it has none', () => {
    expect(penPressure({ pointerType: 'pen', pressure: 0.3 })).toBe(0.3);
    expect(lastPressure()).toEqual({ device: 'pen', pressure: 0.3 });
    expect(penPressure({ pointerType: 'mouse', pressure: 0.5 })).toBe(1);
    expect(lastPressure()).toEqual({ device: 'mouse', pressure: null });
  });
  it('a tablet reported as a mouse with real pressure (Linux) still gives its pressure', () => {
    expect(penPressure({ pointerType: 'mouse', pressure: 0.73 })).toBe(0.73);
    expect(lastPressure()).toEqual({ device: 'mouse', pressure: 0.73 });
  });
  it('a pen touching with no pressure value paints at full pressure', () => {
    expect(penPressure({ pointerType: 'pen', pressure: 0 })).toBe(1);
  });
});

import { simulatedPressure } from '../src/engine/design/brushEngine';
import { brushSegment, newBrushStroke } from '../src/engine/design/brushStroke';

describe('simulated pressure (as Lineart, perfect-freehand)', () => {
  it('slow moves keep pressure up, fast moves bring it down', () => {
    expect(simulatedPressure(0.5, 0, 20)).toBe(0.5);
    expect(simulatedPressure(0.5, 2, 20)).toBeGreaterThan(0.5);
    expect(simulatedPressure(0.5, 20, 20)).toBeLessThan(0.5);
  });
  it('a fast stroke paints thinner than a slow one; the pointer pressure is ignored', () => {
    const layer = { x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100 } as never;
    const brush = { size: 20, minSize: 0.2, simulatePressure: true, color: '#000', opacity: 1 };
    const widths = (step: number) => { newBrushStroke(brush, false); let w = 0; for (let i = 0; i < 12; i++) w = brushSegment(layer, { x: i * step, y: 0 }, { x: (i + 1) * step, y: 0 }, brush, 1).seg[4]; return w; };
    expect(widths(30)).toBeLessThan(widths(1));
  });
});

import { taperAt } from '../src/engine/design/brushEngine';
import { endBrushStroke } from '../src/engine/design/brushStroke';

describe('tapers (as Lineart: perfect-freehand curves, in px)', () => {
  it('the share of the width grows from 0 at the end of the stroke to all of it at the taper length', () => {
    expect(taperAt(0, 40, 'start')).toBe(0);
    expect(taperAt(40, 40, 'start')).toBe(1);
    expect(taperAt(10, 40, 'start')).toBeGreaterThan(0.25);
    expect(taperAt(10, 40, 'end')).toBeGreaterThan(taperAt(10, 40, 'start'));
    expect(taperAt(0, 0, 'start')).toBe(1);
    expect(taperAt(0, undefined, 'end')).toBe(1);
  });
  const layer = { x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100 } as never;
  it('with Taper start the first touch is a point, not a disc, and the width opens along the stroke', () => {
    const brush = { size: 20, taperStart: 40, color: '#000', opacity: 1 };
    newBrushStroke(brush, false);
    const dab = brushSegment(layer, { x: 0, y: 0 }, { x: 0, y: 0 }, brush, 1).seg[4];
    const ws = [1, 2, 3, 4, 5, 6].map((i) => brushSegment(layer, { x: (i - 1) * 10, y: 0 }, { x: i * 10, y: 0 }, brush, 1).seg[4]);
    expect(dab).toBe(0);
    for (let i = 1; i < ws.length; i++) expect(ws[i]).toBeGreaterThanOrEqual(ws[i - 1]);
    expect(ws[3]).toBe(20);
    newBrushStroke({ ...brush, taperStart: 0 }, false);
    expect(brushSegment(layer, { x: 0, y: 0 }, { x: 0, y: 0 }, { ...brush, taperStart: 0 }, 1).seg[4]).toBe(20);
  });
  it('on lift, Taper end closes the last stretch to a point; the rest keeps its width', () => {
    const brush = { size: 20, taperEnd: 30, color: '#000', opacity: 1 };
    const stroke = newBrushStroke(brush, false);
    for (let i = 0; i < 10; i++) stroke.segments.push([i * 10, 0, (i + 1) * 10, 0, 20]);
    endBrushStroke(stroke, { tip: undefined } as never, {} as never, layer, brush);
    const w = stroke.segments.map((s) => s[4]);
    expect(w.slice(0, 6)).toEqual([20, 20, 20, 20, 20, 20]);
    expect(w[9]).toBe(0);
    expect(w[8]).toBeLessThan(w[7]);
    expect(w[7]).toBeLessThan(20);
  });
});

describe('mirror (reflection across the page centre)', () => {
  const layer = { x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100 } as never;
  it('each segment comes with its reflection, same width; the end taper treats each pair as one', () => {
    const brush = { size: 10, mirror: true, taperEnd: 20, color: '#000', opacity: 1 };
    const stroke = newBrushStroke(brush, false);
    const s = brushSegment(layer, { x: 10, y: 5 }, { x: 20, y: 5 }, brush, 1, 100);
    expect(s.mirror).toEqual([90, 5, 80, 5, s.seg[4]]);
    expect(stroke.tip?.mirror).toBe(true);
    for (let i = 0; i < 5; i++) stroke.segments.push([i * 10, 0, (i + 1) * 10, 0, 10], [100 - i * 10, 0, 90 - i * 10, 0, 10]);
    endBrushStroke(stroke, { tip: undefined } as never, {} as never, layer, brush);
    const w = stroke.segments.map((x) => x[4]);
    for (let i = 0; i < w.length; i += 2) expect(w[i]).toBe(w[i + 1]);
    expect(w.slice(-2)).toEqual([0, 0]);
    expect(w.slice(0, 4)).toEqual([10, 10, 10, 10]);
  });
  it('without mirror, no reflection', () => {
    expect(brushSegment(layer, { x: 10, y: 5 }, { x: 20, y: 5 }, { size: 10 }, 1, 100).mirror).toBeUndefined();
  });
});
