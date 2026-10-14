import type { VectorShape } from '../../engine/types';
import { withPrim } from '../../engine/design/primitives';
import { InlineSlider } from './InlineControls';
import { patchShape } from './ShapeLookFields';

/** The parameters of a primitive (polygon, star, sector, arc, chord) to edit in place; nothing for a plain path. */
export function PrimFields({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const p = shape.prim;
  if (!p) return null;
  const set = (change: Parameters<typeof withPrim>[1]) => {
    const patch = withPrim(shape, change);
    if (patch) patchShape(sessionId, docId, layerId, shape.id, patch);
  };
  const corners = p.kind === 'polygon' || p.kind === 'star';
  return <>
    {corners && <InlineSlider label="Sides" min={3} max={24} value={p.sides ?? 5} onChange={(v) => set({ sides: v })} />}
    {p.kind === 'star' && <InlineSlider label="Inner" unit="%" min={10} max={100} value={Math.round((p.inner ?? 0.5) * 100)} onChange={(v) => set({ inner: v / 100 })} />}
    {corners && <InlineSlider label="Round" unit="%" min={0} max={100} value={Math.round((p.round ?? 0) * 100)} onChange={(v) => set({ round: v / 100 })} />}
    {!corners && <>
      <InlineSlider label="From" unit="°" min={0} max={360} value={p.a0 ?? 0} onChange={(v) => set({ a0: v })} />
      <InlineSlider label="To" unit="°" min={0} max={360} value={p.a1 ?? 270} onChange={(v) => set({ a1: v })} />
    </>}
  </>;
}
