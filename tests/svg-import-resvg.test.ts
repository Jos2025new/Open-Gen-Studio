// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import * as resvg from '@resvg/resvg-wasm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* The real vector rasterizer (resvg-wasm) on the gradient shape of the Inkscape sample. Canvas is a recording double. */
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));
let pixels: { data: Uint8ClampedArray; width: number; height: number } | null = null;
vi.mock('../src/lib/media', () => ({
  createCanvas: (width: number, height: number) => ({ width, height, getContext: () => ({ putImageData: (d: typeof pixels) => { pixels = d; } }) }),
  ctx2d: (c: { getContext: () => unknown }) => c.getContext(),
}));

import { rasterizeWithResvg } from '../src/engine/design/svgImport/rasterize';
import { sanitizeSvg } from '../src/engine/design/svgImport/sanitize';
import { walkSvg } from '../src/engine/design/svgImport/structure';

beforeAll(async () => {
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
  await resvg.initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm'));
});

describe('resvg rasterizer', () => {
  it('draws the gradient shape alone at its own box, red on the left and blue on the right', async () => {
    const clean = sanitizeSvg(readFileSync('tests/fixtures/inkscape-sample.svg', 'utf8'));
    if ('error' in clean) throw new Error(clean.error);
    const walked = walkSvg(clean.root);
    const item = walked.items.find((i) => i.kind === 'raster' && i.reasons[0] === 'gradient');
    if (!item || item.kind !== 'raster') throw new Error('no gradient item');
    const k = 96 / 25.4;
    const out = await rasterizeWithResvg(item, walked, resvg);
    expect(out).not.toBeNull();
    expect(out!.engine).toBe('resvg');
    // The box is the shape's, grown by 1 and rounded out to whole pixels.
    expect(Math.abs(out!.box.x - (20 * k - 1))).toBeLessThan(1.01);
    expect(Math.abs(out!.box.y - (150 * k - 1))).toBeLessThan(1.01);
    expect(Math.abs(out!.box.w - (40 * k + 2))).toBeLessThan(2.1);
    const { data, width, height } = pixels!;
    const at = (x: number, y: number) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
    const left = at(4, height >> 1), right = at(width - 5, height >> 1);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(60);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(60);
    expect(left[3]).toBe(255);
    // Nothing else of the document is drawn: the 1 px margin around the shape is transparent.
    expect(at(0, 0)[3]).toBe(0);
  });
});
