import { describe, expect, it } from 'vitest';
import { equalSpacing } from '../src/engine/design/snap';

const B = (x: number, w = 10) => ({ x, y: 0, w, h: 10 });

describe('equal spacing: the gaps match a pair of neighbours', () => {
  it('a box dropped near the middle of two boxes snaps to equal gaps', () => {
    // Neighbours at 0–10 and 30–40: a gap of 20. A 10-wide box between them has equal gaps of 5 at x = 15.
    const r = equalSpacing(B(17, 10), [B(0), B(30)], 10, 'x')!;
    expect(17 + r.d).toBeCloseTo(15, 9);
    const gaps = r.measures.map((m) => m.label);
    expect(gaps[0]).toBeCloseTo(5, 9);
    expect(gaps[1]).toBeCloseTo(5, 9);
  });

  it('beyond the pair, the same gap as the pair is reproduced', () => {
    // Pair gap 10 (0–10 and 20–30); a box at 41 should sit at 40 (gap 10 after 30).
    const r = equalSpacing(B(41, 10), [B(0), B(20, 10)], 10, 'x')!;
    expect(41 + r.d).toBeCloseTo(40, 9);
  });

  it('shows equal horizontal gaps from separate visible rows without pairing every box', () => {
    const row = (x: number, y: number) => ({ x, y, w: 10, h: 10 });
    const references = [row(200, 100), row(230, 100), row(400, 200), row(430, 200), row(0, 500)];
    const r = equalSpacing(row(32, 500), references, 10, 'x')!;
    expect(32 + r.d).toBeCloseTo(30, 9); // the gap to the same-row neighbor becomes 20
    expect(r.measures.map((m) => m.label)).toEqual([20, 20, 20]);
    expect(r.measures.map((m) => m.a[1])).toEqual([105, 205, 505]); // each cota stays in its own row
  });

  it('compares vertical gaps from separate columns with the same local candidate bound', () => {
    const col = (x: number, y: number) => ({ x, y, w: 10, h: 10 });
    const references = [col(100, 200), col(100, 230), col(200, 400), col(200, 430), col(500, 0)];
    const r = equalSpacing(col(500, 32), references, 10, 'y')!;
    expect(32 + r.d).toBeCloseTo(30, 9);
    expect(r.measures.map((m) => m.label)).toEqual([20, 20, 20]);
    expect(r.measures.map((m) => m.a[0])).toEqual([105, 205, 505]); // each vertical cota stays in its own column
  });

  it('nothing within the tolerance gives no spacing; boxes outside the band are ignored', () => {
    expect(equalSpacing(B(100), [B(0), B(30)], 5, 'x')).toBeNull();
    const off = { x: 0, y: 500, w: 10, h: 10 };
    expect(equalSpacing(B(17), [off, { ...off, x: 30 }], 10, 'x')).toBeNull();
  });
});
