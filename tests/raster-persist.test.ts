import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Timers go through `window`, which is the (faked) global here; tab events are captured to fire them by hand.
const events = vi.hoisted(() => {
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  const on = (type: string, fn: (e: unknown) => void) => ((handlers[type] ??= []).push(fn), undefined);
  const doc = { visibilityState: 'visible', addEventListener: on };
  Object.assign(globalThis, { window: globalThis, document: doc, addEventListener: on });
  return { handlers, doc };
});

const stored = new Map<string, string>();
const writes: string[] = [];
let failNext = 0;
vi.mock('../src/lib/idb', () => ({
  stateDb: { get: async () => undefined, set: async () => undefined, del: async () => undefined },
  cacheDb: { get: async () => undefined, set: async () => undefined },
  blobDb: {
    get: async () => undefined,
    set: async (key: string, blob: Blob & { tag?: string }) => {
      if (failNext > 0) {
        failNext--;
        throw new Error('QuotaExceededError');
      }
      writes.push(`${key}=${blob.tag}`);
      stored.set(key, blob.tag ?? '');
    },
    delMany: async (keys: string[]) => keys.forEach((k) => stored.delete(k)),
  },
}));
// A canvas is a plain object; its "pixels" are a tag the fake PNG encoder copies.
vi.mock('../src/lib/media', () => ({
  createCanvas: (w: number, h: number) => ({ width: w, height: h, tag: 'blank' }),
  ctx2d: () => ({ drawImage: () => undefined }),
  canvasToBlob: async (c: { tag: string }) => Object.assign(new Blob(['x']), { tag: c.tag }),
  blobToCanvas: async () => ({ width: 1, height: 1 }),
}));

import { commitEdit, deleteBuffers, flushRaster, pendingRaster, setBuffer } from '../src/engine/design/raster';
import { useStore } from '../src/store/store';

const canvas = (tag: string) => ({ width: 4, height: 4, tag }) as unknown as HTMLCanvasElement;
const fire = (type: string, e: unknown = {}) => (events.handlers[type] ?? []).forEach((fn) => fn(e));
const settle = () => vi.runAllTimersAsync();

beforeEach(() => {
  vi.useFakeTimers();
  stored.clear();
  writes.length = 0;
  failNext = 0;
});
afterEach(async () => {
  await deleteBuffers(pendingRaster());
  vi.useRealTimers();
});

describe('raster saving (D1–D3)', () => {
  it('writes 700 ms after the last change, only the latest pixels, and then nothing is pending', async () => {
    setBuffer('a', canvas('v1'));
    await vi.advanceTimersByTimeAsync(300);
    setBuffer('a', canvas('v2'));
    expect(pendingRaster()).toEqual(['a']);
    await settle();
    expect(writes).toEqual(['raster:a=v2']);
    expect(pendingRaster()).toEqual([]);
  });

  it('an edit made while a write runs keeps the layer pending and is written after it, in order', async () => {
    setBuffer('b', canvas('old'));
    const first = flushRaster();
    setBuffer('b', canvas('new'));
    await first;
    expect(pendingRaster()).toEqual(['b']);
    await settle();
    // Each write reads the latest pixels when it runs; the last one written is the newest, never an older one.
    expect(writes.at(-1)).toBe('raster:b=new');
    expect(stored.get('raster:b')).toBe('new');
    expect(pendingRaster()).toEqual([]);
  });

  it('hiding the tab writes at once; closing with unsaved pixels asks the browser to confirm', async () => {
    setBuffer('c', canvas('draw'));
    const e = { preventDefault: vi.fn(), returnValue: 'x' };
    fire('beforeunload', e);
    expect(e.preventDefault).toHaveBeenCalled();
    events.doc.visibilityState = 'hidden';
    fire('visibilitychange');
    events.doc.visibilityState = 'visible';
    await flushRaster();
    expect(stored.get('raster:c')).toBe('draw');
    const later = { preventDefault: vi.fn(), returnValue: 'x' };
    fire('beforeunload', later);
    expect(later.preventDefault).not.toHaveBeenCalled();
  });

  it('a failed write stays pending, is reported once and succeeds on the next try', async () => {
    useStore.setState((s) => ({ ui: { ...s.ui, toasts: [] } }));
    failNext = 2;
    setBuffer('d', canvas('p1'));
    await vi.advanceTimersByTimeAsync(800);
    commitEdit('d');
    await vi.advanceTimersByTimeAsync(800);
    expect(pendingRaster()).toEqual(['d']);
    expect(useStore.getState().ui.toasts.filter((t) => /Could not save layer pixels/.test(t.text))).toHaveLength(1);
    await flushRaster();
    expect(stored.get('raster:d')).toBe('p1');
    expect(pendingRaster()).toEqual([]);
  });

  it('deleting a layer waits for its write, so its pixels do not come back', async () => {
    setBuffer('e', canvas('gone'));
    const writing = flushRaster();
    await deleteBuffers(['e']);
    await writing;
    expect(stored.has('raster:e')).toBe(false);
    expect(pendingRaster()).toEqual([]);
  });
});
