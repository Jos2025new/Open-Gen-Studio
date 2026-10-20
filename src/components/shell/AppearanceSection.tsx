import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { ACCENT_CHOICES, BASE_CHOICES, readTheme, setAccent, setBase, watchSystemTheme, type AccentChoice, type BaseChoice } from '../../lib/theme';
import { Segmented } from '../ui/primitives';

const BASE_LABELS: Record<BaseChoice, string> = { sistema: 'System', atlas: 'Atlas', grafito: 'Graphite', claro: 'Light', original: 'Original (old)' };
const ACCENT_LABELS: Record<AccentChoice, string> = { lima: 'Default (lime)', azul: 'Blue', violeta: 'Violet', rosa: 'Pink', agua: 'Aqua', aurora: 'Aurora' };

/** Settings → Appearance: base and highlight colour. Applied at once; kept in localStorage only (not in the store). */
export function AppearanceSection() {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => watchSystemTheme(), []);
  return (
    <section className="set-section">
      <div className="set-row col">
        <span className="set-label" data-tip="System follows your device: Atlas in dark, Light in light.">Base</span>
        <Segmented size="sm" value={theme.base} options={BASE_CHOICES.map((value) => ({ value, label: BASE_LABELS[value] }))} onChange={(base) => { setBase(base); setTheme((t) => ({ ...t, base })); }} />
      </div>
      <div className="set-row col">
        <span className="set-label">Highlight colour</span>
        <div className="accent-swatches" role="group" aria-label="Highlight colour">
          {ACCENT_CHOICES.map((accent) => (
            <button key={accent} type="button" data-accent={accent} aria-pressed={theme.accent === accent} aria-label={ACCENT_LABELS[accent]} title={ACCENT_LABELS[accent]} className={`accent-swatch ${theme.accent === accent ? 'is-on' : ''}`} onClick={() => { setAccent(accent); setTheme((t) => ({ ...t, accent })); }}>
              {theme.accent === accent ? <Check size={14} strokeWidth={3} /> : null}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
