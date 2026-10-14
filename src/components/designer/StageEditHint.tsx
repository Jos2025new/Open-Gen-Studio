import { useState } from 'react';
import { X } from 'lucide-react';
import type { DesignDoc, Layer } from '../../engine/types';
import { layerObjects } from '../../engine/design/objectOps';
import { shapeEditHint } from './ShapeKnots';

export function StageEditHint(props: {
  doc: DesignDoc; shapeEditing: boolean; marquee: boolean; layersEmpty: boolean;
  canShowHandles: boolean; handleMode: 'scale' | 'rotate'; canShowObjects: boolean; active: Layer | null;
}) {
  const { doc, shapeEditing, marquee, layersEmpty, canShowHandles, handleMode, canShowObjects, active } = props;
  return shapeEditing ? <StageHint id={shapeEditHint(doc).id} subtle>{shapeEditHint(doc).text}</StageHint>
    : marquee ? <StageHint id="edit-marquee" subtle>Drag selects objects or layers · Shift adds · Alt removes</StageHint>
    : layersEmpty ? <StageHint id="layers-marquee" subtle>Drag empty space to select visible layers · Shift adds · Alt removes</StageHint>
    : canShowHandles ? (handleMode === 'scale' ? <StageHint id="handles-scale" subtle>Drag the squares to resize (Ctrl or Shift keeps proportions) · click the selection again to rotate</StageHint> : <StageHint id="handles-rotate" subtle>Drag a corner to rotate, a side to skew (Ctrl or Shift: 15° steps) · move the center · click again to resize</StageHint>)
    : canShowObjects && active && layerObjects(active).length ? <StageHint id="objects" subtle>Objects: click or drag an object · Shift/Ctrl-click adds or toggles objects · drag empty space to select · Alt subtracts from marquee</StageHint>
    : null;
}

export function StageHint({ id, subtle, children }: { id: string; subtle?: boolean; children: React.ReactNode }) {
  const [closed, setClosed] = useState(() => closedHints().includes(id));
  if (closed) return null;
  return <div className={`stage-hint has-close ${subtle ? 'subtle' : ''}`}>
    <span>{children}</span>
    <button type="button" className="stage-hint-close" aria-label="Close this tip" data-tip="Close this tip" onClick={() => {
      setClosed(true);
      try { localStorage.setItem(HINTS_KEY, JSON.stringify([...new Set([...closedHints(), id])])); } catch { /* storage blocked */ }
    }}><X size={12} /></button>
  </div>;
}

const HINTS_KEY = 'ogs.designer.hintsClosed';
function closedHints(): string[] {
  try { return JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]'); } catch { return []; }
}
