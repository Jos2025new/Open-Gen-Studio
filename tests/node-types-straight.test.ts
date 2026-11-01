import { expect, it } from 'vitest';
import { alignNode } from '../src/engine/design/nodeTypes';
import { nodeHandles, nodeSegs, type Seg } from '../src/engine/design/pathNodes';

const square = (): Seg[] => [{ c: 'M', p: [[0, 0]] }, { c: 'L', p: [[90, 0]] }, { c: 'L', p: [[90, 90]] }, { c: 'L', p: [[0, 90]] }, { c: 'Z', p: [] }];
const handles = (segs: Seg[], n: number) => { const h = nodeHandles(segs, n); return [h.in && segs[h.in[0]].p[h.in[1]], h.out && segs[h.out[0]].p[h.out[1]]]; };

it('smooth on a corner between two straight segments pulls out handles in one line (Inkscape)', () => {
  const out = alignNode(square(), 1, 's');
  const [a, b] = handles(out, 1);
  expect(a && b).toBeTruthy();
  // collinear through the node (90,0), each a third of its neighbour segment
  const cross = (a![0] - 90) * (b![1] - 0) - (a![1] - 0) * (b![0] - 90);
  expect(Math.abs(cross)).toBeLessThan(1e-6);
  expect(Math.hypot(a![0] - 90, a![1])).toBeCloseTo(30, 0);
  expect(nodeSegs(out).seg.length).toBe(4);
});

it('symmetric gives equal handles; the first and last node of a bare-Z closed path work too', () => {
  for (const n of [0, 3]) {
    const out = alignNode(square(), n, 'z');
    const [a, b] = handles(out, n);
    expect(a && b).toBeTruthy();
    const at = n === 0 ? [0, 0] : [0, 90];
    expect(Math.hypot(a![0] - at[0], a![1] - at[1])).toBeCloseTo(Math.hypot(b![0] - at[0], b![1] - at[1]), 6);
    expect(nodeSegs(out).seg.length).toBe(4);
  }
});

it('corner leaves the path alone', () => {
  expect(alignNode(square(), 1, 'c')).toEqual(square());
});
