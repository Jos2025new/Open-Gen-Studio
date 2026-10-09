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
