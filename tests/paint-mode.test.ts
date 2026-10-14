import { describe, expect, it, vi } from 'vitest';
import type { DesignDoc, RasterLayer } from '../src/engine/types';

// The stroke commit is checked without pixels: the pixel path (endBrushStroke, commitEdit) is called the same way in
// both modes; only the stroke record differs. Real pixel equality needs a canvas, which the test setup does not have.
const fx = vi.hoisted(() => ({ doc: null as unknown as DesignDoc, updates: [] as Array<(d: DesignDoc) => DesignDoc>, endCalls: [] as unknown[], commits: [] as string[] }));
vi.mock('../src/store/store', () => ({
  setDoc: (_s: string, _d: string, fn: (d: DesignDoc) => DesignDoc) => { fx.updates.push(fn); },
  toast: () => undefined,
}));
vi.mock('../src/engine/design/actions', () => ({ getDoc: () => fx.doc }));
vi.mock('../src/engine/design/raster', () => ({
  commitEdit: (id: string) => { fx.commits.push(id); },
  getRasterSurface: () => ({ canvas: {} }),
}));
vi.mock('../src/engine/design/brushStroke', () => ({
  endBrushStroke: (...args: unknown[]) => { fx.endCalls.push(args.length); },
}));
vi.mock('../src/engine/design/objectSelection', () => ({ setObjectPick: () => undefined }));
vi.mock('../src/engine/design/rasterLimit', () => ({
  consumeRasterPaintApproval: () => true,
  requestRasterPaintApproval: () => undefined,
  requiresRasterPaintApproval: () => false,
  shouldFlattenRasterPaint: () => false,
}));
vi.mock('../src/engine/design/rules', () => ({ isProtectedImage: () => false }));

import { createDoc } from '../src/engine/design/doc';
import { commitStagePaintGesture } from '../src/components/designer/StagePaintCommit';
import { hasEditableStrokes, paintModeOf, paintsPixelsDirectly, strokeObjectsAvailable } from '../src/engine/design/paintMode';

const raster = (over: Partial<RasterLayer> = {}): RasterLayer => ({
  id: 'L', type: 'raster', name: 'L', visible: true, locked: false, opacity: 1, blend: 'normal', x: 0, y: 0, width: 10, height: 10,
  pxWidth: 10, pxHeight: 10, rev: 0, ...over,
} as unknown as RasterLayer);
// A document with no saved choice unless the test sets one (createDoc now saves Drawing).
const docWith = (layers: RasterLayer[], extra: Partial<DesignDoc> = {}): DesignDoc => ({ ...createDoc('d', 10, 10), paintMode: undefined, layers, activeLayerId: 'L', ...extra });
const editable = { paintStrokes: [{ id: 's1', segments: [], x: 0, y: 0, color: '#000', opacity: 1, erase: false }] } as Partial<RasterLayer>;

