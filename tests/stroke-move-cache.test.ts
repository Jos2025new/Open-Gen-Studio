import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ n: 0 }));
vi.mock('perfect-freehand', async (orig) => {
  const real = await orig<typeof import('perfect-freehand')>();
  return { ...real, getStroke: (...a: Parameters<typeof real.getStroke>) => { calls.n++; return real.getStroke(...a); } };
});
import { DEFAULT_STROKE_STYLE, newStroke, strokeOutline } from '../src/engine/design/strokes';
import { translateObjects } from '../src/engine/design/objectOps';
import type { Layer } from '../src/engine/types';

const pts = Array.from({ length: 120 }, (_, i) => [i * 3, 50 + 20 * Math.sin(i / 8), 0.5] as [number, number, number]);

describe('moving strokes reuses their outline', () => {
  it('a moved stroke keeps its points and its outline is the old one shifted', () => {
    const s = { ...newStroke(pts, DEFAULT_STROKE_STYLE, false), matrix: [0.5, 0, 0, 0.5, 10, 0] as [number, number, number, number, number, number] };
    const layer = { id: 'v', type: 'vector', name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [], strokes: [s] } as unknown as Layer;
    const before = strokeOutline(s);
    const moved = translateObjects(layer, [s.id], 7, -4) as Extract<Layer, { type: 'vector' }>;
    const m = moved.strokes![0];
    expect(m.points).toBe(s.points);
    const after = strokeOutline(m);
    after.forEach(([x, y], i) => { expect(x).toBeCloseTo(before[i][0] + 7, 6); expect(y).toBeCloseTo(before[i][1] - 4, 6); });
  });
  it('dragging 60 strokes for 60 frames computes each outline once', () => {
    const strokes = Array.from({ length: 60 }, () => newStroke(pts.map(([x, y, p]) => [x, y, p] as [number, number, number]), DEFAULT_STROKE_STYLE, false));
    const layer = { id: 'v', type: 'vector', name: 'v', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [], strokes } as unknown as Layer;
    const ids = strokes.map((s) => s.id);
    strokes.forEach(strokeOutline);
    calls.n = 0;
    for (let f = 1; f <= 60; f++) (translateObjects(layer, ids, f, f) as Extract<Layer, { type: 'vector' }>).strokes!.forEach(strokeOutline);
    expect(calls.n).toBe(0);
  });
});
