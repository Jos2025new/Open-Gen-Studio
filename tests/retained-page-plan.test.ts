import { describe, expect, it } from 'vitest';
import { RetainedPage, planFrame, stepSig, type FrameMemo, type PageOps, type StepSig } from '../src/engine/design/retainedPage';
import type { FxLayer } from '../src/engine/fx/types';
import type { Layer } from '../src/engine/types';

/*
 * Retained page (Paso 3): the planner and the page are checked against a one-dimensional model of the composite.
 * A draw step paints a span with a value; a 'below' step blurs everything under it with a reach of r pixels. Crops
 * see nothing outside them (as a canvas crop does), so a region is exact only when the crop adds the reach.
 */
type Draw = { kind: 'draw'; a: number; b: number; v: number };
type Blur = { kind: 'blur'; r: number };
type Step = Draw | Blur;
const W = 60;

function fullCompose(steps: Step[], crop: { x0: number; x1: number }): number[] {
  const n = crop.x1 - crop.x0;
  let acc = new Array<number>(n).fill(0);
  for (const st of steps) {
    if (st.kind === 'draw') {
      for (let x = st.a; x < st.b; x++) if (x >= crop.x0 && x < crop.x1) acc[x - crop.x0] = st.v;
    } else {
      acc = acc.map((_, i) => {
        let sum = 0;
        for (let j = i - st.r; j <= i + st.r; j++) if (j >= 0 && j < n) sum += acc[j];
        return sum / (2 * st.r + 1);
      });
    }
  }
  return acc;
}

type Page = { x0: number; vals: number[] };
const ops: PageOps<Page> = {
  compose: (crop) => ({ x0: crop ? crop.x0 : 0, vals: fullCompose(current!, crop ? { x0: crop.x0, x1: crop.x1 } : { x0: 0, x1: W }) }),
  blit: (dst, src, from, to) => {
    for (let x = to.x0; x < to.x1; x++) dst.vals[x - dst.x0] = src.vals[from.x0 + (x - to.x0)];
  },
};
let current: Step[] | null = null;

function sigOf(s: Step): StepSig {
  if (s.kind === 'blur') return { below: true, key: [s], box: null, margin: s.r };
  return { below: false, key: [s], box: { x0: s.a, y0: 0, x1: s.b, y1: 1 }, margin: 0 };
}
function memo(steps: Step[], background = false): FrameMemo {
  return { W, H: 1, scale: 1, background: background ? '#fff' : undefined, fontEpoch: 0, base: background ? { x0: 0, y0: 0, x1: W, y1: 1 } : null, steps: steps.map((s) => sigOf(s)) };
}

