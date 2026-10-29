import { useId, useState } from 'react';
import { aspectLabel, ratioOf } from '../../engine/params';

export function AspectGlyph({ value, size = 14 }: { value: string; size?: number }) {
  const r = ratioOf(value);
  if (r == null) return <span className="aspect-glyph is-auto" />;
  const w = r >= 1 ? size : Math.max(5, size * r);
  const h = r >= 1 ? Math.max(5, size / r) : size;
  return <span className="aspect-glyph" style={{ width: w, height: h }} />;
}

const COMMON = ['auto', '1:1', '16:9', '9:16', '4:3'];

/** Show a short set in Create; all model-provided values remain available. */
export function AspectChoices({ values, selected, onSelect, label, compact }: {
  values: string[]; selected?: string; onSelect: (value: string) => void; label: string; compact: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const ordered = compact ? [...values].sort((a, b) => {
    const rank = (v: string) => { const n = COMMON.indexOf(aspectLabel(v).toLowerCase()); return n < 0 ? COMMON.length : n; };
    return rank(a) - rank(b);
  }) : values;
  const limit = 5;
  let shown = ordered;
  if (compact && !expanded && ordered.length > limit) {
    shown = ordered.slice(0, limit);
    if (selected && ordered.includes(selected) && !shown.includes(selected)) shown = [...shown.slice(0, limit - 1), selected];
  }
  const extra = ordered.length - Math.min(limit, ordered.length);
  return <section className="fmt-sect">
    <div className="space-aspect-head"><span className="fmt-label">{label}</span>
      {compact && extra > 0 ? <button type="button" className="space-aspect-more" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(!expanded)}>{expanded ? 'Fewer' : `${extra} more`}</button> : null}
    </div>
    <div id={id} className="fmt-row fmt-aspects">
      {shown.map((value) => <button type="button" key={value} className={`fmt-opt ${value === selected ? 'is-active' : ''}`} aria-pressed={value === selected} onClick={() => onSelect(value)}>
        <AspectGlyph value={value} /><span>{aspectLabel(value)}</span>
      </button>)}
    </div>
  </section>;
}
