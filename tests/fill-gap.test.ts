import { describe, expect, it } from 'vitest';
import { floodMask } from '../src/engine/design/fill';
import { gapMask, similarMask } from '../src/engine/design/fillGap';

/** Opaque white page with a black ring (outer radius `r`, one pixel thick), optionally cut open by a `gap`-pixel opening at the right. */
function ring(size: number, r: number, gap = 0): Uint8ClampedArray {
  const px = new Uint8ClampedArray(size * size * 4).fill(255);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - c, y - c);
    if (d > r - 1.5 && d <= r && !(gap && x > c && Math.abs(y - c) < gap / 2)) { const p = (y * size + x) * 4; px[p] = px[p + 1] = px[p + 2] = 0; }
  }
  return px;
}
const count = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);

describe('Fill: close gaps', () => {
  const S = 60, R = 20, mid = S / 2;
  it('without closing, an opening lets the fill out to the whole page', () => {
    expect(count(floodMask(ring(S, R, 2), S, S, mid, mid, 24, 0))).toBeGreaterThan(S * S * 0.8);
  });
  it('closing seals an opening up to the gap and stays inside the ring', () => {
    const inside = count(floodMask(ring(S, R), S, S, mid, mid, 24, 0));
    const m = gapMask(ring(S, R, 2), S, S, mid, mid, 24, 2, 0)!;
    expect(count(m)).toBeLessThan(inside * 1.15);
    expect(count(m)).toBeGreaterThan(inside * 0.9);
    expect(m[(mid * S) + S - 2]).toBe(0); // the page corner side stays unfilled
  });
  it('an opening wider than the gap still leaks', () => {
    expect(count(gapMask(ring(S, R, 8), S, S, mid, mid, 24, 2, 0)!)).toBeGreaterThan(S * S * 0.6);
  });
  it('without any opening it equals the plain fill', () => {
    const plain = floodMask(ring(S, R), S, S, mid, mid, 24, 0);
    expect([...gapMask(ring(S, R), S, S, mid, mid, 24, 4, 0)!]).toEqual([...plain]);
  });
  it('a seed hugging the line returns null so the caller falls back', () => {
    const px = ring(S, R);
    const x = Math.round(mid + R - 2);
    expect(gapMask(px, S, S, x, mid, 24, 8, 0)).toBeNull();
  });
  it('expand grows the closed region too', () => {
    const a = count(gapMask(ring(S, R, 2), S, S, mid, mid, 24, 2, 0)!), b = count(gapMask(ring(S, R, 2), S, S, mid, mid, 24, 2, 2)!);
    expect(b).toBeGreaterThan(a);
  });
});

describe('Fill: all similar', () => {
  it('takes matching pixels connected or not', () => {
    const px = new Uint8ClampedArray([200, 0, 0, 255, 0, 0, 200, 255, 200, 0, 0, 255]);
    expect([...similarMask(px, 3, 1, 0, 0, 10, 0)]).toEqual([1, 0, 1]);
    expect([...floodMask(px, 3, 1, 0, 0, 10, 0)]).toEqual([1, 0, 0]);
  });
  it('expand grows by whole pixels', () => {
    const px = new Uint8ClampedArray([200, 0, 0, 255, 0, 0, 200, 255, 0, 0, 200, 255, 0, 0, 200, 255]);
    expect([...similarMask(px, 4, 1, 0, 0, 10, 1)]).toEqual([1, 1, 0, 0]);
  });
});

describe('Fill: speed on a large page', () => {
  it('2000×2000 stays interactive (timing printed)', () => {
    const S = 2000, px = ring(S, 900, 4);
    const time = (f: () => unknown) => { const t = performance.now(); f(); return Math.round(performance.now() - t); };
    const plain = time(() => floodMask(px, S, S, S / 2, S / 2, 24, 0));
    const gap = time(() => gapMask(px, S, S, S / 2, S / 2, 24, 6, 0));
    const similar = time(() => similarMask(px, S, S, S / 2, S / 2, 24, 0));
    console.log(`fill 2000x2000 ms: plain-leaking ${plain}, gap 6 ${gap}, similar ${similar}`);
    expect(gap).toBeLessThan(2000);
  });
});