describe('Drawing or Design (ADR 0016)', () => {
  it('a new document paints in Drawing', () => {
    expect(createDoc('new', 10, 10).paintMode).toBe('drawing');
    expect(paintModeOf(createDoc('new', 10, 10))).toBe('drawing');
  });

  it('with no saved choice: editable strokes or no painted pixels open in Design; painted pixels open in Drawing (amendment 2026-10-14)', () => {
    expect(paintModeOf(docWith([raster()]))).toBe('design');
    expect(paintModeOf(docWith([raster(editable)]))).toBe('design');
    expect(paintModeOf(docWith([raster({ ...editable, paintFlattened: true, paintBaseId: 'b' })]))).toBe('drawing');
    expect(paintModeOf(docWith([raster({ paintBaseId: 'b' } as never)]))).toBe('drawing');
  });

  it('a saved choice wins over what the document contains', () => {
    expect(paintModeOf(docWith([raster(editable)], { paintMode: 'drawing' }))).toBe('drawing');
    expect(paintModeOf(docWith([raster()], { paintMode: 'design' }))).toBe('design');
  });

  it('Drawing paints pixels directly only on layers with no editable strokes', () => {
    expect(paintsPixelsDirectly(docWith([raster({ paintBaseId: 'b' } as never)]), raster())).toBe(true);
    expect(paintsPixelsDirectly(docWith([raster(editable)], { paintMode: 'drawing' }), raster(editable))).toBe(false);
    expect(paintsPixelsDirectly(docWith([raster()], { paintMode: 'design' }), raster())).toBe(false);
    expect(hasEditableStrokes(raster(editable))).toBe(true);
  });

  it('single-stroke selection is offered in Design, or on a raster layer with editable strokes only', () => {
    expect(strokeObjectsAvailable(docWith([raster()], { paintMode: 'drawing' }))).toBe(false);
    expect(strokeObjectsAvailable(docWith([raster(editable)], { paintMode: 'drawing' }))).toBe(true);
    expect(strokeObjectsAvailable(docWith([raster()], { paintMode: 'design' }))).toBe(true);
  });

  it('a Drawing stroke writes no editable entry, and a Design stroke still records one', () => {
    const gesture = (direct: boolean) => ({ kind: 'paint' as const, live: {} as never, stroke: { id: 'st', segments: [] } as never, layerId: 'L', last: { x: 0, y: 0 }, control: { x: 0, y: 0 }, time: 0, erase: false, direct });
    const brush = {} as never;
    fx.doc = docWith([raster()], { paintMode: 'drawing' });
    fx.updates = [];
    commitStagePaintGesture({ sessionId: 's', docId: fx.doc.id, gesture: gesture(true), brush, clipped: false, flushFrame: () => undefined });
    const drawn = fx.updates.at(-1)!(fx.doc).layers[0] as RasterLayer;
    expect(drawn.paintStrokes).toBeUndefined();
    expect(drawn.rev).toBe(1);

    fx.doc = docWith([raster({ paintBaseId: 'base', paintStrokes: [] })], { paintMode: 'design' });
    fx.updates = [];
    commitStagePaintGesture({ sessionId: 's', docId: fx.doc.id, gesture: gesture(false), brush, clipped: false, flushFrame: () => undefined });
    const designed = fx.updates.at(-1)!(fx.doc).layers[0] as RasterLayer;
    expect(designed.paintStrokes?.length).toBe(1);
  });

  it('both modes run the same pixel path for the stroke: the end taper and the commit', () => {
    fx.endCalls = []; fx.commits = [];
    fx.doc = docWith([raster()], { paintMode: 'drawing' });
    commitStagePaintGesture({ sessionId: 's', docId: fx.doc.id, gesture: { kind: 'paint', live: {} as never, stroke: { id: 'a', segments: [] } as never, layerId: 'L', last: { x: 0, y: 0 }, control: { x: 0, y: 0 }, time: 0, erase: false, direct: true }, brush: {} as never, clipped: false, flushFrame: () => undefined });
    fx.doc = docWith([raster({ paintBaseId: 'b', paintStrokes: [] })], { paintMode: 'design' });
    commitStagePaintGesture({ sessionId: 's', docId: fx.doc.id, gesture: { kind: 'paint', live: {} as never, stroke: { id: 'b', segments: [] } as never, layerId: 'L', last: { x: 0, y: 0 }, control: { x: 0, y: 0 }, time: 0, erase: false, direct: false }, brush: {} as never, clipped: false, flushFrame: () => undefined });
    expect(fx.endCalls).toEqual([5, 5]);
    expect(fx.commits).toEqual(['L', 'L']);
  });

  it('the choice is saved and loaded with the document; a document without it keeps reading by its content', () => {
    const drawing = JSON.parse(JSON.stringify(docWith([raster()], { paintMode: 'design' }))) as DesignDoc;
    expect(paintModeOf(drawing)).toBe('design');
    const legacy = JSON.parse(JSON.stringify(docWith([raster(editable)]))) as DesignDoc;
    expect(legacy.paintMode).toBeUndefined();
    expect(paintModeOf(legacy)).toBe('design');
  });
});
