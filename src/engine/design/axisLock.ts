import type { Mods } from './modifierGate';
import { downMods } from './modifierGate';

type Axis = 'x' | 'y';
type Delta = { dx: number; dy: number };

/** Gates whose Shift was seen released after the press: a Shift pressed anew then counts as the lock (like moveMode's Ctrl). */
const released = new WeakSet<Mods>();

/**
 * The axis Shift locks a move to: the dominant one of the delta, live. null when nothing is locked. Shift held at pointer
 * down is the mode (add to the selection), not the lock, until it is released and pressed again.
 */
export function lockedAxis(dx: number, dy: number, mods: { shiftKey: boolean }, gate: Mods = downMods()): Axis | null {
  if (!mods.shiftKey) { if (gate.shift) released.add(gate); return null; }
  if (gate.shift && !released.has(gate)) return null;
  return Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
}

/** A move delta with Shift's axis lock applied (the other axis goes to zero). */
export function lockedDelta(dx: number, dy: number, mods: { shiftKey: boolean }, gate: Mods = downMods()): Delta {
  const axis = lockedAxis(dx, dy, mods, gate);
  return axis === 'x' ? { dx, dy: 0 } : axis === 'y' ? { dx: 0, dy } : { dx, dy };
}

/** After snapping, the locked axis' partner goes back to zero, so a snap never pulls the move off the line. */
export function keepAxis(d: Delta, axis: Axis | null): Delta {
  return axis === 'x' ? { dx: d.dx, dy: 0 } : axis === 'y' ? { dx: 0, dy: d.dy } : d;
}

/** The pointer position with the lock applied to its distance from `from`; the very same point when nothing is locked. */
export function lockedPoint(p: { x: number; y: number }, from: { x: number; y: number }, mods: { shiftKey: boolean }, gate?: Mods): { x: number; y: number } {
  const dx = p.x - from.x, dy = p.y - from.y;
  const l = lockedDelta(dx, dy, mods, gate);
  return l.dx === dx && l.dy === dy ? p : { x: from.x + l.dx, y: from.y + l.dy };
}
