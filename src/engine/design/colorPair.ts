import { setUi, useStore } from '../../store/store';
import { rememberColor } from './swatches';

/* The primary and secondary color. The primary is ui.brush.color; the secondary is ui.brush.secondary (X swaps, D resets). */

export const DEFAULT_COLORS = { primary: '#ffffff', secondary: '#000000' };

const HEX = /^#[0-9a-f]{6}$/i;

/** The secondary color: its own, else the gradient's second color (what the user may have chosen before), else black. Bad values fall to the default. */
export function secondaryOf(brush: { secondary?: string }, gradient?: { color2?: string }): string {
  return [brush.secondary, gradient?.color2].find((c): c is string => typeof c === 'string' && HEX.test(c)) ?? DEFAULT_COLORS.secondary;
}

/** Primary and secondary trade places. */
export function swapColors(): void {
  const { brush, gradient } = useStore.getState().ui;
  setUi({ brush: { ...brush, color: secondaryOf(brush, gradient), secondary: brush.color } });
}

/** Back to white over black, the app's own colors. */
export function resetColors(): void {
  const { brush } = useStore.getState().ui;
  setUi({ brush: { ...brush, color: DEFAULT_COLORS.primary, secondary: DEFAULT_COLORS.secondary } });
}

/** A secondary color the user chose; it joins the recent colors like any other. */
export function setSecondary(color: string): void {
  if (!HEX.test(color)) return;
  const { brush } = useStore.getState().ui;
  setUi({ brush: { ...brush, secondary: color.toLowerCase() } });
  rememberColor(color);
}
