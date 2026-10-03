import { useState } from 'react';
import { Crop } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { ANCHORS, MAX_SIDE, resizeCanvas, trimToContent, type Anchor } from '../../engine/design/canvasSize';
import { toast } from '../../store/store';
import { Button, IconButton } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';

/** Page size: width and height with an anchor (where the current page stays), or trim to what is drawn. */
export function CanvasSize({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const pop = usePopover();
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [lock, setLock] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>('middle-center');
  const open = () => { setW(doc.width); setH(doc.height); pop.toggle(); };
  const done = (err: string | null) => { if (err) toast(err, 'error'); else pop.close(); };
  const setWidth = (v: number) => { setW(v); if (lock && doc.width) setH(Math.round((v * doc.height) / doc.width)); };
  const setHeight = (v: number) => { setH(v); if (lock && doc.height) setW(Math.round((v * doc.width) / doc.height)); };
  return <>
    <IconButton ref={pop.ref} icon={Crop} label={`Canvas size · ${doc.width} × ${doc.height}`} size="sm" active={pop.open} onClick={open} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={250} label="Canvas size">
      <div className="canvas-size">
        <div className="canvas-size-dims">
          <label>W<input type="number" min={1} max={MAX_SIDE} value={w} onChange={(e) => setWidth(+e.target.value)} /></label>
          <label>H<input type="number" min={1} max={MAX_SIDE} value={h} onChange={(e) => setHeight(+e.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />Keep ratio</label>
        </div>
        <span className="field-label">Anchor · where the current page stays</span>
        <div className="anchor-grid" role="radiogroup" aria-label="Anchor">
          {ANCHORS.map((a) => <button key={a} type="button" role="radio" aria-checked={anchor === a} aria-label={a} className={anchor === a ? 'is-on' : ''} onClick={() => setAnchor(a)} />)}
        </div>
        <div className="confirm-pop-actions">
          <Button size="sm" variant="ghost" onClick={() => done(trimToContent(sessionId, doc.id))} data-tip="The page shrinks to the visible layers">Trim to content</Button>
          <Button size="sm" variant="primary" onClick={() => done(resizeCanvas(sessionId, doc.id, w, h, anchor))}>Apply</Button>
        </div>
      </div>
    </Popover>
  </>;
}
