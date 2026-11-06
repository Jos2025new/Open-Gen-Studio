import type { Mods } from './modifierGate';
import { downMods } from './modifierGate';

/** A move delta with Shift's axis lock applied. Skeleton: it returns the delta as it came (the lock arrives with the moving gestures). */
export function lockedDelta(dx: number, dy: number, _mods: { shiftKey: boolean }, _gate: Mods = downMods()): { dx: number; dy: number } {
  return { dx, dy };
}

/** The pointer position with the lock applied to its distance from `from`; the very same point when nothing is locked. */
export function lockedPoint(p: { x: number; y: number }, from: { x: number; y: number }, mods: { shiftKey: boolean }, gate?: Mods): { x: number; y: number } {
  const dx = p.x - from.x, dy = p.y - from.y;
  const l = lockedDelta(dx, dy, mods, gate);
  return l.dx === dx && l.dy === dy ? p : { x: from.x + l.dx, y: from.y + l.dy };
}
