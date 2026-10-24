import { useEffect, useState } from 'react';
import { Crop } from 'lucide-react';
import type { DesignDoc } from '../../engine/types';
import { ANCHORS, MAX_SIDE, resizeCanvas, trimToContent, type Anchor } from '../../engine/design/canvasSize';
import { FORMAT_PRESETS, PAGE_UNITS, DEFAULT_DPI, orientationOf, presetPx, pxToUnit, unitToPx, type Orientation, type PageUnit } from '../../engine/design/pageUnits';
import { mutateDoc } from '../../engine/design/actions';
import { toast } from '../../store/store';
import { Button, IconButton, Segmented } from '../ui/primitives';
import { InlineColor, InlineSelect } from './InlineControls';
import { Popover, usePopover } from '../ui/Popover';

/** Page size: width and height with an anchor (where the current page stays), or trim to what is drawn. `inline` shows the form without the popover (the toolbox card). */
export function CanvasSize({ sessionId, doc, inline = false }: { sessionId: string; doc: DesignDoc; inline?: boolean }) {
  const pop = usePopover();
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [lock, setLock] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>('middle-center');
  const [unit, setUnit] = useState<PageUnit>('px');
  const [dpi, setDpi] = useState(DEFAULT_DPI);
  const [preset, setPreset] = useState('custom');
  const [bg, setBg] = useState(doc.background ?? '#ffffff');
  const dp = Math.max(1, dpi || DEFAULT_DPI);
  const step = unit === 'px' ? 1 : unit === 'in' ? 0.01 : 0.1;
  const open = () => { setW(doc.width); setH(doc.height); pop.toggle(); };
  const done = (err: string | null) => { if (err) toast(err, 'error'); else pop.close(); };
  useEffect(() => { if (inline) { setW(doc.width); setH(doc.height); } }, [inline, doc.width, doc.height]);
  const setWidth = (v: number) => { setPreset('custom'); setW(v); if (lock && doc.width) setH(Math.round((v * doc.height) / doc.width)); };
  const setHeight = (v: number) => { setPreset('custom'); setH(v); if (lock && doc.height) setW(Math.round((v * doc.width) / doc.height)); };
  const pickPreset = (id: string) => {
    setPreset(id);
    const p = FORMAT_PRESETS.find((f) => f.id === id);
    if (!p) return;
    const px = presetPx(p, dp);
    const land = orientationOf(w, h) === 'landscape';
    setW(land ? px.h : px.w); setH(land ? px.w : px.h);
  };
  const orient = (o: Orientation) => { if (o !== orientationOf(w, h)) { setW(h); setH(w); } };
  const apply = () => {
    const err = resizeCanvas(sessionId, doc.id, w, h, anchor);
    if (!err && bg !== (doc.background ?? '#ffffff')) mutateDoc(sessionId, doc.id, (d) => ({ ...d, background: bg }));
    done(err);
  };
  const form = <div className="canvas-size">
      <div className="canvas-size-dims">
        <InlineSelect label="Format" value={preset} options={[{ value: 'custom', label: 'Custom' }, ...FORMAT_PRESETS.map((f) => ({ value: f.id, label: f.label }))]} onChange={pickPreset} />
        <Segmented size="sm" value={orientationOf(w, h)} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} onChange={orient} />
        <label>W<input type="number" min={step} step={step} value={pxToUnit(w, unit, dp)} onChange={(e) => setWidth(Math.min(MAX_SIDE, unitToPx(+e.target.value, unit, dp)))} /></label>
        <label>H<input type="number" min={step} step={step} value={pxToUnit(h, unit, dp)} onChange={(e) => setHeight(Math.min(MAX_SIDE, unitToPx(+e.target.value, unit, dp)))} /></label>
        <Segmented size="sm" value={unit} options={PAGE_UNITS.map((u) => ({ value: u, label: u }))} onChange={setUnit} />
        {unit !== 'px' && <label>DPI<input type="number" min={1} max={1200} value={dpi} onChange={(e) => setDpi(+e.target.value)} /></label>}
        <InlineColor label="Page color" value={bg} onChange={setBg} />
        <label className="check-row"><input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />Keep ratio</label>
      </div>
      <span className="field-label">Anchor · where the current page stays</span>
      <div className="anchor-grid" role="radiogroup" aria-label="Anchor">
        {ANCHORS.map((a) => <button key={a} type="button" role="radio" aria-checked={anchor === a} aria-label={a} className={anchor === a ? 'is-on' : ''} onClick={() => setAnchor(a)} />)}
      </div>
      <button type="button" className="opt anchor-center" onClick={() => setAnchor('middle-center')} disabled={anchor === 'middle-center'}>Center</button>
      <div className="confirm-pop-actions">
        <Button size="sm" variant="ghost" onClick={() => done(trimToContent(sessionId, doc.id))} data-tip="The page shrinks to the visible layers">Trim to content</Button>
        <Button size="sm" variant="primary" onClick={apply}>Apply</Button>
      </div>
  </div>;
  if (inline) return form;
  return <>
    <IconButton ref={pop.ref} icon={Crop} label={`Canvas size · ${doc.width} × ${doc.height}`} size="sm" active={pop.open} onClick={open} />
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={250} label="Canvas size">
      {form}
    </Popover>
  </>;
}
