import { afterEach, describe, expect, it, vi } from 'vitest';

// A canvas that really keeps pixels (get/putImageData), so the live path can be read back and compared with replay.
vi.hoisted(() => {
  const on = () => undefined;
  Object.assign(globalThis, { window: globalThis, location: { port: '5173' }, document: { visibilityState: 'visible', addEventListener: on }, addEventListener: on });
});
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: { get: async () => undefined, set: async () => undefined, delMany: async () => undefined },
}));
vi.mock('../src/lib/media', () => {
  const fake = (w: number, h: number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    const ctx = {
      createImageData: (iw: number, ih: number) => ({ data: new Uint8ClampedArray(iw * ih * 4), width: iw, height: ih }),
      getImageData: (x: number, y: number, iw: number, ih: number) => {
        const out = new Uint8ClampedArray(iw * ih * 4);
        for (let r = 0; r < ih; r++) out.set(data.subarray(((y + r) * w + x) * 4, ((y + r) * w + x + iw) * 4), r * iw * 4);
        return { data: out, width: iw, height: ih };
      },
      putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number, dx = 0, dy = 0, dw = img.width, dh = img.height) => {
        for (let r = 0; r < dh; r++) for (let c = 0; c < dw; c++) {
          const s = ((dy + r) * img.width + dx + c) * 4, d = ((y + dy + r) * w + x + dx + c) * 4;
          data.set(img.data.subarray(s, s + 4), d);
        }
      },
      save: () => undefined, restore: () => undefined, clearRect: () => undefined, drawImage: () => undefined,
    };
    return { width: w, height: h, data, getContext: () => ctx };
  };
  return { createCanvas: fake, ctx2d: (c: { getContext: (k: string) => unknown }) => c.getContext('2d'), canvasToBlob: async () => new Blob(['x']), blobToCanvas: async () => fake(1, 1) };
});

import { segmentBox, stampSegment, tipFor, type AlphaImage, type BrushTip } from '../src/engine/design/brushEngine';
import { stampDabStroke, stampTip, newDabState } from '../src/engine/design/brushDabs';
import { beginLiveStroke, paintLive, repaintLive } from '../src/engine/design/raster';
import { rasterStrokeMask } from '../src/engine/design/rasterStrokeMask';
import { place } from '../src/engine/design/rasterSurface';
import { applyBrushPreset, DAB_PRESETS, PENCIL_PRESETS } from '../src/engine/design/brushPresets';
import type { RasterStroke } from '../src/engine/types';

const W = 120, H = 80;
const img = (w = W, h = H): AlphaImage => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
const alphas = (i: { data: Uint8ClampedArray }) => Array.from({ length: i.data.length / 4 }, (_, k) => i.data[k * 4 + 3]);
const dabTip = (over: Partial<NonNullable<BrushTip['dabs']>> = {}, extra: Partial<BrushTip> = {}): BrushTip => ({ hardness: 0.6, ...extra, dabs: { spacing: 0.25, scatter: 0.4, sizeJitter: 0.2, angleJitter: 0.5, flow: 0.3, seed: 7, ...over } });
// A bent stroke of several segments, widths and densities changing.
const path = [[10, 40, 30, 30, 10], [30, 30, 55, 44, 12], [55, 44, 80, 36, 9], [80, 36, 105, 50, 6]];
const dens = [0.6, 1, 0.8, 0.5];
const stamp = (tip: BrushTip, segs = path, d = dens) => { const i = img(); stampDabStroke(i, 0, 0, segs, d, tip, [0, 0, 0]); return i; };
const maxAlpha = (i: AlphaImage) => Math.max(...alphas(i));
const sum = (i: AlphaImage) => alphas(i).reduce((a, b) => a + b, 0);

