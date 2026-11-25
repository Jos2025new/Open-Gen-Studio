import { isOmniSpace } from '../nodes/omniSpaces';
import type { GraphEdge, GraphNode, GraphNodeData } from '../types';

/* Node editor layout: sizes, rectangles, free-position search and auto layout. */

export const NODE_WIDTH = 260;

/** Width in flow coordinates for a node (matches RefNode / omni cards). */
export function nodeWidth(data: GraphNodeData): number {
  if (data.kind === 'ref') {
    if (data.type === 'chat') return 440;
    if (data.type === 'space' && isOmniSpace(data.ref)) return 320;
  }
  return NODE_WIDTH;
}

export function estimatedHeight(data: GraphNodeData): number {
  if (data.kind === 'text') return 170;
  if (data.kind === 'ref') return data.type === 'chat' ? 560 : data.type === 'space' && isOmniSpace(data.ref) ? 360 : 220;
  return 220;
}

/** `panel`: the floating composer zone under the card when it has one (see `panelZone`); set by `nodeRect`, never part of the card box. */
export interface NodeRect { x: number; y: number; width: number; height: number; panel?: NodeRect | null }

/** Bounding box in flow coordinates using measured dimensions when available. */
export function nodeRect(node: GraphNode, measured?: Map<string, { width: number; height: number }>): NodeRect {
  const m = measured?.get(node.id);
  const rect: NodeRect = { x: node.position.x, y: node.position.y, width: m?.width ?? nodeWidth(node.data), height: m?.height ?? estimatedHeight(node.data) };
  const panel = panelZone(node.data, rect);
  return panel ? { ...rect, panel } : rect;
}

/** Whether two rectangles intersect when padded by `(gapX, gapY)`. */
export function rectsOverlap(a: NodeRect, b: NodeRect, gapX = 0, gapY = 0): boolean {
  return a.x < b.x + b.width + gapX && a.x + a.width + gapX > b.x && a.y < b.y + b.height + gapY && a.y + a.height + gapY > b.y;
}

const finite = (n: number) => Number.isFinite(n);
const finiteRect = (r: NodeRect) => finite(r.x) && finite(r.y) && finite(r.width) && finite(r.height);

const CELL = 512;
const CELL_BIAS = 16384;
const MAX_CELL_SPAN = 16;
// 30-bit Smi key (fits in V8 31-bit Smi without HeapNumber allocation for ±8M px canvases).
const cellKey = (cx: number, cy: number) => ((cx + CELL_BIAS) << 15) | (cy + CELL_BIAS);

function listIsClear(
  list: readonly NodeRect[],
  x: number, y: number, rx1: number, ry1: number,
  px0: number, py0: number, px1: number, py1: number,
  own: NodeRect | null, ox0: number, oy0: number, ox1: number, oy1: number,
): boolean {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (px0 < o.x + o.width && px1 > o.x && py0 < o.y + o.height && py1 > o.y) return false;
    const p = o.panel;
    if (p && x < p.x + p.width && rx1 > p.x && y < p.y + p.height && ry1 > p.y) return false;
    if (own && ox0 < o.x + o.width && ox1 > o.x && oy0 < o.y + o.height && oy1 > o.y) return false;
  }
  return true;
}

interface RingHint {
  dx0: number; dy0: number; sw: number; sh: number; gapX: number; gapY: number;
  ownX: number; ownY: number; ownW: number; ownH: number; hasOwn: boolean;
  minRing: number;
  cap: number;
  blocked: Uint8Array;
  rightX: number;
  leftX: number;
  downY: number;
  upY: number;
}

function makeHintBlocked(cap: number, prev?: { cap: number; blocked: Uint8Array }): Uint8Array {
  const side = cap * 2 + 1;
  const next = new Uint8Array(side * side);
  if (prev) {
    const oldSide = prev.cap * 2 + 1;
    for (let gy = -prev.cap; gy <= prev.cap; gy++) {
      const srcRow = (gy + prev.cap) * oldSide + prev.cap;
      const dstRow = (gy + cap) * side + cap;
      for (let gx = -prev.cap; gx <= prev.cap; gx++) next[dstRow + gx] = prev.blocked[srcRow + gx];
    }
  }
  return next;
}

