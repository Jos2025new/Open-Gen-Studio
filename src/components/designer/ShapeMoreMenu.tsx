import { MoreHorizontal } from 'lucide-react';
import type { VectorShape } from '../../engine/types';
import { getDoc, patchLayer } from '../../engine/design/actions';
import { canOutlineStroke, outlineStrokeShapes } from '../../engine/design/outlineStroke';
import { FixOverlapsRow } from './FixOverlapsRow';
import { Popover, usePopover } from '../ui/Popover';
import { convertToPath } from './ShapeLookFields';

/** «More» in the selection strip: Outline stroke and Flatten, each one undo step (Figma's Outline stroke and Flatten). */
export function ShapeMoreMenu({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const pop = usePopover();
  const canOutline = canOutlineStroke(shape), canFlatten = shape.type !== 'path' || !!shape.prim;
  const outlineTip = canOutline ? 'The stroke becomes a filled path (the fill, if any, stays its own shape)' : shape.strokeAlign ? 'Outline stroke works on centered strokes: set Align to Center first' : 'This shape has no stroke to outline';
  const outline = () => {
    const l = getDoc(sessionId, docId)?.layers.find((x) => x.id === layerId);
    if (l?.type === 'vector') patchLayer(sessionId, docId, layerId, { shapes: outlineStrokeShapes(l.shapes as VectorShape[], shape.id) });
    pop.close();
  };
  return <>
    <button type="button" ref={pop.ref} className="opt context-more" aria-haspopup="menu" aria-expanded={pop.open} aria-label="More shape operations" data-tip="More: outline stroke, flatten, fix overlaps" onClick={pop.toggle}><MoreHorizontal size={14} /></button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="top-start" width={220} label="Shape operations">
      <div className="node-more">
        <button type="button" className="opt" disabled={!canOutline} data-tip={outlineTip} onClick={outline}>Outline stroke</button>
        <button type="button" className="opt" disabled={!canFlatten} data-tip={canFlatten ? 'Turn the shape into an editable path' : 'Already a plain path'} onClick={() => { convertToPath(sessionId, docId, layerId, shape); pop.close(); }}>Flatten</button>
        <FixOverlapsRow sessionId={sessionId} docId={docId} layerId={layerId} shape={shape} done={() => pop.close()} />
      </div>
    </Popover>
  </>;
}
