import type { VectorShape } from '../../engine/types';
import { withPrim } from '../../engine/design/primitives';
import { convertCorners, convertEllipse, ELLIPSE_TYPES, ellipseTypeOf, radiiOf, withRadius, type EllipseType } from '../../engine/design/shapeKinds';
import { InlineChoice, InlineSelect, InlineSlider } from './InlineControls';
import { patchShape } from './ShapeLookFields';

/** The parameters of a selected ellipse, slice, arc, chord, polygon or star, edited in place; nothing for a plain path. */
export function PrimFields({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const p = shape.prim;
  const type = ellipseTypeOf(shape);
  const apply = (patch: Partial<VectorShape> | null) => { if (patch) patchShape(sessionId, docId, layerId, shape.id, patch); };
  if (!p && !type) return null;
  const set = (change: Parameters<typeof withPrim>[1]) => apply(withPrim(shape, change));
  const corners = p?.kind === 'polygon' || p?.kind === 'star';
  const r = radiiOf(shape);
  return <>
    {type && <InlineSelect<EllipseType> label="Type" value={type} options={ELLIPSE_TYPES} onChange={(t) => apply(convertEllipse(shape, t))} />}
    {type && <>
      <InlineSlider label="Rx" unit="px" min={1} max={Math.max(2000, Math.ceil(r.rx))} allowManualOverflow value={Math.round(r.rx * 10) / 10} onChange={(v) => apply(withRadius(shape, 'rx', v))} />
      <InlineSlider label="Ry" unit="px" min={1} max={Math.max(2000, Math.ceil(r.ry))} allowManualOverflow value={Math.round(r.ry * 10) / 10} onChange={(v) => apply(withRadius(shape, 'ry', v))} />
    </>}
    {type && type !== 'whole' && p && <>
      <InlineSlider label="Start" unit="°" min={0} max={360} value={p.a0 ?? 0} onChange={(v) => set({ a0: v })} />
      <InlineSlider label="End" unit="°" min={0} max={360} value={p.a1 ?? 270} onChange={(v) => set({ a1: v })} />
      <button type="button" className="opt" data-tip="Back to a whole ellipse, same centre and radii" onClick={() => apply(convertEllipse(shape, 'whole'))}>Make whole</button>
    </>}
    {corners && p && <>
      <InlineChoice label="Shape" value={p.kind as 'polygon' | 'star'} options={[{ value: 'polygon' as const, label: 'Polygon' }, { value: 'star' as const, label: 'Star' }]} onChange={(k) => apply(convertCorners(shape, k))} />
      <InlineSlider label="Corners" min={3} max={24} value={p.sides ?? 5} onChange={(v) => set({ sides: v })} />
      {p.kind === 'star' && <InlineSlider label="Spoke ratio" unit="%" min={10} max={100} value={Math.round((p.inner ?? 0.5) * 100)} onChange={(v) => set({ inner: v / 100 })} />}
      <InlineSlider label="Rounded" unit="%" min={0} max={100} value={Math.round((p.round ?? 0) * 100)} onChange={(v) => set({ round: v / 100 })} />
    </>}
  </>;
}
