import type { Layer } from '../types';

/*
 * What a click on the canvas acts on (Photoshop's Auto-select). Off (the default): the active layer, and only when the
 * click lands on its content; a click elsewhere keeps the selection. On: the topmost layer under the pointer.
 */
export function clickCandidate(autoSelect: boolean, topmost: Layer | null, active: Layer | undefined, hitsActive: (l: Layer) => boolean): Layer | null {
  if (autoSelect) return topmost;
  return active && hitsActive(active) ? active : null;
}
