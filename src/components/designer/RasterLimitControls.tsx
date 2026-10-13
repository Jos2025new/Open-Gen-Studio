import { useRef, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { RasterLayer } from '../../engine/types';
import { patchLayer } from '../../engine/design/actions';
import {
  DEFAULT_PAINT_SEGMENT_LIMIT,
  DEFAULT_PAINT_STROKE_LIMIT,
  PAINT_LIMIT_EARLY_WARNING_RATIO,
  armNextRasterPaint,
  cancelRasterPaintApproval,
  pendingRasterPaintLayer,
  rasterPaintUsage,
  subscribeRasterPaintGate,
} from '../../engine/design/rasterLimit';
import { Popover, usePopover } from '../ui/Popover';
import { IconButton } from '../ui/primitives';

export function RasterLimitControls({ sessionId, docId, layer }: {
  sessionId: string;
  docId: string;
  layer: RasterLayer;
}) {
  const disable = usePopover<HTMLButtonElement>();
  const usage = rasterPaintUsage(layer);
  const near = !layer.paintFlattened && !layer.paintLimitDisabled && (
    usage.strokes >= DEFAULT_PAINT_STROKE_LIMIT * PAINT_LIMIT_EARLY_WARNING_RATIO ||
    usage.segments >= DEFAULT_PAINT_SEGMENT_LIMIT * PAINT_LIMIT_EARLY_WARNING_RATIO
  );
  return <div className="layer-actions" aria-label={`${layer.name} editable-stroke limit`}>
    {layer.paintFlattened
      ? <span className="muted" title="This layer is in pixel mode. Undo can restore its editable strokes.">Pixels · strokes flattened</span>
      : <span className={near ? 'muted field-hint' : 'muted'} title={`Initial limit: ${DEFAULT_PAINT_STROKE_LIMIT} strokes or ${DEFAULT_PAINT_SEGMENT_LIMIT} segments; these values may change after full measurements`}>
        {usage.strokes}/{DEFAULT_PAINT_STROKE_LIMIT} strokes · {usage.segments}/{DEFAULT_PAINT_SEGMENT_LIMIT} segments{near ? ' · approaching limit' : ''}
      </span>}
    {!layer.paintFlattened && <>
      <button ref={disable.ref} type="button" className="opt" aria-expanded={disable.open} disabled={layer.locked} onClick={disable.toggle}>
        {layer.paintLimitDisabled ? 'Enable limit' : 'Disable limit'}
      </button>
      <Popover open={disable.open} anchor={disable.ref} onClose={disable.close} width={300} label="Change editable-stroke limit">
        {layer.paintLimitDisabled
          ? <div className="confirm-pop"><p>Re-enable the initial stroke limit for this layer? If it has already reached the limit, painting will ask before flattening.</p><div className="confirm-pop-actions"><button type="button" className="opt" onClick={disable.close}>Cancel</button><button type="button" className="opt" onClick={() => { disable.close(); patchLayer(sessionId, docId, layer.id, { paintLimitDisabled: false }); }}>Enable limit</button></div></div>
          : <div className="confirm-pop"><p>Disable the stroke limit for <strong>{layer.name}</strong>? More editable strokes may make editing slower. This can be undone.</p><div className="confirm-pop-actions"><button type="button" className="opt" onClick={disable.close}>Cancel</button><button type="button" className="opt" onClick={() => { disable.close(); patchLayer(sessionId, docId, layer.id, { paintLimitDisabled: true }); }}>Disable limit</button></div></div>}
      </Popover>
    </>}
  </div>;
}

export function RasterLimitApproval({ layer }: { layer: RasterLayer | undefined }) {
  const pendingId = useSyncExternalStore(subscribeRasterPaintGate, pendingRasterPaintLayer);
  const anchor = useRef<HTMLButtonElement>(null);
  if (!layer || pendingId !== layer.id) return null;
  const cancel = () => cancelRasterPaintApproval(layer.id);
  return <>
    <IconButton ref={anchor} icon={AlertTriangle} label={`Confirm painting on ${layer.name}`} size="sm" active aria-haspopup="dialog" aria-expanded />
    <Popover open anchor={anchor} onClose={cancel} width={320} label="Confirm painting on this layer">
      <div className="confirm-pop">
        <p><strong>{layer.name}</strong> has reached the initial paint limit. Continue, then draw again. The layer will keep its appearance; Undo restores editable strokes.</p>
        <div className="confirm-pop-actions">
          <button type="button" className="opt" onClick={cancel}>Cancel</button>
          <button type="button" className="opt" onClick={() => armNextRasterPaint(layer.id)}>Continue</button>
        </div>
      </div>
    </Popover>
  </>;
}
