import { createElement, forwardRef, useSyncExternalStore, type ComponentType, type CSSProperties, type ForwardRefExoticComponent, type ReactNode, type RefAttributes, type SVGProps } from 'react';
import { readIconSet, subscribeIconSet } from '../../lib/theme';

/** The props every icon of the app uses (the Lucide ones): the other sets accept them too. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { size?: number | string; strokeWidth?: number | string; absoluteStrokeWidth?: boolean; children?: ReactNode };
/** Drop-in for lucide-react's LucideIcon type. */
export type LucideIcon = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Alt = ComponentType<any> | undefined;

/** An explicit numeric size follows Text size (like Dynamic Type) without taking over the box: the size travels as the custom
 *  property --icon-size and a zero-specificity rule in src/styles/accessibility.css turns it into width/height, so any
 *  stylesheet rule that sizes the icon (e.g. var(--control-icon)) still wins. No inline width/height is ever set. */
export function iconSizeVar(size: number | string | undefined): CSSProperties | undefined {
  if (size === undefined || size === '' || !Number.isFinite(Number(size))) return undefined;
  return { '--icon-size': `${Number(size)}px` } as CSSProperties;
}

/** One icon of the app: the Lucide one, or the Phosphor / Obra equivalent while that set is chosen (Lucide when there is none).
 *  `cls` is the lucide-* class the Lucide icon carries; the others keep it so CSS and tests that select it still work. */
export function makeIcon(cls: string, lucide: Alt, phosphor: Alt, obra: Alt): LucideIcon {
  const Icon = forwardRef<SVGSVGElement, IconProps>((props, ref) => {
    const set = useSyncExternalStore(subscribeIconSet, readIconSet, () => 'lucide' as const);
    const alt = set === 'phosphor' ? phosphor : set === 'obra' ? obra : undefined;
    const sizeVar = iconSizeVar(props.size);
    const style = sizeVar ? { ...sizeVar, ...props.style } : props.style;
    if (!alt) return createElement(lucide!, { ...props, style, ref });
    const { strokeWidth, absoluteStrokeWidth: _abs, size = 24, className, style: _style, ...rest } = props;
    const classes = `${cls} ${className ?? ''}`.trim();
    // Phosphor is a fill set: weight stays 'regular', so strokeWidth does not apply there.
    return set === 'phosphor'
      ? createElement(alt, { ...rest, ref, size, style, weight: 'regular', className: classes })
      : createElement(alt, { ...rest, ref, size, style, strokeWidth, className: classes });
  });
  Icon.displayName = (lucide as { displayName?: string }).displayName;
  return Icon;
}