describe('retained page: planner', () => {
  const a: Step = { kind: 'draw', a: 2, b: 8, v: 1 }, b: Step = { kind: 'draw', a: 20, b: 30, v: 2 };
  it('reuses the page when nothing changed', () => {
    const m = memo([a, b]);
    expect(planFrame(m, m)).toEqual({ kind: 'same' });
    expect(planFrame(null, m).kind).toBe('full');
  });
  it('recomposes everything when the page or the step list changes', () => {
    expect(planFrame(memo([a]), { ...memo([a]), scale: 2 })).toEqual({ kind: 'full', why: 'page' });
    expect(planFrame(memo([a]), memo([a, b]))).toEqual({ kind: 'full', why: 'steps' });
  });
  it('dirties the old and the new area of a moved layer, and nothing else', () => {
    const moved: Step = { kind: 'draw', a: 12, b: 16, v: 1 };
    const plan = planFrame(memo([a, b]), memo([moved, b]));
    expect(plan).toEqual({ kind: 'region', rect: { x0: 2, y0: 0, x1: 16, y1: 1 }, reach: 0 });
  });
  it('treats a box that changes without a key change as a change', () => {
    const prev = memo([a, b]);
    const cur = { ...memo([a, b]), steps: [prev.steps[0], { ...prev.steps[1], box: { x0: 20, y0: 0, x1: 34, y1: 1 } }] };
    expect(planFrame(prev, cur)).toEqual({ kind: 'region', rect: { x0: 20, y0: 0, x1: 34, y1: 1 }, reach: 0 });
  });
  it('uses a raster buffer dirty area when only its pixel version changed', () => {
    const prev = memo([a]), old = prev.steps[0];
    const dirty = { x0: 4, y0: 0, x1: 7, y1: 1 };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 2], source: ['raster-id'], render: ['geometry', 'fx'], versions: [2], dirty }] };
    const base: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 1], source: ['raster-id'], render: ['geometry', 'fx'], versions: [1] }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: dirty, reach: 0 });
  });
  it('keeps a paint-base version change safe when it has no visible dirty rectangle', () => {
    const prev = memo([a]), old = prev.steps[0], box = { x0: 2, y0: 0, x1: 8, y1: 1 };
    const base: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 1, 1], source: ['layer', 'base'], render: ['geometry'], versions: [1, 1], box }] };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 1, 2], source: ['layer', 'base'], render: ['geometry'], versions: [1, 2], box }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: box, reach: 0 });
  });
  it('uses dirty pixels across immutable layer replacements when geometry and FX properties match', () => {
    const prev = memo([a]), old = prev.steps[0], dirty = { x0: 4, y0: 0, x1: 7, y1: 1 };
    const base: FrameMemo = { ...prev, steps: [{ ...old, key: ['old-layer', 1], source: ['raster-id'], render: ['geometry', 'fx'], versions: [1] }] };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['new-layer', 2], source: ['raster-id'], render: ['geometry', 'fx'], versions: [2], dirty }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: dirty, reach: 0 });
  });
  it('uses old and new geometry when the layer itself changed, even if pixels are dirty', () => {
    const prev = memo([a]), old = prev.steps[0];
    const nextBox = { x0: 12, y0: 0, x1: 16, y1: 1 }, dirty = { x0: 14, y0: 0, x1: 15, y1: 1 };
    const base: FrameMemo = { ...prev, steps: [{ ...old, source: ['old-layer'], render: ['old-geometry'], versions: [1] }] };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['new-layer', 1], source: ['new-layer'], render: ['new-geometry'], versions: [1], box: nextBox, dirty }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: { x0: 2, y0: 0, x1: 16, y1: 1 }, reach: 0 });
  });
  it('keeps total painted corners when geometry and a localized write change together', () => {
    const prev = memo([a]), old = prev.steps[0];
    const base: FrameMemo = { ...prev, H: 60, steps: [{ ...old, source: ['raster-id'], render: ['old-placement'], versions: [1], box: { x0: 2, y0: 2, x1: 6, y1: 6 } }] };
    const cur: FrameMemo = { ...base, steps: [{ ...old, source: ['raster-id'], render: ['new-placement'], versions: [2], box: { x0: 20, y0: 20, x1: 24, y1: 24 }, dirty: { x0: 30, y0: 30, x1: 33, y1: 33 } }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: { x0: 2, y0: 2, x1: 33, y1: 33 }, reach: 0 });
  });
  it('does not treat an FX edit as a pixel-only change', () => {
    const prev = memo([a]), old = prev.steps[0];
    const base: FrameMemo = { ...prev, steps: [{ ...old, key: ['old-fx'], source: ['raster-id'], render: ['geometry', 'blur:2'], versions: [1] }] };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['new-fx'], source: ['raster-id'], render: ['geometry', 'blur:8'], versions: [2], dirty: { x0: 4, y0: 0, x1: 7, y1: 1 } }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: { x0: 2, y0: 0, x1: 8, y1: 1 }, reach: 0 });
  });
  it('keys layer FX values for vector layers too', () => {
    const layer = { id: 'vector', name: 'Vector', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [] } as Layer;
    const fx = (radius: number): FxLayer => ({
      id: 'fx', name: 'Blur', type: 'fx', visible: true, locked: false, opacity: 1, blend: 'normal',
      group: 'effect', scope: 'layer', ops: [{ id: 'blur', kind: 'blur', enabled: true, params: { radius } }],
    });
    const sig = (radius: number) => stepSig({ t: 'clip', layer, fx: [fx(radius)] }, 1, () => ({ x: 2, y: 2, w: 5, h: 5 }), () => [], () => null);
    expect(sig(2).key).not.toEqual(sig(8).key);
  });
  it('propagates a change through a later below step by its reach', () => {
    const blur: Step = { kind: 'blur', r: 3 };
    const plan = planFrame(memo([a, blur]), memo([{ kind: 'draw', a: 2, b: 9, v: 1 }, blur]));
    expect(plan).toEqual({ kind: 'region', rect: { x0: 0, y0: 0, x1: 12, y1: 1 }, reach: 3 });
  });
  it('recomposes a below step that changed over the page when there is a background', () => {
    const blur: Step = { kind: 'blur', r: 1 }, blur2: Step = { kind: 'blur', r: 2 };
    expect(planFrame(memo([blur], true), memo([blur2], true))).toEqual({ kind: 'full', why: 'large region' });
  });
  it('dirties the wider of the old and new reach of a changed below step', () => {
    const wide: Step = { kind: 'blur', r: 3 }, narrow: Step = { kind: 'blur', r: 0 };
    const plan = planFrame(memo([a, wide]), memo([a, narrow]));
    expect(plan).toEqual({ kind: 'region', rect: { x0: 0, y0: 0, x1: 11, y1: 1 }, reach: 0 });
  });
  it('keeps an unrelated layer-scope unknown FX local to its own output box', () => {
    const glowish: StepSig = { below: false, key: ['glow', 1], box: { x0: 40, y0: 10, x1: 50, y1: 20 }, margin: Infinity };
    const changedDraw: StepSig = { ...sigOf({ kind: 'draw', a: 2, b: 8, v: 2 }), key: ['draw', 2] };
    const oldDraw: StepSig = { ...changedDraw, key: ['draw', 1] };
    const prev: FrameMemo = { ...memo([]), steps: [oldDraw, glowish] };
    const cur: FrameMemo = { ...prev, steps: [changedDraw, glowish] };
    expect(planFrame(prev, cur)).toEqual({ kind: 'region', rect: { x0: 2, y0: 0, x1: 8, y1: 1 }, reach: 0 });
  });
  it('bounds an edit to the clip box when that layer has unknown FX reach', () => {
    const oldFx: StepSig = { below: false, key: ['clip', 1], box: { x0: 40, y0: 10, x1: 50, y1: 20 }, margin: Infinity };
    const newFx: StepSig = { ...oldFx, key: ['clip', 2] };
    const plan = planFrame({ ...memo([]), H: 30, steps: [oldFx] }, { ...memo([]), H: 30, steps: [newFx] });
    expect(plan).toEqual({ kind: 'region', rect: oldFx.box, reach: 0 });
  });
  it('recomposes everything when a step has an unknown reach', () => {
    const glowish: StepSig = { below: true, key: ['glow', 1], box: null, margin: Infinity };
    const m1: FrameMemo = { ...memo([a]), steps: [glowish, sigOf(a)] };
    const m2: FrameMemo = { ...memo([a]), steps: [{ ...glowish, key: ['glow', 2] }, sigOf(a)] };
    expect(planFrame(m1, m2)).toEqual({ kind: 'full', why: 'unknown FX' });
  });
});

