import { describe, expect, it } from 'vitest';
import { snapOptsFor } from '../src/engine/design/snap';
import { newRasterLayer } from '../src/engine/design/doc';
import type { DesignDoc } from '../src/engine/types';

const raster = () => newRasterLayer('r', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 });
const docWith = (layers: any[], paintMode?: 'drawing' | 'design') => ({ layers, paintMode } as unknown as Pick<DesignDoc, 'paintMode' | 'layers'>);

describe('snapping by mode', () => {
  it('Design: on by default', () => {
    expect(snapOptsFor(docWith([], 'design')).on).toBe(true);
  });
  it('Drawing: off by default, and no switch set means no snapping while painting', () => {
    expect(snapOptsFor(docWith([raster()], 'drawing')).on).toBe(false);
  });
  it('the user\'s switch, once set, wins in either mode', () => {
    expect(snapOptsFor(docWith([], 'drawing'), { on: true, page: true, layers: true }).on).toBe(true);
    expect(snapOptsFor(docWith([], 'design'), { on: false, page: true, layers: true }).on).toBe(false);
  });
});
