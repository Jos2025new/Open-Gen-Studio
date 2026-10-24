import { useState } from 'react';
import { Circle, MoveHorizontal, Square } from 'lucide-react';
import type { GradientPaint, GradientStop } from '../../engine/shapeSpec';
import type { VectorShape } from '../../engine/types';
import { defaultGradient } from '../../engine/design/gradientPaint';
import { MARKER_KINDS, type MarkerKind } from '../../engine/design/markers';
import { Popover } from '../ui/Popover';
import { usePopover } from '../ui/Popover';
import { InlineColor, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';
import { PrimFields } from './PrimFields';
import { patchShape } from './ShapeLookFields';

/*
 * The paint of a selected shape, in the bar as two swatches («Fill», «Stroke») and a «Shape» button for a primitive's
 * parameters. Each opens a popover that reuses the colour panel (InlineColor): a type switch with icons (solid,
 * linear, radial), the colour and alpha of the chosen stop, a stop switch for gradients, and for the stroke its width,
 * arrowheads and scale. Pure rules (paintKindPatch, stopPatch) are what the handlers call, and what the tests check.
 */

export type Side = 'fill' | 'stroke';
export type PaintKind = 'solid' | 'linear' | 'radial';
export type StopEnd = 'first' | 'last';

type FieldSet = { paint: 'fill' | 'stroke'; opacity: 'fillOpacity' | 'strokeOpacity'; gradient: 'fillGradient' | 'strokeGradient' };
const fieldsOf = (side: Side): FieldSet => (side === 'stroke' ? { paint: 'stroke', opacity: 'strokeOpacity', gradient: 'strokeGradient' } : { paint: 'fill', opacity: 'fillOpacity', gradient: 'fillGradient' });

/** The patch that switches one side to a kind: solid keeps the colour of its first stop; a gradient keeps its stops. */
export function paintKindPatch(shape: VectorShape, side: Side, kind: PaintKind): Partial<VectorShape> {
  const f = fieldsOf(side);
  const g = shape[f.gradient];
  if (kind === 'solid') return { [f.gradient]: undefined, [f.paint]: shape[f.paint] ?? g?.stops[0]?.color ?? (side === 'stroke' ? '#ffffff' : '#d4f25a') } as Partial<VectorShape>;
  const next: GradientPaint = g ? { ...g, kind } : defaultGradient(kind, shape, shape[f.paint] ?? '#ffffff', '#000000');
  return { [f.gradient]: next, [f.paint]: null } as Partial<VectorShape>;
}

/** The patch that changes the colour or alpha of one stop (the first or last) of a gradient. */
export function stopPatch(shape: VectorShape, side: Side, end: StopEnd, change: Partial<GradientStop>): Partial<VectorShape> | null {
  const f = fieldsOf(side), g = shape[f.gradient];
  if (!g) return null;
  const stops = g.stops.map((st, i) => ((end === 'first' ? i === 0 : i === g.stops.length - 1) ? { ...st, ...change } : st));
  return { [f.gradient]: { ...g, stops } } as Partial<VectorShape>;
}

/** CSS for a gradient swatch, from its stops (alpha included). */
export function gradientCss(g: GradientPaint): string {
  const hex = (c: string, a: number) => { const n = parseInt(c.slice(1, 7), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  const stops = g.stops.map((st) => `${hex(st.color, st.alpha)} ${Math.round(st.offset * 100)}%`).join(', ');
  return g.kind === 'radial' ? `radial-gradient(circle, ${stops})` : `linear-gradient(90deg, ${stops})`;
}

const KINDS: Array<{ kind: PaintKind; label: string; icon: typeof Square }> = [
  { kind: 'solid', label: 'Solid', icon: Square },
  { kind: 'linear', label: 'Linear gradient', icon: MoveHorizontal },
  { kind: 'radial', label: 'Radial gradient', icon: Circle },
];

/** One swatch («Fill» or «Stroke») with its popover. */
export function PaintSwatch({ sessionId, docId, layerId, shape, side }: { sessionId: string; docId: string; layerId: string; shape: VectorShape; side: Side }) {
  const [end, setEnd] = useState<StopEnd>('first');
  const f = fieldsOf(side), g = shape[f.gradient], stroke = side === 'stroke';
  const label = stroke ? 'Stroke' : 'Fill';
  const kind: PaintKind = g ? g.kind : 'solid';
  const st = g ? (end === 'first' ? g.stops[0] : g.stops[g.stops.length - 1]) : null;
  const solid = shape[f.paint] ?? (stroke ? '#ffffff' : '#d4f25a');
  const value = st ? st.color : solid;
  const alpha = st ? st.alpha : (shape[f.opacity] ?? 1);
  const set = (patch: Partial<VectorShape>) => patchShape(sessionId, docId, layerId, shape.id, patch);
  const onColor = (c: string) => set(st ? stopPatch(shape, side, end, { color: c }) ?? {} : { [f.paint]: c });
  const onAlpha = (a: number) => set(st ? stopPatch(shape, side, end, { alpha: a }) ?? {} : { [f.opacity]: a });
  return <InlineColor label={label} value={value} preview={g ? gradientCss(g) : undefined} alpha={{ value: alpha, onChange: onAlpha }} onChange={onColor}>
    <div className="swatch-row" role="radiogroup" aria-label={`${label} type`}>
      {KINDS.map((k) => { const Icon = k.icon; return <button key={k.kind} type="button" role="radio" aria-checked={kind === k.kind} aria-label={k.label} data-tip={k.label} className={`opt${kind === k.kind ? ' is-on' : ''}`} onClick={() => set(paintKindPatch(shape, side, k.kind))}><Icon size={14} aria-hidden="true" /></button>; })}
    </div>
    {g && <div className="swatch-row" role="radiogroup" aria-label="Stops">
      {(['first', 'last'] as const).map((e) => <button key={e} type="button" role="radio" aria-checked={end === e} className={`opt${end === e ? ' is-on' : ''}`} onClick={() => setEnd(e)}>{e === 'first' ? 'Start' : 'End'}</button>)}
    </div>}
    {stroke && <StrokeOptions sessionId={sessionId} docId={docId} layerId={layerId} shape={shape} />}
  </InlineColor>;
}

/** Stroke width, arrowheads and scale: the rest of the stroke's settings, in its popover. */
function StrokeOptions({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const set = (patch: Partial<VectorShape>) => patchShape(sessionId, docId, layerId, shape.id, patch);
  const lined = shape.type === 'line' || shape.type === 'path';
  return <>
    <InlineSlider label="Width" unit="px" min={0} max={40} value={shape.strokeWidth} onChange={(v) => set({ strokeWidth: v })} />
    {lined && <>
      <InlineSelect label="Start arrow" value={shape.markerStart ?? 'none'} options={MARKER_KINDS} onChange={(v) => set({ markerStart: v as MarkerKind })} />
      <InlineSelect label="End arrow" value={shape.markerEnd ?? 'none'} options={MARKER_KINDS} onChange={(v) => set({ markerEnd: v as MarkerKind })} />
    </>}
    {shape.type === 'path' && <InlineToggle label="Scale stroke" tip="On: the stroke and its arrowheads grow with the path when it is scaled" checked={!!shape.scaleStroke} onChange={(on) => set({ scaleStroke: on })} />}
  </>;
}

/** «Shape»: a primitive's parameters in a popover; nothing for a plain shape. */
export function ShapeParams({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const pop = usePopover();
  if (!shape.prim && shape.type !== 'ellipse') return null;
  return <>
    <button type="button" ref={pop.ref} className="opt" aria-haspopup="dialog" aria-expanded={pop.open} data-tip="The shape's parameters: type, corners, radii, angles" onClick={pop.toggle}>Shape</button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="bottom-start" width={240} label="Shape">
      <div className="swatch-panel"><PrimFields sessionId={sessionId} docId={docId} layerId={layerId} shape={shape} /></div>
    </Popover>
  </>;
}
