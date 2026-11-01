// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { bendControls, bendSegment } from '../src/engine/design/bendSegment';
import { bezierAt } from '../src/engine/design/segmentDrag';
import { setNodeEditMode, useNodeEditMode } from '../src/engine/design/nodeEditMode';
import { setShapeEdit } from '../src/engine/design/objectSelection';
import { NodeDoneButton, NodeModeButtons } from '../src/components/designer/NodeEditBar';
import { shapeEditHint } from '../src/components/designer/ShapeKnots';
import type { Seg } from '../src/engine/design/pathNodes';

describe('bend math', () => {
  it('the curve passes through the pointer at t', () => {
    const a: [number, number] = [0, 0], b: [number, number] = [100, 0], p: [number, number] = [40, 30];
    const { c1, c2 } = bendControls(a, b, 0.4, p);
    const q = bezierAt(a, c1, c2, b, 0.4);
    expect(q[0]).toBeCloseTo(40); expect(q[1]).toBeCloseTo(30);
  });
  it('clamps t and turns a line into a curve keeping its ends', () => {
    const segs: Seg[] = [{ c: 'M', p: [[0, 0]] }, { c: 'L', p: [[100, 0]] }];
    const out = bendSegment(segs, 1, 0.001, [10, 20]);
    expect(out[1].c).toBe('C');
    expect(out[1].p[2]).toEqual([100, 0]);
    expect(bendSegment(segs, 0, 0.5, [1, 1])).toEqual(segs);
  });
});

describe('node edit mode', () => {
  beforeEach(() => setShapeEdit('d', null));
  it('every mode can be selected; the mode resets when editing starts or ends', () => {
    for (const m of ['cut', 'erase', 'lasso'] as const) { setNodeEditMode(m); expect(useNodeEditMode.getState().mode).toBe(m); }
    setShapeEdit('d', { layerId: 'l', shapeId: 's' });
    expect(useNodeEditMode.getState().mode).toBe('move');
    setNodeEditMode('bend');
    setShapeEdit('d', { layerId: 'l', shapeId: 's', node: 1, nodes: [1] });
    expect(useNodeEditMode.getState().mode).toBe('bend');
    setShapeEdit('d', null);
    expect(useNodeEditMode.getState().mode).toBe('move');
  });
  it('shows the five modes with words, none disabled, and Done', () => {
    const html = renderToStaticMarkup(createElement('div', null, createElement(NodeModeButtons), createElement(NodeDoneButton, { docId: 'd' })));
    for (const w of ['Move', 'Bend', 'Cut', 'Erase', 'Lasso', 'Done']) expect(html).toContain(w);
    expect(html).not.toContain('disabled');
    expect(html).not.toContain('Soon');
  });
  it('bend has its own hint', () => {
    setNodeEditMode('bend');
    const doc = { id: 'd', layers: [{ id: 'l', type: 'vector', shapes: [{ id: 's', type: 'path' }] }] } as never;
    setShapeEdit('d', { layerId: 'l', shapeId: 's' });
    setNodeEditMode('bend');
    expect(shapeEditHint(doc).text).toContain('Bend: drag a segment to curve it');
  });
});
