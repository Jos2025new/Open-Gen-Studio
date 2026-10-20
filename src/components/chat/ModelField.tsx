import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { choiceEstimate, defaultChoice } from '../../engine/agent/settingsCard';
import type { SettingsChoice } from '../../engine/types';
import { formatUsd } from '../../lib/format';
import { useStore } from '../../store/store';
import { ModelIcon } from './cardIcons';
import { ChipPop } from './ChipPop';

/**
 * The model field of the settings cards: a chip with the model's icon and name that opens the list of models (price on
 * the right; the chosen row highlighted with a check; "Show other models" folds the rest, cheapest first). Used by the
 * confirm_settings card and by the follow-up card after a model switch, so both look and behave the same.
 */
export function ModelField({ kind, base, startImage, current, placeholder, leading, alternatives, initiallyOpen = false, onPick }: {
  kind: 'video' | 'image';
  /** The values the card holds: another model keeps them where it has them. */
  base: SettingsChoice;
  startImage: boolean;
  /** The chosen model (highlighted); undefined before any pick. */
  current?: string;
  placeholder?: string;
  /** Rows before the toggle, in order, with their tag ("recommended"). */
  leading: Array<{ ref: string; tag?: string }>;
  alternatives: string[];
  initiallyOpen?: boolean;
  onPick: (choice: SettingsChoice) => void;
}) {
  const models = useStore((s) => s.catalog.models);
  const schemas = useStore((s) => s.catalog.schemas);
  const [moreOpen, setMoreOpen] = useState(initiallyOpen);
  const name = (ref: string) => models[ref]?.name ?? ref.split('::')[1] ?? ref;
  const choiceFor = (ref: string): SettingsChoice => ({ ...defaultChoice(ref, schemas[ref], { kind, startImage, duration: base.duration, aspect: base.aspect }, base), needsImage: startImage });
  // Indicative: one clip or image with the values above. The exact cost comes on the plan card, once the prompts exist.
  const price = (ref: string) => {
    const e = choiceEstimate(choiceFor(ref), kind, 1);
    return e.usd == null ? 'price unknown' : `from ${formatUsd(e.usd)}`;
  };
  const usdOf = (ref: string) => choiceEstimate(choiceFor(ref), kind, 1).usd ?? Infinity;
  const row = (ref: string, tag?: string) => {
    const on = current === ref;
    return (
      <button key={ref} type="button" className={`q-opt set-model ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => onPick(choiceFor(ref))}>
        {on ? <Check size={12} /> : null}
        <span className="set-model-name">{name(ref)}</span>
        <span className="faint">{ref.split('::')[0]}{tag ? ` · ${tag}` : ''}</span>
        <span className="set-model-price num">{price(ref)}</span>
      </button>
    );
  };
  return (
    <ChipPop icon={<ModelIcon />} label={current ? name(current) : placeholder ?? 'Model'} tip="Model" width={480}>
      <div className="set-models">
        {leading.map((l) => row(l.ref, l.tag))}
        {alternatives.length ? (
          <button type="button" className="set-more" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            {moreOpen ? 'Hide other models' : `Show ${alternatives.length} other model${alternatives.length === 1 ? '' : 's'}`} <ChevronDown size={13} className={moreOpen ? 'is-flipped' : ''} />
          </button>
        ) : null}
        {moreOpen ? [...alternatives].sort((a, b) => usdOf(a) - usdOf(b)).map((ref) => row(ref)) : null}
      </div>
    </ChipPop>
  );
}
