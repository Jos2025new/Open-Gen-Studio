import { afterEach, expect, it, vi } from 'vitest';
import type { RasterLayer, RasterStroke, DesignDoc } from '../src/engine/types';
import { moveRasterStroke, rasterStrokeBox } from '../src/engine/design/rasterStrokes';
import { newRasterLayer, translateLayer, scaleLayer, createDoc, cloneLayer } from '../src/engine/design/doc';

const fixture = vi.hoisted(() => {
  Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} });
  const saved = new Map<string, unknown>();
  return { saved };
});
vi.mock('../src/store/store', () => ({ toast: vi.fn() }));
vi.mock('../src/lib/idb', () => ({ blobDb: {
  get: async (id: string) => fixture.saved.get(id),
  set: async (id: string, data: unknown) => { fixture.saved.set(id, data); },
  delMany: async (ids: string[]) => { ids.forEach((id) => fixture.saved.delete(id)); },
} }));
vi.mock('../src/lib/media', () => {
  const canvas = (width: number, height: number) => {
    const c = { width, height, ops: [] as unknown[], getContext: () => ctx };
    let a: number[], b: number[];
    const ctx = {
      globalCompositeOperation: 'source-over', globalAlpha: 1, strokeStyle: '', lineWidth: 1,
      drawImage: (src: typeof c) => { if (ctx.globalCompositeOperation === 'copy') c.ops.length = 0; c.ops.push(...src.ops); },
      save() {}, restore() {}, beginPath() {},
      moveTo: (x: number, y: number) => { a = [x, y]; },
      lineTo: (x: number, y: number) => { b = [x, y]; },
      stroke: () => { c.ops.push([a, b, ctx.lineWidth, ctx.strokeStyle, ctx.globalAlpha, ctx.globalCompositeOperation]); },
    };
    return c;
  };
  return {
    createCanvas: canvas,
    ctx2d: (c: ReturnType<typeof canvas>) => c.getContext(),
    canvasToBlob: async (c: ReturnType<typeof canvas>) => ({ width: c.width, height: c.height, ops: [...c.ops] }),
    blobToCanvas: async (data: ReturnType<typeof canvas>) => Object.assign(canvas(data.width, data.height), { ops: [...data.ops] }),
  };
});
import { createCanvas } from '../src/lib/media';
import * as raster from '../src/engine/design/raster';
import { record, undo, redo } from '../src/engine/design/history';
const stroke = (id: string, x: number): RasterStroke => ({ id, x: 0, y: 0, color: '#fff', opacity: 0.5, erase: false, segments: [[x, 10, x + 20, 20, 6]] });
const layer = (): RasterLayer => ({ ...newRasterLayer('Paint', { x: 0, y: 0, width: 200, height: 100 }, { width: 200, height: 100 }), paintStrokes: [stroke('a', 10), stroke('b', 80)] });
const ops = (id: string) => (raster.getBuffer(id) as unknown as { ops: unknown[] }).ops;
afterEach(async () => { await raster.flushRaster(); });

it('moves one stroke in local coordinates, retaining the other and both boxes under layer transforms', () => {
  const l = layer();
  const moved = moveRasterStroke(l, 'a', 15, 8);
  expect(rasterStrokeBox(moved, moved.paintStrokes![0])!.x).toBe(rasterStrokeBox(l, l.paintStrokes![0])!.x + 15);
  expect(moved.paintStrokes![1]).toBe(l.paintStrokes![1]);
  const whole = translateLayer(moved, 30, 40) as RasterLayer;
  expect(whole.paintStrokes).toBe(moved.paintStrokes);
  expect(rasterStrokeBox(whole, whole.paintStrokes![0])!.y).toBe(rasterStrokeBox(moved, moved.paintStrokes![0])!.y + 40);
  const scaled = scaleLayer(whole, 2, 2, 0, 0) as RasterLayer;
  const shifted = moveRasterStroke(scaled, 'a', 10, 0);
  expect(shifted.paintStrokes![0].x).toBe(scaled.paintStrokes![0].x + 5);
  expect(rasterStrokeBox(shifted, shifted.paintStrokes![0])!.x).toBe(rasterStrokeBox(scaled, scaled.paintStrokes![0])!.x + 10);
});

it('recomposes unchanged strokes exactly, keeps old pixels, and restores pixels and boxes through undo/redo', () => {
  let l = layer();
  const bitmap = createCanvas(200, 100);
  (bitmap as unknown as { ops: unknown[] }).ops.push('existing image');
  raster.setBuffer(l.id, bitmap);
  const entries = l.paintStrokes;
  l = { ...raster.withPaintBase(l), paintStrokes: entries };
  raster.composeRaster(l);
  const before = [...ops(l.id)];
  const doc: DesignDoc = { ...createDoc('test', 200, 100, null), layers: [l], activeLayerId: l.id };
  record(doc);
  const moved = moveRasterStroke(l, 'a', 20, 0);
  raster.composeRaster(moved);
  expect(ops(l.id)[0]).toBe('existing image');
  expect(ops(l.id)[2]).toEqual(before[2]);
  expect(ops(l.id)[1]).not.toEqual(before[1]);
  const restored = undo({ ...doc, layers: [moved] })!;
  expect(restored.layers[0]).toEqual(l);
  expect(ops(l.id)).toEqual(before);
  const redone = redo(restored)!;
  expect(redone.layers[0]).toEqual(moved);
  const copy = cloneLayer(moved) as RasterLayer;
  raster.copyBuffer(moved.id, copy.id);
  raster.composeRaster(moveRasterStroke(copy, 'b', 0, 12));
  expect(ops(moved.id)[2]).toEqual(before[2]);
  expect(raster.rasterBufferIds([moved, copy])).toHaveLength(3);
});

