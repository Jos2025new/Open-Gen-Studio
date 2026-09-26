import { describe, expect, it } from 'vitest';
import { docToSvg, shapeSvg, textSvg, xmlEscape, type SvgDeps } from '../src/engine/design/export';
import type { DesignDoc, TextLayer } from '../src/engine/types';

const base = { visible: true, locked: false, opacity: 1, blend: 'normal' as const };
const text: TextLayer = {
  ...base,
  id: 't1',
  name: 'Title <A & B>',
  type: 'text',
  x: 10,
  y: 20,
  width: 200,
  text: 'Hi & <you>',
  fontFamily: 'Inter',
  fontSize: 40,
  fontWeight: 700,
  color: '#112233',
  align: 'center',
  lineHeight: 1.5,
  letterSpacing: 2,
};

const doc: DesignDoc = {
  id: 'd',
  name: 'Poster "1"',
  width: 400,
  height: 300,
  background: '#ffffff',
  activeLayerId: null,
  createdAt: 0,
  updatedAt: 0,
  layers: [
    { ...base, id: 'r1', name: 'Photo', type: 'raster', x: 0, y: 0, width: 400, height: 300, pxWidth: 800, pxHeight: 600, rev: 1 },
    { ...base, id: 'v1', name: 'Shapes', type: 'vector', opacity: 0.5, blend: 'multiply', shapes: [
      { id: 's1', type: 'rect', x: 50, y: 60, w: -40, h: 30, fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 100 },
      { id: 's2', type: 'ellipse', x: 0, y: 0, w: 20, h: 10, fill: null, stroke: '#000', strokeWidth: 2, radius: 0 },
      { id: 's3', type: 'line', x: 1, y: 2, w: 3, h: 4, fill: '#abc', stroke: '#00f', strokeWidth: 1.5, radius: 0 },
    ] },
    { ...base, id: 'hidden', name: 'Off', type: 'vector', visible: false, shapes: [] },
    text,
  ],
};

const deps: SvgDeps = {
  rasterHref: async () => 'data:image/png;base64,AAAA',
  layout: () => ({ lines: ['Hi & <you>'], width: 200, lineHeightPx: 60 }),
  ascent: () => 32,
};

describe('SVG export', () => {
  it('keeps layer order, names, opacity and blend, and skips hidden layers', async () => {
    const svg = await docToSvg(doc, deps);
    const ids = [...svg.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(['r1', 'v1', 't1']);
    expect(svg).toContain('width="400" height="300" viewBox="0 0 400 300"');
    expect(svg).toContain('<rect width="400" height="300" fill="#ffffff"/>');
    expect(svg).toContain('inkscape:label="Title &lt;A &amp; B&gt;"');
    expect(svg).toContain('opacity="0.5" style="mix-blend-mode:multiply"');
    expect(svg).toContain('<title>Poster &quot;1&quot;</title>');
    // Images are embedded, never temporary blob: URLs.
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).not.toContain('blob:');
    // Well-formed XML: every opened layer group is closed.
    expect(svg.match(/<g /g)!.length).toBe(svg.match(/<\/g>/g)!.length);
  });

  it('draws shapes like the canvas renderer (negative sizes, clamped radius, lines without fill)', () => {
    expect(shapeSvg(doc.layers[1].type === 'vector' ? doc.layers[1].shapes[0] : (null as never))).toBe('<rect x="10" y="60" width="40" height="30" rx="15" fill="#ff0000"/>');
    expect(shapeSvg({ id: 'e', type: 'ellipse', x: 0, y: 0, w: 20, h: 10, fill: null, stroke: '#000', strokeWidth: 2, radius: 0 })).toBe(
      '<ellipse cx="10" cy="5" rx="10" ry="5" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    );
    expect(shapeSvg({ id: 'l', type: 'line', x: 1, y: 2, w: 3, h: 4, fill: '#abc', stroke: '#00f', strokeWidth: 1.5, radius: 0 })).toContain('<line x1="1" y1="2" x2="4" y2="6" fill="none" stroke="#00f"');
  });

  it('writes text as editable text with escaped characters and the canvas baseline', () => {
    const t = textSvg(text, { lines: ['Hi & <you>', 'two'], width: 200, lineHeightPx: 60 }, 32);
    expect(t).toContain('text-anchor="middle"');
    expect(t).toContain('font-weight="700"');
    expect(t).toContain('letter-spacing="2"');
    // center: x + width/2; baseline: y + (lineHeight - fontSize)/2 + ascent, then one line height per line.
    expect(t).toContain('<tspan x="110" y="62">Hi &amp; &lt;you&gt;</tspan><tspan x="110" y="122">two</tspan>');
    expect(xmlEscape(`'"`)).toBe('&apos;&quot;');
  });
});
