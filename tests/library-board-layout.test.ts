import { describe, expect, it } from 'vitest';
import { boardLayout, type BoardItem } from '../src/engine/libraryLayout';

const overlaps = (items: readonly BoardItem[]) => {
  const b = [...boardLayout(items).boxes.values()];
  return b.some((p, i) => b.slice(i + 1).some((q) => p.x < q.x + q.width - 1 && q.x < p.x + p.width - 1 && p.y < q.y + q.height - 1 && q.y < p.y + p.height - 1));
};

describe('boardLayout: where a moodboard goes on the page', () => {
  it('keeps the arrangement the user made in Nodes', () => {
    const { boxes, width, height } = boardLayout([
      { id: 'a', x: 1000, y: 500, ratio: 1 }, { id: 'b', x: 1400, y: 500, ratio: 1 }, { id: 'note', x: 1000, y: 900, text: 'Oak' },
    ]);
    const [a, b, note] = ['a', 'b', 'note'].map((id) => boxes.get(id)!);
    expect(a.y).toBe(b.y);
    expect(b.x - a.x).toBeGreaterThan(a.width);
    expect(note.x).toBe(a.x);
    expect(note.y).toBeGreaterThan(a.y + a.height);
    expect(Math.min(a.x, a.y)).toBe(80);
    expect(width).toBeLessThanOrEqual(1920);
    expect(height).toBeLessThanOrEqual(4096);
  });

  it('puts piled nodes (Add to moodboard) in rows without overlap, at any count', () => {
    for (const n of [2, 3, 7, 40, 200]) {
      const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, x: 0, y: 0, ratio: [1, 16 / 9, 0.6, 6, 0.1][i % 5] }));
      const { width, height } = boardLayout(items);
      expect(overlaps(items)).toBe(false);
      expect(width <= 1921 && height <= 4097).toBe(true);
    }
  });

  it('a long text keeps inside its own box', () => {
    const text = 'inspiration '.repeat(60);
    const items = [{ id: 'a', x: 0, y: 0, ratio: 1 }, { id: 'b', x: 0, y: 0, ratio: 1 }, { id: 't', x: 0, y: 0, text }];
    const t = boardLayout(items).boxes.get('t')!;
    const lines = Math.ceil((text.length * t.fontSize * 0.5) / t.width);
    expect(overlaps(items)).toBe(false);
    expect(lines * t.fontSize * 1.3).toBeLessThanOrEqual(t.height * 1.15);
  });
});
