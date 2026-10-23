import { afterEach, describe, expect, it, vi } from 'vitest';
import { pixelCanvas } from './helpers/pixelCanvas';
vi.hoisted(() => Object.assign(globalThis, { window: globalThis, document: { addEventListener() {} }, addEventListener() {} }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
vi.mock('../src/lib/media', async () => {
  const { pixelCanvas } = await import('./helpers/pixelCanvas');
  return { createCanvas: pixelCanvas, ctx2d: (c: HTMLCanvasElement) => c.getContext('2d'), canvasToBlob: async () => new Blob() };
});
const drawn = vi.hoisted(() => ({ layers: [] as Array<{ name: string; visible: boolean }> }));
vi.mock('../src/engine/design/render', async (orig) => ({ ...await orig<typeof import('../src/engine/design/render')>(), drawDoc: (_c: unknown, doc: { layers: Array<{ name: string; visible: boolean }> }) => { drawn.layers = doc.layers.map((l) => ({ name: l.name, visible: l.visible })); } }));
import { addDoc, getDoc, mergeDown } from '../src/engine/design/actions';
import { createDoc, newRasterLayer } from '../src/engine/design/doc';
import { useStore } from '../src/store/store';
import { setBuffer, flushRaster } from '../src/engine/design/raster';

afterEach(() => flushRaster());
const layer = (name: string, visible: boolean, fill: [number, number, number, number]) => {
  const l = { ...newRasterLayer(name, { x: 0, y: 0, width: 8, height: 8 }, { width: 8, height: 8 }), visible };
  const c = pixelCanvas(8, 8); c.getContext().fillRect(...fill);
  setBuffer(l.id, c as unknown as HTMLCanvasElement);
  return l;
};

describe('D20: merge down keeps what was visible', () => {
  it('a visible layer merged onto a hidden one stays visible and does not reveal the hidden pixels', async () => {
    const sid = useStore.getState().activeSessionId;
    const below = layer('Below', false, [0, 0, 8, 8]);
    const above = layer('Above', true, [0, 0, 2, 2]);
    const doc = { ...createDoc('merge', 8, 8), layers: [below, above], activeLayerId: above.id };
    addDoc(sid, doc);
    const id = await mergeDown(sid, doc.id, above.id);
    const out = getDoc(sid, doc.id)!.layers.find((l) => l.id === id)!;
    expect(out.visible).toBe(true);
    expect(drawn.layers).toEqual([{ name: 'Below', visible: false }, { name: 'Above', visible: true }]);
  });
  it('two hidden layers merge into a hidden layer that keeps both', async () => {
    const sid = useStore.getState().activeSessionId;
    const below = layer('Below', false, [0, 0, 8, 8]);
    const above = layer('Above', false, [0, 0, 2, 2]);
    const doc = { ...createDoc('merge2', 8, 8), layers: [below, above], activeLayerId: above.id };
    addDoc(sid, doc);
    const id = await mergeDown(sid, doc.id, above.id);
    expect(getDoc(sid, doc.id)!.layers.find((l) => l.id === id)!.visible).toBe(false);
    expect(drawn.layers.every((l) => l.visible)).toBe(true);
  });
});

import { toolBlockReason } from '../src/engine/design/rules';
import { paintCandidate } from '../src/components/designer/StagePaintCommit';
describe('D21: the eraser does not erase a hidden layer', () => {
  it('says why and has no target, like the brush', () => {
    const hidden = layer('Hidden', false, [0, 0, 8, 8]);
    expect(toolBlockReason('eraser', hidden)).toBe('"Hidden" is hidden. Show it to erase.');
    const doc = { ...createDoc('erase', 8, 8), layers: [hidden], activeLayerId: hidden.id };
    expect(paintCandidate(doc, true)).toBeNull();
    expect(toolBlockReason('eraser', { ...hidden, visible: true })).toBeNull();
  });
});