let ivLo = new Float64Array(256);
let ivHi = new Float64Array(256);

function ensureIvCap(len: number): void {
  if (ivLo.length >= len) return;
  const next = Math.max(len, ivLo.length * 2);
  const nLo = new Float64Array(next);
  const nHi = new Float64Array(next);
  nLo.set(ivLo);
  nHi.set(ivHi);
  ivLo = nLo;
  ivHi = nHi;
}

/** Advance `start` in the positive direction past any overlapping open intervals `[lo, hi]` in `ivLo`/`ivHi`. */
function advanceClearRight(start: number, count: number, limit: number): number {
  let cur = start;
  for (let pass = 0; pass < count; pass++) {
    let moved = false;
    for (let i = 0; i < count; i++) {
      if (ivLo[i] < cur && ivHi[i] > cur) {
        cur = ivHi[i];
        if (cur > limit) return cur;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return cur;
}

/** Retreat `start` in the negative direction past any overlapping open intervals `[lo, hi]` in `ivLo`/`ivHi`. */
function advanceClearLeft(start: number, count: number, limit: number): number {
  let cur = start;
  for (let pass = 0; pass < count; pass++) {
    let moved = false;
    for (let i = 0; i < count; i++) {
      if (ivLo[i] < cur && ivHi[i] > cur) {
        cur = ivLo[i];
        if (cur < limit) return cur;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return cur;
}

/** Cell-hash spatial index storing cards and panels by 512 px cells so overlap and strip queries are O(1) / O(sqrt(N)). */
class SpatialGrid {
  private cells = new Map<number, NodeRect[]>();
  private large: NodeRect[] = [];
  readonly cards: NodeRect[] = [];
  bottom = -Infinity;
  hint: RingHint | null = null;

  private addBox(o: NodeRect, x0: number, y0: number, x1: number, y1: number, skipX0 = 1, skipX1 = 0, skipY0 = 1, skipY1 = 0): void {
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    if (cx0 < -CELL_BIAS || cx1 >= CELL_BIAS || cy0 < -CELL_BIAS || cy1 >= CELL_BIAS || (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELL_SPAN) {
      if (this.large[this.large.length - 1] !== o) this.large.push(o);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        if (cx >= skipX0 && cx <= skipX1 && cy >= skipY0 && cy <= skipY1) continue;
        const k = cellKey(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(o);
        else this.cells.set(k, [o]);
      }
    }
  }

  add(o: NodeRect): void {
    if (!finiteRect(o)) return;
    const p = o.panel && finiteRect(o.panel) ? o.panel : null;
    const rec = p === o.panel ? o : { x: o.x, y: o.y, width: o.width, height: o.height };
    this.cards.push(rec);
    if (rec.y + rec.height > this.bottom) this.bottom = rec.y + rec.height;
    const cx0 = Math.floor(rec.x / CELL), cx1 = Math.floor((rec.x + rec.width) / CELL);
    const cy0 = Math.floor(rec.y / CELL), cy1 = Math.floor((rec.y + rec.height) / CELL);
    const cardNormal = cx0 >= -CELL_BIAS && cx1 < CELL_BIAS && cy0 >= -CELL_BIAS && cy1 < CELL_BIAS && (cx1 - cx0 + 1) * (cy1 - cy0 + 1) <= MAX_CELL_SPAN;
    this.addBox(rec, rec.x, rec.y, rec.x + rec.width, rec.y + rec.height);
    if (p) {
      if (cardNormal) this.addBox(rec, p.x, p.y, p.x + p.width, p.y + p.height, cx0, cx1, cy0, cy1);
      else this.addBox(rec, p.x, p.y, p.x + p.width, p.y + p.height);
    }
  }

  isClear(x: number, y: number, sw: number, sh: number, gapX: number, gapY: number, own: NodeRect | null): boolean {
    const px0 = x - gapX, px1 = x + sw + gapX;
    const py0 = y - gapY, py1 = y + sh + gapY;
    const rx1 = x + sw, ry1 = y + sh;
    const ox0 = own ? x + own.x : 0, ox1 = own ? ox0 + own.width : 0;
    const oy0 = own ? y + own.y : 0, oy1 = own ? oy0 + own.height : 0;
    if (this.large.length && !listIsClear(this.large, x, y, rx1, ry1, px0, py0, px1, py1, own, ox0, oy0, ox1, oy1)) return false;
    const qx0 = own && ox0 < px0 ? ox0 : px0;
    const qy0 = own && oy0 < py0 ? oy0 : py0;
    const qx1 = own && ox1 > px1 ? ox1 : px1;
    const qy1 = own && oy1 > py1 ? oy1 : py1;
    const cx0 = Math.floor(qx0 / CELL), cx1 = Math.floor(qx1 / CELL);
    const cy0 = Math.floor(qy0 / CELL), cy1 = Math.floor(qy1 / CELL);
    if (cx0 < -CELL_BIAS || cx1 >= CELL_BIAS || cy0 < -CELL_BIAS || cy1 >= CELL_BIAS || (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > MAX_CELL_SPAN * 4) {
      return listIsClear(this.cards, x, y, rx1, ry1, px0, py0, px1, py1, own, ox0, oy0, ox1, oy1);
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (bucket && !listIsClear(bucket, x, y, rx1, ry1, px0, py0, px1, py1, own, ox0, oy0, ox1, oy1)) return false;
      }
    }
    return true;
  }

  forEachInBox(x0: number, y0: number, x1: number, y1: number, visit: (o: NodeRect) => void): void {
    for (let i = 0; i < this.large.length; i++) visit(this.large[i]);
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cy0 = Math.floor(y0 / CELL), cy1 = Math.floor(y1 / CELL);
    if (cx0 < -CELL_BIAS || cx1 >= CELL_BIAS || cy0 < -CELL_BIAS || cy1 >= CELL_BIAS || (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 256) {
      for (let i = 0; i < this.cards.length; i++) visit(this.cards[i]);
      return;
    }
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = this.cells.get(cellKey(cx, cy));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) visit(bucket[i]);
      }
    }
  }
}

interface GridCacheEntry {
  grid: SpatialGrid;
  len: number;
  first: NodeRect | undefined;
  firstX: number; firstY: number; firstW: number; firstH: number;
  last: NodeRect | undefined;
  lastX: number; lastY: number; lastW: number; lastH: number;
}

const gridCache = new WeakMap<readonly NodeRect[], GridCacheEntry>();

function gridForOccupied(occupied: readonly NodeRect[]): SpatialGrid {
  const len = occupied.length;
  const cached = gridCache.get(occupied);
  if (cached && len >= cached.len) {
    const f = occupied[0];
    const l = cached.len > 0 ? occupied[cached.len - 1] : undefined;
    const sameFirst = cached.len === 0 || (f !== undefined && f === cached.first && f.x === cached.firstX && f.y === cached.firstY && f.width === cached.firstW && f.height === cached.firstH);
    const sameLast = cached.len === 0 || (l !== undefined && l === cached.last && l.x === cached.lastX && l.y === cached.lastY && l.width === cached.lastW && l.height === cached.lastH);
    if (sameFirst && sameLast) {
      for (let i = cached.len; i < len; i++) cached.grid.add(occupied[i]);
      cached.len = len;
      if (len > 0) {
        const nf = occupied[0], nl = occupied[len - 1];
        cached.first = nf; cached.firstX = nf.x; cached.firstY = nf.y; cached.firstW = nf.width; cached.firstH = nf.height;
        cached.last = nl; cached.lastX = nl.x; cached.lastY = nl.y; cached.lastW = nl.width; cached.lastH = nl.height;
      }
      return cached.grid;
    }
  }
  const grid = new SpatialGrid();
  for (let i = 0; i < len; i++) grid.add(occupied[i]);
  const f = len > 0 ? occupied[0] : undefined;
  const l = len > 0 ? occupied[len - 1] : undefined;
  gridCache.set(occupied, {
    grid, len,
    first: f, firstX: f?.x ?? 0, firstY: f?.y ?? 0, firstW: f?.width ?? 0, firstH: f?.height ?? 0,
    last: l, lastX: l?.x ?? 0, lastY: l?.y ?? 0, lastW: l?.width ?? 0, lastH: l?.height ?? 0,
  });
  return grid;
}

function findFreePositionInGrid(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  grid: SpatialGrid,
  opts?: { gapX?: number; gapY?: number; preferRight?: boolean; panel?: NodeRect | null },
): { x: number; y: number } {
  const gapX = opts?.gapX ?? 48;
  const gapY = opts?.gapY ?? 56;
  const preferRight = Boolean(opts?.preferRight);
  // A non-finite coordinate (an unmeasured pointer, an imported node) never reaches the result: the desired one falls to the origin, a broken rect is ignored.
  if (!finite(desired.x) || !finite(desired.y)) desired = { x: finite(desired.x) ? desired.x : 0, y: finite(desired.y) ? desired.y : 0 };
  if (!grid.cards.length) return desired;
  const dx0 = desired.x, dy0 = desired.y;
  const sw = size.width, sh = size.height;
  const own = opts?.panel && finiteRect(opts.panel) ? opts.panel : null;
  if (grid.isClear(dx0, dy0, sw, sh, gapX, gapY, own)) return desired;

  const stepX = sw + gapX;
  const stepY = sh + gapY;
  const minStep = Math.min(stepX, stepY);
  let bestDist = Infinity;
  let bestDx = -Infinity;
  let bestX = dx0;
  let bestY = dy0;
  let found = false;

  // Monotonic ring hint: on an append-only grid with the same query shape, rings/cells already proved blocked stay blocked.
  const ownX = own ? own.x : 0, ownY = own ? own.y : 0, ownW = own ? own.width : 0, ownH = own ? own.height : 0;
  const hasOwn = own !== null;
  const maxRing = Math.max(8, Math.ceil(Math.sqrt(grid.cards.length)) + 6);
  let hint = grid.hint;
  if (
    !hint || hint.dx0 !== dx0 || hint.dy0 !== dy0 || hint.sw !== sw || hint.sh !== sh || hint.gapX !== gapX || hint.gapY !== gapY ||
    hint.hasOwn !== hasOwn || hint.ownX !== ownX || hint.ownY !== ownY || hint.ownW !== ownW || hint.ownH !== ownH
  ) {
    const cap = Math.max(16, maxRing);
    hint = {
      dx0, dy0, sw, sh, gapX, gapY, ownX, ownY, ownW, ownH, hasOwn,
      minRing: 1, cap, blocked: makeHintBlocked(cap),
      rightX: dx0, leftX: dx0, downY: dy0, upY: dy0,
    };
    grid.hint = hint;
  } else if (hint.cap < maxRing) {
    const cap = Math.max(hint.cap * 2, maxRing);
    hint.blocked = makeHintBlocked(cap, hint);
    hint.cap = cap;
  }
  const hCap = hint.cap;
  const hSide = hCap * 2 + 1;
  const hBlocked = hint.blocked;

  const tryRingCell = (gx: number, gy: number, x: number, y: number): boolean => {
    const idx = (gy + hCap) * hSide + hCap + gx;
    if (hBlocked[idx]) return false;
    const dx = x - dx0;
    const dy = y - dy0;
    const dist = dx * dx + dy * dy;
    if (dist > bestDist) return false;
    if (dist === bestDist && (!preferRight || dx <= bestDx)) return false;
    if (!grid.isClear(x, y, sw, sh, gapX, gapY, own)) {
      hBlocked[idx] = 1;
      return false;
    }
    bestDist = dist;
    bestDx = dx;
    bestX = x;
    bestY = y;
    found = true;
    return true;
  };

  let nextMinRing = hint.minRing;
  for (let r = hint.minRing; r <= maxRing; r++) {
    if (found && r * minStep * (r * minStep) > bestDist) break;
    const rStepX = r * stepX;
    const rStepY = r * stepY;
    let anyClearInRing = false;
    if (tryRingCell(0, -r, dx0, dy0 - rStepY)) anyClearInRing = true;
    if (tryRingCell(0, r, dx0, dy0 + rStepY)) anyClearInRing = true;
    if (tryRingCell(r, 0, dx0 + rStepX, dy0)) anyClearInRing = true;
    if (tryRingCell(-r, 0, dx0 - rStepX, dy0)) anyClearInRing = true;
    for (let g = 1; g <= r; g++) {
      const gxStep = g * stepX;
      if (gxStep * gxStep + rStepY * rStepY <= bestDist) {
        if (tryRingCell(g, -r, dx0 + gxStep, dy0 - rStepY)) anyClearInRing = true;
        if (tryRingCell(-g, -r, dx0 - gxStep, dy0 - rStepY)) anyClearInRing = true;
        if (tryRingCell(g, r, dx0 + gxStep, dy0 + rStepY)) anyClearInRing = true;
        if (tryRingCell(-g, r, dx0 - gxStep, dy0 + rStepY)) anyClearInRing = true;
      }
      if (g < r) {
        const gyStep = g * stepY;
        if (rStepX * rStepX + gyStep * gyStep <= bestDist) {
          if (tryRingCell(r, g, dx0 + rStepX, dy0 + gyStep)) anyClearInRing = true;
          if (tryRingCell(-r, g, dx0 - rStepX, dy0 + gyStep)) anyClearInRing = true;
          if (tryRingCell(r, -g, dx0 + rStepX, dy0 - gyStep)) anyClearInRing = true;
          if (tryRingCell(-r, -g, dx0 - rStepX, dy0 - gyStep)) anyClearInRing = true;
        }
      }
    }
    if (!found && !anyClearInRing && r === nextMinRing) nextMinRing = r + 1;
  }
  hint.minRing = nextMinRing;

  // 2. Monotonic 1D interval sweep along the desired horizontal and vertical strips: each cursor only advances outward.
  const stripY0 = dy0 - gapY, stripY1 = dy0 + sh + gapY;
  const stripX0 = dx0 - gapX, stripX1 = dx0 + sw + gapX;
  const ownY0 = own ? dy0 + own.y : stripY0, ownY1 = own ? ownY0 + own.height : stripY1;
  const ownX0 = own ? dx0 + own.x : stripX0, ownX1 = own ? ownX0 + own.width : stripX1;
  const bandY0 = ownY0 < stripY0 ? ownY0 : stripY0;
  const bandY1 = ownY1 > stripY1 ? ownY1 : stripY1;
  const bandX0 = ownX0 < stripX0 ? ownX0 : stripX0;
  const bandX1 = ownX1 > stripX1 ? ownX1 : stripX1;
  const padX = Math.max(sw + gapX, own ? own.width + Math.abs(own.x) : 0);
  const padY = Math.max(sh + gapY, own ? own.height + Math.abs(own.y) : 0);

  const acceptAxis = (x: number, y: number): void => {
    if (!finite(x) || !finite(y)) return;
    const dx = x - dx0, dy = y - dy0;
    const dist = dx * dx + dy * dy;
    if (dist > bestDist) return;
    if (dist === bestDist && (!preferRight || dx <= bestDx)) return;
    bestDist = dist; bestDx = dx; bestX = x; bestY = y; found = true;
  };

  let ivCount = 0;
  const pushIv = (lo: number, hi: number): void => {
    if (ivCount >= ivLo.length) ensureIvCap(ivCount + 1);
    ivLo[ivCount] = lo;
    ivHi[ivCount] = hi;
    ivCount++;
  };
  const collectX = (x0: number, x1: number): void => {
    ivCount = 0;
    grid.forEachInBox(x0 - padX, bandY0, x1 + padX, bandY1, (o) => {
      if (o.y < stripY1 && o.y + o.height > stripY0) pushIv(o.x - sw - gapX, o.x + o.width + gapX);
      if (own && o.y < ownY1 && o.y + o.height > ownY0) pushIv(o.x - own.x - own.width, o.x + o.width - own.x);
      const p = o.panel;
      if (p && p.y < dy0 + sh && p.y + p.height > dy0) pushIv(p.x - sw, p.x + p.width);
    });
  };
  const collectY = (y0: number, y1: number): void => {
    ivCount = 0;
    grid.forEachInBox(bandX0, y0 - padY, bandX1, y1 + padY, (o) => {
      if (o.x < stripX1 && o.x + o.width > stripX0) pushIv(o.y - sh - gapY, o.y + o.height + gapY);
      if (own && o.x < ownX1 && o.x + o.width > ownX0) pushIv(o.y - own.y - own.height, o.y + o.height - own.y);
      const p = o.panel;
      if (p && p.x < dx0 + sw && p.x + p.width > dx0) pushIv(p.y - sh, p.y + p.height);
    });
  };

  let radius = found ? Math.sqrt(bestDist) : Infinity;
  if (hint.rightX - dx0 <= radius) {
    if (grid.isClear(hint.rightX, dy0, sw, sh, gapX, gapY, own)) acceptAxis(hint.rightX, dy0);
    else {
      const lim = found ? dx0 + radius : 1e9;
      collectX(hint.rightX, lim);
      hint.rightX = advanceClearRight(hint.rightX, ivCount, lim);
      if (hint.rightX - dx0 <= radius && grid.isClear(hint.rightX, dy0, sw, sh, gapX, gapY, own)) acceptAxis(hint.rightX, dy0);
    }
  }
  radius = found ? Math.sqrt(bestDist) : Infinity;
  if (dx0 - hint.leftX <= radius) {
    if (grid.isClear(hint.leftX, dy0, sw, sh, gapX, gapY, own)) acceptAxis(hint.leftX, dy0);
    else {
      const lim = found ? dx0 - radius : -1e9;
      collectX(lim, hint.leftX);
      hint.leftX = advanceClearLeft(hint.leftX, ivCount, lim);
      if (dx0 - hint.leftX <= radius && grid.isClear(hint.leftX, dy0, sw, sh, gapX, gapY, own)) acceptAxis(hint.leftX, dy0);
    }
  }
  radius = found ? Math.sqrt(bestDist) : Infinity;
  if (hint.downY - dy0 <= radius) {
    if (grid.isClear(dx0, hint.downY, sw, sh, gapX, gapY, own)) acceptAxis(dx0, hint.downY);
    else {
      const lim = found ? dy0 + radius : 1e9;
      collectY(hint.downY, lim);
      hint.downY = advanceClearRight(hint.downY, ivCount, lim);
      if (hint.downY - dy0 <= radius && grid.isClear(dx0, hint.downY, sw, sh, gapX, gapY, own)) acceptAxis(dx0, hint.downY);
    }
  }
  radius = found ? Math.sqrt(bestDist) : Infinity;
  if (dy0 - hint.upY <= radius) {
    if (grid.isClear(dx0, hint.upY, sw, sh, gapX, gapY, own)) acceptAxis(dx0, hint.upY);
    else {
      const lim = found ? dy0 - radius : -1e9;
      collectY(lim, hint.upY);
      hint.upY = advanceClearLeft(hint.upY, ivCount, lim);
      if (dy0 - hint.upY <= radius && grid.isClear(dx0, hint.upY, sw, sh, gapX, gapY, own)) acceptAxis(dx0, hint.upY);
    }
  }

  // 3. Corner slots flush with nearby mixed-size obstacles (e.g. a text card tucking into the free corner next to a tall chat card).
  // Skipped when the inner ring is already packed with uniform cards, or pruned in O(1) via the blocked ring bitmap and bestDist.
  if (hint.minRing <= 2 || grid.cards.length <= 64) {
    const rCorner = found ? Math.sqrt(bestDist) : Math.max(stepX, stepY) * 3;
    const invX = 1 / stepX, invY = 1 / stepY;
    let seenCorner: Set<number> | null = null;
    const tryCorner = (x: number, y: number): void => {
      const dx = x - dx0, dy = y - dy0;
      const dist = dx * dx + dy * dy;
      if (dist > bestDist) return;
      if (dist === bestDist && (!preferRight || dx <= bestDx)) return;
      const gx = dx * invX, gy = dy * invY;
      const rgx = Math.round(gx), rgy = Math.round(gy);
      if (Math.abs(gx - rgx) < 1e-6 && Math.abs(gy - rgy) < 1e-6 && rgx >= -hCap && rgx <= hCap && rgy >= -hCap && rgy <= hCap) {
        if (hBlocked[(rgy + hCap) * hSide + hCap + rgx]) return;
      }
      const qx = Math.round(x * 2), qy = Math.round(y * 2);
      if (qx >= -CELL_BIAS && qx < CELL_BIAS && qy >= -CELL_BIAS && qy < CELL_BIAS) {
        const k = ((qx + CELL_BIAS) << 15) | (qy + CELL_BIAS);
        if (!seenCorner) seenCorner = new Set();
        else if (seenCorner.has(k)) return;
        seenCorner.add(k);
      }
      if (!grid.isClear(x, y, sw, sh, gapX, gapY, own)) return;
      bestDist = dist; bestDx = dx; bestX = x; bestY = y; found = true;
    };
    const visitCorners = (o: NodeRect): void => {
      const xR = o.x + o.width + gapX, xL = o.x - sw - gapX;
      const yB = o.y + o.height + gapY, yT = o.y - sh - gapY;
      tryCorner(xR, o.y);
      tryCorner(xL, o.y);
      tryCorner(xR, o.y + o.height - sh);
      tryCorner(xL, o.y + o.height - sh);
      tryCorner(o.x, yB);
      tryCorner(o.x, yT);
      tryCorner(o.x + o.width - sw, yB);
      tryCorner(o.x + o.width - sw, yT);
    };
    grid.forEachInBox(dx0 - rCorner - padX, bandY0, dx0 + rCorner + padX, bandY1, visitCorners);
    grid.forEachInBox(bandX0, dy0 - rCorner - padY, bandX1, dy0 + rCorner + padY, visitCorners);
  }

  if (found) return { x: bestX, y: bestY };
  return { x: dx0, y: Math.max(grid.bottom, dy0) + gapY };
}

/** Pick the closest non-overlapping flow position starting from `desired` (searching outward in a grid).
 *  Existing cards bring their floating composer panel (`NodeRect.panel`): the new card keeps clear of it. `opts.panel` is the new
 *  card's own panel (`panelZone` of a card at 0,0): it keeps clear of existing cards (no gap beyond the panel itself); panels never
 *  collide with panels, since only the selected card shows one. Both callers share this single mechanism. */
export function findFreePosition(
  desired: { x: number; y: number },
  size: { width: number; height: number },
  occupied: readonly NodeRect[],
  opts?: { gapX?: number; gapY?: number; preferRight?: boolean; panel?: NodeRect | null },
): { x: number; y: number } {
  if (!occupied.length) {
    return { x: finite(desired.x) ? desired.x : 0, y: finite(desired.y) ? desired.y : 0 };
  }
  return findFreePositionInGrid(desired, size, gridForOccupied(occupied), opts);
}

/** Image, video, audio, 3D and tool cards open a composer panel under the card while selected (400 px wide, 12 px below). It is
 *  not part of the card, so a neighbour placed under the card at the usual gap sat beneath it. The height is the panel at its
 *  tallest common size: .nt-refs (40 + 10 gap) + .nt-prompt at its 13.75rem max (220) + padding 2×12 + border 2 + gap 10 + model row (~44). */
const PANEL = { width: 400, gap: 12, height: 350 };

export function panelZone(data: GraphNodeData, card: NodeRect): NodeRect | null {
  if (data.kind === 'text' || data.kind === 'asset' || data.kind === 'ref') return null;
  return { x: card.x + card.width / 2 - PANEL.width / 2, y: card.y + card.height + PANEL.gap, width: PANEL.width, height: PANEL.height };
}

/** `findFreePosition` for a node about to be added: the spot also leaves the node's composer panel clear of other cards (see `findFreePosition`). */
export function findFreePositionFor(
  data: GraphNodeData,
  desired: { x: number; y: number },
  occupied: readonly NodeRect[],
  opts?: { gapX?: number; gapY?: number; width?: number; preferRight?: boolean },
): { x: number; y: number } {
  const width = opts?.width ?? nodeWidth(data);
  const height = estimatedHeight(data);
  const panel = panelZone(data, { x: 0, y: 0, width, height });
  return findFreePosition(desired, { width, height }, occupied, { gapX: opts?.gapX, gapY: opts?.gapY, preferRight: opts?.preferRight, panel });
}

/** Nodes whose size is known only now (first measurement) move off the nodes they stack on. Placement before the
 *  measurement works with estimated sizes, which are smaller than the cards, so new nodes landed on each other.
 *  `fresh`: ids measured for the first time. Returns new positions for those that overlap; the rest stay put. */
export function settleFresh(nodes: readonly GraphNode[], fresh: ReadonlySet<string>, measured: Map<string, { width: number; height: number }>): Map<string, { x: number; y: number }> {
  const moves = new Map<string, { x: number; y: number }>();
  const grid = new SpatialGrid();
  for (const n of nodes) if (!fresh.has(n.id)) grid.add(nodeRect(n, measured));
  for (const n of nodes) {
    if (!fresh.has(n.id)) continue;
    const r = nodeRect(n, measured);
    const own = panelZone(n.data, { x: 0, y: 0, width: r.width, height: r.height });
    if (!grid.isClear(r.x, r.y, r.width, r.height, 48, 56, own)) {
      const at = findFreePositionInGrid(n.position, { width: r.width, height: r.height }, grid, { gapX: 48, gapY: 56, panel: own });
      moves.set(n.id, at);
      const moved: NodeRect = { x: at.x, y: at.y, width: r.width, height: r.height };
      const panel = panelZone(n.data, moved);
      grid.add(panel ? { ...moved, panel } : moved);
    } else {
      grid.add(r);
    }
  }
  return moves;
}

/** Layered left-to-right layout by dependency depth. Returns new positions for the given node ids. */
export function autoLayout(nodes: GraphNode[], edges: GraphEdge[], origin = { x: 0, y: 0 }): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
  }
  const depth = new Map<string, number>();
  const dfs = (id: string, trail: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const d = Math.max(-1, ...(incoming.get(id) ?? []).map((s) => dfs(s, trail))) + 1;
    trail.delete(id);
    depth.set(id, d);
    return d;
  };
  nodes.forEach((n) => dfs(n.id, new Set()));
  const columns = new Map<number, GraphNode[]>();
  for (const n of nodes) {
    const d = depth.get(n.id) ?? 0;
    columns.set(d, [...(columns.get(d) ?? []), n]);
  }
  const gapX = 90;
  const gapY = 56;
  const heights = [...columns.values()].map((col) => col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY));
  const tallest = Math.max(0, ...heights);
  const out = new Map<string, { x: number; y: number }>();
  let colX = origin.x;
  [...columns.entries()]
    .sort((a, b) => a[0] - b[0])
    .forEach(([, col]) => {
      // Keep sibling order stable by the average position of their parents.
      col.sort((a, b) => avgParent(a.id) - avgParent(b.id));
      const colH = col.reduce((h, n) => h + estimatedHeight(n.data) + gapY, -gapY);
      const colW = col.reduce((w, n) => Math.max(w, nodeWidth(n.data)), NODE_WIDTH);
      let y = origin.y + (tallest - colH) / 2;
      for (const n of col) {
        out.set(n.id, { x: colX, y });
        y += estimatedHeight(n.data) + gapY;
      }
      colX += colW + gapX;
    });
  return out;

  function avgParent(id: string): number {
    const ps = incoming.get(id) ?? [];
    if (!ps.length) return nodes.findIndex((n) => n.id === id);
    return ps.reduce((s, p) => s + (out.get(p)?.y ?? 0), 0) / ps.length;
  }
}

/** Bounding box of existing nodes (to place new flows beside them). */
export function graphBounds(nodes: GraphNode[]): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null;
  const x0 = Math.min(...nodes.map((n) => n.position.x));
  const y0 = Math.min(...nodes.map((n) => n.position.y));
  const x1 = Math.max(...nodes.map((n) => n.position.x + NODE_WIDTH));
  const y1 = Math.max(...nodes.map((n) => n.position.y + estimatedHeight(n.data)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
