import type { DesignDoc, ShapeSpec, VectorShape } from '../../engine/types';
import { blurPercent, blurSigma, cornerRadii, MITER_DEFAULT, SHARP } from '../../engine/design/shapeLook';
import { useObjectSelection } from '../../engine/design/objectSelection';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { InlineChoice, InlineSelect, InlineSlider, InlineToggle } from './InlineControls';

/*
 * Corners, stroke style and blur of a shape (Inkscape's rectangle toolbar and Fill & Stroke → Stroke style):
 * the same fields for the next shape (tool settings) and for a picked shape (bar and layer properties).
 * Formulas: engine/design/shapeLook.ts.
 */

const DASHES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Solid' }, { value: '1 1', label: 'Dots' }, { value: '4 2', label: 'Dashes' },
  { value: '8 4', label: 'Long dashes' }, { value: '4 2 1 2', label: 'Dash dot' },
];

type Look = Partial<ShapeSpec>;
export function ShapeLookFields({ value, onChange, corners, stroke = true, blur, compact }: {
  value: Look; onChange: (patch: Look) => void; corners?: boolean; stroke?: boolean; /** Needs w/h (blur % is relative to the size). */ blur?: boolean; compact?: boolean;
}) {
  const r = cornerRadii({ w: value.w ?? 1e9, h: value.h ?? 1e9, radius: value.radius ?? 0, rx: value.rx, ry: value.ry });
  const join = value.join ?? 'round', dash = value.dash?.join(' ') ?? '';
  const w = value.w ?? 0, h = value.h ?? 0;
  return <>
    {corners && <>
      <InlineSlider label="Rx" unit="px" min={0} max={Math.max(1, Math.round(Math.abs(w) / 2) || 200)} allowManualOverflow value={Math.round(r.rx * 10) / 10} step={0.5} onChange={(rx) => onChange({ rx, ry: value.ry ?? r.ry })} />
      <InlineSlider label="Ry" unit="px" min={0} max={Math.max(1, Math.round(Math.abs(h) / 2) || 200)} allowManualOverflow value={Math.round(r.ry * 10) / 10} step={0.5} onChange={(ry) => onChange({ ry, rx: value.rx ?? r.rx })} />
      <button type="button" className="opt" disabled={!r.rx && !r.ry} onClick={() => onChange(SHARP)} data-tip="Make corners sharp (Shift-click a corner handle does the same)">Sharp corners</button>
    </>}
    {blur && <span data-tip="Inkscape's blur: σ = (blur/100)² · (width + height) / 4"><InlineSlider label="Blur" unit="%" min={0} max={100} step={0.1} value={Math.round(blurPercent(value.blur ?? 0, w, h) * 10) / 10} onChange={(p) => onChange({ blur: blurSigma(p, w, h) })} /></span>}
    {stroke && !compact && <>
      <InlineChoice label="Join" value={join} options={[{ value: 'miter' as const, label: 'Miter join' }, { value: 'round' as const, label: 'Round join' }, { value: 'bevel' as const, label: 'Bevel join' }]} onChange={(j) => onChange({ join: j })} />
      {join === 'miter' && <InlineSlider label="Miter limit" min={1} max={20} step={0.5} value={value.miter ?? MITER_DEFAULT} onChange={(miter) => onChange({ miter })} />}
      <InlineChoice label="Cap" value={value.cap ?? 'round'} options={[{ value: 'butt' as const, label: 'Butt cap' }, { value: 'round' as const, label: 'Round cap' }, { value: 'square' as const, label: 'Square cap' }]} onChange={(cap) => onChange({ cap })} />
      <InlineSelect label="Dashes" value={DASHES.some((d) => d.value === dash) ? dash : ''} options={DASHES} onChange={(v) => onChange({ dash: v ? v.split(' ').map(Number) : undefined })} />
      {dash && <InlineSlider label="Dash offset" min={0} max={20} step={0.5} value={value.dashOffset ?? 0} onChange={(dashOffset) => onChange({ dashOffset })} />}
      <InlineToggle label="Stroke behind fill" tip="Paint order: the stroke is painted first, so the fill covers its inner half" checked={value.paintOrder === 'stroke'} onChange={(on) => onChange({ paintOrder: on ? 'stroke' : undefined })} />
    </>}
  </>;
}

/** The one shape picked with Edit → Objects, if exactly one is (and its layer can change). */
export function usePickedShape(doc: DesignDoc): { layerId: string; shape: VectorShape } | null {
  const pick = useObjectSelection((st) => st.byDoc[doc.id]);
  if (!pick || pick.ids.length !== 1) return null;
  const l = doc.layers.find((x) => x.id === pick.layerId);
  if (!l || l.type !== 'vector' || l.locked) return null;
  const shape = l.shapes.find((s) => s.id === pick.ids[0]);
  return shape ? { layerId: l.id, shape } : null;
}

/** Change one shape of a vector layer (one undo step per call). */
export function patchShape(sessionId: string, docId: string, layerId: string, shapeId: string, patch: Look, opts: { record?: boolean } = {}): void {
  const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === layerId);
  if (!l || l.type !== 'vector') return;
  patchLayer(sessionId, docId, layerId, { shapes: l.shapes.map((s) => (s.id === shapeId ? { ...s, ...patch } : s)) }, opts);
}

/** Width and height of a shape in edit mode (Inkscape's W/H next to Rx/Ry); the top-left corner stays put. */
export function ShapeSizeFields({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const set = (key: 'w' | 'h', v: number) => patchShape(sessionId, docId, layerId, shape.id, { [key]: (shape[key] < 0 ? -1 : 1) * Math.max(1, v) });
  return <>
    <InlineSlider label="W" unit="px" min={1} max={Math.max(4000, Math.ceil(Math.abs(shape.w)))} allowManualOverflow value={Math.round(Math.abs(shape.w) * 10) / 10} onChange={(v) => set('w', v)} />
    <InlineSlider label="H" unit="px" min={1} max={Math.max(4000, Math.ceil(Math.abs(shape.h)))} allowManualOverflow value={Math.round(Math.abs(shape.h) * 10) / 10} onChange={(v) => set('h', v)} />
  </>;
}
