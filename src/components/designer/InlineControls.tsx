import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from '../ui/icons';
import { MenuItem, Range } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/store';
import { activeKit, activeKitColors } from '../../engine/activeKit';
import { tokenChoices, type TokenChoice } from '../../engine/design/tokenBind';
import type { TokenRef } from '../../engine/libraryTypes';
import { rememberColor, removeSwatch, saveSwatch } from '../../engine/design/swatches';
import { alphaFromOpacity, colorHsl, hexShown, opacityFromAlpha, parseHexAlpha } from '../../lib/color';
import { ColorPlane } from './ColorPlane';
import { ColorChannels } from './ColorChannels';

/**
 * A number as one field (the app's only slider): the whole field is the track, filled up to the value, with the
 * name on the left and the value on the right. Drag anywhere on it, use the arrow keys, scroll over it, or click
 * the value to type it. A short range shows its steps as dots. Every tool and panel uses this one.
 */
export function InlineSlider({ label, value, min, max, step = 1, unit = '', scale = 1, log = false, allowManualOverflow = false, typedRange, badge, disabled, icon, tip, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; scale?: number; /** The track runs on a log scale (each stretch doubles the value): for zoom-like ranges such as 5%–3200%. */ log?: boolean; allowManualOverflow?: boolean; /** What can be typed when it is wider than the track. */ typedRange?: [number, number]; /** A small button after the name. */ badge?: ReactNode; disabled?: boolean; /** Shown in place of the name where space is short; the name stays as its label and tooltip. */ icon?: ReactNode; /** Tooltip on the whole field. */ tip?: string; onChange: (v: number) => void }) {
  // A typed value outside the range waits until the field is left (Enter or blur), so typing "250" into a 5–3200
  // field does not clamp at the first "2".
  const [draft, setDraft] = useState<string | null>(null);
  const shown = log ? Math.round(value * scale) : Math.round(value * scale * 100) / 100;
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)));
  const typedLo = typedRange?.[0] ?? min, typedHi = typedRange?.[1] ?? (allowManualOverflow ? Infinity : max);
  const pos = (v: number) => (log ? Math.log2(v) : v);
  const lo = pos(min), hi = pos(max);
  const fill = hi > lo ? Math.min(100, Math.max(0, ((pos(value) - lo) / (hi - lo)) * 100)) : 0;
  const steps = log ? 0 : Math.round((max - min) / step);
  const commit = (raw: string) => { setDraft(null); const v = +raw / scale; if (raw.trim() && Number.isFinite(v)) onChange(Math.min(typedHi, Math.max(typedLo, v))); };
  return <label className={`opt opt-slider${disabled ? ' is-disabled' : ''}`} data-tip={tip} style={{ '--fill': `${fill}%` } as CSSProperties} onWheel={(e) => { if (!disabled) set(log ? value * (e.deltaY < 0 ? 1.1 : 1 / 1.1) : +(value + (e.deltaY < 0 ? step : -step)).toFixed(4)); }}>
    {steps > 1 && steps <= 12 && <span className="opt-ticks" aria-hidden="true">{Array.from({ length: steps - 1 }, (_, i) => <i key={i} style={{ left: `${((i + 1) / steps) * 100}%` }} />)}</span>}
    <Range className="opt-range" min={lo} max={hi} step={log ? 0.01 : step} value={pos(value)} disabled={disabled} aria-label={label} onChange={(e) => set(log ? 2 ** +e.target.value : +e.target.value)} />
    <span className="opt-label" data-tip={icon ? label : undefined}>{icon ?? label}</span>
    {badge}
    <span className="opt-readout">
      <input className="opt-num num" style={{ width: `${Math.max(1, (draft ?? String(shown)).length) + 0.6}ch` }} type="number" disabled={disabled} min={typedLo * scale} max={typedHi === Infinity ? undefined : typedHi * scale} step={log ? 'any' : step * scale} value={draft ?? shown} aria-label={`${label} value`}
        onChange={(e) => { const v = +e.target.value / scale; if (e.target.value !== '' && Number.isFinite(v) && v >= typedLo && v <= typedHi) { setDraft(null); onChange(v); } else setDraft(e.target.value); }}
        onBlur={(e) => { if (draft !== null) commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape' && draft !== null) { e.stopPropagation(); setDraft(null); } }} />
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

/** The mode of the document on screen, and the Library entry it belongs to. */
export const useTokenMode = () => useStore(useShallow((s) => { const x = s.sessions[s.activeSessionId], d = x?.docs.find((y) => y.id === x.activeDocId); return [d?.tokenMode, d?.library?.subjectId] as const; }));

/**
 * A color in the bar: click for the picker, a hex field, the recent colors and the saved ones (shared by every tool).
 * The color is remembered as recent when the panel closes, so dragging in the picker does not fill the list.
 */
export function InlineColor(props: { label: string; value: string; /** The brand token the value comes from. */ token?: TokenRef; /** Only opaque 6-digit colors fit this field (page background). */ opaque?: boolean; /** CSS background of the swatch when it is not just the value (a gradient). */ preview?: string; showValue?: boolean; /** The tool's opacity (0–1) as alpha: A and #RRGGBBAA read and write it. */ alpha?: { value: number; onChange: (opacity: number) => void }; /** Just the swatch, as a round button (the brush row). */ iconOnly?: boolean; children?: ReactNode; onChange: (v: string, token?: TokenRef, prev?: TokenRef) => void }) {
  const { label, value, onChange, showValue = false, iconOnly = false, alpha, children, preview, token, opaque } = props, binds = 'token' in props;
  const pop = usePopover();
  const sw = useStore((s) => s.ui.swatches) ?? { recent: [], saved: [] };
  const [hex, setHex] = useState(() => hexShown(value, alpha?.value));
  const [hue, setHue] = useState(() => colorHsl(value)[0]);
  useEffect(() => { const [h, s] = colorHsl(value); if (s > 0) setHue(h); }, [value]);
  const kit = useStore(activeKit), library = useStore((s) => s.library), kitColors = useStore(useShallow(activeKitColors)), [mode, own] = useTokenMode();
  const tokens = useMemo(() => (pop.open ? tokenChoices('color', mode, own).filter((t) => !opaque || String(t.ref.value).length === 7) : []), [pop.open, kit, library, mode, own, opaque]);
  const plain = kitColors.filter((c) => (!opaque || c.length === 7) && !tokens.some((t) => t.ref.value === c));
  const close = () => { rememberColor(value); pop.close(); };
  const pick = (c: string) => { onChange(c); setHex(hexShown(c, alpha?.value)); };
  const choose = (raw: string, ref?: TokenRef) => {
    const p = parseHexAlpha(raw);
    if (!p) return;
    const hasAlpha = raw.length === 9, nextOp = hasAlpha ? opacityFromAlpha(p.alpha) : binds && String(token?.value).length === 9 ? 1 : alpha?.value;
    if (binds) onChange(raw, ref, token);
    else { onChange(p.color); if (hasAlpha && alpha) alpha.onChange(opacityFromAlpha(p.alpha)); }
    setHex(hexShown(p.color, alpha ? nextOp : undefined));
  };
  const shown = hexShown(value, alpha?.value).toLowerCase();
  const tokenChip = ({ ref, label: name }: TokenChoice) => (
    <button key={`${ref.kit}${ref.token}`} type="button" className={`swatch${token?.kit === ref.kit && token.token === ref.token ? ' is-on' : ''}`} style={{ background: String(ref.value) }} aria-label={name} data-tip={name} onClick={() => choose(String(ref.value), ref)} />
  );
  const chip = (c: string, saved: boolean) => (
    <button key={`${saved}${c}`} type="button" className={`swatch${c === (c.length === 9 ? shown : value.toLowerCase()) ? ' is-on' : ''}`} style={{ background: c }} aria-label={c} data-tip={saved ? `${c} · right-click to remove` : c}
      onClick={() => choose(c)} onContextMenu={saved ? (e) => { e.preventDefault(); removeSwatch(c); } : undefined} />
  );
  return <>
    <button type="button" ref={pop.ref} className={`opt opt-color${iconOnly ? ' is-icon' : ''}`} aria-label={`${label} · ${token?.token ?? value}`} data-tip={token ? `${label} · ${token.token}` : label} aria-haspopup="dialog" aria-expanded={pop.open} onClick={() => { setHex(hexShown(value, alpha?.value)); pop.toggle(); }}>
      {!iconOnly && <span className="opt-label">{label}</span>}<span className="opt-swatch" style={{ background: preview ?? hexShown(value, alpha?.value) }} />{!iconOnly && (showValue || label === 'Text color') && <span className="opt-value">{token?.token ?? hexShown(value, alpha?.value).toUpperCase()}</span>}
    </button>
    <Popover open={pop.open} anchor={pop.ref} onClose={close} placement="bottom-start" width={260} label={label}>
      <div className="swatch-panel">
        <ColorPlane value={value} hue={hue} onChange={pick} />
        <ColorChannels value={value} hue={hue} onHueChange={setHue} onChange={pick} alpha={alpha ? alphaFromOpacity(alpha.value) : undefined} onAlphaChange={alpha ? (a) => alpha.onChange(opacityFromAlpha(a)) : undefined} />
        {children}
        <div className="swatch-row">
          <span className="picker-preview" style={{ background: hexShown(value, alpha?.value) }} aria-hidden="true" />
          <input className="swatch-hex" value={hex} aria-label="Hex" spellCheck={false} onChange={(e) => { setHex(e.target.value); const raw = e.target.value.trim(), p = parseHexAlpha(raw); if (p) { if (binds && alpha && raw.replace(/^#/, '').length === 8) onChange(raw.startsWith('#') ? raw : `#${raw}`); else { onChange(p.color); if (alpha && raw.replace(/^#/, '').length === 8) alpha.onChange(opacityFromAlpha(p.alpha)); } } }} />
          <button type="button" className="sb-link" onClick={() => saveSwatch(value)} disabled={sw.saved.includes(value.toLowerCase())}>Save</button>
        </div>
        {tokens.length + plain.length > 0 && <><span className="field-label">{kit?.name ?? tokens[0]?.kit}</span><div className="swatch-grid">{tokens.map(tokenChip)}{plain.map((c) => chip(c, false))}</div></>}
        {sw.recent.length > 0 && <><span className="field-label">Recent</span><div className="swatch-grid">{sw.recent.map((c) => chip(c, false))}</div></>}
        {sw.saved.length > 0 && <><span className="field-label">Saved</span><div className="swatch-grid">{sw.saved.map((c) => chip(c, true))}</div></>}
      </div>
    </Popover>
  </>;
}

/** A short list in the bar: the value with a chevron; the choices open in the app's own menu. */
export function InlineSelect<T extends string | number>({ label, value, options, icon, more, onChange }: { label: string; value: T; options: Array<T | { value: T; label: string }>; /** Shown alone, as a round button, instead of the name and value (the brush row). */ icon?: ReactNode; /** Rows after the options. */ more?: (close: () => void) => ReactNode; onChange: (v: T) => void }) {
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
      {more ? <div className="menu">{more(pop.close)}</div> : null}
    </Popover>
  </>;
}

