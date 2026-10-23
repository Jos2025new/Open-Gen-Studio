import type { Layer } from '../types';

/*
 * What a click on the canvas acts on (Photoshop's Auto-select). Off (the default): the active layer, and only when the
 * click lands on its content; a click elsewhere keeps the selection. On: the topmost layer under the pointer.
 */
export function clickCandidate(autoSelect: boolean, topmost: Layer | null, active: Layer | undefined, hitsActive: (l: Layer) => boolean): Layer | null {
  if (autoSelect) return topmost;
  return active && hitsActive(active) ? active : null;
}

/**
 * Objects mode, when the layer a click would act on has no object under the pointer: the topmost visible, unlocked layer
 * that has one (the active layer first), so the click never falls into nothing.
 */
export function topObjectLayer(layers: Layer[], hasObject: (l: Layer) => boolean, preferred?: Layer | null): Layer | null {
  if (preferred && preferred.visible && !preferred.locked && hasObject(preferred)) return preferred;
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i].visible && !layers[i].locked && hasObject(layers[i])) return layers[i];
  return null;
}
