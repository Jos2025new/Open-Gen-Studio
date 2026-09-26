import type { Stroke } from '../types';
import { xmlEscape } from './export';
import { drawSolidStroke, solidStrokeSvg } from './strokes';

/* Stroke painting entry points: solid ink today; textured stamps plug in here. */

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
  drawSolidStroke(ctx, s);
}

export async function strokeSvg(s: Stroke): Promise<string> {
  return solidStrokeSvg(s, xmlEscape);
}
