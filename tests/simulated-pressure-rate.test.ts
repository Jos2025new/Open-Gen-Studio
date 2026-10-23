import { describe, expect, it } from 'vitest';
import { simulatedPressure } from '../src/engine/design/brushEngine';

/* Simulated pressure follows the hand's speed, not how often the mouse or touchpad reports it. */

const FRAME = 1000 / 60;
// The same hand: `speed` px per ms for `ms`, reported every `every` ms.
function run(speed: number, ms: number, every: number, influence?: number): number {
  let p = 0.5;
  for (let i = Math.round(ms / every); i > 0; i--) p = simulatedPressure(p, speed * every, 20, every, influence);
  return p;
}

describe('simulated pressure is independent of the event rate', () => {
  it('a 60 Hz mouse, a 120 Hz touchpad and a 240 Hz mouse give the same pressure at the same speed', () => {
    for (const speed of [0.05, 0.3, 1, 3]) {
      const at60 = run(speed, 200, FRAME);
      expect(run(speed, 200, FRAME / 2)).toBeCloseTo(at60, 3);
      expect(run(speed, 200, FRAME / 4)).toBeCloseTo(at60, 3);
    }
  });

  it('at 60 Hz it feels as before (same formula, same values)', () => {
    const old = (prev: number, d: number, size: number) => { const r = Math.min(1, d / size); return Math.min(1, prev + (Math.min(1, 1 - r) - prev) * (r * 0.275)); };
    for (const d of [0, 1, 5, 12, 40]) expect(simulatedPressure(0.5, d, 20, FRAME)).toBeCloseTo(old(0.5, d, 20), 10);
    // Without a time (Lineart, textured stamps): unchanged.
    expect(simulatedPressure(0.5, 7, 20)).toBeCloseTo(old(0.5, 7, 20), 10);
  });

  it('speed influence: more makes fast strokes thinner, less keeps them fuller; values stay in 0–1', () => {
    const base = run(0.6, 200, FRAME), more = run(0.6, 200, FRAME, 2), less = run(0.6, 200, FRAME, 0.5);
    expect(more).toBeLessThan(base);
    expect(less).toBeGreaterThan(base);
    for (const p of [run(50, 100, 1), run(0, 1000, FRAME), simulatedPressure(0.5, 5, 20, 0)]) { expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1); }
  });
});

import { brushSegment, newBrushStroke, penPressure } from '../src/engine/design/brushStroke';

describe('the brush reads speed from the pointer samples', () => {
  const layer = { x: 0, y: 0, width: 4000, height: 100, pxWidth: 4000, pxHeight: 100 } as never;
  const brush = { size: 20, minSize: 0.2, simulatePressure: true, color: '#000', opacity: 1 };
  // A stroke at `speed` px/ms for 300 ms, sampled every `every` ms, as Stage sends it (pressure read, then the segment).
  const stroke = (speed: number, every: number, b = brush) => {
    penPressure({ pointerType: 'mouse', pressure: 0.5, timeStamp: 1000 });
    newBrushStroke(b, false);
    let w = 0, x = 0;
    for (let i = 1; i <= Math.round(300 / every); i++) {
      penPressure({ pointerType: 'mouse', pressure: 0.5, timeStamp: 1000 + i * every });
      w = brushSegment(layer, { x, y: 0 }, { x: x + speed * every, y: 0 }, b, 1).seg[4];
      x += speed * every;
    }
    return w;
  };

  it('the same hand paints the same width on a 60 Hz touchpad and a 240 Hz mouse', () => {
    expect(stroke(0.8, 1000 / 240)).toBeCloseTo(stroke(0.8, 1000 / 60), 2);
  });

  it('Speed influence changes how much a fast stroke thins', () => {
    expect(stroke(0.8, 1000 / 60, { ...brush, pressureSpeed: 2 } as typeof brush)).toBeLessThan(stroke(0.8, 1000 / 60));
  });
});
