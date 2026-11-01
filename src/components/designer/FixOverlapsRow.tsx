import type { VectorShape } from '../../engine/types';
import { FIX_MODES, fixOverlapsState, fixShapeOverlaps } from '../../engine/design/fixOverlaps';
import { setUi, useStore } from '../../store/store';

/** The «Fix overlaps» menu row: the action and, beside it, how to resolve (Fill / Cut); the last mode is remembered. `done` runs after a change (or none). */
export function FixOverlapsRow({ sessionId, docId, layerId, shape, done }: { sessionId: string; docId: string; layerId: string; shape: VectorShape; done: (changed: boolean) => void }) {
  const mode = useStore((s) => s.ui.fixMode ?? 'fill'), fix = fixOverlapsState(shape);
  return <div className="opt opt-choice" role="radiogroup" aria-label="Fix overlaps mode">
    <button type="button" className="opt-label" disabled={!fix.ok} data-tip={fix.tip} onClick={() => done(fixShapeOverlaps(sessionId, docId, layerId, shape, mode))}>Fix overlaps</button>
    <span className="opt-choices">{FIX_MODES.map((m) => <button key={m.value} type="button" role="radio" aria-checked={m.value === mode} data-tip={m.tip} className={m.value === mode ? 'is-on' : ''} onClick={() => setUi({ fixMode: m.value })}>{m.label}</button>)}</span>
  </div>;
}
