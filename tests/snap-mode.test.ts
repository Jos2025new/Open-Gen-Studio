import { describe, expect, it } from 'vitest';
import { snapOptsFor } from '../src/engine/design/snap';
import { newRasterLayer } from '../src/engine/design/doc';
import type { DesignDoc } from '../src/engine/types';

const raster = () => newRasterLayer('r', { x: 0, y: 0, width: 10, height: 10 }, { width: 10, height: 10 });
const docWith = (layers: any[], paintMode?: 'drawing' | 'design') => ({ layers, paintMode } as unknown as Pick<DesignDoc, 'paintMode' | 'layers'>);
const on = { on: true, page: true, layers: true };
const off = { on: false, page: true, layers: true };

describe('snapping by mode', () => {
  it('Design: on by default; Drawing: off by default, and raster painting has no snap', () => {
    expect(snapOptsFor(docWith([], 'design')).on).toBe(true);
    expect(snapOptsFor(docWith([raster()], 'drawing')).on).toBe(false);
  });

  it('a switch saved for one mode is read only in that mode', () => {
    expect(snapOptsFor(docWith([], 'drawing'), { drawing: on }).on).toBe(true);
    expect(snapOptsFor(docWith([], 'design'), { drawing: on }).on).toBe(true); // Design keeps its own default
  });

  it('saving Design off does not change Drawing\'s default, and the other way round', () => {
    const byMode = { design: off };
    expect(snapOptsFor(docWith([], 'design'), byMode).on).toBe(false);
    expect(snapOptsFor(docWith([], 'drawing'), byMode).on).toBe(false); // Drawing: its default, off
    const byMode2 = { drawing: on };
    expect(snapOptsFor(docWith([], 'drawing'), byMode2).on).toBe(true);
    expect(snapOptsFor(docWith([], 'design'), byMode2).on).toBe(true); // Design: its default, on
  });

  it('a switch in the old single format is not read: each mode keeps its default', () => {
    const legacy = { snap: off } as unknown as Parameters<typeof snapOptsFor>[1];
    expect(snapOptsFor(docWith([], 'design'), legacy).on).toBe(true);
    expect(snapOptsFor(docWith([], 'drawing'), legacy).on).toBe(false);
  });
});
