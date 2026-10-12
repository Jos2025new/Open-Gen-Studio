import { beforeEach, expect, it, vi } from 'vitest';
import type { RasterStroke } from '../src/engine/types';
const made = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/lib/media', () => ({
  createCanvas: (width: number, height: number) => { made.count++; return { width, height }; },
  ctx2d: () => ({ createImageData: () => ({}), putImageData: () => undefined }),
}));
vi.mock('../src/engine/design/brushEngine', () => ({
  hexRgb: () => [1, 2, 3], stampSegment: () => undefined,
  segmentBox: (seg: number[]) => ({ x: 0, y: 0, w: seg[4], h: seg[4] }),
}));
beforeEach(() => { vi.resetModules(); made.count = 0; });
const stroke = (size = 10): RasterStroke => ({ id: 's', x: 0, y: 0, color: '#fff', opacity: 1, erase: false, tip: { hardness: .4 }, segments: [[0, 0, 1, 1, size]] });
it('reuses translated coverage but rebuilds for color, tip or geometry changes', async () => {
  const { rasterStrokeMask } = await import('../src/engine/design/rasterStrokeMask');
  const a = stroke(), first = rasterStrokeMask(a, a.tip!);
  expect(rasterStrokeMask({ ...a, x: 20, y: 50, opacity: .3, erase: true }, a.tip!).canvas).toBe(first.canvas);
  expect(made.count).toBe(1);
  rasterStrokeMask({ ...a, color: '#f00' }, a.tip!);
  rasterStrokeMask(a, { ...a.tip!, hardness: .8 });
  rasterStrokeMask({ ...a, segments: a.segments.map((s) => [...s]) }, a.tip!);
  expect(made.count).toBe(4);
});
it('evicts older coverage when pixel storage would exceed 16 million pixels', async () => {
  const { rasterStrokeMask } = await import('../src/engine/design/rasterStrokeMask');
  const a = stroke(3000), b = stroke(3000);
  rasterStrokeMask(a, a.tip!); rasterStrokeMask(b, b.tip!); rasterStrokeMask(b, b.tip!);
  expect(made.count).toBe(2);
  rasterStrokeMask(a, a.tip!); expect(made.count).toBe(3);
});
it('keeps every mask of a 300-stroke layer, so a cyclic walk does not rebuild them each frame', async () => {
  const { rasterStrokeMask } = await import('../src/engine/design/rasterStrokeMask');
  const ss = Array.from({ length: 300 }, () => stroke());
  for (const s of ss) rasterStrokeMask(s, s.tip!);
  expect(made.count).toBe(300);
  for (const s of ss) rasterStrokeMask({ ...s, x: 5 }, s.tip!);
  expect(made.count).toBe(300);
});
