import { describe, expect, it } from 'vitest';
import type { VectorShape } from '../src/engine/types';
import { isClosedShape, strokeAlignOf, strokeReach } from '../src/engine/design/shapeLook';
import { shapeSvg } from '../src/engine/design/export';

const rect = (o: Partial<VectorShape> = {}): VectorShape => ({ id: 'r', type: 'rect', x: 0, y: 0, w: 40, h: 20, fill: '#f00', stroke: '#000', strokeWidth: 4, radius: 0, ...o });

describe('stroke alignment', () => {
  it('old shapes (no field) stay centered and render exactly as before', () => {
    expect(strokeAlignOf(rect())).toBe('center');
    const svg = shapeSvg(rect());
    expect(svg).not.toContain('clip-path');
    expect(svg).not.toContain('mask');
    expect(svg.startsWith('<rect ')).toBe(true);
  });

  it('only closed shapes leave the center; open paths and lines are forced back', () => {
    expect(isClosedShape(rect())).toBe(true);
    expect(isClosedShape({ type: 'path', d: 'M0 0 L10 0 L10 10 Z' })).toBe(true);
    expect(isClosedShape({ type: 'path', d: 'M0 0 L10 0 L10 10' })).toBe(false);
    expect(strokeAlignOf({ type: 'line', strokeAlign: 'outside' })).toBe('center');
    expect(strokeAlignOf({ type: 'path', d: 'M0 0 L9 9', strokeAlign: 'inside' })).toBe('center');
    expect(strokeAlignOf(rect({ strokeAlign: 'inside' }))).toBe('inside');
  });

  it('inside doubles the width under a clip to the shape; outside masks the shape out', () => {
    const inside = shapeSvg(rect({ strokeAlign: 'inside' }));
    expect(inside).toContain('<clipPath id="sa-r">');
    expect(inside).toContain('stroke-width="8"');
    expect(inside).toContain('<g clip-path="url(#sa-r)">');
    const outside = shapeSvg(rect({ strokeAlign: 'outside', dash: [2, 1] }));
    expect(outside).toContain('<mask id="sa-r"');
    expect(outside).toContain('fill="#000"');
    expect(outside).toContain('stroke-dasharray="8 4"');
    expect(outside.indexOf('fill="#f00"'), 'fill first, stroke over it').toBeLessThan(outside.indexOf('<g mask='));
    expect(shapeSvg(rect({ strokeAlign: 'inside', paintOrder: 'stroke' })).indexOf('<g clip-path')).toBeLessThan(shapeSvg(rect({ strokeAlign: 'inside', paintOrder: 'stroke' })).indexOf('fill="#f00"'));
  });

  it('keeps the path transform in both the clip and the stroke', () => {
    const svg = shapeSvg({ id: 'p', type: 'path', d: 'M0 0 L10 0 L10 10 Z', box0: { x: 0, y: 0, w: 10, h: 10 }, x: 5, y: 5, w: 20, h: 20, fill: '#0f0', stroke: '#000', strokeWidth: 2, radius: 0, strokeAlign: 'inside' });
    expect(svg.match(/transform="matrix\(/g)?.length).toBe(3);
  });

  it('reach: inside paints nothing past the edge, outside the full width, center half', () => {
    expect(strokeReach(rect({ strokeAlign: 'inside' }))).toBe(0);
    expect(strokeReach(rect({ strokeAlign: 'outside' }))).toBe(4);
    expect(strokeReach(rect())).toBe(2);
  });
});
