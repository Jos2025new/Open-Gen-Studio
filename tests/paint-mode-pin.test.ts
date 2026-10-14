import { describe, expect, it } from 'vitest';
import { paintModeOf, pinPaintMode } from '../src/engine/design/paintMode';
import { createDoc, newRasterLayer, newVectorLayer } from '../src/engine/design/doc';

const painted = () => ({ ...newRasterLayer('r', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 }), paintBaseId: 'b' });

describe('the mode is fixed when the document is created or first read (ADR 0016, amendment 2026-10-14)', () => {
  it('a new shapes-only document stays in Design after raster is painted', () => {
    const d = pinPaintMode({ ...createDoc('s', 10, 10), paintMode: undefined, layers: [newVectorLayer('v')] });
    expect(d.paintMode).toBe('design');
    expect(paintModeOf({ ...d, layers: [...d.layers, painted()] })).toBe('design');
  });
  it('a new drawing document stays in Drawing after a shape is added', () => {
    const d = pinPaintMode(createDoc('d', 10, 10));
    expect(d.paintMode).toBe('drawing');
    expect(paintModeOf({ ...d, layers: [newVectorLayer('v')] })).toBe('drawing');
  });
  it('an old document without the field is deduced and fixed; the same object comes back when it already has one', () => {
    const old = { layers: [painted()], paintMode: undefined } as any;
    const pinned = pinPaintMode(old);
    expect(pinned.paintMode).toBe('drawing');
    expect(paintModeOf({ ...pinned, layers: [newVectorLayer('v')] })).toBe('drawing');
    expect(pinPaintMode(pinned)).toBe(pinned);
  });
});
