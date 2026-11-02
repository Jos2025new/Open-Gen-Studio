import { describe, expect, it } from 'vitest';
import { applyTooth, atPressure, pencilDensityCurve, stampSegment, textureAt, tipFor, type AlphaImage, type BrushTip } from '../src/engine/design/brushEngine';
import { newDabState, repaintDabs, stampDabStroke, stampTip } from '../src/engine/design/brushDabs';
import { applyBrushPreset, DAB_PRESETS, PENCIL_PRESETS } from '../src/engine/design/brushPresets';

const W = 120, H = 80;
const img = (): AlphaImage => ({ data: new Uint8ClampedArray(W * H * 4), width: W, height: H });
const alphas = (i: AlphaImage) => Array.from({ length: W * H }, (_, k) => i.data[k * 4 + 3]);
/** FNV-1a over the bytes of a mask (or a string): a fingerprint for byte-identity. */
const sha = (v: AlphaImage | string) => {
  let h = 0x811c9dc5;
  const bytes = typeof v === 'string' ? Array.from(v, (c) => c.charCodeAt(0) & 255) : v.data;
  for (let k = 0; k < bytes.length; k++) h = Math.imul(h ^ bytes[k], 0x01000193);
  return (h >>> 0).toString(16);
};
const path = [[10, 40, 30, 30, 10], [30, 30, 55, 44, 12], [55, 44, 80, 36, 9], [80, 36, 105, 50, 6]];
const dens = [0.6, 1, 0.8, 0.5];
const D = { spacing: 0.25, scatter: 0.4, sizeJitter: 0.2, angleJitter: 0.5, flow: 0.3, seed: 7 };
const dabStroke = (tip: BrushTip, segs = path, d = dens) => { const i = img(); stampDabStroke(i, 0, 0, segs, d, tip, [0, 0, 0]); return i; };
const capsule = (tip: BrushTip) => { const i = img(); path.forEach((s, n) => stampSegment(i, 0, 0, s, dens[n], tip, [0, 0, 0], n ? { width: path[n - 1][4], density: dens[n - 1] } : undefined)); return i; };
const base = { hardness: 0.6, texture: 'graphite', textureStrength: 0.5 } as const;
const grade = (id: string) => PENCIL_PRESETS.find((p) => p.id === id)!.values;
const dens_ = (id: string, p: number) => { const v = grade(id); return atPressure(v, p).density; };

describe('pencilDensityCurve', () => {
  it('softer lead deposits more at low and mid pressure; every grade reaches 1', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75]) {
      const at = (lh: number) => pencilDensityCurve(p, 0.3, lh);
      expect(at(0.15), `4B>HB p=${p}`).toBeGreaterThan(at(0.26));
      expect(at(0.26), `HB>2H p=${p}`).toBeGreaterThan(at(0.34));
    }
    for (const id of ['pencil-2h', 'pencil-hb', 'pencil-4b']) { expect(dens_(id, 1)).toBeCloseTo(1, 12); expect(dens_(id, 0)).toBeCloseTo(grade(id).minDensity, 12); }
    for (const lh of [0, 0.15, 0.5, 1]) { expect(pencilDensityCurve(1, 0.3, lh)).toBeCloseTo(1, 12); expect(pencilDensityCurve(0, 0.3, lh)).toBeCloseTo(0.3, 12); }
  });
  it('is monotonic with no jumps', () => {
    for (const lh of [0, 0.15, 0.26, 0.34, 0.6, 1]) {
      let prev = pencilDensityCurve(0, 0.25, lh);
      for (let k = 1; k <= 200; k++) {
        const v = pencilDensityCurve(k / 200, 0.25, lh);
        expect(v).toBeGreaterThanOrEqual(prev);
        expect(v - prev).toBeLessThan(0.05);
        prev = v;
      }
    }
  });
  it('absent leadHardness is the exact old linear curve', () => {
    for (const p of [0, 0.13, 0.5, 0.77, 1]) expect(atPressure({ size: 9, pressureDensity: true, minDensity: 0.3 }, p).density).toBe(0.3 + 0.7 * p);
    expect(sha(JSON.stringify([0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => atPressure({ size: 10, pressureDensity: true, minDensity: 0.3 }, p).density)))).toBe('3edb35c4');
  });
  it('is not applied when pressure → density is off', () => {
    expect(atPressure({ size: 9, leadHardness: 0.1 }, 0.3).density).toBe(1);
  });
  it('a stroke records densities, not the lead: replay uses them as stored', () => {
    const o = { size: 8, pressureDensity: true, leadHardness: 0.15, ...base, dabs: true };
    const tip = tipFor(o, false);
    expect('leadHardness' in tip).toBe(false);
    expect(tip.densities).toEqual([]);
    tip.densities!.push(...[0.2, 0.5, 0.9].map((p) => atPressure(o, p).density));
    const segs = path.slice(0, 3), a = dabStroke(tip, segs, tip.densities), b = dabStroke(tip, segs, [...tip.densities!]);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    // Other densities do change the mask, so the recorded ones are what is read.
    expect(alphas(dabStroke(tip, segs, [1, 1, 1]))).not.toEqual(alphas(a));
  });
});