describe('tips without dabs', () => {
  it('record nothing new and stamp the old mask', () => {
    expect('dabs' in tipFor({ size: 8, hardness: 0.5, texture: 'paper', textureStrength: 0.5 }, false)).toBe(false);
    const tip: BrushTip = { hardness: 0.5, edge: 0.3 }, old = img(), via = img();
    path.forEach((s, i) => stampSegment(old, 0, 0, s, dens[i], tip, [1, 2, 3], i ? { width: path[i - 1][4], density: dens[i - 1] } : undefined));
    const live = { tip, color: '#010203', last: undefined as { width: number; density: number } | undefined };
    path.forEach((s, i) => { stampTip(live, via, 0, 0, { x0: 0, y0: 0 }, s, dens[i]); live.last = { width: s[4], density: dens[i] }; });
    expect(Array.from(via.data)).toEqual(Array.from(old.data));
    expect(segmentBox(path[0], tip)).toEqual(segmentBox(path[0], { edge: 0.3 }));
    expect(segmentBox(path[0], { dabs: dabTip().dabs, edge: 0.3 }).w).toBeGreaterThan(segmentBox(path[0], tip).w);
  });
  it('tipFor records dabs only when the brush asks, clamped, with a seed', () => {
    expect(tipFor({ size: 8, dabs: true }, false).dabs).toMatchObject({ spacing: 0.25, scatter: 0, flow: 0.3 });
    expect(tipFor({ size: 8, dabs: true, dabSpacing: 0.001, dabScatter: 9, dabFlow: 0 }, false).dabs).toMatchObject({ spacing: 0.05, scatter: 3, flow: 0.001 });
    expect(tipFor({ size: 8, dabs: false, dabScatter: 1 }, false).dabs).toBeUndefined();
  });
});

