import { useEffect, useState } from 'react';
import { Check, Contrast, Droplet, Palette, SwatchBook } from 'lucide-react';
import { ACCENT_CHOICES, BASE_CHOICES, readSoftContrast, readTheme, setAccent, setBase, setSoftContrast, watchSystemTheme, type AccentChoice, type BaseChoice } from '../../lib/theme';
import { Toggle } from '../ui/primitives';
import { SetGroup, SetRow } from './settings/SettingsRows';

const BASE_LABELS: Record<BaseChoice, string> = { sistema: 'System', atlas: 'Atlas', grafito: 'Graphite', claro: 'Light', blanco: 'White', original: 'Original (old)' };
const ACCENT_LABELS: Record<AccentChoice, string> = { lima: 'Default (lime)', azul: 'Blue', violeta: 'Violet', rosa: 'Pink', agua: 'Aqua', aurora: 'Aurora' };

/** A small picture of a base drawn with its own tokens: page, side bar, a panel with a line of text, the highlight. */
const Mini = ({ base }: { base: string }) => <span className="theme-mini" data-base={base}><i className="tm-side" /><i className="tm-panel"><i className="tm-line" /><i className="tm-dot" /></i></span>;

/** Settings → Appearance: base and highlight colour. Applied at once; kept in localStorage only (not in the store). */
export function AppearanceSection() {
  const [theme, setTheme] = useState(readTheme);
  const [soft, setSoft] = useState(readSoftContrast);
  useEffect(() => watchSystemTheme(), []);
  return (
    <SetGroup icon={Palette} title="Theme">
      <SetRow col icon={SwatchBook} label="Base" tip="System follows your device: Atlas in dark, Light in light.">
        <div className="theme-thumbs" role="radiogroup" aria-label="Base">
          {BASE_CHOICES.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={theme.base === value} className={`theme-thumb ${theme.base === value ? 'is-on' : ''}`} onClick={() => { setBase(value); setTheme((t) => ({ ...t, base: value })); }}>
              {value === 'sistema' ? <span className="theme-split"><Mini base="atlas" /><Mini base="claro" /></span> : <Mini base={value} />}
              {BASE_LABELS[value]}
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow icon={Droplet} label="Highlight colour">
        <div className="accent-swatches" role="group" aria-label="Highlight colour">
          {ACCENT_CHOICES.map((accent) => (
            <button key={accent} type="button" data-accent={accent} aria-pressed={theme.accent === accent} aria-label={ACCENT_LABELS[accent]} title={ACCENT_LABELS[accent]} className={`accent-swatch ${theme.accent === accent ? 'is-on' : ''}`} onClick={() => { setAccent(accent); setTheme((t) => ({ ...t, accent })); }}>
              {theme.accent === accent ? <Check size={12} strokeWidth={3} /> : null}
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow icon={Contrast} label="Soft contrast" tip="Brings panels, popovers, fields and lines closer to each other, in every base. Text and highlight colours keep their contrast.">
        <Toggle checked={soft} onChange={(v) => { setSoftContrast(v); setSoft(v); }} label="Soft contrast" />
      </SetRow>
    </SetGroup>
  );
}
