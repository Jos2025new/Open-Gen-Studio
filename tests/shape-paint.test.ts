// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { gradientCss, paintKindPatch, PaintSwatch, ShapeParams, stopPatch } from '../src/components/designer/ShapePaint';
import { primShape } from '../src/engine/design/primitives';
import type { VectorShape } from '../src/engine/types';

const rect = (over: Partial<VectorShape> = {}): VectorShape => ({ id: 'r1', type: 'rect', x: 0, y: 0, w: 100, h: 50, fill: '#ff0000', stroke: '#000000', strokeWidth: 2, radius: 0, ...over });

describe('paint popover rules: the type switch', () => {
  it('solid → linear turns the fill into a gradient that starts from the fill colour and clears the solid fill', () => {
    const s = rect();
    const p = paintKindPatch(s, 'fill', 'linear');
    expect(p.fill).toBeNull();
    expect(p.fillGradient?.kind).toBe('linear');
    expect(p.fillGradient?.stops[0].color).toBe('#ff0000');
  });

  it('linear → radial keeps the stops; radial → solid gives back the first stop\'s colour', () => {
    const s = rect({ fill: null, fillGradient: { kind: 'linear', x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ offset: 0, color: '#123456', alpha: 1 }, { offset: 1, color: '#abcdef', alpha: 0.5 }] } });
    const radial = paintKindPatch(s, 'fill', 'radial');
    expect(radial.fillGradient?.kind).toBe('radial');
    expect(radial.fillGradient?.stops).toEqual(s.fillGradient!.stops);
    const solid = paintKindPatch({ ...s, ...radial } as VectorShape, 'fill', 'solid');
    expect(solid.fill).toBe('#123456');
    expect(solid.fillGradient).toBeUndefined();
  });

  it('the stroke switches on its own side and leaves the fill alone', () => {
    const p = paintKindPatch(rect(), 'stroke', 'radial');
    expect(p.stroke).toBeNull();
    expect(p.strokeGradient?.kind).toBe('radial');
    expect(p).not.toHaveProperty('fill');
  });
});

describe('paint popover rules: the stops', () => {
  it('changing the end stop changes only that stop', () => {
    const s = rect({ fill: null, fillGradient: { kind: 'linear', x1: 0, y1: 0, x2: 100, y2: 0, stops: [{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#ffffff', alpha: 1 }] } });
    const next = stopPatch(s, 'fill', 'last', { color: '#00ff00', alpha: 0.25 })!.fillGradient!;
    expect(next.stops).toEqual([{ offset: 0, color: '#000000', alpha: 1 }, { offset: 1, color: '#00ff00', alpha: 0.25 }]);
    expect(stopPatch(rect(), 'fill', 'first', { alpha: 0.5 })).toBeNull();
  });

  it('a gradient swatch shows its stops with alpha, linear or radial', () => {
    const g = { kind: 'linear' as const, x1: 0, y1: 0, x2: 1, y2: 0, stops: [{ offset: 0, color: '#ff0000', alpha: 0.5 }, { offset: 1, color: '#0000ff', alpha: 1 }] };
    expect(gradientCss(g)).toBe('linear-gradient(90deg, rgba(255,0,0,0.5) 0%, rgba(0,0,255,1) 100%)');
    expect(gradientCss({ ...g, kind: 'radial' })).toMatch(/^radial-gradient\(circle,/);
  });
});

describe('paint bar: what it renders', () => {
  const props = { sessionId: 's', docId: 'd', layerId: 'l' };
  const markup = (side: 'fill' | 'stroke', shape: VectorShape) => renderToStaticMarkup(createElement(PaintSwatch, { ...props, shape, side }));

  it('the bar has a Fill and a Stroke control, each a single label', () => {
    const fill = markup('fill', rect());
    const stroke = markup('stroke', rect());
    expect(fill).toContain('aria-label="Fill');
    expect(stroke).toContain('aria-label="Stroke');
    // Labels are one short word; nothing wraps onto a second line or repeats «Fill:».
    expect(fill).not.toContain('Fill:');
    expect(fill).not.toMatch(/<br/i);
  });

  it('a gradient fill shows its gradient on the swatch', () => {
    const shape = rect({ fill: null, fillGradient: { kind: 'radial', x1: 50, y1: 25, x2: 100, y2: 25, stops: [{ offset: 0, color: '#ffffff', alpha: 1 }, { offset: 1, color: '#000000', alpha: 1 }] } });
    expect(markup('fill', shape)).toContain('radial-gradient(circle');
  });

  it('a primitive has a Shape button that opens its parameters', () => {
    const star = { ...primShape(0, 0, 100, 100, { kind: 'star', sides: 5, inner: 0.5 }), id: 'p', fill: null, stroke: null, strokeWidth: 0, radius: 0 } as VectorShape;
    const html = renderToStaticMarkup(createElement(ShapeParams, { ...props, shape: star }));
    expect(html).toContain('>Shape</button>');
    expect(renderToStaticMarkup(createElement(ShapeParams, { ...props, shape: rect() }))).toBe('');
  });
});
