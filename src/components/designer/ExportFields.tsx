import type { ComponentType } from 'react';
import { autoSuffix, row, type ExportFormat, type ExportRow, type ExportSettings } from '../../engine/design/exportSettings';
import { Check, ChevronDown, FileImage, FileText, Image, PenTool, Plus, Shapes, X } from '../ui/icons';
import { MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { InlineSelect } from './InlineControls';

type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export interface MenuOption<T extends string> { value: T; label: string; detail?: string; icon?: Icon; group?: string }

/** The app's field menu (like InlineSelect) whose choices may carry a short purpose line and groups. */
export function ExportMenu<T extends string>({ label, value, options, onChange, autoFocus, bare }: {
  label: string; value: T; options: MenuOption<T>[]; onChange: (value: T) => void; autoFocus?: boolean; /** Value only, the name as its accessible label (a compact bar). */ bare?: boolean;
}) {
  const pop = usePopover();
  const current = options.find((o) => o.value === value);
  let group: string | undefined;
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick" aria-label={bare ? `${label} · ${current?.label ?? value}` : undefined} aria-haspopup="listbox" aria-expanded={pop.open} autoFocus={autoFocus} onClick={pop.toggle}>
      {!bare && <span className="opt-label">{label}</span>}
      <span className="opt-value">{current?.label ?? value}</span>
      <ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={260} label={label}>
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
  png: { label: 'PNG', detail: 'Images and complex illustrations', icon: Image },
  webp: { label: 'WebP', detail: 'Smaller files for websites', icon: Shapes },
  svg: { label: 'SVG', detail: 'Scalable, for web and logos', icon: PenTool },
  pdf: { label: 'PDF', detail: 'Documents and printing', icon: FileText },
};
export const formatOptions: MenuOption<ExportFormat>[] = (['jpg', 'png', 'webp', 'svg', 'pdf'] as const).map((f) => ({ value: f, ...FORMAT_INFO[f] }));

/** A short text as one field, like the sliders: the name on the left, the text on the right. */
export function OptText({ label, value, placeholder, maxLength = 120, onChange }: { label: string; value: string; placeholder?: string; maxLength?: number; onChange: (v: string) => void }) {
  return <label className="opt opt-text">
    <span className="opt-label">{label}</span>
    <input value={value} placeholder={placeholder} maxLength={maxLength} spellCheck={false} aria-label={label} onChange={(e) => onChange(e.target.value)} />
  </label>;
}

const SCALES = [0.5, 0.75, 1, 1.5, 2, 3, 4];

/** Several files at once: a scale, a name suffix and a format per row. */
export function ExportRows({ rows, onChange }: { rows: ExportRow[]; onChange: (rows: ExportRow[]) => void }) {
  const edit = (i: number, change: Partial<ExportRow>) => onChange(rows.map((r, at) => (at === i ? { ...r, ...change } : r)));
  const add = () => { const scale = Math.min(8, (rows.at(-1)?.scale ?? 1) + 1); onChange([...rows, row(scale, rows.at(-1)?.format ?? 'png', autoSuffix(scale))]); };
  return <>
    {rows.map((r, i) => <div className="brush-row design-export-output" key={i} role="group" aria-label={`File ${i + 1}`}>
      <InlineSelect label={`Scale of file ${i + 1}`} value={r.scale} options={[...new Set([...SCALES, r.scale])].sort((a, b) => a - b).map((s) => ({ value: s, label: `${s}×` }))}
        onChange={(scale) => edit(i, { scale, suffix: r.suffix === autoSuffix(r.scale) ? autoSuffix(scale) : r.suffix })} />
      <OptText label="Suffix" value={r.suffix} placeholder="none" maxLength={20} onChange={(suffix) => edit(i, { suffix })} />
      <InlineSelect label={`Format of file ${i + 1}`} value={r.format} options={formatOptions.map((o) => ({ value: o.value, label: o.label }))} onChange={(format) => edit(i, { format })} />
      <button type="button" className="opt opt-pick is-icon" aria-label={`Remove file ${i + 1}`} disabled={rows.length < 2} onClick={() => onChange(rows.filter((_, at) => at !== i))}><X size={13} /></button>
    </div>)}
    <button type="button" className="opt opt-pick design-export-add" onClick={add}><Plus size={13} /><span className="opt-label">Add scale</span></button>
  </>;
}

/** Add a row list to settings (or fold it back to one file). */
export function withRows(rows: ExportRow[]): Partial<ExportSettings> {
  if (rows.length === 1) return { outputs: undefined, format: rows[0].format, size: rows[0].scale, preset: undefined };
  return { outputs: rows, preset: undefined };
}
