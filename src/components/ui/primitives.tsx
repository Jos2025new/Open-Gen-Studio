import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import type { Estimate } from '../../engine/types';

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };

export function IconButton({
  icon: Icon,
  label,
  size = 'md',
  active,
  tone = 'default',
  tipSide,
  className,
  ...rest
}: BtnProps & { icon: LucideIcon; label: string; size?: 'sm' | 'md' | 'lg'; active?: boolean; tone?: 'default' | 'danger' | 'accent'; tipSide?: 'top' | 'right' }) {
  const px = size === 'sm' ? 14 : size === 'lg' ? 18 : 16;
  return (
    <button
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-side={tipSide}
      className={`icon-btn icon-btn-${size} tone-${tone} ${active ? 'is-active' : ''} ${className ?? ''}`}
      {...rest}
    >
      <Icon size={px} strokeWidth={1.75} />
    </button>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  children,
  className,
  ...rest
}: BtnProps & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; icon?: LucideIcon; loading?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size} ${className ?? ''}`} {...rest}>
      {loading ? <LoaderCircle size={14} className="spin" /> : Icon ? <Icon size={14} strokeWidth={1.9} /> : null}
      {children}
    </button>
  );
}

/** A compact trigger used in the composer and toolbars (label + optional value). */
export function Chip({
  icon: Icon,
  children,
  active,
  muted,
  className,
  ...rest
}: BtnProps & { icon?: LucideIcon; active?: boolean; muted?: boolean; children?: ReactNode }) {
  return (
    <button type="button" className={`chip ${active ? 'is-active' : ''} ${muted ? 'is-muted' : ''} ${className ?? ''}`} {...rest}>
      {Icon ? <Icon size={14} strokeWidth={1.8} /> : null}
      {children}
    </button>
  );
}

export function costLabel(e: Estimate | null | undefined, opts: { short?: boolean } = {}): string {
  if (!e) return '';
  if (e.usd == null) return opts.short ? 'n/a' : 'Price n/a';
  if (e.usd === 0 && !e.lowerBound) return 'Free';
  const v = formatUsd(e.usd);
  if (e.lowerBound) return `≥${v}`;
  return e.approximate ? `≈${v}` : v;
}

export function CostTag({ estimate, className }: { estimate: Estimate | null | undefined; className?: string }) {
  if (!estimate) return null;
  const free = estimate.usd === 0 && !estimate.lowerBound;
  return (
    <span className={`cost-tag num ${free ? 'is-free' : ''} ${estimate.usd == null ? 'is-unknown' : ''} ${className ?? ''}`} data-tip={estimate.note}>
      {costLabel(estimate)}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: Array<{ value: T; label: ReactNode; tip?: string }>; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div className={`segmented seg-${size}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} data-tip={o.tip} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`toggle ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return <LoaderCircle size={size} className="spin" strokeWidth={2} />;
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/** List row for menus inside popovers. */
export function MenuItem({
  icon: Icon,
  label,
  detail,
  right,
  active,
  danger,
  disabled,
  onClick,
  tip,
}: {
  icon?: LucideIcon;
  label: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  tip?: string;
}) {
  return (
    <button type="button" className={`menu-item ${active ? 'is-active' : ''} ${danger ? 'is-danger' : ''}`} disabled={disabled} onClick={onClick} data-tip={tip}>
      {Icon ? <Icon size={15} strokeWidth={1.8} className="menu-icon" /> : null}
      <span className="menu-text">
        <span className="menu-label">{label}</span>
        {detail ? <span className="menu-detail">{detail}</span> : null}
      </span>
      {right ? <span className="menu-right">{right}</span> : null}
    </button>
  );
}
