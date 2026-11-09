// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import type { DesignDoc } from '../src/engine/types';

const doc = {
  id: 'doc', name: 'Artwork', width: 100, height: 100, background: null, activeLayerId: 'layer', createdAt: 0, updatedAt: 0,
  layers: [{ id: 'layer', name: 'Version 1.25', type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [
    { id: 'shape', type: 'rect', x: 10.125, y: 0, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 },
  ] }],
} as DesignDoc;
const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };

describe('adversarial SVG export', () => {
  it('keeps the XML declaration valid after rounding', async () => {
    const svg = await docToSvg(doc, deps, undefined, { decimals: 1 });
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });

  it('rounds coordinates without changing a layer name containing a decimal', async () => {
    const svg = await docToSvg(doc, deps, undefined, { decimals: 1 });
    expect(svg).toContain('x="10.1"');
    expect(svg).toContain('inkscape:label="Version 1.25"');
  });
});
