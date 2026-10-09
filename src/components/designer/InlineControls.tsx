import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { MenuItem, Range } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { useStore } from '../../store/store';
import { rememberColor, removeSwatch, saveSwatch } from '../../engine/design/swatches';
import { colorHsl } from '../../lib/color';
import { ColorPlane } from './ColorPlane';
import { ColorChannels } from './ColorChannels';

/**
 * A number as one field (the app's only slider): the whole field is the track, filled up to the value, with the
 * name on the left and the value on the right. Drag anywhere on it, use the arrow keys, scroll over it, or click
 * the value to type it. A short range shows its steps as dots. Every tool and panel uses this one.
 */
export function InlineSlider({ label, value, min, max, step = 1, unit = '', scale = 1, allowManualOverflow = false, disabled, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; scale?: number; allowManualOverflow?: boolean; disabled?: boolean; onChange: (v: number) => void }) {
  const shown = Math.round(value * scale * 100) / 100;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const fill = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;
  const steps = Math.round((max - min) / step);
  return <label className={`opt opt-slider${disabled ? ' is-disabled' : ''}`} style={{ '--fill': `${fill}%` } as CSSProperties} onWheel={(e) => { if (!disabled) set(+(value + (e.deltaY < 0 ? step : -step)).toFixed(4)); }}>
    {steps > 1 && steps <= 12 && <span className="opt-ticks" aria-hidden="true">{Array.from({ length: steps - 1 }, (_, i) => <i key={i} style={{ left: `${((i + 1) / steps) * 100}%` }} />)}</span>}
    <Range className="opt-range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={label} onChange={(e) => set(+e.target.value)} />
    <span className="opt-label">{label}</span>
    <span className="opt-readout">
      <input className="opt-num num" style={{ width: `${Math.max(1, String(shown).length) + 0.6}ch` }} type="number" disabled={disabled} min={min * scale} max={allowManualOverflow ? undefined : max * scale} step={step * scale} value={shown} aria-label={`${label} value`} onChange={(e) => { const v = +e.target.value / scale; if (Number.isFinite(v)) allowManualOverflow ? onChange(Math.max(min, v)) : set(v); }} />
      {unit && <span className="opt-unit">{unit}</span>}
    </span>
  </label>;
}

/** An on/off setting as one field, like the slider: the name on the left, the switch on the right. */
export function InlineToggle({ label, checked, tip, onChange }: { label: string; checked: boolean; tip?: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} className={`opt opt-toggle${checked ? ' is-on' : ''}`} data-tip={tip} onClick={() => onChange(!checked)}>
    <span className="opt-label">{label}</span><span className={`toggle${checked ? ' is-on' : ''}`} aria-hidden="true"><span /></span>
  </button>;
}

/** A few named choices side by side in one field (the selected one filled), each drawn by `render`. */
export function InlineChoice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string; render?: ReactNode }>; onChange: (v: T) => void }) {
  return <div className="opt opt-choice" role="radiogroup" aria-label={label}>
    <span className="opt-label">{label}</span>
    <span className="opt-choices">{options.map((o) => <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} aria-label={o.label} data-tip={o.label} className={o.value === value ? 'is-on' : ''} onClick={() => onChange(o.value)}>{o.render ?? o.label}</button>)}</span>
  </div>;
}

/**
 * A color in the bar: click for the picker, a hex field, the recent colors and the saved ones (shared by every tool).
 * The color is remembered as recent when the panel closes, so dragging in the picker does not fill the list.
 */
export function InlineColor({ label, value, onChange, showValue = false, iconOnly = false, children }: { label: string; value: string; showValue?: boolean; /** Just the swatch, as a round button (the brush row). */ iconOnly?: boolean; children?: ReactNode; onChange: (v: string) => void }) {
  const pop = usePopover();
  const sw = useStore((s) => s.ui.swatches) ?? { recent: [], saved: [] };
  const [hex, setHex] = useState(value);
  const [hue, setHue] = useState(() => colorHsl(value)[0]);
  useEffect(() => { const [h, s] = colorHsl(value); if (s > 0) setHue(h); }, [value]);
  const close = () => { rememberColor(value); pop.close(); };
  const pick = (c: string) => { onChange(c); setHex(c); };
  const chip = (c: string, saved: boolean) => (
    <button key={`${saved}${c}`} type="button" className={`swatch${c === value.toLowerCase() ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} data-tip={saved ? `${c} · right-click to remove` : c}
      onClick={() => pick(c)} onContextMenu={saved ? (e) => { e.preventDefault(); removeSwatch(c); } : undefined} />
  );
  return <>
    <button type="button" ref={pop.ref} className={`opt opt-color${iconOnly ? ' is-icon' : ''}`} aria-label={`${label} · ${value}`} data-tip={label} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => { setHex(value); pop.toggle(); }}>
      {!iconOnly && <span className="opt-label">{label}</span>}<span className="opt-swatch" style={{ background: value }} />{!iconOnly && (showValue || label === 'Text color') && <span className="opt-value">{value.toUpperCase()}</span>}
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={close} placement="bottom-start" width={260} label={label}>
      <div className="swatch-panel">
        <ColorPlane value={value} hue={hue} onChange={pick} />
        <ColorChannels value={value} hue={hue} onHueChange={setHue} onChange={pick} />
        {children}
        <div className="swatch-row">
          <span className="picker-preview" style={{ background: value }} aria-hidden="true" />
          <input className="swatch-hex" value={hex} aria-label="Hex" spellCheck={false} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()); }} />
          <button type="button" className="sb-link" onClick={() => saveSwatch(value)} disabled={sw.saved.includes(value.toLowerCase())}>Save</button>
        </div>
        {sw.recent.length > 0 && <><span className="field-label">Recent</span><div className="swatch-grid">{sw.recent.map((c) => chip(c, false))}</div></>}
        {sw.saved.length > 0 && <><span className="field-label">Saved</span><div className="swatch-grid">{sw.saved.map((c) => chip(c, true))}</div></>}
      </div>
    </Popover>
  </>;
}

/** A short list in the bar: the value with a chevron; the choices open in the app's own menu. */
export function InlineSelect<T extends string | number>({ label, value, options, icon, onChange }: { label: string; value: T; options: Array<T | { value: T; label: string }>; /** Shown alone, as a round button, instead of the name and value (the brush row). */ icon?: ReactNode; onChange: (v: T) => void }) {
  const pop = usePopover();
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  const current = items.find((o) => o.value === value)?.label ?? String(value);
  return <>
    <button type="button" ref={pop.ref} className={`opt opt-pick${icon ? ' is-icon' : ''}`} aria-label={icon ? `${label} · ${current}` : undefined} data-tip={icon ? `${label}: ${current}` : undefined} aria-haspopup="listbox" aria-expanded={pop.open} onClick={pop.toggle}>
      {icon ?? <><span className="opt-label">{label}</span><span className="opt-value">{current}</span><ChevronDown size={12} /></>}
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={170} label={label}>
      <div className="menu" role="listbox">
        {items.map((o) => <MenuItem key={String(o.value)} label={o.label} active={o.value === value} onClick={() => { onChange(o.value); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

