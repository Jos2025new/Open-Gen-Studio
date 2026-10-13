import { useState } from 'react';
import { Segmented } from '../ui/primitives';
import { colorRgb, colorHsl, rgbHex, hslHex, parseIntRange, setRgbChannel } from '../../lib/color';

/** The channels (sliders), the A slider and the labeled fields of one row: R G B A, or H S L A in HSL. */
export function ColorChannels({ value, hue, onHueChange, onChange, alpha, onAlphaChange }: { value: string; hue: number; onHueChange: (hue: number) => void; onChange: (color: string) => void; /** The tool's opacity in %, when the tool has one (the brush). */ alpha?: number; onAlphaChange?: (alpha: number) => void }) {
  const [mode, setMode] = useState<'hsl' | 'rgb'>('hsl');
  const rgb = colorRgb(value), hsl = colorHsl(value);
  const color = (s: number, l: number) => `hsl(${hue} ${s}% ${l}%)`;
  const channels = mode === 'hsl' ? [
    { label: 'Hue', short: 'H', value: hue, max: 359, gradient: 'linear-gradient(to right,red,#ff0,#0f0,#0ff,#00f,#f0f,red)' },
    { label: 'Saturation', short: 'S', value: hsl[1], max: 100, gradient: `linear-gradient(to right,${color(0, hsl[2])},${color(100, hsl[2])})` },
    { label: 'Lightness', short: 'L', value: hsl[2], max: 100, gradient: `linear-gradient(to right,#000,${color(hsl[1], 50)},#fff)` },
  ] : ['Red', 'Green', 'Blue'].map((label, i) => {
    const low = [...rgb], high = [...rgb]; low[i] = 0; high[i] = 255;
    return { label, short: label[0], value: rgb[i], max: 255, gradient: `linear-gradient(to right,${rgbHex(low)},${rgbHex(high)})` };
  });
  // The labeled fields: one row, each with its name (the same ranges as the sliders).
  const setChannel = (i: number, text: string) => {
    if (mode === 'rgb') { const next = setRgbChannel(value, i as 0 | 1 | 2, text); if (next) onChange(next); return; }
    const max = i === 0 ? 359 : 100;
    const v = parseIntRange(text, max);
    if (v === null) return;
    const result = [hue, hsl[1], hsl[2]]; result[i] = v;
    if (i === 0) onHueChange(v);
    onChange(hslHex(result));
  };
  const fields = mode === 'hsl'
    ? [['H', 'Hue', hue, 359, 0], ['S', 'Saturation', hsl[1], 100, 1], ['L', 'Lightness', hsl[2], 100, 2]] as const
    : [['R', 'Red', rgb[0], 255, 0], ['G', 'Green', rgb[1], 255, 1], ['B', 'Blue', rgb[2], 255, 2]] as const;
  return <div className="color-channels">
    <div className="color-channel-mode" role="group" aria-label="Color channels"><Segmented size="sm" value={mode} options={[{ value: 'hsl', label: 'HSLA', tip: 'Hue, saturation, lightness and alpha' }, { value: 'rgb', label: 'RGBA', tip: 'Red, green, blue and alpha' }]} onChange={setMode} /></div>
    {channels.map((c, i) => <label key={c.label} className="color-channel" title={c.label}>
      <span>{c.short}</span><input className="color-track" type="range" min={0} max={c.max} step={1} value={Math.round(c.value)} aria-label={c.label} style={{ background: c.gradient }} onChange={(e) => {
        const next = Number(e.target.value);
        if (mode === 'rgb') { const result = [...rgb]; result[i] = next; onChange(rgbHex(result)); }
        else { const result = [hue, hsl[1], hsl[2]]; result[i] = next; if (i === 0) onHueChange(next); onChange(hslHex(result)); }
      }} />
    </label>)}
    {onAlphaChange && alpha !== undefined && <label className="color-channel" title="Opacity (A)">
      <span>A</span><input className="color-track" type="range" min={0} max={100} step={1} value={alpha} aria-label="Alpha" style={{ background: `linear-gradient(to right,${value}00,${value}),conic-gradient(#bbb 25%,#fff 0 50%,#bbb 0 75%,#fff 0) 0 0/8px 8px` }} onChange={(e) => onAlphaChange(Number(e.target.value))} />
    </label>}
    <div className="color-fields" style={{ display: 'flex', gap: 6 }}>
      {fields.map(([short, name, v, max, index]) => <label key={short} title={`${name} (0–${max})`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span className="muted" style={{ fontSize: 11 }}>{short}</span>
        <input className="color-num" type="number" min={0} max={max} step={1} aria-label={name} value={Math.round(v)} style={{ width: '100%', minWidth: 0 }} onChange={(e) => setChannel(index, e.target.value)} />
      </label>)}
      {onAlphaChange && alpha !== undefined && <label title="Opacity (0–100)" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
        <span className="muted" style={{ fontSize: 11 }}>A</span>
        <input className="color-num" type="number" min={0} max={100} step={1} aria-label="A" value={alpha} style={{ width: '100%', minWidth: 0 }} onChange={(e) => { const v = parseIntRange(e.target.value, 100); if (v !== null) onAlphaChange(v); }} />
      </label>}
    </div>
  </div>;
}
