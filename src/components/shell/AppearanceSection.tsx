import { useEffect, useSyncExternalStore } from 'react';
import { Check, Contrast, Droplet, Minus, Palette, Plus, Shapes, SwatchBook, Type, Zap } from '../ui/icons';
import { ACCENT_CHOICES, BASE_CHOICES, TEXT_SCALES, currentTextScale, readContrast, readIconSet, readReduceMotion, readStrongFocus, readTheme, setAccent, setBase, setContrast, setIconSet, setReduceMotion, setStrongFocus, stepTextScale, subscribePrefs, watchSystemTheme, type AccentChoice, type BaseChoice, type ContrastChoice, type IconSet } from '../../lib/theme';
import { IconButton, Segmented, Toggle } from '../ui/primitives';
import { SetGroup, SetRow } from './settings/SettingsRows';

const BASE_LABELS: Record<BaseChoice, string> = { sistema: 'System', atlas: 'Atlas', grafito: 'Graphite', claro: 'Light', blanco: 'White', original: 'Original (old)' };
const ACCENT_LABELS: Record<AccentChoice, string> = { lima: 'Default (lime)', azul: 'Blue', violeta: 'Violet', rosa: 'Pink', agua: 'Aqua', aurora: 'Aurora' };

const CONTRAST_OPTIONS: Array<{ value: ContrastChoice; label: string }> = [{ value: 'soft', label: 'Soft' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }];

const ICON_SET_OPTIONS: Array<{ value: IconSet; label: string }> = [{ value: 'lucide', label: 'Lucide' }, { value: 'phosphor', label: 'Phosphor' }, { value: 'obra', label: 'Obra' }];

/** A small picture of a base drawn with its own tokens: page, side bar, a panel with a line of text, the highlight. */
const Mini = ({ base }: { base: string }) => <span className="theme-mini" data-base={base}><i className="tm-side" /><i className="tm-panel"><i className="tm-line" /><i className="tm-dot" /></i></span>;

/** Settings → Appearance: base, highlight colour and icon set, then the Accessibility group (contrast, text size, reduce motion, focus outline). Applied at once; kept in localStorage only (not in the store). */
export function AppearanceSection() {
  // Read through a subscription (not copied into state): another tab's change shows here, and − / + step from the current value.
  const base = useSyncExternalStore(subscribePrefs, () => readTheme().base);
  const accent = useSyncExternalStore(subscribePrefs, () => readTheme().accent);
  const theme = { base, accent };
  const contrast = useSyncExternalStore(subscribePrefs, readContrast);
  const scale = useSyncExternalStore(subscribePrefs, currentTextScale);
  const motion = useSyncExternalStore(subscribePrefs, readReduceMotion);
  const focus = useSyncExternalStore(subscribePrefs, readStrongFocus);
  const icons = useSyncExternalStore(subscribePrefs, readIconSet);
  useEffect(() => watchSystemTheme(), []);
  return (
    <>
    <SetGroup icon={Palette} title="Theme">
      <SetRow col icon={SwatchBook} label="Base" tip="System follows your device: Atlas in dark, Light in light.">
        <div className="theme-thumbs" role="radiogroup" aria-label="Base">
          {BASE_CHOICES.map((value) => (
            <button key={value} type="button" role="radio" aria-checked={theme.base === value} className={`theme-thumb ${theme.base === value ? 'is-on' : ''}`} onClick={() => { setBase(value); }}>
              {value === 'sistema' ? <span className="theme-split"><Mini base="atlas" /><Mini base="claro" /></span> : <Mini base={value} />}
              {BASE_LABELS[value]}
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow icon={Droplet} label="Highlight colour">
        <div className="accent-swatches" role="group" aria-label="Highlight colour">
          {ACCENT_CHOICES.map((accent) => (
            <button key={accent} type="button" data-accent={accent} aria-pressed={theme.accent === accent} aria-label={ACCENT_LABELS[accent]} title={ACCENT_LABELS[accent]} className={`accent-swatch ${theme.accent === accent ? 'is-on' : ''}`} onClick={() => { setAccent(accent); }}>
              {theme.accent === accent ? <Check size={12} strokeWidth={3} /> : null}
            </button>
          ))}
        </div>
      </SetRow>
      <SetRow icon={Shapes} label="Icons" tip="Icon set used across the app. Lucide is the default; Phosphor and Obra swap the icons they have an equivalent for.">
        <Segmented value={icons} options={ICON_SET_OPTIONS} onChange={(v) => { setIconSet(v); }} size="sm" />
      </SetRow>
    </SetGroup>
    <SetGroup icon={Contrast} title="Accessibility">
      <SetRow icon={Contrast} label="Contrast" tip="Soft brings panels and lines closer together. High brightens text and strengthens lines, in every base.">
        <Segmented value={contrast} options={CONTRAST_OPTIONS} onChange={(v) => { setContrast(v); }} size="sm" />
      </SetRow>
      <SetRow icon={Type} label="Text size" tip="Scales the interface text from 87.5 % to 200 %.">
        <span className="text-size-ctl" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <IconButton icon={Minus} label="Smaller text" size="sm" disabled={scale === TEXT_SCALES[0]} onClick={() => stepTextScale(-1)} />
          <output aria-label="Text size" className="num">{`${scale * 100} %`}</output>
          <IconButton icon={Plus} label="Larger text" size="sm" disabled={scale === TEXT_SCALES[TEXT_SCALES.length - 1]} onClick={() => stepTextScale(1)} />
        </span>
      </SetRow>
      <SetRow icon={Zap} label="Reduce motion" tip="Turns off transitions and animations. Follows your device setting until you change it.">
        <Toggle checked={motion} onChange={(v) => { setReduceMotion(v); }} label="Reduce motion" />
      </SetRow>
      <SetRow icon={Contrast} label="Stronger focus" tip="A thick outline in the highlight colour around the control you reach with the keyboard.">
        <Toggle checked={focus} onChange={(v) => { setStrongFocus(v); }} label="Stronger focus" />
      </SetRow>
    </SetGroup>
    </>
  );
}
