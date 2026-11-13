import type { ObjectGroup, VectorLayer, VectorShape } from '../types';
import { createCanvas, ctx2d } from '../../lib/media';
import { unionBox } from './doc';
import { groupChain, groupLook, inGroup } from './objectGroupTree';
import { blurRegion } from './shapeLook';

/*
 * Painting the shapes of a vector layer when some of its groups carry their own opacity or blend mode (objectMeta.ts):
 * such a group is composed apart, as an SVG <g opacity style="mix-blend-mode">, and laid on the target once. Groups
 * without a look, and layers without such groups, paint straight through: nothing changes for them.
 */

/** True when the layer has a group that must be composed apart. */
export function hasGroupLook(layer: VectorLayer): boolean {
  return !!layer.objectGroups?.some(groupLook);
}

// One scratch canvas per nesting depth: a group inside a group is composed while its parent's canvas is in use.
const scratch: HTMLCanvasElement[] = [];

function compose(ctx: CanvasRenderingContext2D, g: ObjectGroup, shapes: VectorShape[], depth: number, gco: (g: ObjectGroup) => GlobalCompositeOperation, paint: (c: CanvasRenderingContext2D) => void): void {
  const r = unionBox(shapes.map(blurRegion));
  if (!r || (g.opacity ?? 1) <= 0) return;
  const m = ctx.getTransform(), pad = 2;
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  const x0 = Math.floor(Math.max(0, Math.min(...pts.map((q) => q[0])) - pad)), y0 = Math.floor(Math.max(0, Math.min(...pts.map((q) => q[1])) - pad));
  const x1 = Math.ceil(Math.min(ctx.canvas.width, Math.max(...pts.map((q) => q[0])) + pad)), y1 = Math.ceil(Math.min(ctx.canvas.height, Math.max(...pts.map((q) => q[1])) + pad));
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const off = (scratch[depth] ??= createCanvas(1, 1)), o = ctx2d(off);
  if (off.width < w || off.height < h) { off.width = Math.max(off.width, w); off.height = Math.max(off.height, h); }
  else { o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, w, h); }
  o.save();
  o.beginPath(); o.rect(0, 0, w, h); o.clip();
  o.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
  paint(o);
  o.restore();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // On top of what the target already applies (its layer's opacity); a group's own blend mode replaces the target's.
  ctx.globalAlpha *= g.opacity ?? 1;
  if (g.blend && g.blend !== 'normal') ctx.globalCompositeOperation = gco(g);
  ctx.drawImage(off, 0, 0, w, h, x0, y0, w, h);
  ctx.restore();
}

/** Paint these shapes (paint order, hidden ones already left out) with their groups' opacity and blend. */
export function paintShapeTree(ctx: CanvasRenderingContext2D, layer: VectorLayer, shapes: readonly VectorShape[], draw: (c: CanvasRenderingContext2D, s: VectorShape) => void, gco: (g: ObjectGroup) => GlobalCompositeOperation, done: ReadonlySet<string> = new Set(), depth = 0): void {
  for (let i = 0; i < shapes.length;) {
    // The outermost group above the shape that still has to be composed.
    const g = groupChain(layer, shapes[i].groupId).reverse().find((x) => groupLook(x) && !done.has(x.id));
    if (!g) { draw(ctx, shapes[i++]); continue; }
    let j = i;
    while (j < shapes.length && inGroup(layer, shapes[j], g.id)) j++;
    const run = shapes.slice(i, j);
    compose(ctx, g, run, depth, gco, (o) => paintShapeTree(o, layer, run, draw, gco, new Set([...done, g.id]), depth + 1));
    i = j;
  }
}
