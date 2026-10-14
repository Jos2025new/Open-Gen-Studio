import { describe, expect, it } from 'vitest';
import { paintModeOf } from '../src/engine/design/paintMode';
import { newRasterLayer, newVectorLayer } from '../src/engine/design/doc';

const empty = () => newRasterLayer('r', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 });
const painted = () => ({ ...empty(), paintBaseId: 'buf1' });
const doc = (layers: any[], paintMode?: 'drawing' | 'design') => ({ layers, paintMode }) as any;

describe('default paint mode follows the content (ADR 0016, amendment 2026-10-14)', () => {
  it('vector shapes only open in Design', () => {
    expect(paintModeOf(doc([newVectorLayer('v')]))).toBe('design');
  });
  it('no raster content (empty raster layers, no layers) opens in Design', () => {
    expect(paintModeOf(doc([empty()]))).toBe('design');
    expect(paintModeOf(doc([]))).toBe('design');
  });
  it('a raster layer with painted pixels opens in Drawing', () => {
    expect(paintModeOf(doc([painted()]))).toBe('drawing');
  });
  it('editable strokes keep Design even next to painted pixels', () => {
    const withStrokes = { ...painted(), paintStrokes: [{ id: 's' }], paintFlattened: false };
    expect(paintModeOf(doc([withStrokes]))).toBe('design');
  });
  it('a saved choice always wins over the default', () => {
    expect(paintModeOf(doc([newVectorLayer('v')], 'drawing'))).toBe('drawing');
    expect(paintModeOf(doc([painted()], 'design'))).toBe('design');
  });
});
