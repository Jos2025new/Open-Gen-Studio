import type { SelectCombine } from './pixelSelection';

/** Modifier keys as a gesture sees them. */
export interface Mods { shift: boolean; alt: boolean; ctrl: boolean }

const NONE: Mods = { shift: false, alt: false, ctrl: false };
let atDown: Mods = NONE;

/** Remember what was held at pointer down (the Stage calls it on every press). */
export function markDown(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey?: boolean }): void {
  atDown = eventMods(e);
}

/** The modifiers of a pointer or keyboard event (Meta counts as Ctrl). */
export const eventMods = (e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey?: boolean }): Mods => ({ shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || Boolean(e.metaKey) });

export const downMods = (): Mods => atDown;

/**
 * A modifier held at pointer down belongs to the mode (add to the selection, take away), not to the shape: it counts for
 * the shape only if pressed after the press, and again once it is released and pressed anew. Same idea as moveMode's Ctrl.
 */
export function shapeMods(now: Mods, down: Mods = atDown): Mods {
  return { shift: now.shift && !down.shift, alt: now.alt && !down.alt, ctrl: now.ctrl && !down.ctrl };
}

/** How a selection combines: Shift+Alt intersects, Alt takes away, Shift adds, otherwise `base` (the Mode chosen). */
export function combineFrom(mods: { shift: boolean; alt: boolean }, base: SelectCombine): SelectCombine {
  return mods.shift && mods.alt ? 'intersect' : mods.alt ? 'subtract' : mods.shift ? 'add' : base;
}
