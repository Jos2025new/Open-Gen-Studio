import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { chatImagesNotInDesigner, chatToDesigner } from '../../engine/design/fromChat';
import { ImportFromChat } from '../ui/ImportFromChat';
import { ArrowUpFromLine, Images, Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { toast, setUi, useStore } from '../../store/store';
import type { ExportFormat } from '../../engine/design/export';
import { deleteLayer, exportDocFile, newBlankDoc, redoDoc, saveDocToGallery, undoDoc } from '../../engine/design/actions';
import { activeLayer, DOC_PRESETS } from '../../engine/design/doc';
import { canRedo, canUndo, subscribeHistory } from '../../engine/design/history';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { TopbarActions } from '../shell/TopBar';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { Stage } from './Stage';
import { ToolRail } from './ToolRail';
import { DocumentPicker } from './DocumentPicker';
import { uploadFiles } from '../../engine/actions';
import { getDoc, openAssetInDesigner, placeAsset } from '../../engine/design/actions';
import { cloneCanvas, getBuffer } from '../../engine/design/raster';
import { canvasToBlob } from '../../lib/media';
import { ToolSettings } from './ToolSettings';
import { LayersPanel } from './LayersPanel';

const SHORTCUTS: Record<string, DesignTool> = { v: 'move', h: 'hand', b: 'brush', g: 'fill', p: 'lineart', e: 'eraser', r: 'rect', o: 'ellipse', l: 'line', t: 'text' };

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
  const saveConfirm = usePopover();
  const [zoom, setZoom] = useState(1);
  const [selectedCurve, setSelectedCurve] = useState<{ layerId: string; strokeId: string; handles: number[] } | null>(null);
  useEffect(() => { setSelectedCurve(null); }, [doc?.id, session.id]);
  const [busy, setBusy] = useState(false);
  const assets = useStore((s) => s.assets);
  const generations = useStore((s) => s.generations);
  // Chat images not in a design yet: one click (or "send it to the Designer" to the agent) opens each as a design.
  const fromChat = useMemo(
    () => chatImagesNotInDesigner(session.id).map((a) => {
      const g = a.generationId ? generations[a.generationId] : undefined;
      return { id: a.id, assetId: a.id, label: g ? (g.op ? g.op.id.replace(/_/g, ' ') : g.prompt.split(/[.,\n]/)[0].slice(0, 60)) : 'Image' };
    }),
    [session, assets, generations],
  );
  const undoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canUndo(doc.id));
  const redoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canRedo(doc.id));

  useEffect(() => {
    const inField = (e: Event) => e.target instanceof Element && !!e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
    const paste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || inField(e)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      const targetDocId = doc?.id;
      void (async () => {
        const ids = await uploadFiles(files);
        if (useStore.getState().activeSessionId !== session.id) return;
        if (!targetDocId) {
          if (!ids.length) return;
          await openAssetInDesigner(session.id, ids[0]);
          const newDocId = useStore.getState().sessions[session.id]?.activeDocId;
          if (newDocId) for (const id of ids.slice(1)) await placeAsset(session.id, newDocId, id, 'new');
        } else if (getDoc(session.id, targetDocId)) {
          for (const id of ids) await placeAsset(session.id, targetDocId, id, 'new');
        }
      })().catch((err) => toast(err instanceof Error ? err.message : 'Could not paste image.', 'error'));
    };
    const copy = (e: ClipboardEvent) => {
      if (e.defaultPrevented || inField(e) || window.getSelection()?.toString() || !doc) return;
      const layer = activeLayer(doc);
      if (layer?.type !== 'raster') return;
      const buffer = getBuffer(layer.id);
      if (!buffer) { toast('Image pixels are still loading.', 'error'); return; }
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') { toast('This browser cannot copy images to the clipboard.', 'error'); return; }
      e.preventDefault();
      const png = canvasToBlob(cloneCanvas(buffer), 'image/png');
      void navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
        .then(() => toast('Image copied', 'success'))
        .catch(() => toast('Could not copy image to the clipboard.', 'error'));
    };
    document.addEventListener('paste', paste);
    document.addEventListener('copy', copy);
    return () => { document.removeEventListener('paste', paste); document.removeEventListener('copy', copy); };
  }, [doc, session.id]);

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
      <IconButton ref={presets.ref} className="designer-new-document" icon={Plus} label="New document" size="sm" onClick={presets.toggle} />
      <Popover open={presets.open} anchor={presets.ref} onClose={presets.close} label="Document presets">
        {DOC_PRESETS.map((p) => <MenuItem key={p.id} label={p.label} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(session.id, p); presets.close(); }} />)}
      </Popover>
      {doc && <ToolSettings sessionId={session.id} doc={doc} selectedCurve={selectedCurve} />}
      {doc && <>
        <IconButton ref={saveConfirm.ref} icon={Images} label="Save to gallery" size="sm" disabled={busy} active={saveConfirm.open} onClick={saveConfirm.toggle} />
        <Popover open={saveConfirm.open} anchor={saveConfirm.ref} onClose={saveConfirm.close} width={260} label="Save to gallery">
          <div className="confirm-pop">
            <p>Save <strong>{doc.name}</strong> to the gallery as an image?</p>
            <div className="confirm-pop-actions">
              <Button size="sm" variant="ghost" onClick={saveConfirm.close}>Cancel</Button>
              <Button size="sm" variant="primary" icon={Images} onClick={() => { saveConfirm.close(); void output(true); }}>Save</Button>
            </div>
          </div>
        </Popover>
        <Button ref={exportMenu.ref} icon={ArrowUpFromLine} size="sm" disabled={busy} onClick={exportMenu.toggle}>Export</Button>
        <Popover open={exportMenu.open} anchor={exportMenu.ref} onClose={exportMenu.close} label="Export format">
          {EXPORT_FORMATS.map((f) => <MenuItem key={f.id} label={f.label} detail={f.detail} onClick={() => { exportMenu.close(); void output(false, f.id); }} />)}
        </Popover>
      </>}
    </TopbarActions>
    <ImportFromChat
      sessionId={session.id}
      canvas="designer"
      items={fromChat}
      noun="image"
      modes={[{ id: 'layers', label: 'As layers of one' }, { id: 'documents', label: 'Each as a design' }]}
      onImport={(ids, mode) => void chatToDesigner(session.id, { assetIds: ids, as: mode === 'documents' ? 'documents' : 'layers' })}
    />
    {doc ? <><DocumentPicker sessionId={session.id} docs={session.docs} active={doc} /><ToolRail doc={doc}>
        <IconButton icon={Undo2} label="Undo" size="sm" disabled={!undoReady} onClick={() => undoDoc(session.id, doc.id)} />
        <IconButton icon={Redo2} label="Redo" size="sm" disabled={!redoReady} onClick={() => redoDoc(session.id, doc.id)} />
        <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 0.8 }))} />
        <span className="zoom-value num">{Math.round(zoom * 100)}%</span>
        <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 1.25 }))} />
        <IconButton icon={Maximize} label="Fit canvas" size="sm" onClick={() => window.dispatchEvent(new Event('ogs:designer-fit'))} />
      </ToolRail><Stage key={doc.id} sessionId={session.id} doc={doc} selectedCurve={selectedCurve} setSelectedCurve={setSelectedCurve} /><LayersPanel sessionId={session.id} doc={doc} /></> :
      <div className="designer-empty"><h1>Start a design</h1><p className="muted">Choose a canvas, or open an image from the gallery.</p><div className="preset-grid">{DOC_PRESETS.map((p) => <button className="preset" key={p.id} onClick={() => newBlankDoc(session.id, p)}><strong>{p.label}</strong><span className="muted num">{p.width} × {p.height}</span></button>)}</div></div>}
  </div>;
}