describe('presets', () => {
  it('2H, HB and 4B carry the clay fraction; the rest are untouched', () => {
    expect(grade('pencil-2h').leadHardness).toBe(0.34);
    expect(grade('pencil-hb').leadHardness).toBe(0.26);
    expect(grade('pencil-4b').leadHardness).toBe(0.15);
    const rest = [...PENCIL_PRESETS, ...DAB_PRESETS].filter((p) => !['pencil-2h', 'pencil-hb', 'pencil-4b'].includes(p.id));
    expect(rest).toHaveLength(8);
    expect(sha(JSON.stringify(rest))).toBe('270641bb');
  });
  it('a preset without lead hardness clears the previous one', () => {
    const out = applyBrushPreset(applyBrushPreset({ size: 1, color: '#000000' }, PENCIL_PRESETS[2]), PENCIL_PRESETS[3]);
    expect(out.leadHardness).toBeUndefined();
  });
  it('same pressure, three grades: 4B > HB > 2H at low and mid pressure', () => {
    for (const p of [0.25, 0.5]) { expect(dens_('pencil-4b', p)).toBeGreaterThan(dens_('pencil-hb', p)); expect(dens_('pencil-hb', p)).toBeGreaterThan(dens_('pencil-2h', p)); }
  });
});

describe('tooth v2', () => {
  it('applyTooth is the subtraction', () => {
    expect(applyTooth(0.8, 1, 0.5)).toBe(0.8);
    expect(applyTooth(0.5, 0, 0.2)).toBeCloseTo(0.2, 12);
    expect(applyTooth(0.1, 0, 0.5)).toBe(0);
  });
  it('tipFor records version 2 only with tooth', () => {
    expect(tipFor({ size: 5, ...base, tooth: true }, false).toothVersion).toBe(2);
    expect('toothVersion' in tipFor({ size: 5, ...base }, false)).toBe(false);
    expect('toothVersion' in tipFor({ size: 5, tooth: true }, false)).toBe(false);
  });
  it('capsule: version 2 equals the old result (golden hash from before the change)', () => {
    const v1 = capsule({ ...base, tooth: true, edge: 0.3 }), v2 = capsule({ ...base, tooth: true, toothVersion: 2, edge: 0.3 });
    expect(Array.from(v2.data)).toEqual(Array.from(v1.data));
    expect(sha(v1)).toBe('6a2f9c73');
  });
  it('dabs: v1 strokes (no version) replay byte-identical; so do strokes without tooth', () => {
    expect(sha(dabStroke({ ...base, tooth: true, dabs: D }))).toBe('de4f2bd3');
    expect(sha(dabStroke({ ...base, dabs: D }))).toBe('e16265c3');
  });
  it('dabs v2: accumulate first, then one subtraction per pixel', () => {
    const t2: BrushTip = { ...base, textureStrength: 0.3, tooth: true, toothVersion: 2, dabs: D };
    const t1: BrushTip = { ...t2, toothVersion: undefined };
    delete t1.toothVersion;
    const raw = dabStroke({ hardness: 0.6, dabs: D }), v2 = dabStroke(t2), v1 = dabStroke(t1);
    expect(alphas(v2)).not.toEqual(alphas(v1));
    let checked = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = raw.data[(y * W + x) * 4 + 3] / 255;
      if (!c) continue;
      const want = applyTooth(c, textureAt('graphite', x, y), 0.3) * 255;
      expect(Math.abs(v2.data[(y * W + x) * 4 + 3] - want)).toBeLessThanOrEqual(1.01);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
  });
  it('dabs v2: a faint 4H stroke keeps visible alpha after tooth; and many dabs build up', () => {
    const faint = { ...DAB_PRESETS[1].values, textureStrength: 0.3 };
    const tip = tipFor({ ...faint, tooth: true, dabs: true }, false);
    tip.dabs!.seed = 5;
    expect(tip.toothVersion).toBe(2);
    const line = [[10, 40, 110, 40, 4]];
    const one = dabStroke(tip, [[60, 40, 60, 40, 4]], [1]), many = dabStroke(tip, line, [1]);
    const sum = (i: AlphaImage) => alphas(i).reduce((a, b) => a + b, 0), max = (i: AlphaImage) => Math.max(...alphas(i));
    expect(max(many)).toBeGreaterThan(10);
    expect(sum(many)).toBeGreaterThan(sum(one) * 10);
    // The faint pits end up empty, the crests keep paint.
    expect(alphas(many).filter((a) => a > 0).length).toBeGreaterThan(40);
  });
  it('tooth in capsule and dabs: same footprint, same texture threshold, same zeroed pixels', () => {
    const tex = { hardness: 1, texture: 'graphite', textureStrength: 0.5, tooth: true, toothVersion: 2 } as const;
    const seg = [[60, 40, 60, 40, 20]];
    const cap = img(); stampSegment(cap, 0, 0, seg[0], 0.5, tex, [0, 0, 0]);
    const dab = dabStroke({ ...tex, dabs: { spacing: 0.25, scatter: 0, sizeJitter: 0, angleJitter: 0, flow: 0.5, seed: 1 } }, seg, [1]);
    const zero = (i: AlphaImage) => alphas(i).map((a) => a === 0);
    expect(zero(dab)).toEqual(zero(cap));
    expect(alphas(dab).some((a) => a > 0)).toBe(true);
    expect(alphas(dab).some((a) => a === 0)).toBe(true);
    // And inside the disc some pixels are zeroed by the grain in both.
    let pits = 0; for (let y = 32; y < 48; y++) for (let x = 52; x < 68; x++) if (Math.hypot(x - 59.5, y - 39.5) < 7 && cap.data[(y * W + x) * 4 + 3] === 0) pits++;
    expect(pits).toBeGreaterThan(3);
  });
  it('live, repaint and replay give the same v2 mask', () => {
    const tip: BrushTip = { ...base, tooth: true, toothVersion: 2, dabs: D };
    const replay = dabStroke(tip);
    const live = { tip, color: '#000000', last: undefined as { width: number; density: number } | undefined, dabs: newDabState() };
    const via = img();
    path.forEach((s, i) => { stampTip(live, via, 0, 0, { x0: 0, y0: 0 }, s, dens[i]); live.last = { width: s[4], density: dens[i] }; });
    expect(Array.from(via.data)).toEqual(Array.from(replay.data));
    const rep = img();
    repaintDabs(live, rep, 0, 0, { x0: 0, y0: 0 }, path, dens);
    expect(Array.from(rep.data)).toEqual(Array.from(replay.data));
  });
});

describe('inter-pass accumulation', () => {
  const composite = (layer: Float32Array, m: AlphaImage) => { for (let k = 0; k < layer.length; k++) { const a = m.data[k * 4 + 3] / 255; layer[k] = layer[k] + (1 - layer[k]) * a; } };
  const mean = (layer: Float32Array) => { let s = 0, n = 0; for (let y = 36; y < 45; y++) for (let x = 20; x < 100; x++) { s += layer[y * W + x]; n++; } return s / n; };
  it('five separate overlapping strokes get progressively darker', () => {
    for (const mk of [(seed: number) => dabStroke({ ...base, tooth: true, toothVersion: 2, dabs: { ...D, flow: 0.08, scatter: 0.5, seed } }, [[10, 40, 110, 40, 8]], [1]), (seed: number) => capsule({ ...base, tooth: true, toothVersion: 2, hardness: 0.6, edge: 0.3 + seed * 0 })]) {
      const layer = new Float32Array(W * H), seen: number[] = [];
      for (let s = 1; s <= 5; s++) { composite(layer, mk(s)); seen.push(mean(layer)); }
      for (let s = 1; s < 5; s++) expect(seen[s], JSON.stringify(seen)).toBeGreaterThan(seen[s - 1]);
    }
  });
});
