import { describe, expect, it } from 'vitest';
import { bendStroke, DEFAULT_STROKE_STYLE, nearestPoint, newStroke, restyleStrokes, scaleStroke, strokeBox, strokePath, translateStroke } from '../src/engine/design/strokes';
import { scaleLayer, translateLayer, cloneLayer } from '../src/engine/design/doc';
import { docToSvg } from '../src/engine/design/export';
import { MAX_STAMPS, stampPlacements, texturedStrokeSvg } from '../src/engine/design/brushTextures';
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

describe('textured strokes (stamps along the path)', () => {
  const textured = (seed = 7, spacing = 0.5): Stroke => ({ ...line(), texture: { stamp: 'pencil', spacing, jitter: 0.4, seed } });

  it('places stamps along the path, the same way for the same seed', () => {
    const s = textured();
    const a = stampPlacements(s);
    expect(a.length).toBeGreaterThan(20);
    expect(stampPlacements({ ...s })).toEqual(a);
    expect(stampPlacements({ ...s, texture: { ...s.texture!, seed: 8 } })).not.toEqual(a);
    // Spacing is a fraction of the size: half the spacing, about twice the stamps.
    expect(stampPlacements(textured(7, 0.25)).length).toBeGreaterThan(a.length * 1.8);
  });

  it('follows the curve: bending the stroke turns the stamps', () => {
    const s = textured(1, 0.5);
    const straight = stampPlacements({ ...s, texture: { ...s.texture!, jitter: 0 } });
    expect(straight.every((p) => Math.abs(p.angle) < 0.01)).toBe(true);
    const bent = stampPlacements(bendStroke({ ...s, texture: { ...s.texture!, jitter: 0 } }, 10, 0, 60, 80));
    expect(bent.some((p) => Math.abs(p.angle) > 0.3)).toBe(true);
  });

  it('caps the stamps of very long strokes', () => {
    const long = newStroke(Array.from({ length: 400 }, (_, i) => [i * 50, 0, 0.5] as [number, number, number]), { ...DEFAULT_STROKE_STYLE, size: 4, texture: { stamp: 'chalk', spacing: 0.05, jitter: 0, seed: 1 } }, true);
    expect(stampPlacements(long).length).toBeLessThanOrEqual(MAX_STAMPS + 1);
  });

  it('exports one embedded stamp per stroke reused by <use>', () => {
    const s = textured();
    const svg = texturedStrokeSvg(s, 'data:image/png;base64,QQ==');
    expect(svg.match(/<image /g)).toHaveLength(1);
    expect(svg.match(/<use /g)!.length).toBe(stampPlacements(s).length);
    expect(svg).toContain(`<use href="#stamp-${s.id}" transform="translate(`);
    expect(svg).not.toContain('blob:');
  });
});
