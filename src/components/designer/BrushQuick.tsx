import type { ReactNode } from 'react';
import { Blend, Lock, Unlock } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { BRUSH_BLENDS, type BrushBlend } from '../../engine/design/brushEngine';
import { flowBlocked, flowOf, FLOW_MIN, withFlow } from '../../engine/design/brushFlow';
import { InlineSelect, InlineSlider } from './InlineControls';

/* Flow, Blend and Lock alpha: the brush's own controls that the quick row and the Brush tabs share (one state, one look). */

const setBrush = (patch: object) => setUi({ brush: { ...useStore.getState().ui.brush, ...patch } });

/** Flow as one slider. Under 100 % it turns Dabs on (see brushFlow.ts); measured graphite cannot take it. */
export function FlowField({ icon }: { icon?: ReactNode }) {
  const brush = useStore((s) => s.ui.brush);
  const blocked = flowBlocked(brush);
  return <InlineSlider label="Flow" icon={icon} unit="%" scale={100} min={FLOW_MIN} max={1} step={0.01} value={blocked ? 1 : flowOf(brush)} disabled={blocked}
    tip={blocked ? 'Flow does not apply to graphite pencils' : 'How much each stamp adds. Under 100 % the brush paints with Dabs'} onChange={(v) => setBrush(withFlow(useStore.getState().ui.brush, v))} />;
}

/** The six blend modes behind one round button. */
export function BlendMenu() {
  const blend = useStore((s) => s.ui.brush.blend) ?? 'normal';
  return <InlineSelect label="Blend" icon={<Blend size={15} />} value={blend} options={BRUSH_BLENDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }))} onChange={(v) => setBrush({ blend: v as BrushBlend })} />;
}

/** Lock alpha: paint only where the layer already has pixels (the brush's keepOpacity). */
export function LockAlphaButton() {
  const on = !!useStore((s) => s.ui.brush.keepOpacity);
  return <button type="button" className={`opt opt-pick is-icon${on ? ' is-on' : ''}`} aria-label="Lock alpha" aria-pressed={on} data-tip="Lock alpha: paint only where the layer already has pixels"
    style={on ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined} onClick={() => setBrush({ keepOpacity: !on })}>
    {on ? <Lock size={15} /> : <Unlock size={15} />}
  </button>;
}
