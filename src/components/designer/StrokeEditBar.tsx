import type { DesignDoc, Layer } from '../../engine/types';
import type { Stroke } from '../../engine/strokeTypes';
import { patchLayer } from '../../engine/design/actions';
import { editStrokes } from '../../engine/design/strokeEdit';
import { InlineColor, InlineSlider } from './InlineControls';

/* The selection strip of picked Lineart strokes (colour, size, Edit nodes); their edit row is NodeModeButtons + NodeDoneButton (ContextStrip). */

/** Modes of the stroke edit row: Lasso (node selection) and More (node operations) are for paths. */
export const STROKE_MODES = ['move', 'bend', 'cut', 'erase'] as const;

function restyle(sessionId: string, doc: DesignDoc, layerId: string, ids: string[], patch: Partial<Stroke>): void {
  const l = doc.layers.find((x) => x.id === layerId);
  if (l?.type !== 'vector') return;
  patchLayer(sessionId, doc.id, layerId, { strokes: l.strokes?.map((s) => (ids.includes(s.id) ? { ...s, ...patch } : s)) } as Partial<Layer>);
}

export function StrokeStripFields({ sessionId, doc, layerId, strokes }: { sessionId: string; doc: DesignDoc; layerId: string; strokes: Stroke[] }) {
  const ids = strokes.map((s) => s.id), first = strokes[0];
  return <>
    <InlineColor label="Color" value={first.color} alpha={{ value: first.opacity, onChange: (opacity) => restyle(sessionId, doc, layerId, ids, { opacity }) }} onChange={(color) => restyle(sessionId, doc, layerId, ids, { color })} />
    <InlineSlider label="Size" unit="px" min={0.5} max={200} step={0.5} allowManualOverflow value={Math.round(first.size * 10) / 10} onChange={(size) => restyle(sessionId, doc, layerId, ids, { size })} />
    <button type="button" className="opt" data-tip="Move, bend, cut or erase part of the stroke" onClick={() => editStrokes(doc.id, layerId, ids)}>Edit nodes</button>
  </>;
}
