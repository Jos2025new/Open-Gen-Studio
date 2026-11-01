import { describe, expect, it } from 'vitest';
import type { VectorShape } from '../src/engine/types';
import { roundRectPath } from '../src/engine/design/shapeLook';
import { shapeSvg } from '../src/engine/design/export';
import { shapeToPath } from '../src/engine/design/affine';

const rect = (o: Partial<VectorShape> = {}): VectorShape => ({ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 60, fill: '#f00', stroke: null, strokeWidth: 0, radius: 10, ...o });
const box = { x: 0, y: 0, w: 100, h: 60 };

describe('corner smoothing', () => {
  it('absent or zero keeps the path and the element exactly as before', () => {
    expect(roundRectPath(box, 10, 10, false, 0)).toBe(roundRectPath(box, 10, 10));
    expect(shapeSvg(rect())).toBe('<rect x="0" y="0" width="100" height="60" rx="10" fill="#f00"/>');
    expect(shapeSvg(rect({ smooth: 0 }))).toContain('<rect ');
  });

  it('starts each corner further along the edge: (1 + smoothing) times the radius, never past the middle', () => {
    expect(roundRectPath(box, 10, 10, false, 0.5)).toContain('M 15 0');
    expect(roundRectPath(box, 10, 10, false, 1)).toContain('M 20 0');
    expect(roundRectPath({ x: 0, y: 0, w: 40, h: 60 }, 15, 15, false, 1)).toContain('M 20 0'); // capped at half the side
  });

  it('exports a smoothed rectangle as a path; sharp corners have nothing to smooth', () => {
    const svg = shapeSvg(rect({ smooth: 0.6 }));
    expect(svg.startsWith('<path d="M 16 0')).toBe(true);
    expect(shapeSvg(rect({ radius: 0, smooth: 0.6 }))).toContain('<rect ');
  });

  it('keeps the smoothing when converted to a path, and drops the field', () => {
    const p = shapeToPath(rect({ smooth: 1 }));
    expect(p.d).toContain('M 20 0');
    expect(p.smooth).toBeUndefined();
  });
});
