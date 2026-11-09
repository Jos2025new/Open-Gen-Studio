// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { DesignDoc, VectorLayer } from '../src/engine/types';
import { groupShapes } from '../src/engine/design/objectGroupTree';
import { exportGeometry, exportPlan } from '../src/engine/design/exportJob';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';

vi.mock('../src/engine/design/exportRaster', () => ({
  checkRasterExport: () => {}, PREVIEW_MAX_SIDE: 512,
  exportDoc: async () => new Blob(['png'], { type: 'image/png' }),
}));
vi.mock('../src/engine/design/exportStrokeMask', () => ({ strokesExportMask: (_doc: unknown, _kept: unknown, partial: Map<string, Set<string>>) => ({ partial }) }));
vi.mock('../src/lib/media', () => ({ blobToDataUrl: async () => 'data:image/png;base64,cG5n' }));

const base = { visible: true, locked: false, opacity: 1, blend: 'normal' as const };
const shape = { id: 'shape', type: 'rect' as const, x: 10, y: 10, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0, radius: 0 };
const vector = { ...base, id: 'v', name: 'Vector', type: 'vector' as const, shapes: [shape], strokes: [{ id: 'lineart' }] } as unknown as VectorLayer;
const doc = { id: 'd', name: 'Private title', width: 100, height: 100, background: null, activeLayerId: 'v', createdAt: 0, updatedAt: 0, layers: [vector] } as DesignDoc;
const deps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };

describe('adversarial export and object combinations', () => {
  it('does not throw when grouping a shape and a lineart stroke selected together', () => {
    expect(() => groupShapes(vector, ['shape', 'lineart'])).not.toThrow();
  });
  it('respects disabled SVG metadata for a pixel selection', async () => {
    const selection = { points: [[1, 1], [20, 1], [20, 20], [1, 20]] as [number, number][] };
    const [file] = await exportPlan(doc, { ...DEFAULT_EXPORT, area: 'selection', format: 'svg', svg: { metadata: false } }, { selection }, deps);
    expect(await file.bytes.text()).not.toContain('<title>');
  });
  it('exports only the selected stroke of a raster layer', () => {
    const raster = { ...base, id: 'r', name: 'Paint', type: 'raster', x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100, rev: 0,
      paintStrokes: [{ id: 'chosen', x: 0, y: 0, color: '#f00', opacity: 1, erase: false, segments: [[10, 10, 30, 10, 4]] }, { id: 'other', x: 0, y: 0, color: '#00f', opacity: 1, erase: false, segments: [[10, 60, 30, 60, 4]] }] };
    const painted = { ...doc, layers: [raster], activeLayerId: 'r' } as unknown as DesignDoc;
    const result = exportGeometry(painted, { ...DEFAULT_EXPORT, area: 'objects' }, { objects: [{ layerId: 'r', ids: ['chosen'] }] });
    // The layer's pixels are kept and cut to the chosen stroke's footprint (exportStrokeMask.ts), not repainted.
    const mask = ('mask' in result ? result.mask : undefined) as unknown as { partial: Map<string, Set<string>> } | undefined;
    expect([...(mask?.partial.get('r') ?? [])]).toEqual(['chosen']);
    // The area hugs the chosen stroke (y ≈ 10), not the whole layer or the other stroke (y ≈ 60).
    expect(result.box.y + result.box.h).toBeLessThan(40);
  });
});
