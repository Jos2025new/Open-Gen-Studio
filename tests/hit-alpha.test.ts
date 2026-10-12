import { beforeEach, expect, it, vi } from 'vitest';

const versions = vi.hoisted(() => ({ map: {} as Record<string, number> }));
vi.mock('../src/engine/design/raster', () => ({ bufferVersion: (id: string) => versions.map[id] ?? -1 }));

/** A canvas-like buffer whose alpha is set per pixel; getImageData counts as one GPU read. */
function fakeCanvas(w: number, h: number, opaque: Array<[number, number]>) {
  const reads = { count: 0 };
  const canvas = {
    width: w, height: h, reads,
    getContext: () => ({
      getImageData: (_x: number, _y: number, cw: number, ch: number) => {
        reads.count++;
        const data = new Uint8ClampedArray(cw * ch * 4);
        for (const [x, y] of opaque) data[(y * cw + x) * 4 + 3] = 255;
        return { data };
      },
    }),
  };
  return canvas as unknown as HTMLCanvasElement & { reads: { count: number } };
}

beforeEach(() => { versions.map = {}; });

it('reads a buffer once per content version and reuses the alpha until the pixels change', async () => {
  const { bufferAlpha, alphaReads } = await import('../src/engine/design/hitAlpha');
  alphaReads.count = 0;
  const buf = fakeCanvas(4, 3, [[2, 1]]);
  versions.map.layer = 1;
  const a = bufferAlpha('layer', buf);
  expect(a[1 * 4 + 2]).toBe(255);
  expect(a[0]).toBe(0);
  bufferAlpha('layer', buf); bufferAlpha('layer', buf);
  expect(buf.reads.count).toBe(1);
  versions.map.layer = 2;
  bufferAlpha('layer', buf);
  expect(buf.reads.count).toBe(2);
  expect(alphaReads.count).toBe(2);
});

it('does not reuse alpha across canvases that share a layer id', async () => {
  const { bufferAlpha } = await import('../src/engine/design/hitAlpha');
  versions.map.layer = 1;
  const first = fakeCanvas(2, 2, [[0, 0]]), second = fakeCanvas(2, 2, [[1, 1]]);
  expect(bufferAlpha('layer', first)[0]).toBe(255);
  expect(bufferAlpha('layer', second)[3]).toBe(255);
  expect(second.reads.count).toBe(1);
});
