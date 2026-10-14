import { describe, expect, it } from 'vitest';
import { MIN_UNDO_STEPS, bytesOfSnapshots, trimByBytes } from '../src/engine/design/history';

type ByteValue = { width: number; height: number };
type Snap = { buffers: Map<string, ByteValue & { tiles?: ReadonlyMap<unknown, ByteValue> }> };
const snap = (...canvases: Array<{ width: number; height: number }>): Snap => ({ buffers: new Map(canvases.map((c, i) => [`l${i}`, c])) });
const big = { width: 100, height: 100 }; // 40 000 bytes

describe('undo history in bytes (Paso 5)', () => {
  it('counts each canvas once, even when several steps share it (copy on write)', () => {
    const shared = { width: 10, height: 10 };
    expect(bytesOfSnapshots([snap(shared), snap(shared, big)])).toBe(400 + 40000);
  });

  it('keeps at least MIN_UNDO_STEPS (3) undo steps, dropping the oldest beyond the limit', () => {
    expect(MIN_UNDO_STEPS).toBe(3);
    const past = [snap({ ...big }), snap({ ...big }), snap({ ...big }), snap({ ...big }), snap({ ...big })];
    const dropped = trimByBytes(past, [], 2 * 40000);
    expect(dropped).toBe(2);
    expect(past).toHaveLength(3);
  });

  it('keeps 3 undo steps even when they alone exceed the limit', () => {
    const past = [snap({ width: 1000, height: 1000 }), snap({ width: 1000, height: 1000 }), snap({ width: 1000, height: 1000 })];
    expect(trimByBytes(past, [], 10)).toBe(0);
    expect(past).toHaveLength(3);
  });

  it('keeps the newest 3 undo steps when the limit is 0', () => {
    const past = [snap({ ...big }), snap({ ...big }), snap({ ...big }), snap({ ...big })];
    expect(trimByBytes(past, [], 0)).toBe(1);
    expect(past).toHaveLength(3);
  });

  it('counts redo steps against the limit too, while keeping 3 undo steps', () => {
    const past = [snap({ ...big }), snap({ ...big }), snap({ ...big }), snap({ ...big })];
    const future = [snap({ ...big }), snap({ ...big })];
    const dropped = trimByBytes(past, future, 5 * 40000);
    expect(dropped).toBe(1);
    expect(past).toHaveLength(3);
  });

  it('counts unique tile refs and actual partial-edge dimensions across history steps', () => {
    const shared = { width: 64, height: 64 };
    const changed = { width: 2, height: 64 };
    const before: Snap = { buffers: new Map([['layer', { width: 66, height: 64, tiles: new Map([['0:0', shared], ['1:0', changed]]) }]]) };
    const after: Snap = { buffers: new Map([['layer', { width: 66, height: 64, tiles: new Map([['0:0', shared], ['1:0', { width: 2, height: 64 }]]) }]]) };
    expect(bytesOfSnapshots([before, after])).toBe((64 * 64 + 2 * 64 + 2 * 64) * 4);
  });

  it('keeps the 3 newest undo snapshots even when their unique tile refs exceed the cap', () => {
    const tile = { width: 64, height: 64 };
    const past: Snap[] = [0, 1, 2, 3].map((i) => ({ buffers: new Map([[`l${i}`, { width: 64, height: 64, tiles: new Map([['0:0', tile]]) }]]) }));
    expect(trimByBytes(past, [], 1)).toBe(1);
    expect(past).toHaveLength(3);
  });

  it('does not drop below 3 undo snapshots at the 512 MiB tile cap', () => {
    const fullGrid = () => new Map(Array.from({ length: 128 * 128 }, (_, i) => [`${i % 128}:${Math.floor(i / 128)}`, { width: 64, height: 64 }]));
    const snapshot = (): Snap => ({ buffers: new Map([
      ['layer-a', { width: 8192, height: 8192, tiles: fullGrid() }],
      ['layer-b', { width: 8192, height: 8192, tiles: fullGrid() }],
    ]) });
    const past = [snapshot(), snapshot()];
    expect(trimByBytes(past, [], 512 * 1024 * 1024)).toBe(0);
    expect(past).toHaveLength(2);
  });

  it('does nothing while under the limit', () => {
    const past = [snap({ ...big }), snap({ ...big })];
    expect(trimByBytes(past, [], 1_000_000)).toBe(0);
    expect(past).toHaveLength(2);
  });
});
