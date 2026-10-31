import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** A titled group of Settings rows: a small head (icon and title) over one framed card; rows inside are split by hairlines. */
export function SetGroup({ icon: Icon, title, children }: { icon?: LucideIcon; title?: string; children: ReactNode }) {
  return (
    <section className="set-group" aria-label={title}>
      {title ? <h3 className="set-group-head">{Icon ? <Icon size={13} /> : null}{title}</h3> : null}
      <div className="set-group-body">{children}</div>
    </section>
  );
}

/** One Settings row: icon and label on the left, the control on the right (`col` puts a wide control under the label). */
export function SetRow({ icon: Icon, label, tip, col, className, children }: { icon?: LucideIcon; label: ReactNode; tip?: string; col?: boolean; className?: string; children: ReactNode }) {
  return (
    <div className={['set-row', col ? 'col' : '', className ?? ''].filter(Boolean).join(' ')}>
      <span className="set-label" data-tip={tip}>{Icon ? <Icon size={14} className="set-row-icon" aria-hidden /> : null}{label}</span>
      {children}
    </div>
  );
}
