import { describe, expect, it } from 'vitest';
import { promptAnchor } from '../src/engine/design/drawingChoice';

const view = { w: 1000, h: 700 }, box = { w: 340, h: 170 };

describe('the drawing choice prompt sits beside the press', () => {
  it('anchors 12 px down and right of the press when there is room', () => {
    expect(promptAnchor({ x: 200, y: 150 }, view, box)).toEqual({ x: 212, y: 162 });
  });
  it('flips to the left of the press when the box would pass the right edge', () => {
    expect(promptAnchor({ x: 900, y: 150 }, view, box)).toEqual({ x: 900 - 12 - 340, y: 162 });
  });
  it('flips above the press when the box would pass the bottom edge', () => {
    expect(promptAnchor({ x: 200, y: 650 }, view, box)).toEqual({ x: 212, y: 650 - 12 - 170 });
  });
  it('clamps inside the view when the box is bigger than the room on both sides', () => {
    const tiny = { w: 300, h: 120 };
    const p = promptAnchor({ x: 10, y: 10 }, { w: 200, h: 100 }, tiny);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x + tiny.w).toBeLessThanOrEqual(Math.max(tiny.w, 200));
  });
  it('the anchor never lands outside the view for a press at a corner', () => {
    const p = promptAnchor({ x: 999, y: 699 }, view, box);
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x + box.w).toBeLessThanOrEqual(view.w);
    expect(p.y + box.h).toBeLessThanOrEqual(view.h);
  });
});
