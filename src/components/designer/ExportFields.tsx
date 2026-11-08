import type { ComponentType, ReactNode } from 'react';
import { autoSuffix, row, type ExportFormat, type ExportRow, type ExportSettings } from '../../engine/design/exportSettings';
import { Check, ChevronDown, FileImage, FileText, Image, PenTool, Plus, Shapes, X } from '../ui/icons';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineSelect } from './InlineControls';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export interface MenuOption<T extends string> { value: T; label: string; detail?: string; icon?: Icon; group?: string }

/** The app's field menu with a one-line purpose under each choice (the format list, the "What is it for?" list). */
export function ExportMenu<T extends string>({ label, value, options, onChange, autoFocus }: {
  label: string; value: T; options: MenuOption<T>[]; onChange: (value: T) => void; autoFocus?: boolean;
}) {
  const pop = usePopover();
  const current = options.find((o) => o.value === value);
  const Current = current?.icon;
  let group: string | undefined;
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick" aria-haspopup="listbox" aria-expanded={pop.open} autoFocus={autoFocus} onClick={pop.toggle}>
      <span className="opt-label">{label}</span>
      <span className="opt-value">{Current && <Current size={13} />} {current?.label ?? value}</span>
      <ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={280} label={label}>
      <div className="menu" role="listbox">
        {options.map((o) => {
          const head = o.group && o.group !== group ? <div className="menu-sep-label" key={`g-${o.group}`}>{o.group}</div> : null;
          group = o.group ?? group;
          return <span key={o.value} style={{ display: 'contents' }}>
            {head}
            <MenuItem icon={o.icon as never} label={o.label} detail={o.detail} active={o.value === value}
              right={o.value === value ? <Check size={13} /> : null} onClick={() => { onChange(o.value); pop.close(); }} />
          </span>;
        })}
      </div>
    </Popover>
  </>;
}

export const FORMAT_INFO: Record<ExportFormat, { label: string; detail: string; icon: Icon }> = {
  jpg: { label: 'JPG', detail: 'Best for sharing', icon: FileImage },
  png: { label: 'PNG', detail: 'Best for images and complex illustrations', icon: Image },
  webp: { label: 'WebP', detail: 'Smaller files for websites', icon: Shapes },
  svg: { label: 'SVG', detail: 'Scalable, for web and logos', icon: PenTool },
  pdf: { label: 'PDF', detail: 'Documents and printing', icon: FileText },
};
export const formatOptions: MenuOption<ExportFormat>[] = (['jpg', 'png', 'webp', 'svg', 'pdf'] as const).map((f) => ({ value: f, ...FORMAT_INFO[f] }));

/** Several files at once: a scale, a name suffix and a format per row. */
export function ExportRows({ rows, onChange }: { rows: ExportRow[]; onChange: (rows: ExportRow[]) => void }) {
  const edit = (i: number, change: Partial<ExportRow>) => onChange(rows.map((r, at) => (at === i ? { ...r, ...change } : r)));
  const add = () => { const scale = Math.min(8, (rows.at(-1)?.scale ?? 1) + 1); onChange([...rows, row(scale, rows.at(-1)?.format ?? 'png', autoSuffix(scale))]); };
  return <div className="design-export-outputs" role="group" aria-label="Files">
    {rows.map((r, i) => <div className="design-export-output" key={i}>
      <span className="design-export-scale"><input type="number" min={0.1} max={8} step={0.25} aria-label={`Scale of file ${i + 1}`} value={r.scale || ''}
        onChange={(e) => { const scale = Number(e.target.value); edit(i, { scale, suffix: r.suffix === autoSuffix(r.scale) ? autoSuffix(scale) : r.suffix }); }} /><span aria-hidden="true">×</span></span>
      <input aria-label={`Name suffix of file ${i + 1}`} placeholder="suffix" value={r.suffix} onChange={(e) => edit(i, { suffix: e.target.value })} />
      <InlineSelect label={`Format of file ${i + 1}`} value={r.format} options={formatOptions.map((o) => ({ value: o.value, label: o.label }))} onChange={(format) => edit(i, { format })} />
      <button type="button" className="design-export-remove" aria-label={`Remove file ${i + 1}`} disabled={rows.length < 2} onClick={() => onChange(rows.filter((_, at) => at !== i))}><X size={13} /></button>
    </div>)}
    <button type="button" className="opt opt-pick" onClick={add}><Plus size={13} /><span className="opt-label">Add scale</span></button>
  </div>;
}

/** Add a row list to settings (or fold it back to one file). */
export function withRows(rows: ExportRow[]): Partial<ExportSettings> {
  if (rows.length === 1) return { outputs: undefined, format: rows[0].format, size: rows[0].scale, preset: undefined };
  return { outputs: rows, preset: undefined };
}

export function Hint({ children }: { children: ReactNode }) { return <p className="design-export-hint">{children}</p>; }
