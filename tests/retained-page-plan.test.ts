import { describe, expect, it } from 'vitest';
import { RetainedPage, planFrame, type FrameMemo, type PageOps, type StepSig } from '../src/engine/design/retainedPage';

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
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 2], source: ['layer'], versions: [2], dirty }] };
    const base: FrameMemo = { ...prev, steps: [{ ...old, key: ['layer', 1], source: ['layer'], versions: [1] }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: dirty, reach: 0 });
  });
  it('uses old and new geometry when the layer itself changed, even if pixels are dirty', () => {
    const prev = memo([a]), old = prev.steps[0];
    const nextBox = { x0: 12, y0: 0, x1: 16, y1: 1 }, dirty = { x0: 14, y0: 0, x1: 15, y1: 1 };
    const base: FrameMemo = { ...prev, steps: [{ ...old, source: ['old-layer'], versions: [1] }] };
    const cur: FrameMemo = { ...prev, steps: [{ ...old, key: ['new-layer', 1], source: ['new-layer'], versions: [1], box: nextBox, dirty }] };
    expect(planFrame(base, cur)).toEqual({ kind: 'region', rect: { x0: 2, y0: 0, x1: 16, y1: 1 }, reach: 0 });
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
  it('recomposes everything when a step has an unknown reach', () => {
    const glowish: StepSig = { below: true, key: ['glow', 1], box: null, margin: Infinity };
    const m1: FrameMemo = { ...memo([a]), steps: [glowish, sigOf(a)] };
    const m2: FrameMemo = { ...memo([a]), steps: [{ ...glowish, key: ['glow', 2] }, sigOf(a)] };
    expect(planFrame(m1, m2)).toEqual({ kind: 'full', why: 'unknown FX' });
  });
});

describe('retained page: frames match a whole composition', () => {
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
