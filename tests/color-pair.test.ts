import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => Object.assign(globalThis, { window: { setTimeout, clearTimeout, addEventListener: () => undefined }, document: { addEventListener: () => undefined, visibilityState: 'visible' } }));
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  getAssetBlob: async () => undefined,
  putAssetBlob: async () => undefined,
}));

import { DEFAULT_COLORS, resetColors, secondaryOf, setSecondary, swapColors } from '../src/engine/design/colorPair';
import { createDoc, insertLayer, newRasterLayer, newVectorLayer } from '../src/engine/design/doc';
import { renderSource } from '../src/engine/design/sampleSource';
import { setUi, useStore } from '../src/store/store';

const brush = () => useStore.getState().ui.brush;

describe('color pair', () => {
  it('the secondary is its own, else the gradient second color, else black; bad values fall back', () => {
    expect(secondaryOf({ secondary: '#112233' }, { color2: '#445566' })).toBe('#112233');
    expect(secondaryOf({}, { color2: '#445566' })).toBe('#445566');
    expect(secondaryOf({})).toBe('#000000');
    expect(secondaryOf({ secondary: 'red' }, { color2: 'nope' })).toBe(DEFAULT_COLORS.secondary);
  });
  it('swap trades the two, reset goes back to white over black, a chosen secondary joins the recent colors', () => {
    setUi({ brush: { ...brush(), color: '#ff0000', secondary: undefined } });
    swapColors();
    expect([brush().color, brush().secondary]).toEqual(['#000000', '#ff0000']);
    swapColors();
    expect([brush().color, brush().secondary]).toEqual(['#ff0000', '#000000']);
    setSecondary('#00FF00');
    setSecondary('not a color');
    expect(brush().secondary).toBe('#00ff00');
    expect(useStore.getState().ui.swatches?.recent[0]).toBe('#00FF00'.toLowerCase());
    resetColors();
    expect([brush().color, brush().secondary]).toEqual(['#ffffff', '#000000']);
  });
});

describe('layer insertion below', () => {
  it('goes right under the active layer, and on top when none is active', () => {
    const a = newRasterLayer('A', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), b = newVectorLayer('B'), c = newVectorLayer('C');
    let doc = insertLayer(insertLayer(createDoc('T', 10, 10), a), b);
    doc = { ...doc, activeLayerId: a.id };
    expect(insertLayer(doc, c, 'below').layers.map((l) => l.id)).toEqual([c.id, a.id, b.id]);
    expect(insertLayer(doc, c, 'above').layers.map((l) => l.id)).toEqual([a.id, c.id, b.id]);
    expect(insertLayer({ ...doc, activeLayerId: null }, c, 'below').layers.map((l) => l.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe('sample source', () => {
  it('reading the active layer needs one; pixels still loading are reported, not read', () => {
    const doc = createDoc('T', 10, 10);
    expect(renderSource({ ...doc, activeLayerId: null }, 'layer', { origin: 'fill' })).toMatch(/Select a layer/);
    const raster = newRasterLayer('R', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 });
    const withRaster = insertLayer(doc, raster);
    expect(typeof renderSource(withRaster, 'all', { origin: 'fill' })).toBe('string');
    expect(typeof renderSource(withRaster, 'layer', { origin: 'color-sample' })).toBe('string');
  });
});
