import { useState } from 'react';
import { Box, Camera, ChevronDown, ChevronRight, Hand, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Chip, IconButton, MenuItem, Segmented, Toggle, Range } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { resetView, setOrbit, setView3d, snapshot3d, useViewer3d, VIEW3D_DEFAULT, VIEWS, zoomBy } from './viewer3d';

/** View bar under the 3D model, same look as the operations dock. */
export function Viewer3DDock() {
  const ready = useViewer3d((s) => !!s.el);
  const pan = useViewer3d((s) => s.view.pan);
  const pop = usePopover<HTMLSpanElement>();
  return (
    <div className="asset-actions">
      <span ref={pop.ref}>
        <Chip icon={Box} onClick={pop.toggle} disabled={!ready}>
          View <ChevronDown size={14} />
        </Chip>
      </span>
      <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} width={180} placement="top-start" label="View">
        {VIEWS.map((v) => <MenuItem key={v.id} label={v.label} onClick={() => { setOrbit(v.orbit); pop.close(); }} />)}
        <MenuItem icon={RotateCcw} label="Reset view" onClick={() => { resetView(); pop.close(); }} />
      </Popover>
      <IconButton icon={Hand} label="Pan (drag to move)" active={pan} disabled={!ready} onClick={() => setView3d({ pan: !pan })} />
      <IconButton icon={ZoomOut} label="Zoom out" disabled={!ready} onClick={() => zoomBy(-1)} />
      <IconButton icon={ZoomIn} label="Zoom in" disabled={!ready} onClick={() => zoomBy(1)} />
      <IconButton icon={Camera} label="Snapshot to Gallery" disabled={!ready} onClick={() => void snapshot3d()} />
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="v3d-row">
      <span>{label}</span>
      <Range min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="num">{value.toFixed(2)}</span>
    </label>
  );
}

/** Collapsible "3D Controls" for the side panel. View only: never saved, never changes the file. */
export function Viewer3DControls() {
  const v = useViewer3d((s) => s.view);
  const ready = useViewer3d((s) => !!s.el);
  const [open, setOpen] = useState(true);
  if (!ready) return null;
  return (
    <section className="info-sect v3d">
      <button type="button" className="info-sect-head v3d-head" onClick={() => setOpen(!open)}>
        <span className="info-sect-title">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} 3D controls</span>
      </button>
      {open ? (
        <div className="info-box v3d-box">
          <Slider label="Exposure" value={v.exposure} min={0} max={2} step={0.05} onChange={(exposure) => setView3d({ exposure })} />
          <div className="v3d-row">
            <span>Environment</span>
            <Segmented size="sm" value={v.environment} options={[{ value: 'neutral', label: 'Neutral' }, { value: 'legacy', label: 'Soft' }]} onChange={(environment) => setView3d({ environment })} />
          </div>
          <div className="v3d-row"><span>Grid</span><Toggle checked={v.grid} onChange={(grid) => setView3d({ grid })} /></div>
          <div className="v3d-sub">Material</div>
          <div className="v3d-row"><span>Texture</span><Toggle checked={v.texture} onChange={(texture) => setView3d({ texture })} /></div>
          <Slider label="Roughness" value={v.roughness ?? 0.5} min={0} max={1} step={0.05} onChange={(roughness) => setView3d({ roughness })} />
          <Slider label="Metalness" value={v.metalness ?? 0} min={0} max={1} step={0.05} onChange={(metalness) => setView3d({ metalness })} />
          <Chip icon={RotateCcw} onClick={() => setView3d({ ...VIEW3D_DEFAULT, pan: v.pan })}>Reset</Chip>
        </div>
      ) : null}
    </section>
  );
}