describe('dab mode', () => {
  it('is deterministic, and the seed changes the scatter', () => {
    expect(alphas(stamp(dabTip()))).toEqual(alphas(stamp(dabTip())));
    expect(alphas(stamp(dabTip({ seed: 8 })))).not.toEqual(alphas(stamp(dabTip({ seed: 7 }))));
    expect(maxAlpha(stamp(dabTip()))).toBeGreaterThan(0);
  });
  it('builds up: overlapping dabs are darker than a single dab, and a second pass darker than one', () => {
    const one = stamp(dabTip({ scatter: 0, sizeJitter: 0 }), [[40, 40, 40, 40, 20]], [1]);
    const many = stamp(dabTip({ scatter: 0, sizeJitter: 0 }), [[36, 40, 44, 40, 20]], [1]);
    const alphaAt = (i: AlphaImage, x: number, y: number) => i.data[(y * i.width + x) * 4 + 3];
    // One dab at flow .3 leaves ~.3 at its centre; a short drag lays several on top of each other.
    expect(alphaAt(one, 40, 40)).toBeGreaterThan(60);
    expect(alphaAt(one, 40, 40)).toBeLessThan(90);
    const row = [[10, 40, 100, 40, 20]];
    const once = stamp(dabTip({ scatter: 0, sizeJitter: 0 }), row, [1]), twice = stamp(dabTip({ scatter: 0, sizeJitter: 0 }), [...row, [100, 40, 10, 40, 20]], [1, 1]);
    expect(alphaAt(many, 40, 40)).toBeGreaterThan(alphaAt(one, 40, 40));
    expect(alphaAt(twice, 50, 40)).toBeGreaterThan(alphaAt(once, 50, 40));
    // Not the max-coverage mask: the same stroke with flow 1 saturates, flow .3 stays below it.
    expect(alphaAt(once, 50, 40)).toBeLessThan(alphaAt(stamp(dabTip({ scatter: 0, sizeJitter: 0, flow: 1 }), row, [1]), 50, 40));
  });
  it('scatter puts coverage outside the clean capsule', () => {
    const line = [[10, 40, 110, 40, 8]], outside = (i: AlphaImage) => { let n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.abs(y + 0.5 - 40) > 5 && i.data[(y * W + x) * 4 + 3] > 0) n++; return n; };
    expect(outside(stamp(dabTip({ scatter: 0, sizeJitter: 0, angleJitter: 0 }), line, [1]))).toBe(0);
    expect(outside(stamp(dabTip({ scatter: 1, sizeJitter: 0, angleJitter: 0 }), line, [1]))).toBeGreaterThan(80);
  });
  it('a 4H-light stroke leaves visible alpha although each dab rounds to 0 in 8 bits', () => {
    const tip = dabTip({ flow: 0.0015, scatter: 0.3, sizeJitter: 0, angleJitter: 0 }, { hardness: 1 });
    expect(Math.round(0.0015 * 255)).toBe(0);
    const out = stamp(tip, [[10, 40, 110, 40, 8]], [1]);
    expect(maxAlpha(out)).toBeGreaterThanOrEqual(3);
  });
  it('angle jitter turns an elliptical tip; size jitter changes the footprint', () => {
    const ell = { roundness: 0.25 } as Partial<BrushTip>, seg = [[20, 40, 100, 40, 16]];
    expect(alphas(stamp(dabTip({ angleJitter: 1, scatter: 0, sizeJitter: 0 }, ell), seg, [1]))).not.toEqual(alphas(stamp(dabTip({ angleJitter: 0, scatter: 0, sizeJitter: 0 }, ell), seg, [1])));
    expect(sum(stamp(dabTip({ sizeJitter: 0.6, scatter: 0 }), seg, [1]))).not.toBe(sum(stamp(dabTip({ sizeJitter: 0, scatter: 0 }), seg, [1])));
  });
  it('is the same whatever the live buffer origin is (positions are layer pixels)', () => {
    const tip = dabTip({}, { texture: 'paper', textureStrength: 0.5, edge: 0.3 }), a = img(), b = img(W + 40, H + 20);
    const sa = { tip, color: '#000000', dabs: undefined as ReturnType<typeof newDabState> | undefined }, sb = { ...sa };
    path.forEach((s, i) => {
      stampTip(sa, a, 0, 0, { x0: 0, y0: 0 }, s, dens[i]);
      // The same layer pixels seen from a buffer that starts at (-20, -10): the image is that much further out.
      stampTip(sb, b, 0, 0, { x0: -20, y0: -10 }, s, dens[i]);
    });
    const A = alphas(a), B = alphas(b);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expect(B[(y + 10) * (W + 40) + x + 20]).toBe(A[y * W + x]);
  });
  it('mirror strokes (segments in pairs) walk each side on its own', () => {
    // Without noise, each half must be what its own path gives alone; one shared carry would shift the dabs.
    const calm = { scatter: 0, sizeJitter: 0, angleJitter: 0 }, left = [[5, 30, 13, 30, 8], [13, 30, 30, 36, 8], [30, 36, 44, 36, 8]];
    const pairs = left.flatMap((s) => [s, [W - s[0], s[1], W - s[2], s[3], s[4]]]);
    const both = stamp(dabTip(calm, { mirror: true }), pairs, pairs.map(() => 1)), alone = stamp(dabTip(calm), left, left.map(() => 1));
    for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) expect(both.data[(y * W + x) * 4 + 3]).toBe(alone.data[(y * W + x) * 4 + 3]);
    expect(maxAlpha(both)).toBeGreaterThan(0);
  });
});

