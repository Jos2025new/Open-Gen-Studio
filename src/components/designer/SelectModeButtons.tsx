import type { VectorShape } from '../../engine/types';
import { useNodeEditMode } from '../../engine/design/nodeEditMode';
import { SELECT_MODES, type SelectMode } from '../../engine/design/selectMode';
import { chooseSelectMode } from './selectModeActions';

/* Node · Segment · Face (keys 1 / 2 / 3): what a click, a marquee or a lasso selects while node editing, as in Blender's vertex / edge / face select. */
const LABELS: Record<SelectMode, { label: string; key: string; tip: string }> = {
  node: { label: 'Node', key: '1', tip: 'Select nodes' },
  segment: { label: 'Segment', key: '2', tip: 'Select segments: click or drag one to move its two nodes' },
  face: { label: 'Face', key: '3', tip: 'Select faces: click inside a closed shape (its holes move with it)' },
};

function Glyph({ m }: { m: SelectMode }) {
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
    {m === 'node' && <><path d="M2 11 L7 3 L12 11" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.45" /><rect x="5" y="1.5" width="4" height="4" fill="currentColor" /></>}
    {m === 'segment' && <><path d="M2 11 L7 3 L12 11 Z" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.45" /><path d="M2 11 L7 3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></>}
    {m === 'face' && <path d="M2 11 L7 3 L12 11 Z" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />}
  </svg>;
}

export function SelectModeButtons({ docId, shape }: { docId: string; shape: VectorShape }) {
  const mode = useNodeEditMode((s) => s.mode), now = useNodeEditMode((s) => s.select);
  if (mode !== 'move' && mode !== 'lasso') return null;
  return <div className="node-select" role="radiogroup" aria-label="Selection element">
    {SELECT_MODES.map((m) => {
      const { label, key, tip } = LABELS[m], on = now === m;
      return <button key={m} type="button" role="radio" aria-checked={on} aria-label={`${label} (${key})`} className={`opt node-mode${on ? ' is-on is-active' : ''}`} data-tip={`${label} (${key}): ${tip}`} onClick={() => chooseSelectMode(docId, shape, m)}><Glyph m={m} /></button>;
    })}
  </div>;
}
