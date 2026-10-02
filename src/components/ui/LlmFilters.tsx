import { Check } from 'lucide-react';
import { contextLabel, type LlmCapability, type LlmModel, type LlmSort } from '../../engine/providers/llm';
import { formatUsd } from '../../lib/format';
import { VisionTag } from './VisionTag';

const CAPS: Array<{ id: LlmCapability; label: string; tip: string }> = [
  { id: 'vision', label: 'Vision', tip: 'Sees images: attachments, the Designer page, results it looks at' },
  { id: 'reasoning', label: 'Reasoning', tip: 'Thinks before answering' },
  { id: 'videoInput', label: 'Video input', tip: 'Takes video as input' },
  { id: 'audioInput', label: 'Audio input', tip: 'Takes audio as input' },
];
const SORTS: Array<{ id: LlmSort; label: string }> = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'price', label: 'Price: low → high' },
  { id: 'context', label: 'Context: largest' },
  { id: 'name', label: 'Name A–Z' },
];

/** Capability checkboxes and order for agent model lists (tool calling is always required, so it is not a filter). */
export function LlmFilterBar({ caps, onCaps, sort, onSort }: { caps: LlmCapability[]; onCaps: (c: LlmCapability[]) => void; sort: LlmSort; onSort: (s: LlmSort) => void }) {
  return (
    <div className="ml-filters llm-filters">
      {CAPS.map((c) => {
        const on = caps.includes(c.id);
        return (
          <button key={c.id} type="button" className={`ml-filter ${on ? 'is-active' : ''}`} data-tip={c.tip} aria-pressed={on} onClick={() => onCaps(on ? caps.filter((x) => x !== c.id) : [...caps, c.id])}>
            {on ? <Check size={11} /> : null}
            {c.label}
          </button>
        );
      })}
      <span className="ml-filters-gap" />
      <select className="ml-filter llm-sort" aria-label="Order" value={sort} onChange={(e) => onSort(e.target.value as LlmSort)}>
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>{s.label}</option>
        ))}
      </select>
    </div>
  );
}

/** One agent model: name, vision, context, price on the first line; the provider's description below. */
export function LlmRowBody({ m }: { m: LlmModel }) {
  return (
    <span className="ml-main">
      <span className="llm-line">
        <span className="ml-name">{m.name}</span>
        <VisionTag vision={m.vision} />
        {m.reasoning ? <span className="vision-tag" data-tip="Reasoning">R</span> : null}
        {m.contextLength ? <span className="llm-ctx num" data-tip="Context window (tokens)">{contextLabel(m.contextLength)}</span> : null}
        {m.inputPrice != null ? <span className="ml-price num" data-tip="USD per million input / output tokens">{`${formatUsd(m.inputPrice)}/${formatUsd(m.outputPrice ?? 0)}`}</span> : null}
      </span>
      <span className="ml-sub" title={m.description ?? m.id}>{m.description ?? m.id}</span>
    </span>
  );
}