describe('live paint equals replay', () => {
  afterEach(() => { delete (globalThis as { ImageData?: unknown }).ImageData; });
  const live = (tip: BrushTip, withPixels: boolean, taper = false) => {
    if (withPixels) (globalThis as Record<string, unknown>).ImageData = class { data: Uint8ClampedArray; constructor(public width: number, public height: number) { this.data = new Uint8ClampedArray(width * height * 4); } };
    const base = place({ width: W, height: H } as unknown as HTMLCanvasElement, { x0: 0, y0: 0, fw: W, fh: H });
    (base as unknown as { getContext: () => unknown }).getContext = () => ({ getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4) }), save() {}, restore() {}, clearRect() {}, drawImage() {}, putImageData() {}, globalAlpha: 1 });
    const stroke = beginLiveStroke(base, '#102030', 1, false, null, tip);
    const segs = path.map((s) => s.slice());
    segs.forEach((s, i) => { paintLive(base, stroke, { x: s[0], y: s[1] }, { x: s[2], y: s[3] }, s[4], dens[i]); stroke.last = { width: s[4], density: dens[i] }; });
    if (taper) {
      const before = segs.map((s) => s.slice());
      segs[2][4] *= 0.5; segs[3][4] *= 0.2;
      repaintLive(base, stroke, before.slice(2), segs, dens);
    }
    return { mask: (stroke.mask as unknown as { data: Uint8ClampedArray }).data, segs };
  };
  const replay = (tip: BrushTip, segs: number[][]) => {
    const s: RasterStroke = { id: 'r', x: 0, y: 0, color: '#102030', opacity: 1, erase: false, tip: { ...tip, densities: dens }, segments: segs as RasterStroke['segments'] };
    return { m: rasterStrokeMask(s, s.tip!) };
  };
  const compare = (tip: BrushTip, withPixels: boolean, taper: boolean) => {
    const { mask, segs } = live(tip, withPixels, taper);
    const { m } = replay(tip, segs);
    const rep = (m.canvas as unknown as { getContext: () => { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8ClampedArray } } }).getContext().getImageData(0, 0, m.canvas.width, m.canvas.height).data;
    let compared = 0;
    for (let y = 0; y < m.canvas.height; y++) for (let x = 0; x < m.canvas.width; x++) {
      const lx = x + m.x, ly = y + m.y;
      if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;
      const i = (ly * W + lx) * 4, j = (y * m.canvas.width + x) * 4;
      expect([mask[i], mask[i + 1], mask[i + 2], mask[i + 3]]).toEqual([rep[j], rep[j + 1], rep[j + 2], rep[j + 3]]);
      compared += mask[i + 3] ? 1 : 0;
    }
    expect(compared).toBeGreaterThan(100);
  };
  const tip = dabTip({}, { texture: 'graphite', textureStrength: 0.4, tooth: true, edge: 0.2 });
  it('multi-segment stroke, getImageData path', () => compare(tip, false, false));
  it('multi-segment stroke, in-memory pixels path', () => compare(tip, true, false));
  it('after the end-taper repaint', () => compare(tip, true, true));
});

describe('presets', () => {
  it('adds three dab presets and leaves the pencils as they were', () => {
    expect(DAB_PRESETS.map((p) => p.id)).toEqual(['dabs-2b', 'dabs-4h', 'dabs-acrylic']);
    expect(PENCIL_PRESETS).toHaveLength(8);
    for (const p of PENCIL_PRESETS) expect(p.values.dabs).toBeUndefined();
    const tip = tipFor(applyBrushPreset({ size: 9, color: '#000000', opacity: 1 }, DAB_PRESETS[2]), false);
    expect(tip.dabs).toMatchObject({ sizeJitter: 0.2, angleJitter: 1 });
    expect(tip.roundness).toBe(0.25);
    expect(tipFor(applyBrushPreset(applyBrushPreset({ size: 9, color: '#000000', opacity: 1 }, DAB_PRESETS[0]), PENCIL_PRESETS[1]), false).dabs).toBeUndefined();
  });
});

describe('speed', () => {
  it('a 1000 px stroke stays fast at radius 3 and radius 60', () => {
    for (const [r, budget] of [[3, 400], [60, 2000]] as const) {
      const big = img(1100, 140), segs = Array.from({ length: 50 }, (_, i) => [20 + i * 20, 70, 40 + i * 20, 70, r * 2]);
      const t = performance.now();
      stampDabStroke(big, 0, 0, segs, undefined, dabTip({ spacing: 0.25 }, { hardness: 0.5 }), [0, 0, 0]);
      const ms = performance.now() - t;
      console.log(`dab perf: radius ${r}: ${ms.toFixed(1)} ms`);
      expect(ms).toBeLessThan(budget);
    }
  });
});
