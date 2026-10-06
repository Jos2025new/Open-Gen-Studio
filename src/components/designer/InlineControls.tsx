import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { MenuItem, Range } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { useStore } from '../../store/store';
import { rememberColor, removeSwatch, saveSwatch } from '../../engine/design/swatches';
import { colorHsl } from '../../lib/color';
import { ColorPlane } from './ColorPlane';
import { ColorChannels } from './ColorChannels';

/**
 * A number set right in the bar: short label, a small slider and the value (type it, or scroll the wheel over it).
 * No menu to open: what it is and what it holds stay in sight.
 */
export function InlineSlider({ label, value, min, max, step = 1, unit = '', scale = 1, allowManualOverflow = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; scale?: number; allowManualOverflow?: boolean; onChange: (v: number) => void }) {
  const shown = Math.round(value * scale * 100) / 100;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  return <label className="opt opt-slider" onWheel={(e) => { set(+(value + (e.deltaY < 0 ? step : -step)).toFixed(4)); }}>
    <span className="opt-label">{label}</span>
    <Range className="opt-range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => set(+e.target.value)} />
    <input className="opt-num num" style={{ width: `${Math.max(1, String(shown).length) + 0.6}ch` }} type="number" min={min * scale} max={allowManualOverflow ? undefined : max * scale} step={step * scale} value={shown} aria-label={`${label} value`} onChange={(e) => { const v = +e.target.value / scale; if (Number.isFinite(v)) allowManualOverflow ? onChange(Math.max(min, v)) : set(v); }} />
    {unit && <span className="opt-unit">{unit}</span>}
  </label>;
}

/**
 * A color in the bar: click for the picker, a hex field, the recent colors and the saved ones (shared by every tool).
 * The color is remembered as recent when the panel closes, so dragging in the picker does not fill the list.
 */
export function InlineColor({ label, value, onChange, showValue = false, children }: { label: string; value: string; showValue?: boolean; children?: ReactNode; onChange: (v: string) => void }) {
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
    <button type="button" ref={pop.ref} className="opt opt-color" aria-label={`${label} · ${value}`} data-tip={label} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => { setHex(value); pop.toggle(); }}>
      <span className="opt-label">{label}</span><span className="opt-swatch" style={{ background: value }} />{(showValue || label === 'Text color') && <span className="opt-value">{value.toUpperCase()}</span>}
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
export function InlineSelect<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: Array<T | { value: T; label: string }>; onChange: (v: T) => void }) {
  const pop = usePopover();
  const items = options.map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
  const current = items.find((o) => o.value === value)?.label ?? String(value);
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick" aria-haspopup="listbox" aria-expanded={pop.open} onClick={pop.toggle}>
      <span className="opt-label">{label}</span><span className="opt-value">{current}</span><ChevronDown size={12} />
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={170} label={label}>
      <div className="menu" role="listbox">
        {items.map((o) => <MenuItem key={String(o.value)} label={o.label} active={o.value === value} onClick={() => { onChange(o.value); pop.close(); }} />)}
      </div>
    </Popover>
  </>;
}

