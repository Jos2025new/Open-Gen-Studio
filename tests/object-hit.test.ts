import { describe, expect, it } from 'vitest';
import { objectAt } from '../src/engine/design/objectOps';
import { newVectorLayer } from '../src/engine/design/doc';
import { shapeHit, strokeHit } from '../src/engine/design/objectHit';
import { DEFAULT_STROKE_STYLE, newStroke } from '../src/engine/design/strokes';
import type { ShapeSpec } from '../src/engine/types';

const shape = (o: Partial<ShapeSpec>): ShapeSpec => ({ type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: '#fff', stroke: null, strokeWidth: 0, radius: 0, ...o }) as ShapeSpec;

describe('clicks land on what a vector object draws', () => {
  it('an ellipse is not hit in the corners of its box', () => {
    const e = shape({ type: 'ellipse' });
    expect(shapeHit(e, 50, 50)).toBe(true);
    expect(shapeHit(e, 3, 3)).toBe(false);
  });

  it('a diagonal line is hit near it, not across its box', () => {
    const l = shape({ type: 'line', strokeWidth: 2 });
    expect(shapeHit(l, 51, 49)).toBe(true);
    expect(shapeHit(l, 90, 10)).toBe(false);
  });

  it('a turned rectangle follows its turn; a thick stroke counts', () => {
    const c = Math.SQRT1_2;
    const r = shape({ rot: [c, c, -c, c] });
    expect(shapeHit(r, 50, 50)).toBe(true);
    expect(shapeHit(r, 2, 2)).toBe(false);
    expect(shapeHit(shape({ stroke: '#000', strokeWidth: 20 }), -8, 50)).toBe(true);
  });

  it('a freehand curve is hit on its line, not inside its curl', () => {
    const pts = Array.from({ length: 40 }, (_, i) => [50 + 40 * Math.cos(i / 6), 50 + 40 * Math.sin(i / 6), 0.5] as [number, number, number]);
    const s = newStroke(pts, { ...DEFAULT_STROKE_STYLE, size: 4 }, false);
    expect(strokeHit(s, 90, 50)).toBe(true);
    expect(strokeHit(s, 50, 50)).toBe(false);
  });

  it('Objects mode: a click in an ellipse box corner picks nothing', () => {
    const l = newVectorLayer('s', [shape({ type: 'ellipse' })]);
    expect(objectAt(l, 3, 3)).toBeNull();
    expect(objectAt(l, 50, 50)).not.toBeNull();
  });
});
