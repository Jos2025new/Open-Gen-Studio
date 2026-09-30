interface Point { x: number; y: number }
const level = (n: number) => Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 0;

/** A trailing control point rejects small hand movements; a temporal filter smooths the remaining motion. */
export function brushPoint(previous: Point, anchor: Point, input: Point, smoothing: number, stabilization: number, zoom: number, elapsedMs: number) {
  const radius = level(stabilization) * 2 / Math.max(0.05, zoom);
  const dx = input.x - anchor.x, dy = input.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  const control = radius === 0 ? input : distance <= radius ? anchor : { x: input.x - dx * radius / distance, y: input.y - dy * radius / distance };
  const tau = level(smoothing) * 8;
  const weight = tau === 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / tau);
  return { control, paint: { x: previous.x + (control.x - previous.x) * weight, y: previous.y + (control.y - previous.y) * weight } };
}
