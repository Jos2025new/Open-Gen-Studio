import { SIZE_PRESETS } from '../../engine/design/brushEngine';

/** One-click sizes, as in SAI's size grid. Dots grow on a log scale (3 → 18 px from the first to the last preset) so every step is visibly larger; sqrt made 1–5 look alike and capped 96–200. */
const dotFor = (s: number) => Math.round((3 + 15 * Math.log(s / SIZE_PRESETS[0]) / Math.log(SIZE_PRESETS[SIZE_PRESETS.length - 1] / SIZE_PRESETS[0])) * 10) / 10;

/** The brush card's size row, shared with Lineart; `max`/`min` keep it inside the size range of the slider it sits by. */
export function SizePresets({ value, onChange, min = 0, max = Infinity }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <div className="opt opt-presets" role="radiogroup" aria-label="Size presets">
    {SIZE_PRESETS.filter((s) => s >= min && s <= max).map((s) => <button key={s} type="button" role="radio" aria-checked={s === value} aria-label={`${s} px`} className={s === value ? 'is-on' : ''} onClick={() => onChange(s)}>
      <i style={{ width: dotFor(s), height: dotFor(s) }} /><span className="num">{s}</span>
    </button>)}
  </div>;
}
