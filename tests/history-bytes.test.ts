import { describe, expect, it } from 'vitest';
import { bytesOfSnapshots, trimByBytes } from '../src/engine/design/history';

type Snap = { buffers: Map<string, { width: number; height: number }> };
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

  it('does nothing while under the limit', () => {
    const past = [snap({ ...big }), snap({ ...big })];
    expect(trimByBytes(past, [], 1_000_000)).toBe(0);
    expect(past).toHaveLength(2);
  });
});
