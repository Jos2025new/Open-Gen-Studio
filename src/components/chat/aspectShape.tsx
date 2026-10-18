import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { aspectLabel, ratioOf } from '../../engine/params';

/** Width and height of a true-proportion shape whose longest side is `max` px (never distorted by a minimum). */
export function shapeDims(value: string, max: number): { w: number; h: number; auto: boolean } {
  const r = ratioOf(value);
  if (r == null || !(r > 0)) return { w: max, h: max, auto: true };
  const w = r >= 1 ? max : max * r;
  const h = r >= 1 ? max / r : max;
  return { w: Math.max(2, Math.round(w * 100) / 100), h: Math.max(2, Math.round(h * 100) / 100), auto: false };
}

/** The outline of an aspect ratio at its real proportion, tight to the label that follows it. */
export function AspectShape({ value, max = 14, className }: { value: string; max?: number; className?: string }) {
  const d = shapeDims(value, max);
  return <span className={`cc-shape${d.auto ? ' is-auto' : ''}${className ? ` ${className}` : ''}`} data-shape={value} style={{ width: d.w, height: d.h }} aria-hidden />;
}

/** The ratios most people reach for, in the order the picker shows them. */
export const COMMON_RATIOS = ['1:1', '3:4', '9:16', '16:9', '3:2'] as const;

/** Up to five common ratios the model supports (the first five it has when none of the common ones are), and the rest. */
export function splitRatios(all: string[]): { main: string[]; rest: string[] } {
  const label = (v: string) => aspectLabel(v);
  const common = COMMON_RATIOS.flatMap((c) => all.filter((v) => label(v) === c).slice(0, 1));
  const main = common.length ? common : all.slice(0, 5);
  return { main, rest: all.filter((v) => !main.includes(v)) };
}

/** The format picker: five common shapes (28×28 box each) and "More ▾" for the rest. Selected is lime. */
export function AspectPicker({ values, value, onPick, extra }: { values: string[]; value: string | undefined; onPick: (v: string) => void; extra?: React.ReactNode }) {
  const { main, rest } = splitRatios(values);
  const [more, setMore] = useState(() => value != null && rest.includes(value));
  const opt = (v: string) => (
    <button key={v} type="button" className={`cc-ratio${v === value ? ' is-on' : ''}`} aria-pressed={v === value} onClick={() => onPick(v)}>
      <span className="cc-ratio-box"><AspectShape value={v} max={20} /></span>
      <span>{aspectLabel(v)}</span>
    </button>
  );
  return (
    <div className="cc-aspect-pop">
      <div className="cc-cap">Format</div>
      <div className="cc-ratios">
        {main.map(opt)}
        {rest.length ? (
          <button type="button" className="cc-ratio cc-more" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            {more ? 'Less' : 'More'} {more ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : null}
      </div>
      {more ? <div className="cc-ratios cc-ratios-more">{rest.map(opt)}</div> : null}
      {extra}
    </div>
  );
}
