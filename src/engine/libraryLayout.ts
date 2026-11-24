import { packRows } from '../lib/justifiedRows';
import { NODE_WIDTH } from './flow/graph-layout';

/* Where a board's images and texts go on the page when its nodes open as a document. Pure. */
export interface BoardItem { id: string; x: number; y: number; ratio?: number; text?: string }
export interface BoardBox { x: number; y: number; width: number; height: number; fontSize: number }
export interface BoardLayout { width: number; height: number; boxes: Map<string, BoardBox> }

const PAGE = 1920, MAX_PAGE = 4096, MARGIN = 80, GAP = 32, ROW = 460;

function natural(i: BoardItem): { w: number; h: number; fontSize: number } {
  if (i.ratio) return { w: NODE_WIDTH, h: NODE_WIDTH / i.ratio, fontSize: 0 };
  const tall = (fs: number) => (i.text ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil((l.length * fs * 0.6) / NODE_WIDTH)), 0) * fs * 1.3;
  let fontSize = 18;
  while (fontSize > 6 && tall(fontSize) > NODE_WIDTH * 1.5) fontSize--;
  return { w: NODE_WIDTH, h: Math.max(NODE_WIDTH / 3, tall(fontSize)), fontSize };
}

/** Nodes the user spread out keep that arrangement; piled or never-placed ones go in rows of equal height. */
export function boardLayout(items: readonly BoardItem[]): BoardLayout {
  const size = new Map(items.map((i) => [i.id, natural(i)]));
  const rects = items.map((i) => ({ id: i.id, x: i.x, y: i.y, ...size.get(i.id)! }));
  const piled = rects.some((a, n) => rects.slice(n + 1).some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  let placed = rects;
  if (piled) {
    let y = 0;
    placed = packRows(items.map((i) => ({ id: i.id, ratio: size.get(i.id)!.w / size.get(i.id)!.h })), PAGE - 2 * MARGIN, ROW, GAP).flatMap((row) => {
      let x = 0;
      const cells = row.cells.map((c) => { const s = size.get(c.id)!, out = { id: c.id, x, y, w: c.width, h: c.height, fontSize: s.fontSize * Math.min(c.width / s.w, c.height / s.h) }; x += c.width + GAP; return out; });
      y += row.height + GAP;
      return cells;
    });
  }
  const left = Math.min(...placed.map((r) => r.x)), top = Math.min(...placed.map((r) => r.y));
  const w = Math.max(...placed.map((r) => r.x + r.w)) - left, h = Math.max(...placed.map((r) => r.y + r.h)) - top;
  const k = Math.min(piled ? 1 : 3, (PAGE - 2 * MARGIN) / w, (MAX_PAGE - 2 * MARGIN) / h);
  const boxes = new Map(placed.map((r) => [r.id, {
    x: Math.round(MARGIN + (r.x - left) * k), y: Math.round(MARGIN + (r.y - top) * k), width: Math.round(r.w * k), height: Math.round(r.h * k), fontSize: Math.max(6, Math.round(r.fontSize * k)),
  }]));
  return { width: Math.round(w * k) + 2 * MARGIN, height: Math.round(h * k) + 2 * MARGIN, boxes };
}
