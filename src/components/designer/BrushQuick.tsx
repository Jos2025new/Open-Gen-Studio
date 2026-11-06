import type { ReactNode } from 'react';
import { Blend, Droplets, Lock, Unlock } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import { BRUSH_BLENDS, type BrushBlend } from '../../engine/design/brushEngine';
import { flowOf, FLOW_MIN, withFlow } from '../../engine/design/brushFlow';
import { InlineSelect, InlineSlider } from './InlineControls';
import { Popover, usePopover } from '../ui/Popover';

/* Flow, Blend and Lock alpha: the brush's own controls that the quick row and the Brush tabs share (one state, one look). */

const setBrush = (patch: object) => setUi({ brush: { ...useStore.getState().ui.brush, ...patch } });

/** Flow as one slider. Under 100 % it turns Dabs on (see brushFlow.ts); measured graphite cannot take it. */
export function FlowField({ icon }: { icon?: ReactNode }) {
  const brush = useStore((s) => s.ui.brush);
  return <InlineSlider label="Flow" icon={icon} unit="%" scale={100} min={FLOW_MIN} max={1} step={0.01} value={flowOf(brush)}
    tip="How much each stamp adds. Under 100 % the brush paints with Dabs" onChange={(v) => setBrush(withFlow(useStore.getState().ui.brush, v))} />;
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

/** Flow behind one round button (the quick row has no room for a third slider): the same field in a small popover. */
export function FlowMenu() {
  const pop = usePopover(), brush = useStore((s) => s.ui.brush);
  const pct = Math.round(flowOf(brush) * 100);
  return <>
    <button type="button" ref={pop.ref} className="opt opt-pick is-icon" aria-label={`Flow · ${pct}%`} data-tip={`Flow: ${pct}%`} aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}><Droplets size={15} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={200} label="Flow"><div className="snap-pop"><FlowField /></div></Popover>
  </>;
}
