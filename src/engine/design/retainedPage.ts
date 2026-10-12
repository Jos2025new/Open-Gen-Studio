import type { FxOp } from '../fx/types';

/*
 * Retained page (Paso 3): the editor keeps the last composite and recomposes only the region a change dirties.
 * This module holds the pure parts: FX margins (how far an op reaches beyond its pixels) and rectangle arithmetic.
 * The state and the frame logic are in this file below; `render.ts` only calls into it.
 */

export interface Rect { x0: number; y0: number; x1: number; y1: number }

export const EMPTY: Rect = { x0: 0, y0: 0, x1: 0, y1: 0 };
export const isEmpty = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0;
export const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || isEmpty(a)) return b && !isEmpty(b) ? b : null;
  if (!b || isEmpty(b)) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
};
/** Grows a rectangle by `m` on every side (`Infinity` is the whole plane, used to force a full frame). */
export const grow = (r: Rect, m: number): Rect => (m === Infinity ? { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity } : { x0: r.x0 - m, y0: r.y0 - m, x1: r.x1 + m, y1: r.y1 + m });
/** Clips a rectangle to the page of W×H pixels. */
export const clipTo = (r: Rect, W: number, H: number): Rect => ({ x0: Math.max(0, Math.floor(r.x0)), y0: Math.max(0, Math.floor(r.y0)), x1: Math.min(W, Math.ceil(r.x1)), y1: Math.min(H, Math.ceil(r.y1)) });

/**
 * How many pixels beyond its own area an FX op can change, at composition scale. Ops that only change pixels in
 * place (tone and colour) reach nothing; blur, shadow and glow spread; anything not known here is `Infinity`, which
 * makes the frame a full one (the safe answer).
 */
export function fxMargin(op: Pick<FxOp, 'kind' | 'enabled' | 'params'>, scale: number): number {
  if (!op.enabled) return 0;
  const n = (k: string, d: number) => Number(op.params[k] ?? d);
  switch (op.kind) {
    case 'brightness': case 'contrast': case 'saturation': case 'hue': case 'grayscale': case 'sepia': case 'invert': case 'levels': case 'curves':
      return 0;
    case 'blur':
      return Math.ceil(3 * n('radius', 4) * scale);
    case 'shadow':
      return Math.ceil((Math.max(Math.abs(n('x', 8)), Math.abs(n('y', 8))) + 3 * n('blur', 12)) * scale);
    default:
      // glow reaches its blur radius (3 sigma) but its passes are not verified here; flare places light anywhere.
      return Infinity;
  }
}
