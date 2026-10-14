/* Pressure strokes: the style of a stroke and the stroke itself. Kept apart from types.ts (its size limit); types.ts re-exports them. */

/** How a pressure stroke is shaped (perfect-freehand options, kept so the stroke can be re-shaped later). */
export interface StrokeStyle {
  color: string;
  /** Base diameter in document px. */
  size: number;
  /** How much pressure thins the line (-1…1; 0 = constant width). */
  thinning: number;
  smoothing: number;
  streamline: number;
  /** Taper length at each end in document px (0 = none). */
  taperStart: number;
  taperEnd: number;
  opacity: number;
  /** Stamped texture along the path (P9); absent = solid ink. */
  texture?: StrokeTexture;
}

export interface StrokeTexture {
  /** Built-in stamp id (design/brushTextures.ts). */
  stamp: string;
  /** Distance between stamps as a fraction of the size. */
  spacing: number;
  /** Random rotation/offset amount (0…1), repeatable through the seed. */
  jitter: number;
  seed: number;
}

/**
 * A drawn line kept as the gesture, not pixels: points are [x, y, pressure] in document px.
 * `simulatePressure` is set for mouse/touch input (no real pressure).
 */
export interface Stroke extends StrokeStyle {
  id: string;
  /** The gesture as drawn, in its own frame (never rewritten by a transform). */
  points: Array<[number, number, number]>;
  simulatePressure: boolean;
  /** Accumulated transform from the frame of `points` to the page (absent = identity). Outline and export use it. */
  matrix?: [number, number, number, number, number, number];
}
