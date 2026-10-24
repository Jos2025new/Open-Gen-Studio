/*
 * Brush Tip Shape (Photoshop's Angle and Roundness), with GIMP's math for the elliptical tip.
 *
 * GIMP's generated brush is a circle of `radius` squeezed by `aspect_ratio` (>= 1) and turned by `angle`:
 * short_radius = radius / aspect_ratio; x_axis = (c*radius, -s*radius); y_axis = (s*short_radius, c*short_radius),
 * with s, c = sin, cos of the angle in degrees (app/core/gimpbrushgenerated.c:617-628, y down, so a positive angle
 * turns the long axis counter-clockwise on screen). Roundness is Photoshop's name for 1 / aspect_ratio.
 * gimp_brush_core_get_angle (app/paint/gimpbrushcore.c:1071-1085) wraps the angle into one turn, and
 * paint_options->brush_angle / brush_aspect_ratio are what the tip stamps with (gimpbrushcore.c:1215-1216).
 * gimp_brush_transform_matrix rotates the dab about its centre (app/core/gimpbrush-transform.cc:751-769).
 *
 * Our tip is swept along a segment, so instead of stamping a rotated dab we take every point into the ellipse's own
 * frame (undo the rotation, stretch the short axis by aspect_ratio): there the tip is a plain circle and the
 * existing capsule maths applies unchanged. A swept ellipse is exactly a swept circle seen through that map.
 */

/** Photoshop's limits: Roundness 1–100 %, Angle -180..180°. */
export const ROUNDNESS_MIN = 0.01;

/** Wrap an angle to (-180, 180] (the Angle field's range); gimpbrushcore.c:1080-1083 does the same for one turn. */
export function wrapAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

export const clampRoundness = (r: number) => Math.min(1, Math.max(ROUNDNESS_MIN, r));

export interface TipShape { angle?: number; roundness?: number; follow?: boolean }

/** The map into the tip's frame, or null for a round tip (then the caller keeps its plain circle maths). */
export interface TipFrame { c: number; s: number; aspect: number }

/**
 * The frame for a segment from (0,0) along (dx, dy). `follow` turns the tip with the stroke's direction (the angle
 * is then relative to it), as Photoshop's Angle Jitter "Direction" does.
 */
export function tipFrame(tip: TipShape, dx: number, dy: number): TipFrame | null {
  if (tip.roundness === undefined || tip.roundness >= 1) return null;
  let angle = tip.angle ?? 0;
  // The direction in the same convention as the angle: u = (c, -s) is the long axis (gimpbrushgenerated.c:625-626).
  if (tip.follow && (dx || dy)) angle += (Math.atan2(-dy, dx) * 180) / Math.PI;
  const rad = (angle * Math.PI) / 180;
  return { c: Math.cos(rad), s: Math.sin(rad), aspect: 1 / clampRoundness(tip.roundness) };
}

/** A point in the tip's frame: along the long axis as is, across the short axis stretched by the aspect ratio. */
export function toTipFrame(f: TipFrame, x: number, y: number): [number, number] {
  return [f.c * x - f.s * y, (f.s * x + f.c * y) * f.aspect];
}
