import { describe, expect, it } from 'vitest';
import { newRasterLayer } from '../src/engine/design/doc';
import { drawRevision } from '../src/engine/design/drawRevision';
import { newVectorLayer } from '../src/engine/design/doc';

describe('drawing revision (placement is not drawn content)', () => {
  const raster = newRasterLayer('R', { x: 0, y: 0, width: 20, height: 10 }, { width: 20, height: 10 });
  it('ignores position, opacity and blend for raster layers', () => {
    const moved = { ...raster, x: 50, y: 7, opacity: 0.3, blend: 'screen' as const };
    expect(drawRevision(moved)).toEqual(drawRevision(raster));
  });
  it('changes with the transform of a raster layer', () => {
    expect(drawRevision({ ...raster, transform: [1, 0, 0, 1, 2, 0] as never })).not.toEqual(drawRevision(raster));
  });
  it('keeps vector layers compared as a whole', () => {
    const v = newVectorLayer('V', []);
    expect(drawRevision({ ...v, x: 4 })).not.toEqual(drawRevision(v));
  });
});
