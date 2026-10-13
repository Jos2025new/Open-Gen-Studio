import { describe, expect, it } from 'vitest';
import type { ShapeSpec, VectorLayer } from '../src/engine/types';
import { drawLayer } from '../src/engine/design/render';
import { shapeSvg } from '../src/engine/design/export';
import { paintOpacity, paintOpacityPatch } from '../src/engine/design/shapeLook';
import { alphaFromOpacity, opacityFromAlpha } from '../src/lib/color';

/* fill-opacity and stroke-opacity per shape: absent = 1 (no migration), canvas = SVG = picker's A. */
const shape = (o: Partial<ShapeSpec & { id: string }> = {}): ShapeSpec & { id: string } => ({ id: 's', type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#f00', stroke: '#00f', strokeWidth: 2, radius: 0, ...o });
const layer = (shapes: Array<ShapeSpec & { id: string }>): VectorLayer => ({ id: 'v', name: 'v', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes });

function paintAlphas(shapes: Array<ShapeSpec & { id: string }>): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k in t) return t[k];
      if (k === 'getTransform') return () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
      if (k === 'fill' || k === 'stroke') return () => out.push([k, t.globalAlpha as number]);
      return () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  drawLayer(ctx, layer(shapes));
  return out;
}

describe('shape fill and stroke opacity', () => {
  it('canvas: fill and stroke are painted with their own alpha, and alpha is restored', () => {
    expect(paintAlphas([shape({ fillOpacity: 0.25, strokeOpacity: 0.5 })])).toEqual([['fill', 0.25], ['stroke', 0.5]]);
    expect(paintAlphas([shape({ fillOpacity: 0.25 }), shape({ id: 't' })])).toEqual([['fill', 0.25], ['stroke', 1], ['fill', 1], ['stroke', 1]]);
  });
  it('an old shape without the fields paints at 1 and exports without the attributes', () => {
    expect(paintAlphas([shape()])).toEqual([['fill', 1], ['stroke', 1]]);
    const svg = shapeSvg(shape());
    expect(svg).not.toContain('fill-opacity');
    expect(svg).not.toContain('stroke-opacity');
  });
  it('SVG export writes fill-opacity and stroke-opacity (rect, ellipse, path, line)', () => {
    const o = { fillOpacity: 0.4, strokeOpacity: 0.7 };
    for (const s of [shape(o), shape({ ...o, type: 'ellipse' }), shape({ ...o, type: 'path', d: 'M 0 0 L 10 10 L 0 10 Z', box0: { x: 0, y: 0, w: 10, h: 10 } })]) {
      const svg = shapeSvg(s);
      expect(svg).toContain('fill-opacity="0.4"');
      expect(svg).toContain('stroke-opacity="0.7"');
    }
    const line = shapeSvg(shape({ ...o, type: 'line' }));
    expect(line).toContain('stroke-opacity="0.7"');
    expect(line).not.toContain('fill-opacity');
  });
  it('no stroke-opacity without a visible stroke, no fill-opacity without a fill', () => {
    const svg = shapeSvg(shape({ fillOpacity: 0.5, strokeOpacity: 0.5, stroke: null, strokeWidth: 0 }));
    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).not.toContain('stroke-opacity');
    expect(shapeSvg(shape({ fill: null, fillOpacity: 0.5 }))).not.toContain('fill-opacity');
  });
  it('the picker A is the paint opacity, both ways, one value per paint', () => {
    let s = shape();
    expect(alphaFromOpacity(paintOpacity(s, 'fill'))).toBe(100);
    s = { ...s, ...paintOpacityPatch('fill', opacityFromAlpha(30)) };
    expect(s.fillOpacity).toBe(0.3);
    expect(s.strokeOpacity).toBeUndefined();
    expect(alphaFromOpacity(paintOpacity(s, 'fill'))).toBe(30);
    s = { ...s, ...paintOpacityPatch('stroke', opacityFromAlpha(80)) };
    expect(alphaFromOpacity(paintOpacity(s, 'stroke'))).toBe(80);
    expect(alphaFromOpacity(paintOpacity(s, 'fill'))).toBe(30);
    // An SVG-side value shows as A.
    expect(alphaFromOpacity(paintOpacity(shape({ strokeOpacity: 0.12 }), 'stroke'))).toBe(12);
    expect(paintOpacityPatch('fill', 7).fillOpacity).toBe(1);
  });
});
