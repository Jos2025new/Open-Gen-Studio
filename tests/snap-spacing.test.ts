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

  const perpendicularCases: [string, 'x' | 'y', { x: number; y: number; w: number; h: number }[], { x: number; y: number; w: number; h: number }, number][] = [
    ['below a horizontal reference pair', 'y', [{ x: 100, y: 100, w: 40, h: 40 }, { x: 180, y: 100, w: 40, h: 40 }], { x: 180, y: 184, w: 40, h: 40 }, -4],
    ['above a horizontal reference pair', 'y', [{ x: 100, y: 100, w: 40, h: 40 }, { x: 180, y: 100, w: 40, h: 40 }], { x: 180, y: 16, w: 40, h: 40 }, 4],
    ['right of a vertical reference pair', 'x', [{ x: 100, y: 100, w: 40, h: 40 }, { x: 100, y: 180, w: 40, h: 40 }], { x: 184, y: 180, w: 40, h: 40 }, -4],
    ['left of a vertical reference pair', 'x', [{ x: 100, y: 100, w: 40, h: 40 }, { x: 100, y: 180, w: 40, h: 40 }], { x: 16, y: 180, w: 40, h: 40 }, 4],
  ];
  it.each(perpendicularCases)('matches perpendicular equal gaps %s', (_name, axis, rawRefs, rawBox, expected) => {
    const r = equalSpacing(rawBox, rawRefs, 10, axis)!;
    expect(r).not.toBeNull();
    expect(r.d).toBe(expected);
    expect(r.measures.map((m) => m.label)).toEqual([40, 40]);
  });

  it('repeats a vertical reference gap below the right edge when the boxes touch in projection', () => {
    const refs = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 133, w: 300, h: 300 }];
    const moving = { x: 400, y: 470, w: 100, h: 100 }; // right edge of the large reference touches the moving box
    const r = equalSpacing(moving, refs, 10, 'y');
    expect(r).not.toBeNull();
    expect(moving.y + r!.d).toBe(466);
    expect(r!.measures.map((m) => m.label)).toEqual([33, 33]);
  });

  it('keeps the touching left-edge reflection and rejects a separated projection', () => {
    const refs = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 100, y: 133, w: 300, h: 300 }];
    const leftTouch = equalSpacing({ x: 0, y: 470, w: 100, h: 100 }, refs, 10, 'y');
    expect(leftTouch).not.toBeNull();
    expect(leftTouch!.measures.map((m) => m.label)).toEqual([33, 33]);
    expect(equalSpacing({ x: 400.1, y: 470, w: 100, h: 100 }, refs, 10, 'y')).toBeNull();
  });

  const blockerFixtures: [string, 'x' | 'y', { x: number; y: number; w: number; h: number }[], { x: number; y: number; w: number; h: number }, number][] = [
    ['below the smaller left endpoint (reported failure)', 'y', [{ x: 0, y: 0, w: 200, h: 300 }, { x: 233, y: 0, w: 430, h: 395 }], { x: -100, y: 337, w: 300, h: 250 }, 333],
    ['above the smaller left endpoint', 'y', [{ x: 0, y: 0, w: 200, h: 300 }, { x: 233, y: 0, w: 430, h: 395 }], { x: -100, y: -287, w: 300, h: 250 }, -283],
    ['below the larger right endpoint (positive capture)', 'y', [{ x: 0, y: 0, w: 200, h: 300 }, { x: 233, y: 0, w: 430, h: 395 }], { x: 333, y: 432, w: 300, h: 250 }, 428],
    ['above the larger right endpoint', 'y', [{ x: 0, y: 0, w: 200, h: 300 }, { x: 233, y: 0, w: 430, h: 395 }], { x: 333, y: -287, w: 300, h: 250 }, -283],
    ['below the smaller right endpoint after horizontal reflection', 'y', [{ x: 0, y: 0, w: 430, h: 395 }, { x: 463, y: 0, w: 200, h: 300 }], { x: 463, y: 337, w: 300, h: 250 }, 333],
    ['to the right of the upper endpoint after swapping axes', 'x', [{ x: 0, y: 0, w: 300, h: 200 }, { x: 0, y: 233, w: 395, h: 430 }], { x: 337, y: -100, w: 250, h: 300 }, 333],
  ];
  it.each(blockerFixtures)('matches the reference gap when another box is only an axis projection %s', (_name, axis, refs, box, expected) => {
    const r = equalSpacing(box, refs, 10, axis);
    expect(r).not.toBeNull();
    expect((axis === 'x' ? box.x : box.y) + r!.d).toBeCloseTo(expected, 9);
    expect(r!.measures.map((m) => m.label)).toEqual([33, 33]);
  });

  it('still blocks a repeated gap when a real box occupies the proposed gap', () => {
    const refs = [{ x: 0, y: 0, w: 200, h: 300 }, { x: 233, y: 0, w: 430, h: 395 }];
    const moving = { x: -100, y: 337, w: 300, h: 250 };
    const obstacle = { x: 0, y: 320, w: 100, h: 40 };
    expect(equalSpacing(moving, [...refs, obstacle], 10, 'y')).toBeNull();
  });

  it('nothing within the tolerance gives no spacing; boxes outside the band are ignored', () => {
    expect(equalSpacing(B(100), [B(0), B(30)], 5, 'x')).toBeNull();
    const off = { x: 0, y: 500, w: 10, h: 10 };
    expect(equalSpacing(B(17), [off, { ...off, x: 30 }], 10, 'x')).toBeNull();
  });
});
