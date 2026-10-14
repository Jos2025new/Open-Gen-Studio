// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SnapIndicator } from '../src/components/designer/SnapIndicator';

const view = { x: 0, y: 0, zoom: 1 } as never;
describe('spacing indicator', () => {
  it('draws nothing without measures, and each gap with its length', () => {
    expect(renderToStaticMarkup(createElement(SnapIndicator, { view, measures: [] }))).toBe('');
    const html = renderToStaticMarkup(createElement(SnapIndicator, { view, measures: [{ a: [10, 5], b: [20, 5], label: 10 }, { a: [30, 5], b: [40, 5], label: 10 }] }));
    expect(html).toContain('>10.0</text>');
    expect(html.match(/<text/g)).toHaveLength(2);
    expect(html).toContain('class="stroke-ruler snap-indicator"'); // the stroke-ruler class lets pointer events through
  });
});
