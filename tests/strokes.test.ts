import { describe, expect, it } from 'vitest';
import { bendStroke, DEFAULT_STROKE_STYLE, nearestPoint, newStroke, restyleStrokes, scaleStroke, strokeBox, strokePath, translateStroke } from '../src/engine/design/strokes';
import { scaleLayer, translateLayer, cloneLayer } from '../src/engine/design/doc';
import { docToSvg } from '../src/engine/design/export';
import type { DesignDoc, Stroke, VectorLayer } from '../src/engine/types';

const line = (): Stroke =>
  newStroke(
    Array.from({ length: 21 }, (_, i) => [i * 10, 100, 0.3 + (i / 20) * 0.6] as [number, number, number]),
    { ...DEFAULT_STROKE_STYLE, size: 10, color: '#123456' },
    false,
  );

describe('editable pressure strokes', () => {
  it('rebuilds the same outline from the same gesture and style', () => {
    const a = line();
    const b = { ...a, points: a.points.map((p) => [...p] as [number, number, number]) };
    expect(strokePath(a)).toBe(strokePath(b));
    expect(strokePath(a).startsWith('M')).toBe(true);
    // Pressure matters: the heavy end is wider than the light start.
    const box = strokeBox(a)!;
    expect(box.x).toBeLessThan(0);
    expect(box.w).toBeGreaterThan(200);
  });

  it('a style change is a new stroke with a new outline; the gesture is kept', () => {
    const a = line();
    const [thick] = restyleStrokes([a], { size: 30 });
    expect(thick.points).toBe(a.points);
    expect(strokeBox(thick)!.h).toBeGreaterThan(strokeBox(a)!.h);
    expect(strokePath(thick)).not.toBe(strokePath(a));
  });

  it('bending a point moves its neighbours with a falloff and keeps pressure', () => {
    const a = line();
    const bent = bendStroke(a, 10, 0, 40, 50);
    expect(bent.points[10]).toEqual([100, 140, a.points[10][2]]);
    expect(bent.points[12][1]).toBeGreaterThan(100);
    expect(bent.points[12][1]).toBeLessThan(140);
    expect(bent.points[0]).toEqual(a.points[0]);
    expect(bent.points[20]).toEqual(a.points[20]);
    expect(nearestPoint([a], 101, 99, 5)).toEqual({ stroke: 0, point: 10 });
    expect(nearestPoint([a], 101, 150, 5)).toBeNull();
  });

  it('moves and scales with its layer (width follows the scale)', () => {
    const a = line();
    expect(translateStroke(a, 5, -5).points[0]).toEqual([5, 95, a.points[0][2]]);
    const s = scaleStroke(a, 2, 2, 0, 0);
    expect(s.points[1]).toEqual([20, 200, a.points[1][2]]);
    expect(s.size).toBe(20);
    const layer: VectorLayer = { id: 'l', name: 'Lineart', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [], strokes: [a] };
    expect((translateLayer(layer, 1, 2) as VectorLayer).strokes![0].points[0]).toEqual([1, 102, a.points[0][2]]);
    expect((scaleLayer(layer, 0.5, 0.5, 0, 0) as VectorLayer).strokes![0].size).toBe(5);
    expect((cloneLayer(layer) as VectorLayer).strokes![0].id).not.toBe(a.id);
  });

  it('exports each stroke as a filled path in its layer', async () => {
    const a = line();
    const doc: DesignDoc = {
      id: 'd', name: 'x', width: 300, height: 200, background: null, activeLayerId: null, createdAt: 0, updatedAt: 0,
      layers: [{ id: 'l', name: 'Lineart 1', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [], strokes: [a, { ...a, id: 'b', opacity: 0.5 }] }],
    };
    const svg = await docToSvg(doc, { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 });
    expect(svg).toContain(`<path d="${strokePath(a)}" fill="#123456"/>`);
    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).toContain('inkscape:label="Lineart 1"');
  });
});
