import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cursorIndicator, hasCursorPreview, type CursorTools } from '../src/engine/design/cursorPreview';
import { BrushCursor } from '../src/components/designer/BrushCursor';
import { newStroke, DEFAULT_STROKE_STYLE } from '../src/engine/design/strokes';
import { newVectorLayer } from '../src/engine/design/doc';
const options: CursorTools = { tool: 'brush', brushSize: 20, lineartSize: 8, lineartMode: 'draw', influence: 80, active: null, curveSelected: false };
const point = { x: 10, y: 20 };
const stroke = newStroke([[10, 20, .5], [60, 20, .5]], { ...DEFAULT_STROKE_STYLE, size: 12 }, true);
const active = { ...newVectorLayer('Lineart'), strokes: [stroke] };

describe('one real-size cursor for raster, vector and deformation', () => {
  it.each(['brush', 'eraser'] as const)('%s uses half the brush diameter', tool => {
    expect(cursorIndicator({ ...options, tool }, point, 1, false)).toEqual({ radius: 10, kind: 'brush' });
  });
  it('vector drawing uses lineart size; editing and Move points use the configured influence', () => {
    expect(cursorIndicator({ ...options, tool: 'lineart' }, point, 1, false)!.radius).toBe(4);
    expect(cursorIndicator({ ...options, tool: 'lineart', lineartMode: 'edit' }, point, 1, false)).toEqual({ radius: 80, kind: 'influence' });
    expect(cursorIndicator({ ...options, tool: 'move', curveSelected: true }, point, 1, false)!.radius).toBe(80);
  });
  it('Alt-drag shows the existing size-derived radius and keeps it throughout the gesture', () => {
    expect(cursorIndicator({ ...options, active, tool: 'lineart' }, point, 1, true)!.radius).toBe(48);
    expect(cursorIndicator({ ...options, active, tool: 'lineart' }, { x: 300, y: 300 }, 1, true)!.radius).toBe(4);
    expect(cursorIndicator(options, { x: 300, y: 300 }, 1, false, { base: [stroke], stroke: 0 })!.radius).toBe(48);
    expect(cursorIndicator(options, point, 1, false, { base: [stroke], stroke: 0, influence: 123 })!.radius).toBe(123);
  });
  it.each([.05, .5, 1, 2, 8])('one overlay scales diameter with zoom %s without a minimum-size distortion', zoom => {
    const html = renderToStaticMarkup(createElement(BrushCursor, { point, view: { x: 100, y: 50, zoom }, indicator: { radius: 10, kind: 'brush' } }));
    expect(html).toContain(`width:${20 * zoom}px`);
    expect(html).toContain(`height:${20 * zoom}px`);
    expect(html).toContain(`translate(${100 + point.x * zoom - 10 * zoom}px, ${50 + point.y * zoom - 10 * zoom}px)`);
  });
  it('unrelated tools have no cursor work or overlay', () => {
    for (const tool of ['hand', 'text', 'select', 'gradient', 'move'] as const) expect(hasCursorPreview({ ...options, tool })).toBe(false);
    expect(renderToStaticMarkup(createElement(BrushCursor, { point: null, view: { x: 0, y: 0, zoom: 1 }, indicator: null }))).toBe('');
  });
});
