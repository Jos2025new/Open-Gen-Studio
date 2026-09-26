import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Images, Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { toast, setUi, useStore } from '../../store/store';
import type { ExportFormat } from '../../engine/design/export';
import { deleteLayer, exportDocFile, newBlankDoc, redoDoc, saveDocToGallery, selectDoc, undoDoc } from '../../engine/design/actions';
import { activeLayer, DOC_PRESETS } from '../../engine/design/doc';
import { canRedo, canUndo, subscribeHistory } from '../../engine/design/history';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { TopbarActions } from '../shell/TopBar';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { Stage } from './Stage';
import { ToolRail } from './ToolRail';
import { LayersPanel } from './LayersPanel';

const SHORTCUTS: Record<string, DesignTool> = { v: 'move', h: 'hand', b: 'brush', p: 'lineart', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', t: 'text' };

const EXPORT_FORMATS: Array<{ id: ExportFormat; label: string; detail: string }> = [
  { id: 'png', label: 'PNG', detail: 'Image, keeps transparency' },
  { id: 'jpg', label: 'JPG', detail: 'Image, white background' },
  { id: 'svg', label: 'SVG', detail: 'Editable layers, text and shapes' },
  { id: 'pdf', label: 'PDF', detail: 'Vector; text in standard fonts' },
];

export function DesignerWorkspace() {
  const session = useStore((s) => s.sessions[s.activeSessionId]);
  const doc = session.docs.find((d) => d.id === session.activeDocId) ?? session.docs[0];
  const presets = usePopover();
  const exportMenu = usePopover();
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const undoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canUndo(doc.id));
  const redoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canRedo(doc.id));

  useEffect(() => {
    const view = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener('ogs:designer-view', view);
    return () => window.removeEventListener('ogs:designer-view', view);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!doc || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable="true"]')) || document.querySelector('.popover, .lightbox')) return;
      const layer = activeLayer(doc);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        (e.shiftKey ? redoDoc : undoDoc)(session.id, doc.id);
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 'Delete' && layer && !layer.locked) {
          e.preventDefault();
          deleteLayer(session.id, doc.id, layer.id);
        } else {
          const tool = SHORTCUTS[e.key.toLowerCase()];
          if (tool && !toolBlockReason(tool, layer)) { e.preventDefault(); setUi({ tool }); }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, session.id]);

  const output = async (gallery: boolean, format: ExportFormat = 'png') => {
    if (!doc || busy) return;
    setBusy(true);
    try { await (gallery ? saveDocToGallery(session.id, doc.id) : exportDocFile(session.id, doc.id, format)); }
    catch (err) { toast(err instanceof Error ? err.message : 'Export failed', 'error'); }
    finally { setBusy(false); }
  };

  return <div className="designer">
    <TopbarActions>
      {doc && <select aria-label="Document" className="doc-select" value={doc.id} onChange={(e) => selectDoc(session.id, e.target.value)}>{session.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>}
      <IconButton ref={presets.ref} icon={Plus} label="New document" size="sm" onClick={presets.toggle} />
      <Popover open={presets.open} anchor={presets.ref} onClose={presets.close} label="Document presets">
        {DOC_PRESETS.map((p) => <MenuItem key={p.id} label={p.label} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(session.id, p); presets.close(); }} />)}
      </Popover>
      {doc && <>
        <IconButton icon={Undo2} label="Undo" size="sm" disabled={!undoReady} onClick={() => undoDoc(session.id, doc.id)} />
        <IconButton icon={Redo2} label="Redo" size="sm" disabled={!redoReady} onClick={() => redoDoc(session.id, doc.id)} />
        <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 0.8 }))} />
        <span className="zoom-value num">{Math.round(zoom * 100)}%</span>
        <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 1.25 }))} />
        <IconButton icon={Maximize} label="Fit canvas" size="sm" onClick={() => window.dispatchEvent(new Event('ogs:designer-fit'))} />
        <IconButton icon={Images} label="Save to gallery" size="sm" disabled={busy} onClick={() => void output(true)} />
        <Button ref={exportMenu.ref} icon={Download} size="sm" disabled={busy} onClick={exportMenu.toggle}>Export</Button>
        <Popover open={exportMenu.open} anchor={exportMenu.ref} onClose={exportMenu.close} label="Export format">
          {EXPORT_FORMATS.map((f) => <MenuItem key={f.id} label={f.label} detail={f.detail} onClick={() => { exportMenu.close(); void output(false, f.id); }} />)}
        </Popover>
      </>}
    </TopbarActions>
    {doc ? <><ToolRail doc={doc} /><Stage key={doc.id} sessionId={session.id} doc={doc} /><LayersPanel sessionId={session.id} doc={doc} /></> :
      <div className="designer-empty"><h1>Start a design</h1><p className="muted">Choose a canvas, or open an image from the gallery.</p><div className="preset-grid">{DOC_PRESETS.map((p) => <button className="preset" key={p.id} onClick={() => newBlankDoc(session.id, p)}><strong>{p.label}</strong><span className="muted num">{p.width} × {p.height}</span></button>)}</div></div>}
  </div>;
}
