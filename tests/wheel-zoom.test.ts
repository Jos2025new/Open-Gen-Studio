import { describe, expect, it } from 'vitest';
import { stageWheel, wheelZoomer, wheelZoomStep, ZOOM_STOPS } from '../src/components/designer/wheelZoom';

const RATE = 0.0022; // the wheel's zoom per unit of deltaY, as before the stops existed

describe('wheel zoom: jitter and speed', () => {
  it('single-unit wheel jitter (|deltaY| ≤ 1) does not zoom and does not change the gesture state', () => {
    for (const deltaY of [1, -1, 0]) expect(wheelZoomStep(0.4, deltaY, 10, null)).toEqual({ factor: 1, state: null });
    const prev = { at: 5 };
    expect(wheelZoomStep(0.4, -1, 50, prev).state).toBe(prev);
  });

  it('a faster spin zooms further per notch, and the boost is bounded', () => {
    const base = wheelZoomStep(0.4, -10, 0, null).factor; // no earlier event: no boost
    expect(base).toBeCloseTo(Math.exp(10 * RATE), 12);
    const slow = wheelZoomStep(0.4, -10, 100, { at: 0 }).factor; // speed 0.1 per ms
    const fast = wheelZoomStep(0.4, -10, 10, { at: 0 }).factor; // speed 1 per ms
    expect(slow).toBeGreaterThan(base);
    expect(fast).toBeGreaterThan(slow);
    const huge = wheelZoomStep(0.4, -10, 1, { at: 0 }).factor; // speed 10 per ms: capped at three times the base step
    expect(huge).toBeCloseTo(Math.exp(10 * RATE * 3), 9);
    expect(wheelZoomStep(0.4, -10, 0, { at: 0 }).factor).toBeCloseTo(huge, 12);
  });

  it('zooming out with a positive deltaY is the mirror of zooming in', () => {
    expect(wheelZoomStep(0.4, 10, 0, null).factor).toBeCloseTo(1 / wheelZoomStep(0.4, -10, 0, null).factor, 12);
  });
});

describe('wheel zoom: stops', () => {
  it('a step that passes a stop lands exactly on it', () => {
    // 0.9 × e^(0.22) ≈ 1.12 passes 1.0: the zoom lands on 1.
    const r = wheelZoomStep(0.9, -100, 0, null);
    expect(0.9 * r.factor).toBeCloseTo(1, 12);
    expect(r.state?.stop).toBe(1);
  });

  it('a step that comes within 0.05 of a stop lands on it', () => {
    // 0.9 × e^(0.0748) ≈ 0.970 is 0.03 short of 1.0.
    const r = wheelZoomStep(0.9, -34, 0, null);
    expect(0.9 * r.factor).toBeCloseTo(1, 12);
  });

  it('a step that stays farther than 0.05 from every stop is not moved', () => {
    expect(wheelZoomStep(0.9, -10, 0, null).factor).toBeCloseTo(Math.exp(10 * RATE), 12); // 0.92 is 0.08 short of 1
  });

  it('downward zoom lands on a stop it passes', () => {
    const r = wheelZoomStep(0.55, 50, 0, null); // 0.55 × e^(-0.11) ≈ 0.49 passes 0.5
    expect(0.55 * r.factor).toBeCloseTo(0.5, 12);
    expect(r.state?.stop).toBe(0.5);
  });

  it('a zoom already on a stop moves on, and the stop does not capture it again', () => {
    expect(wheelZoomStep(1, -10, 0, null).factor).toBeCloseTo(Math.exp(10 * RATE), 12);
    expect(ZOOM_STOPS).toEqual([0.25, 0.5, 1, 1.5, 2]);
  });
});

describe('wheel zoom: dwell and reset', () => {
  it('after landing, the next event within 150 ms holds the stop; the event after moves on', () => {
    const landed = wheelZoomStep(0.9, -100, 0, null);
    const held = wheelZoomStep(1, -100, 50, landed.state);
    expect(held.factor).toBe(1);
    expect(held.state?.stop).toBeUndefined();
    const next = wheelZoomStep(1, -10, 100, held.state);
    expect(next.factor).toBeGreaterThan(1);
  });

  it('the hold ends when no event comes within 150 ms of the landing event', () => {
    const landed = wheelZoomStep(0.9, -100, 0, null);
    const late = wheelZoomStep(1, -10, 200, landed.state);
    expect(late.factor).toBeCloseTo(Math.exp(10 * RATE * 1.025), 9); // boost from a 200 ms gap, no hold
  });

  it('after 1 s idle the gesture starts over: no hold and no speed boost', () => {
    const landed = wheelZoomStep(0.9, -100, 0, null);
    const after = wheelZoomStep(1, -10, 1200, landed.state);
    expect(after.factor).toBeCloseTo(Math.exp(10 * RATE), 12);
    expect(wheelZoomStep(0.4, -10, 1100, { at: 0 }).factor).toBeCloseTo(Math.exp(10 * RATE), 12);
  });
});

describe('wheel zoom: the stateful wrapper used by the stage', () => {
  it('keeps the gesture state and returns the zoomed view about the cursor', () => {
    const zoomBy = wheelZoomer();
    const landed = zoomBy({ zoom: 0.9, x: 0, y: 0 }, 100, 50, -100, 0);
    expect(landed.zoom).toBeCloseTo(1, 12);
    expect(zoomBy(landed, 100, 50, -10, 40).zoom).toBe(1); // the held tick, from the state the first call left behind
  });
});

describe('stage wheel: zooms from the latest view, even before React re-renders', () => {
  const fake = () => {
    let view = { zoom: 0.9, x: 0, y: 0 };
    const set = (action: any) => { view = typeof action === 'function' ? action(view) : action; };
    return { set, get: () => view };
  };
  const rect = { left: 0, top: 0 };
  it('two ctrl-wheel events in a row compound from the first result, not the rendered zoom', () => {
    const f = fake();
    const w = stageWheel(f.set);
    w.sync(f.get());
    w.wheel({ ctrlKey: true, metaKey: false, clientX: 0, clientY: 0, deltaX: 0, deltaY: -100, timeStamp: 0 }, rect);
    expect(f.get().zoom).toBeCloseTo(1, 12); // landed on 100 %
    w.wheel({ ctrlKey: true, metaKey: false, clientX: 0, clientY: 0, deltaX: 0, deltaY: -10, timeStamp: 40 }, rect);
    expect(f.get().zoom).toBe(1); // held: from 1, not from the stale 0.9
  });
  it('a plain wheel pans without zooming', () => {
    const f = fake();
    const w = stageWheel(f.set);
    w.sync(f.get());
    w.wheel({ ctrlKey: false, metaKey: false, clientX: 0, clientY: 0, deltaX: 3, deltaY: 5, timeStamp: 0 }, rect);
    expect(f.get()).toEqual({ zoom: 0.9, x: -3, y: -5 });
  });
});
