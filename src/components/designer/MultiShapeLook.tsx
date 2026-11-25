import type { DesignDoc } from '../../engine/types';
import type { ShapeSpec } from '../../engine/types';
import { objectPicks } from '../../engine/design/objectSelection';
import { patchPickedShapes } from '../../engine/design/multiObjectOps';
import { paintOpacity, paintOpacityPatch } from '../../engine/design/shapeLook';
import { tokenPatch, tokenOf } from '../../engine/design/tokenBind';
import { InlineColor, InlineSlider } from './InlineControls';
import { ShapeLookFields } from './ShapeLookFields';
import { SelectSameLook } from './SelectSameLook';

/** Look of several picked shapes, possibly in different layers: one edit changes every one in its own layer (one undo step). */
export function MultiShapeLook({ sessionId, doc, first, count }: { sessionId: string; doc: DesignDoc; first: ShapeSpec; count: number }) {
  const set = (patch: Partial<ShapeSpec>) => patchPickedShapes(sessionId, doc.id, doc, objectPicks(doc.id), patch);
  return <>
    <span className="context-mode" data-tip="Changes apply to every picked shape, each in its own layer">{count} shapes</span>
    <InlineColor label="Fill" value={first.fill ?? '#d4f25a'} token={tokenOf(first, 'fill')} alpha={{ value: paintOpacity(first, 'fill'), onChange: (o) => set(paintOpacityPatch('fill', o)) }} onChange={(c, t, p) => set(tokenPatch('fill', c, t, p))} />
    <InlineColor label="Stroke" value={first.stroke ?? '#ffffff'} token={tokenOf(first, 'stroke')} alpha={{ value: paintOpacity(first, 'stroke'), onChange: (o) => set(paintOpacityPatch('stroke', o)) }} onChange={(c, t, p) => set(tokenPatch('stroke', c, t, p))} />
    <InlineSlider label="Stroke width" unit="px" min={0} max={40} allowManualOverflow value={first.strokeWidth} onChange={(strokeWidth) => set({ strokeWidth })} />
    <ShapeLookFields value={first} onChange={set} />
    <SelectSameLook doc={doc} />
  </>;
}
