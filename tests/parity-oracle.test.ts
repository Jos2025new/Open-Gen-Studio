import { describe, expect, it } from 'vitest';
import { compareArrays } from '../bench/engines/parity';
import { PARITY_SIZE, parityDocument } from '../bench/engines/parity-docs';

describe('parity oracle: comparison', () => {
  it('reports zero difference for identical pixels and counts each differing channel', () => {
    const a = new Uint8ClampedArray([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(compareArrays(a, new Uint8ClampedArray(a))).toEqual({ maxChannelDiff: 0, differingChannels: 0, totalChannels: 8 });
    const b = new Uint8ClampedArray([1, 2, 4, 4, 5, 9, 7, 8]);
    expect(compareArrays(a, b)).toEqual({ maxChannelDiff: 3, differingChannels: 2, totalChannels: 8 });
  });
});

describe('parity oracle: synthetic document', () => {
  it('is deterministic and covers every feature the optimized paths must keep', () => {
    const first = parityDocument().doc, second = parityDocument().doc;
    expect(JSON.stringify(first.layers)).toBe(JSON.stringify(second.layers));
    expect(first.width).toBe(PARITY_SIZE);
    const modes = new Set(first.layers.map((l) => l.blend));
    for (const m of ['multiply', 'screen', 'overlay', 'difference']) expect(modes.has(m as never)).toBe(true);
    expect(first.layers.some((l) => l.type === 'fx' && l.scope === 'layer')).toBe(true);
    expect(first.layers.some((l) => l.type === 'fx' && l.scope === 'below')).toBe(true);
    expect(first.layers.some((l) => l.type === 'vector')).toBe(true);
    expect(first.layers.some((l) => !l.visible)).toBe(true);
    const strokes = first.layers.flatMap((l) => (l.type === 'raster' ? l.paintStrokes ?? [] : []));
    expect(strokes.some((s) => s.erase)).toBe(true);
    expect(strokes.some((s) => s.tip?.blend === 'multiply')).toBe(true);
    expect(strokes.some((s) => s.tip?.keepOpacity)).toBe(true);
  });
});
