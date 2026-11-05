import { describe, expect, it } from 'vitest';
import { compositeOp, segmentBox, stampSegment, tipFor, type BrushTip } from '../src/engine/design/brushEngine';
import { LEAD_FITS, type LeadGrade } from '../src/engine/design/brushLead';
import { applyBrushPreset, PENCIL_PRESETS } from '../src/engine/design/brushPresets';

const N = 96;
const mask = () => ({ data: new Uint8ClampedArray(N * N * 4), width: N, height: N });
const tipOf = (lead: LeadGrade, seed = 7): BrushTip => { const t = tipFor({ size: 24, lead }, false); t.lead!.seed = seed; return t; };
const stroke = (tip: BrushTip, density = 1, from?: { width: number; density: number }) => { const m = mask(); stampSegment(m, 0, 0, [8, 48, 88, 48, 24], density, tip, [0, 0, 0], from); return m; };
/** The tone after `passes` strokes composited with `darken` on white: T -= (T - colour) * alpha where T > colour. */
function tone(lead: LeadGrade, passes: number, density = 1): number {
  const T = new Float64Array(N * N).fill(1);
  for (let p = 0; p < passes; p++) {
    const m = stroke(tipOf(lead, p * 99991 + 5), density);
    for (let i = 0; i < T.length; i++) { const a = m.data[i * 4 + 3] / 255, c = m.data[i * 4] / 255; if (a && T[i] > c) T[i] -= (T[i] - c) * a; }
  }
  let sum = 0, n = 0;
  for (let y = 44; y < 52; y++) for (let x = 30; x < 66; x++) { sum += T[y * N + x]; n++; }
  return sum / n;
}

/** Mean alpha over the middle of a stroke drawn along `path` (one tip, one mask). */
function along(lead: LeadGrade, path: number[][]): number {
  const m = mask(), tip = tipOf(lead);
  for (let i = 1; i < path.length; i++) stampSegment(m, 0, 0, [path[i - 1][0], path[i - 1][1], path[i][0], path[i][1], 24], 1, tip, [0, 0, 0]);
  let sum = 0, n = 0;
  for (let y = 44; y < 52; y++) for (let x = 40; x < 56; x++) { sum += m.data[(y * N + x) * 4 + 3]; n++; }
  return sum / n;
}
const line = (step: number, from = 8, to = 88) => { const p: number[][] = []; for (let x = from; to > from ? x <= to : x >= to; x += to > from ? step : -step) p.push([x, 48]); return p; };

describe('graphite grades', () => {
  it('a straight stroke is one crossing however it is cut into segments', () => {
    for (const g of ['2H', '2B', '6B'] as const) {
      const whole = along(g, line(80));
      for (const step of [1, 3, 10]) expect(Math.abs(along(g, line(step)) - whole), `${g} step ${step}`).toBeLessThan(0.05 * whole + 1);
    }
  });

  it('a thin tip keeps its edge when the stroke is cut into small segments', () => {
    const width = (step: number) => {
      const m = mask(), tip = tipFor({ size: 5, lead: '2B' }, false); tip.lead!.seed = 7;
      const p = line(step);
      for (let i = 1; i < p.length; i++) stampSegment(m, 0, 0, [p[i - 1][0], 48, p[i][0], 48, 5], 1, tip, [0, 0, 0]);
      const at = (y: number) => { let s = 0; for (let x = 30; x < 66; x++) s += m.data[(y * N + x) * 4 + 3]; return s / 36; };
      return at(48) / Math.max(1, at(50));
    };
    expect(Math.abs(width(2) - width(80))).toBeLessThan(0.25 * width(80));
  });

  it('going back over a spot without lifting builds up, up to opaque at most', () => {
    for (const g of ['2H', '2B', '6B'] as const) {
      const once = along(g, line(3)), back = along(g, [...line(3), ...line(3, 88, 8)]), many = along(g, Array.from({ length: 12 }, (_, i) => (i % 2 ? line(3, 88, 8) : line(3))).flat());
      expect(back).toBeGreaterThan(once * 1.1);
      expect(back).toBeLessThan(once * 1.6); // Rubbing builds up slowly: lifting and passing again is what adds a full deposit.
      expect(many).toBeGreaterThan(back);
      expect(many).toBeLessThanOrEqual(255);
    }
  });

  it('softer grades are darker at the same pressure and passes', () => {
    const tones = (['2H', 'HB', '2B', '4B'] as const).map((g) => tone(g, 6));
    for (let i = 1; i < tones.length; i++) expect(tones[i]).toBeLessThan(tones[i - 1]);
  });

  it('passes darken up to the grade and stop short of black', () => {
    for (const g of ['2H', 'HB', '2B', '4B', '6B'] as const) {
      expect(tone(g, 3)).toBeLessThan(tone(g, 1));
      expect(tone(g, 60)).toBeGreaterThan(0.1);
    }
    expect(tone('2H', 60)).toBeGreaterThan(tone('4B', 60) + 0.2);
  });

  it('more pressure gives more graphite', () => {
    for (const g of ['2H', '2B', '6B'] as const) expect(tone(g, 2, 1)).toBeLessThan(tone(g, 2, 0.3));
  });

  it('the same stroke gives the same mask', () => {
    const a = stroke(tipOf('2B'));
    expect(a.data.some((v) => v > 0)).toBe(true);
    const shifted = { data: new Uint8ClampedArray(N * N * 4), width: N, height: N };
    stampSegment(shifted, 0, 0, [8, 48, 88, 48, 24], 1, tipOf('2B'), [0, 0, 0]);
    expect(shifted.data).toEqual(a.data);
  });

  it('never leaves the box the compositor repaints', () => {
    for (const lead of Object.keys(LEAD_FITS) as LeadGrade[]) for (const size of [1, 4, 40, 200]) {
      const seg = [100, 100, 130, 110, size] as const, big = { data: new Uint8ClampedArray(400 * 400 * 4), width: 400, height: 400 }, tip = tipFor({ size, lead }, false), box = segmentBox(seg, tip);
      stampSegment(big, 0, 0, seg, 1, tip, [0, 0, 0]);
      for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) if (big.data[(y * 400 + x) * 4 + 3]) {
        expect(x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h).toBe(true);
      }
    }
  });

  it('the colour tints the ceiling, and erasing ignores the grade', () => {
    const m = mask();
    stampSegment(m, 0, 0, [8, 48, 88, 48, 24], 1, tipOf('2B'), [200, 0, 0]);
    const i = (48 * N + 48) * 4;
    expect(m.data[i]).toBeGreaterThan(m.data[i + 1]);
    expect(tipFor({ size: 8, lead: '2B' }, true).lead).toBeUndefined();
  });

  it('presets draw with darken; other presets switch the grade off', () => {
    const lead = applyBrushPreset({ size: 1 }, PENCIL_PRESETS[0]);
    expect(compositeOp(tipFor(lead, false), false)).toBe('darken');
    expect(applyBrushPreset(lead, PENCIL_PRESETS.find((p) => p.id === 'pencil-soft')!).lead).toBeUndefined();
  });
});
