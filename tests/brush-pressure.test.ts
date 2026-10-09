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
