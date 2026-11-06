import { resetColors, swapColors } from '../../engine/design/colorPair';
import { offBoard } from './boardKey';

/** X swaps the primary and secondary color, D resets them. True when it took the key (boardKey has already left out text fields). */
export function colorKey(e: KeyboardEvent): boolean {
  if (offBoard(e) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return false;
  const k = e.key.toLowerCase();
  if (k !== 'x' && k !== 'd') return false;
  e.preventDefault();
  (k === 'x' ? swapColors : resetColors)();
  return true;
}
