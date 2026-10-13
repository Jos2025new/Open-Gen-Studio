import { describe, expect, it } from 'vitest';
import { bytesOfSnapshots, trimByBytes } from '../src/engine/design/history';

type ByteValue = { width: number; height: number };
type Snap = { buffers: Map<string, ByteValue & { tiles?: ReadonlyMap<unknown, ByteValue> }> };
const snap = (...canvases: Array<{ width: number; height: number }>): Snap => ({ buffers: new Map(canvases.map((c, i) => [`l${i}`, c])) });
const big = { width: 100, height: 100 }; // 40 000 bytes

describe('undo history in bytes (Paso 5)', () => {
  it('counts each canvas once, even when several steps share it (copy on write)', () => {
    const shared = { width: 10, height: 10 };
    expect(bytesOfSnapshots([snap(shared), snap(shared, big)])).toBe(400 + 40000);
  });

  it('drops the oldest undo steps beyond the limit and keeps the newest one', () => {
    const past = [snap({ ...big }), snap({ ...big }), snap({ ...big }), snap({ ...big })];
    const dropped = trimByBytes(past, [], 2 * 40000);
    expect(dropped).toBe(2);
    expect(past).toHaveLength(2);
  });

  it('never drops the last undo step, even if it alone exceeds the limit', () => {
    const past = [snap({ width: 1000, height: 1000 })];
    expect(trimByBytes(past, [], 10)).toBe(0);
    expect(past).toHaveLength(1);
  });

  it('counts redo steps against the limit too', () => {
    const past = [snap({ ...big }), snap({ ...big })];
    const future = [snap({ ...big }), snap({ ...big })];
    const dropped = trimByBytes(past, future, 3 * 40000);
    expect(dropped).toBe(1);
    expect(past).toHaveLength(1);
  });

  it('counts unique tile refs and actual partial-edge dimensions across history steps', () => {
    const shared = { width: 64, height: 64 };
    const changed = { width: 2, height: 64 };
    const before: Snap = { buffers: new Map([['layer', { width: 66, height: 64, tiles: new Map([['0:0', shared], ['1:0', changed]]) }]]) };
    const after: Snap = { buffers: new Map([['layer', { width: 66, height: 64, tiles: new Map([['0:0', shared], ['1:0', { width: 2, height: 64 }]]) }]]) };
    expect(bytesOfSnapshots([before, after])).toBe((64 * 64 + 2 * 64 + 2 * 64) * 4);
  });

  it('keeps the newest undo snapshot when its unique tile refs exceed the cap', () => {
    const tile = { width: 64, height: 64 };
    const past: Snap[] = [
      { buffers: new Map([['a', { width: 64, height: 64, tiles: new Map([['0:0', { ...tile }]]) }]]) },
      { buffers: new Map([['b', { width: 64, height: 64, tiles: new Map([['0:0', tile]]) }]]) },
    ];
    expect(trimByBytes(past, [], 1)).toBe(1);
    expect(past).toHaveLength(1);
    expect(bytesOfSnapshots(past)).toBe(64 * 64 * 4);
  });

  it('trims to the retained 512 MiB tile snapshot without dropping the last undo step', () => {
    const fullGrid = () => new Map(Array.from({ length: 128 * 128 }, (_, i) => [`${i % 128}:${Math.floor(i / 128)}`, { width: 64, height: 64 }]));
    const snapshot = (): Snap => ({ buffers: new Map([
      ['layer-a', { width: 8192, height: 8192, tiles: fullGrid() }],
      ['layer-b', { width: 8192, height: 8192, tiles: fullGrid() }],
    ]) });
    const past = [snapshot(), snapshot()];
    expect(trimByBytes(past, [], 512 * 1024 * 1024)).toBe(1);
    expect(past).toHaveLength(1);
    expect(bytesOfSnapshots(past)).toBe(512 * 1024 * 1024);
  });

  it('does nothing while under the limit', () => {
    const past = [snap({ ...big }), snap({ ...big })];
    expect(trimByBytes(past, [], 1_000_000)).toBe(0);
    expect(past).toHaveLength(2);
  });
});
