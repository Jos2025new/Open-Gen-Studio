import { describe, expect, it } from 'vitest';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { fxFilter, opPrimitives, saturateMatrix } from '../src/engine/fx/svg';
import { newFxLayer, newFxOp } from '../src/engine/fx/commands';
import type { DesignDoc, VectorLayer } from '../src/engine/types';
import type { FxLayer } from '../src/engine/fx/types';

/* FX in the SVG export (ADR 0011): Inkscape's mechanism (a <filter> referenced from the group), sRGB like the canvas. */

const deps = (notes: string[] = []): SvgDeps => ({ rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0, notice: (m) => notes.push(m) });
const shape = (id: string, name: string, extra: Partial<VectorLayer> = {}): VectorLayer => ({ id, name, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes: [{ id: `${id}s`, type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#ff0000', stroke: null, strokeWidth: 0, radius: 0 }], ...extra });
const doc = (layers: DesignDoc['layers']): DesignDoc => ({ id: 'd', name: 'FX', width: 300, height: 200, background: '#ffffff', activeLayerId: null, createdAt: 0, updatedAt: 0, layers });
const fx = (group: 'filter' | 'effect', scope: 'layer' | 'below', ops: ReturnType<typeof newFxOp>[], extra: Partial<FxLayer> = {}): FxLayer => ({ ...newFxLayer(group, { scope, ops }), id: `fx${scope}`, name: `My ${scope}`, ...extra });

describe('primitives', () => {
  it('every filter but the flare has one, chained from the previous result', () => {
    expect(opPrimitives(newFxOp('blur', { radius: 3 }), 'SourceGraphic', 'f0')).toBe('<feGaussianBlur in="SourceGraphic" result="f0" stdDeviation="3"/>');
    expect(opPrimitives(newFxOp('hue', { degrees: 90 }), 'f0', 'f1')).toBe('<feColorMatrix in="f0" result="f1" type="hueRotate" values="90"/>');
    expect(opPrimitives(newFxOp('contrast', { amount: 2 }), 'a', 'b')).toContain('slope="2" intercept="-0.5"');
    expect(opPrimitives(newFxOp('invert', { amount: 1 }), 'a', 'b')).toContain('tableValues="1 0"');
    expect(opPrimitives(newFxOp('flare'), 'a', 'b')).toBeNull();
  });
  it('saturation uses the CSS saturate matrix, so values above 1 work everywhere', () => {
    expect(saturateMatrix(1).map((v) => Math.round(v * 1000) / 1000)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(opPrimitives(newFxOp('saturation', { amount: 2 }), 'a', 'b')).toContain('type="matrix" values="1.787 -0.715 -0.072 0 0');
  });
  it('the drop shadow\'s blur is a CSS radius: half of it is the SVG standard deviation', () => {
    expect(opPrimitives(newFxOp('shadow', { blur: 12, x: 3, y: 4, color: '#102030', opacity: 0.5 }), 'a', 'b')).toBe('<feDropShadow in="a" result="b" dx="3" dy="4" stdDeviation="6" flood-color="#102030" flood-opacity="0.5"/>');
  });
  it('glow: the blurred source screened over the result, once per unit of strength', () => {
    const g = opPrimitives(newFxOp('glow', { strength: 1.5, radius: 8 }), 'SourceGraphic', 'f0')!;
    expect(g.match(/<feBlend mode="screen"/g)).toHaveLength(2);
    expect(g).toContain('slope="1"');
    expect(g).toContain('slope="0.5"');
    expect(g).toMatch(/result="f0"\/>$/);
  });
  it('a filter covers the page in sRGB; one with only a flare has no SVG filter and names what it skipped', () => {
    const f = fxFilter(fx('filter', 'below', [newFxOp('sepia'), newFxOp('blur')]), 'fx-1', 300, 200);
    expect(f.markup).toMatch(/^<filter id="fx-1" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="300" height="200" color-interpolation-filters="sRGB">/);
    expect(f.markup).toContain('in="f0" result="f1"');
    expect(fxFilter(fx('effect', 'below', [newFxOp('flare')]), 'x', 1, 1)).toEqual({ markup: null, skipped: ['Lens flare'] });
  });
});

describe('docToSvg with FX layers', () => {
  it('"below": an Inkscape layer with the filter, holding everything under it (background too); layers above stay outside', async () => {
    const svg = await docToSvg(doc([shape('a', 'A'), fx('filter', 'below', [newFxOp('grayscale')]), shape('b', 'B')]), deps());
    expect(svg).toContain('<filter id="fx-fxbelow"');
    expect(svg).toMatch(/<g id="fxbelow" inkscape:groupmode="layer" inkscape:label="My below" filter="url\(#fx-fxbelow\)"><rect width="300" height="200" fill="#ffffff"\/><g id="a" /);
    expect(svg.indexOf('<g id="b"')).toBeGreaterThan(svg.indexOf('</g></g>'));
  });
  it('"layer": the filter wraps the target\'s content inside its layer, under the layer\'s own opacity and blend', async () => {
    const svg = await docToSvg(doc([shape('a', 'A', { opacity: 0.5, blend: 'multiply' }), fx('filter', 'layer', [newFxOp('blur', { radius: 2 })])]), deps());
    expect(svg).toMatch(/<g id="a" inkscape:groupmode="layer" inkscape:label="A" opacity="0.5" style="mix-blend-mode:multiply"><g filter="url\(#fx-fxlayer\)"><rect /);
    expect(svg).not.toContain('id="fxlayer"');
  });
  it('an FX at partial opacity or another blend: a filtered copy over the original, ids only on the original', async () => {
    const svg = await docToSvg(doc([shape('a', 'A'), fx('filter', 'below', [newFxOp('invert')], { opacity: 0.4, blend: 'screen' })]), deps());
    expect(svg).toContain('<g filter="url(#fx-fxbelow)" opacity="0.4" style="mix-blend-mode:screen">');
    expect(svg.match(/id="a"/g)).toHaveLength(1);
  });
  it('the lens flare is left out with one notice; the rest of the stack is kept', async () => {
    const notes: string[] = [];
    const svg = await docToSvg(doc([shape('a', 'A'), fx('effect', 'below', [newFxOp('glow'), newFxOp('flare')])]), deps(notes));
    expect(svg).toContain('feBlend mode="screen"');
    expect(notes).toEqual(['SVG has no equivalent for Lens flare: left out of this file. PNG and JPG keep it.']);
  });
  it('hidden FX layers are not exported', async () => {
    const svg = await docToSvg(doc([shape('a', 'A'), fx('filter', 'below', [newFxOp('invert')], { visible: false })]), deps());
    expect(svg).not.toContain('<filter');
  });
});
