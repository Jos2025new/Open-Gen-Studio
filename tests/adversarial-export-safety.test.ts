// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { DesignDoc, Layer, RasterLayer } from '../src/engine/types';

const state = vi.hoisted(() => ({ attempted: [] as number[][], ensure: vi.fn(async (_layers: Layer[]) => {}), unreadable: new Set<string>(), surface: { fw: 8000, fh: 8000 } }));
vi.mock('../src/lib/media', async (original) => ({
  ...await original<typeof import('../src/lib/media')>(),
  createCanvas: (w: number, h: number) => { state.attempted.push([w, h]); throw new Error(`Blocked simulated allocation: ${w}x${h}`); },
}));
vi.mock('../src/engine/design/raster', async (original) => ({
  ...await original<typeof import('../src/engine/design/raster')>(),
  ensureBuffers: state.ensure,
  isUnreadable: (id: string) => state.unreadable.has(id),
  getRasterSurface: () => state.surface,
}));
vi.mock('../src/engine/design/exportJob', async (original) => ({
  ...await original<typeof import('../src/engine/design/exportJob')>(),
  exportPreview: async () => new Blob(['preview'], { type: 'image/png' }),
}));
import { STROKE_MASK_MAX_PIXELS, strokesExportMask } from '../src/engine/design/exportStrokeMask';
import { prepareDesignPreview } from '../src/engine/design/exportDesign';
import { DEFAULT_EXPORT } from '../src/engine/design/exportSettings';
import { writeFilesToFolder, type FolderHandle } from '../src/engine/design/exportFolder';

const base = { visible: true, locked: false, opacity: 1, blend: 'normal' as const };
const raster = { ...base, id: 'paint', name: 'Paint', type: 'raster', x: 0, y: 0, width: 2000, height: 2000, pxWidth: 8000, pxHeight: 8000, rev: 0, paintStrokes: [] } as RasterLayer;
const vector = { ...base, id: 'vector', name: 'Vector', type: 'vector', shapes: [{ id: 'shape', type: 'rect', x: 1, y: 1, w: 10, h: 10, fill: '#000', stroke: null, strokeWidth: 0 }] } as Layer;
const doc = { id: 'doc', name: 'Design', width: 2000, height: 2000, background: null, layers: [vector, raster], activeLayerId: 'vector', createdAt: 0, updatedAt: 0 } as DesignDoc;

describe('adversarial export safety', () => {
  it('caps a large stroke mask instead of allocating it whole', () => {
    state.attempted = [];
    // The mock blocks every allocation; what matters is the size that was asked for.
    try { strokesExportMask(doc, [raster], new Map([['paint', new Set(['chosen'])]])); } catch { /* blocked by the mock */ }
    expect(state.attempted.length).toBe(1);
    const [[w, h]] = state.attempted;
    expect(w * h).toBeLessThanOrEqual(STROKE_MASK_MAX_PIXELS + 2 * Math.sqrt(STROKE_MASK_MAX_PIXELS) + 1);
  });
  it('previews one selected layer when another visible layer cannot be read', async () => {
    state.ensure.mockClear(); state.unreadable = new Set(['paint']);
    await expect(prepareDesignPreview(doc, { ...DEFAULT_EXPORT, area: 'layer' }, { layerId: 'vector' })).resolves.toMatchObject({ type: 'image/png' });
    expect(state.ensure.mock.calls[0][0].map((l) => l.id)).toEqual(['vector']);
  });
  it('previews selected objects even if an unrelated visible layer cannot be read', async () => {
    state.ensure.mockClear(); state.unreadable = new Set(['paint']);
    const result = prepareDesignPreview(doc, { ...DEFAULT_EXPORT, area: 'objects' }, { objects: [{ layerId: 'vector', ids: ['shape'] }] });
    await expect(result).resolves.toMatchObject({ type: 'image/png' });
    expect(state.ensure.mock.calls[0][0].map((l) => l.id)).toEqual(['vector']);
  });
  it('does not choose the same destination for two interleaved exports', async () => {
    const contents = new Map<string, string>();
    const folder = {
      name: 'memory', getDirectoryHandle: async () => { throw new Error('not used'); },
      getFileHandle: async (name: string, options?: { create?: boolean }) => {
        if (!options?.create) { await new Promise((r) => setTimeout(r, 10)); if (contents.has(name)) return { createWritable: async () => { throw new Error('exists'); } }; throw new DOMException('missing', 'NotFoundError'); }
        return { createWritable: async () => { let data = ''; return { write: async (blob: Blob) => { data = await blob.text(); }, close: async () => { contents.set(name, data); } }; } };
      },
    } as FolderHandle;
    const make = (content: string) => ({ name: 'same.png', mime: 'image/png', bytes: new Blob([content]) });
    const results = await Promise.all([writeFilesToFolder(folder, [make('first')], false), writeFilesToFolder(folder, [make('second')], false)]);
    expect({ uniqueNames: new Set(results.flat()).size, savedFiles: contents.size }).toEqual({ uniqueNames: 2, savedFiles: 2 });
  });
});
