import type { DesignDoc, Layer } from '../types';
import { equalSpacing, snapBox, snapNow, snapTolerance, type Measure, type SnapOptions } from './snap';
import { layerBox } from './render';

/*
 * One snapping session per drag (Inkscape's SnapManager::setup and its candidate search, snap.cpp:696-992): the lines
 * to stick to are collected once, when the drag starts, and only for what is on screen (capped at MAX_LINES). Each
 * move then filters them by band (a line counts when its layer overlaps the moving box on the other axis) and
 * scores them; no layer is visited again during the drag.
 */

export const MAX_LINES = 200;
type Line = { v: number; lo: number; hi: number };
type Box = { x: number; y: number; w: number; h: number };
export interface SessionStep { dx: number; dy: number; gx?: number; gy?: number; measures?: Measure[] }

export class SnapSession {
  private xs: Line[] = [];
  private ys: Line[] = [];
  private last: { x: number; y: number; t: number } | null = null;
  private lastMove = 0;
  private boxes: Box[] = [];

  constructor(doc: Pick<DesignDoc, 'width' | 'height' | 'layers' | 'guides'>, movingId: string, private opts: SnapOptions, private zoom: number, view: { x0: number; y0: number; x1: number; y1: number }) {
    const always = { lo: -Infinity, hi: Infinity };
    if (opts.page) {
      for (const v of [0, doc.width / 2, doc.width]) this.xs.push({ v, ...always });
      for (const v of [0, doc.height / 2, doc.height]) this.ys.push({ v, ...always });
    }
    if (opts.guides !== false) {
      for (const v of doc.guides?.x ?? []) this.xs.push({ v, ...always });
      for (const v of doc.guides?.y ?? []) this.ys.push({ v, ...always });
    }
    if (opts.layers) {
      const seen: Array<{ b: Box; d: number }> = [];
      const cx = (view.x0 + view.x1) / 2, cy = (view.y0 + view.y1) / 2;
      for (const l of doc.layers as Layer[]) {
        if (l.id === movingId || !l.visible) continue;
        const b = layerBox(l);
        if (!b) continue;
        // On screen only, with a margin of one view: a layer far off the view cannot be aimed at anyway.
        if (b.x + b.w < view.x0 || b.x > view.x1 || b.y + b.h < view.y0 || b.y > view.y1) continue;
        seen.push({ b, d: Math.hypot(b.x + b.w / 2 - cx, b.y + b.h / 2 - cy) });
      }
      // Nearest to the view centre first, so the cap keeps what the user is most likely to aim at.
      seen.sort((a, c) => a.d - c.d);
      for (const { b } of seen) {
        if (this.xs.length + this.ys.length + 6 > 2 * MAX_LINES) break; // a layer adds six lines
        this.boxes.push(b);
        for (const v of [b.x, b.x + b.w / 2, b.x + b.w]) this.xs.push({ v, lo: b.y, hi: b.y + b.h });
        for (const v of [b.y, b.y + b.h / 2, b.y + b.h]) this.ys.push({ v, lo: b.x, hi: b.x + b.w });
      }
    }
  }

  /** Every line of the session, without bands (for handles that snap a single coordinate). */
  targets(): { xs: number[]; ys: number[] } {
    return { xs: this.xs.map((l) => l.v), ys: this.ys.map((l) => l.v) };
  }

  /**
   * One move: the box at `box`, the pointer at page point `p` and screen point `screen` at time `t` (ms). Returns no
   * nudge while the pointer is fast (snapNow), otherwise the snap of the box to the lines in its bands.
   */
  step(box: Box, p: { x: number; y: number }, screen: { x: number; y: number }, t: number): SessionStep {
    let speed = 0;
    if (this.last) {
      const dist = Math.hypot(screen.x - this.last.x, screen.y - this.last.y);
      speed = dist / Math.max(1, t - this.last.t);
      if (dist > 0) this.lastMove = t;
    } else this.lastMove = t;
    this.last = { x: screen.x, y: screen.y, t };
    if (!snapNow(speed, t - this.lastMove)) return { dx: 0, dy: 0 };
    const inBand = (lines: Line[], lo: number, hi: number) => lines.filter((l) => l.hi >= lo && l.lo <= hi).map((l) => l.v);
    const xs = inBand(this.xs, box.y, box.y + box.h), ys = inBand(this.ys, box.x, box.x + box.w);
    const tol = snapTolerance(this.zoom);
    const r: SessionStep = snapBox(box, { xs, ys }, tol, p);
    // Equal spacing applies on an axis where no line snapped the box (a line snap keeps its edge on the line).
    const measures: Measure[] = [];
    for (const axis of ['x', 'y'] as const) {
      const cur = axis === 'x' ? r.dx : r.dy;
      const sp = this.opts.equalSpacing !== false && cur === 0 ? equalSpacing(box, this.boxes, tol, axis) : null;
      if (sp) {
        if (axis === 'x') r.dx = sp.d; else r.dy = sp.d;
        measures.push(...sp.measures);
      }
    }
    if (measures.length) r.measures = measures;
    return r;
  }
}

const sessions = new WeakMap<object, SnapSession>();

/** The session of one drag, created on its first use; the key is the drag object (it lives for the whole gesture). */
export function snapSessionFor(key: object, make: () => SnapSession): SnapSession {
  let s = sessions.get(key);
  if (!s) { s = make(); sessions.set(key, s); }
  return s;
}

/** The session of drag `key`: every layer but `ids` is a candidate; `movingId` is the layer whose box moves ('' for a handle). */
export function snapSessionOf(key: object, doc: DesignDoc, ids: Set<string>, movingId: string, opts: SnapOptions, view: { x: number; y: number; zoom: number }, size: { w: number; h: number }): SnapSession {
  return snapSessionFor(key, () => new SnapSession({ ...doc, layers: doc.layers.filter((l) => !ids.has(l.id)) }, movingId, opts, view.zoom, visibleDocRect(view, size)));
}

/** The part of the page on screen, in document units, for a view and a screen size (origin at the top-left). */
export function visibleDocRect(view: { x: number; y: number; zoom: number }, size: { w: number; h: number }): { x0: number; y0: number; x1: number; y1: number } {
  return { x0: -view.x / view.zoom, y0: -view.y / view.zoom, x1: (size.w - view.x) / view.zoom, y1: (size.h - view.y) / view.zoom };
}

/**
 * The watchdog of the delayed snap (Inkscape's snap timer, tool-base.cpp): while the pointer is fast a snap is
 * postponed, and this timer fires once SNAP_IDLE_MS have passed, so the snap happens even if no slower motion event
 * follows. The clock is injected, so the timing is tested with a simulated one.
 */
export class SnapWatchdog {
  private timer: unknown = null;
  constructor(private schedule: (fn: () => void, ms: number) => unknown, private cancelTimer: (h: unknown) => void) {}
  /** Arm (or re-arm) the timer: `fn` runs after `ms`, unless `arm` is called again or `cancel` first. */
  arm(ms: number, fn: () => void): void {
    this.cancel();
    this.timer = this.schedule(() => { this.timer = null; fn(); }, ms);
  }
  cancel(): void {
    if (this.timer != null) this.cancelTimer(this.timer);
    this.timer = null;
  }
  get armed(): boolean { return this.timer != null; }
}