describe('retained page: frames match a whole composition', () => {
  it('exposes the last plan and legitimate full-frame reason', () => {
    const retained = new RetainedPage<Page>();
    const draw: Step = { kind: 'draw', a: 0, b: 20, v: 1 };
    current = [draw];
    retained.frame(memo([draw]), ops);
    expect(retained.lastPlan).toEqual({ kind: 'full', why: 'first frame' });
    retained.frame(memo([draw]), ops);
    expect(retained.lastPlan).toEqual({ kind: 'same' });
    expect(retained.stats.fullWhy).toEqual({ 'first frame': 1 });
  });

  it('stays identical to a full composition over 200 random changes', () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let steps: Step[] = [
      { kind: 'draw', a: 0, b: 20, v: 1 }, { kind: 'draw', a: 30, b: 45, v: 2 }, { kind: 'blur', r: 2 }, { kind: 'draw', a: 10, b: 36, v: 3 }, { kind: 'blur', r: 1 },
    ];
    const retained = new RetainedPage<Page>();
    let mismatches = 0;
    for (let k = 0; k < 200; k++) {
      const next = steps.slice();
      const i = rnd(next.length);
      const s = next[i];
      if (s.kind === 'draw') {
        const a = rnd(W - 2), len = 1 + rnd(18);
        next[i] = { kind: 'draw', a, b: Math.min(W, a + len), v: 1 + rnd(9) };
      } else {
        next[i] = { kind: 'blur', r: rnd(4) };
      }
      current = next;
      const page = retained.frame(memo(next), ops);
      const expected = fullCompose(next, { x0: 0, x1: W });
      if (JSON.stringify(page.vals) !== JSON.stringify(expected)) mismatches++;
      steps = next;
    }
    expect(mismatches).toBe(0);
    expect(retained.stats.region).toBeGreaterThan(20);
  });
});
