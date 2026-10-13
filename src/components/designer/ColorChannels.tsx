import { useState } from 'react';
import { Segmented } from '../ui/primitives';
import { colorRgb, colorHsl, rgbHex, hslHex, parseAlphaText, setRgbChannel } from '../../lib/color';

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
  return <div className="color-channels">
    <div className="color-channel-mode" role="group" aria-label="Color channels"><Segmented size="sm" value={mode} options={[{ value: 'hsl', label: 'HSL' }, { value: 'rgb', label: 'RGB' }]} onChange={setMode} /></div>
    {channels.map((c, i) => <label key={c.label} className="color-channel" title={c.label}>
      <span>{c.short}</span><input className="color-track" type="range" min={0} max={c.max} step={1} value={Math.round(c.value)} aria-label={c.label} style={{ background: c.gradient }} onChange={(e) => {
        const next = Number(e.target.value);
        if (mode === 'rgb') { const result = [...rgb]; result[i] = next; onChange(rgbHex(result)); }
        else { const result = [hue, hsl[1], hsl[2]]; result[i] = next; if (i === 0) onHueChange(next); onChange(hslHex(result)); }
      }} />
    </label>)}
    <ColorTextFields value={value} onChange={onChange} alpha={alpha} onAlphaChange={onAlphaChange} />
  </div>;
}

/** R, G, B and A typed by hand. A is the tool's opacity (one value, no copy); a wrong entry is not applied. */
function ColorTextFields({ value, onChange, alpha, onAlphaChange }: { value: string; onChange: (color: string) => void; alpha?: number; onAlphaChange?: (alpha: number) => void }) {
  const rgb = colorRgb(value);
  return <div className="color-text">
    {(['R', 'G', 'B'] as const).map((label, i) => <input key={label} className="color-num" type="number" min={0} max={255} step={1} aria-label={label} value={rgb[i]} onChange={(e) => { const next = setRgbChannel(value, i as 0 | 1 | 2, e.target.value); if (next) onChange(next); }} />)}
    {onAlphaChange && alpha !== undefined && <input key="A" className="color-num" type="number" min={0} max={100} step={1} aria-label="A" value={alpha} onChange={(e) => { const next = parseAlphaText(e.target.value); if (next !== null) onAlphaChange(next); }} />}
  </div>;
}
