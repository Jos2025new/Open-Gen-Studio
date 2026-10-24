import { useState } from 'react';
import type { DesignDoc } from '../../engine/types';
import { clearGuides, guidesAroundPage, placeGuide, type GuideAxis } from '../../engine/design/guides';
import { snapOptsFor } from '../../engine/design/snap';
import { paintModeOf } from '../../engine/design/paintMode';
import { setUi, useStore } from '../../store/store';
import { Button } from '../ui/primitives';
import { InlineChoice, InlineToggle } from './InlineControls';

/** Layout → Guides: what shows (rulers, guides), whether Edit can move them, snapping, and exact guides by position. */
export function GuidesCard({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const rulers = useStore((s) => s.ui.rulers ?? false);
  const show = useStore((s) => s.ui.showGuides ?? true);
  const lock = useStore((s) => s.ui.lockGuides ?? false);
  const byMode = useStore((s) => s.ui.snapByMode);
  const snap = snapOptsFor(doc, byMode);
  const [axis, setAxis] = useState<GuideAxis>('x');
  const [unit, setUnit] = useState<'px' | '%'>('px');
  const [pos, setPos] = useState(0);
  const count = (doc.guides?.x.length ?? 0) + (doc.guides?.y.length ?? 0);
  const add = () => {
    const span = axis === 'x' ? doc.width : doc.height;
    placeGuide(sessionId, doc.id, axis, unit === '%' ? (pos / 100) * span : pos);
  };
  // Same per-mode snap setting as the Snap menu; guides snapping only matters while snapping is on.
  const setSnapGuides = (on: boolean) => setUi({ snapByMode: { ...byMode, [paintModeOf(doc)]: { ...snap, guides: on } } });
  return <div className="guides-card">
    <div className="guides-col">
      <InlineToggle label="Show rulers" tip="Shift+R" checked={rulers} onChange={(v) => setUi({ rulers: v })} />
      <InlineToggle label="Show guides" checked={show} onChange={(v) => setUi({ showGuides: v })} />
      <InlineToggle label="Lock guides" tip="Edit cannot move or remove locked guides" checked={lock} onChange={(v) => setUi({ lockGuides: v })} />
      <InlineToggle label="Snap to guides" tip={snap.on ? undefined : 'Turn on Snap while moving to use it'} checked={snap.on && snap.guides !== false} onChange={setSnapGuides} />
    </div>
    <div className="guides-col">
      <InlineChoice<GuideAxis> label="Orientation" value={axis} options={[{ value: 'x', label: 'Vertical' }, { value: 'y', label: 'Horizontal' }]} onChange={setAxis} />
      <div className="canvas-size-dims">
        <label>Position<input type="number" aria-label="Guide position" value={pos} onChange={(e) => setPos(+e.target.value)} /></label>
        <InlineChoice<'px' | '%'> label="Unit" value={unit} options={[{ value: 'px', label: 'px' }, { value: '%', label: '%' }]} onChange={setUnit} />
      </div>
      <div className="confirm-pop-actions">
        <Button size="sm" variant="primary" onClick={add}>Add</Button>
        <Button size="sm" variant="ghost" onClick={() => guidesAroundPage(sessionId, doc.id)}>Guides around page</Button>
        <Button size="sm" variant="ghost" disabled={!count} onClick={() => clearGuides(sessionId, doc.id)}>Clear all guides</Button>
      </div>
    </div>
  </div>;
}
