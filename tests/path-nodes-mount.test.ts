// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PathNodes } from '../src/components/designer/PathNodes';
import { setShapeEdit } from '../src/engine/design/objectSelection';
import type { VectorShape } from '../src/engine/types';

/* The node editor, mounted with the props the app passes: four curves (an ellipse converted), node 1 picked. */
const ellipsePath: VectorShape = {
  id: 'e1', type: 'path', d: 'M 50 0 C 77 0 100 22 100 50 C 100 77 77 100 50 100 C 22 100 0 77 0 50 C 0 22 22 0 50 0 Z',
  box0: { x: 0, y: 0, w: 100, h: 100 }, x: 0, y: 0, w: 100, h: 100, fill: '#ff8800', stroke: '#000000', strokeWidth: 2, radius: 0,
} as VectorShape;
const view = { x: 0, y: 0, zoom: 1, width: 800, height: 600 } as never;

describe('node editor mount', () => {
  it('a selected node shows its two handles and their lines', () => {
    setShapeEdit('doc1', { layerId: 'l1', shapeId: 'e1', node: 1, nodes: [1] } as never);
    const html = renderToStaticMarkup(createElement(PathNodes, { view, sessionId: 's', docId: 'doc1', layerId: 'l1', shape: ellipsePath }));
    expect(html).toContain('class="stroke-ruler-handle shape-knot path-handle"');
    const handles = html.match(/data-handle="[^"]+"/g) ?? [];
    expect(handles.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain('class="shape-knot-lines"');
  });

  it('the segment band is in the markup', () => {
    setShapeEdit('doc1', { layerId: 'l1', shapeId: 'e1', node: 1, nodes: [1] } as never);
    const html = renderToStaticMarkup(createElement(PathNodes, { view, sessionId: 's', docId: 'doc1', layerId: 'l1', shape: ellipsePath }));
    expect(html).toContain('class="segment-hit"');
  });
});
