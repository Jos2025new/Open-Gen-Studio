import { createCanvas, ctx2d } from '../../lib/media';
import { numParam, rgba } from './defs';
import type { FxLayer, FxOp } from './types';
import { span, traceDeep } from '../../lib/trace';

/*
 * FX on canvas: each op is one pass (ctx.filter, screen, gradients), never a JavaScript pixel loop. The source canvas
 * is never written; every pass draws into a new canvas, so undo and the layer buffers stay untouched.
 */

/** `scale` = canvas px per document px (lengths are given in document px); `clip` keeps light inside the source alpha. */
export interface FxContext {
  scale: number;
  clip: boolean;
  /** Where the target is, in canvas px: the lens flare is placed in it, as GIMP places it in the drawable. Default: all. */
  region?: { x: number; y: number; w: number; h: number };
}

/** The ctx.filter string for ops CSS can do; null for glow and flare, drawn by hand. */
export function cssFilter(op: FxOp, scale: number): string | null {
  const a = numParam(op, 'amount');
  switch (op.kind) {
    case 'brightness': return `brightness(${a})`;
    case 'contrast': return `contrast(${a})`;
    case 'saturation': return `saturate(${a})`;
    case 'hue': return `hue-rotate(${numParam(op, 'degrees')}deg)`;
    case 'grayscale': return `grayscale(${a})`;
    case 'sepia': return `sepia(${a})`;
    case 'invert': return `invert(${a})`;
    case 'blur': return `blur(${numParam(op, 'radius') * scale}px)`;
    case 'shadow': return `drop-shadow(${numParam(op, 'x') * scale}px ${numParam(op, 'y') * scale}px ${numParam(op, 'blur') * scale}px ${rgba(String(op.params.color), numParam(op, 'opacity'))})`;
    default: return null;
  }
}

/** Glow passes: one screen pass per whole unit of strength, the rest in the last one (strength 1.5 → 1, 0.5). */
export function glowPasses(strength: number): number[] {
  const passes: number[] = [];
  for (let left = Math.max(0, strength); left > 1e-6; left -= 1) passes.push(Math.min(1, left));
  return passes;
}

/** Light of the lens flare, on its own transparent canvas the size of the target. */
export function flareCanvas(op: FxOp, width: number, height: number, region = { x: 0, y: 0, w: width, h: height }): HTMLCanvasElement {
  const c = createCanvas(width, height), x = ctx2d(c);
  const i = numParam(op, 'intensity'), color = String(op.params.color);
  // Position and size are fractions of the region (the target layer, or the whole page).
  const sx = region.x + numParam(op, 'x') * region.w, sy = region.y + numParam(op, 'y') * region.h, r = Math.max(1, numParam(op, 'size') * Math.min(region.w, region.h));
  const blob = (cx: number, cy: number, radius: number, stops: Array<[number, string]>) => {
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, radius);
    for (const [at, col] of stops) g.addColorStop(at, col);
    x.fillStyle = g;
    x.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  };
  x.globalCompositeOperation = 'lighter';
  blob(sx, sy, r, [[0, rgba('#ffffff', i)], [0.08, rgba(color, 0.85 * i)], [0.35, rgba(color, 0.22 * i)], [1, rgba(color, 0)]]);
  blob(sx, sy, r * 1.5, [[0.8, rgba(color, 0)], [0.88, rgba(color, 0.14 * i)], [0.96, rgba(color, 0)]]);
  // Ghosts along the line from the light through the centre of the region.
  const dx = region.x + region.w / 2 - sx, dy = region.y + region.h / 2 - sy;
  for (const [t, k, a] of [[0.6, 0.18, 0.16], [1.1, 0.08, 0.22], [1.45, 0.3, 0.1], [1.9, 0.14, 0.14]] as const) {
    blob(sx + dx * t, sy + dy * t, r * k, [[0, rgba(color, a * i)], [0.7, rgba(color, a * i * 0.6)], [1, rgba(color, 0)]]);
  }
  return c;
}

function pass(src: HTMLCanvasElement, op: FxOp, c: FxContext): HTMLCanvasElement {
  const end = span('fx', 'pass', { kind: op.kind, size: `${src.width}x${src.height}` });
  const out = draw(src, op, c);
  if (traceDeep()) {
    // The read synchronizes pending work; its duration is not pure GPU time.
    const script = end();
    const read = span('fx', 'pass-gpu', { kind: op.kind, size: `${src.width}x${src.height}`, scriptMs: Math.round(script * 1000) / 1000 });
    ctx2d(out).getImageData(0, 0, 1, 1);
    read();
  } else end();
  return out;
}

function draw(src: HTMLCanvasElement, op: FxOp, c: FxContext): HTMLCanvasElement {
  const out = createCanvas(src.width, src.height), x = ctx2d(out);
  const css = cssFilter(op, c.scale);
  if (css) {
    x.filter = css;
    x.drawImage(src, 0, 0);
    x.filter = 'none';
    return out;
  }
  x.drawImage(src, 0, 0);
  if (op.kind === 'glow') {
    x.globalCompositeOperation = 'screen';
    x.filter = `blur(${numParam(op, 'radius') * c.scale}px)`;
    for (const alpha of glowPasses(numParam(op, 'strength'))) {
      x.globalAlpha = alpha;
      x.drawImage(src, 0, 0);
    }
    x.filter = 'none';
  } else if (op.kind === 'flare') {
    const light = flareCanvas(op, src.width, src.height, c.region);
    if (c.clip) {
      const lx = ctx2d(light);
      lx.globalCompositeOperation = 'destination-in';
      lx.drawImage(src, 0, 0);
    }
    x.globalCompositeOperation = 'screen';
    x.drawImage(light, 0, 0);
  }
  return out;
}

/** The enabled ops in order. The source is returned as is when none is on. */
export function applyFx(src: HTMLCanvasElement, ops: FxOp[], c: FxContext): HTMLCanvasElement {
  return ops.reduce((cur, op) => (op.enabled ? pass(cur, op, c) : cur), src);
}

const GCO: Record<string, GlobalCompositeOperation> = { normal: 'source-over' };

/**
 * The layer's result mixed with what it filters: opacity 1 and normal = the result alone; lower opacity = a straight
 * interpolation ('lighter' adds premultiplied colours, so (1-o)·src + o·fx); another blend = the result painted over
 * the source with that blend.
 */
export function mixFx(src: HTMLCanvasElement, fx: FxLayer, c: FxContext): HTMLCanvasElement {
  const done = applyFx(src, fx.ops, c);
  if (done === src || (fx.opacity >= 1 && fx.blend === 'normal')) return done;
  const out = createCanvas(src.width, src.height), x = ctx2d(out);
  if (fx.blend === 'normal') {
    x.globalAlpha = 1 - fx.opacity;
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = 'lighter';
  } else {
    x.drawImage(src, 0, 0);
    x.globalCompositeOperation = GCO[fx.blend] ?? fx.blend;
  }
  x.globalAlpha = fx.opacity;
  x.drawImage(done, 0, 0);
  return out;
}