it('loads the immutable base after reload and can still move a stroke without losing the other', async () => {
  let l = layer();
  raster.setBuffer(l.id, createCanvas(200, 100));
  const entries = l.paintStrokes;
  l = { ...raster.withPaintBase(l), paintStrokes: entries };
  raster.composeRaster(l);
  const expectedOther = ops(l.id)[1];
  await raster.flushRaster();
  vi.resetModules();
  const loaded = await import('../src/engine/design/raster');
  await loaded.ensureBuffers([JSON.parse(JSON.stringify(l))]);
  expect(loaded.getBuffer(l.paintBaseId!)).toBeDefined();
  expect(loaded.composeRaster(moveRasterStroke(l, 'a', 20, 0))).toBe(true);
  expect((loaded.getBuffer(l.id) as unknown as { ops: unknown[] }).ops[1]).toEqual(expectedOther);
  await loaded.flushRaster();
});

it('does not discard existing pixels if the stored foundation is unavailable', async () => {
  const l = { ...layer(), paintBaseId: 'missing-foundation' };
  const bitmap = createCanvas(200, 100);
  (bitmap as unknown as { ops: unknown[] }).ops.push('keep existing pixels');
  raster.setBuffer(l.id, bitmap);
  await raster.ensureBuffers([l]);
  expect(raster.composeRaster(l)).toBe(false);
  expect(ops(l.id)).toEqual(['keep existing pixels']);
});


it('reuses immutable segment bounds while applying the current offset and layer scale', () => {
  const l = layer(), s = l.paintStrokes![0];
  let iterations = 0;
  const seg = s.segments[0];
  Object.defineProperty(seg, Symbol.iterator, { value: function* () { iterations++; for (let i = 0; i < 5; i++) yield seg[i]; } });
  const first = rasterStrokeBox(l, s)!;
  const moved = { ...s, x: 20, y: 30 };
  expect(rasterStrokeBox(l, moved)).toEqual({ ...first, x: first.x + 20, y: first.y + 30 });
  const scaled = { ...l, width: l.width * 2, height: l.height * 2 };
  const box = rasterStrokeBox(scaled, moved)!;
  expect(box.w).toBeCloseTo(first.w * 2, 10);
  expect(box.h).toBeCloseTo(first.h * 2, 10);
  expect(iterations).toBe(1);
  const changed = { ...s, segments: [[10, 10, 90, 20, 6]] as RasterStroke['segments'] };
  expect(rasterStrokeBox(l, changed)!.w).toBeGreaterThan(first.w);
});

it('stroke bounds cache: a stroke that grows in place (painting) gets its new bounds, not the cached ones', () => {
  const layer = { x: 0, y: 0, width: 100, height: 100, pxWidth: 100, pxHeight: 100 } as unknown as RasterLayer;
  const stroke = { x: 0, y: 0, segments: [[0, 0, 10, 0, 2]] } as unknown as RasterStroke;
  const a = rasterStrokeBox(layer, stroke)!;
  (stroke.segments as unknown as number[][]).push([10, 0, 60, 40, 2]);
  const b = rasterStrokeBox(layer, stroke)!;
  expect(b.w).toBeGreaterThan(a.w);
  expect(b.h).toBeGreaterThan(a.h);
});

it('moving strokes recomposes from the first moving one on a reused canvas: same pixels, the old buffer untouched', () => {
  let l: RasterLayer = { ...layer(), paintStrokes: [stroke('a', 10), stroke('b', 80), stroke('c', 120)] };
  const bitmap = createCanvas(200, 100);
  (bitmap as unknown as { ops: unknown[] }).ops.push('existing image');
  raster.setBuffer(l.id, bitmap);
  l = { ...raster.withPaintBase(l), paintStrokes: l.paintStrokes };
  raster.composeRaster(l);
  const original = raster.getBuffer(l.id)!, before = [...ops(l.id)];
  const frame = raster.composeMoving(l, ['b'])!;
  let work: unknown;
  for (const dx of [5, 12, 30]) {
    const moved = moveRasterStroke(l, 'b', dx, 3);
    frame(moved);
    const fast = [...ops(l.id)];
    work ??= raster.getBuffer(l.id);
    expect(raster.getBuffer(l.id)).toBe(work); // one canvas for the whole drag
    raster.composeRaster(moved, false);
    expect(fast).toEqual(ops(l.id));
    raster.setBuffer(l.id, work as never, false);
  }
  expect(work).not.toBe(original);
  expect((original as unknown as { ops: unknown[] }).ops).toEqual(before);
});

