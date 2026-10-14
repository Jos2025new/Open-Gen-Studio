import type { DesignDoc, VectorLayer } from '../types';
import { nodeSegs, pageSegs, type Pt } from './pathNodes';
import { snapTolerance, snapNow } from './snap';

export const MAX_NODE_TARGETS = 200;

/** Visible vector-path nodes other than the path being edited, nearest to the grabbed node first. */
export function pathNodeTargets(doc: Pick<DesignDoc, 'layers'>, shapeId: string, near: Pt): Pt[] {
  const points: Array<{ p: Pt; d: number }> = [];
  for (const layer of doc.layers) {
    if (layer.type !== 'vector' || !layer.visible) continue;
    for (const shape of (layer as VectorLayer).shapes) {
      if (shape.id === shapeId || shape.type !== 'path' || !shape.d) continue;
      const segs = pageSegs(shape);
      for (const i of nodeSegs(segs).seg) {
        const p = segs[i]?.p.at(-1);
        if (p) points.push({ p, d: Math.hypot(p[0] - near[0], p[1] - near[1]) });
      }
    }
  }
  points.sort((a, b) => a.d - b.d);
  return points.slice(0, MAX_NODE_TARGETS).map(({ p }) => p);
}

/** A node drag's candidate session: same screen tolerance and speed/idle threshold as the Edit-tool snap. */
export class PathNodeSnapSession {
  private last: { x: number; y: number; t: number };
  private lastMove: number;

  constructor(private targets: Pt[], private zoom: number, start: { x: number; y: number; t: number }) {
    this.last = start;
    this.lastMove = start.t;
  }

  step(point: Pt, screen: { x: number; y: number }, t: number): Pt | null {
    const dist = Math.hypot(screen.x - this.last.x, screen.y - this.last.y);
    const speed = dist / Math.max(1, t - this.last.t);
    if (dist > 0) this.lastMove = t;
    this.last = { ...screen, t };
    if (!snapNow(speed, t - this.lastMove)) return null;
    const tol = snapTolerance(this.zoom);
    let best: { p: Pt; d: number } | null = null;
    for (const target of this.targets) {
      const d = Math.hypot(target[0] - point[0], target[1] - point[1]);
      if (d <= tol && (!best || d < best.d)) best = { p: target, d };
    }
    return best ? [...best.p] as Pt : null;
  }
}
