import { MAX_ZOOM } from '../../engine/design/viewCoordinates';
import { ToolHelpLine, ViewToggles } from './ToolHelp';
import { DrawingChoicePrompt } from './DrawingChoice';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { chatImagesNotInDesigner, chatToDesigner } from '../../engine/design/fromChat';
import { ImportFromChat } from '../ui/ImportFromChat';
import { CanvasSize } from './CanvasSize';
import { AspectGlyph } from '../composer/MediaControls';
import { ArrowUpFromLine, Images, ImagePlus, Maximize, Minus, PanelRight, Plus, Redo2, Undo2 } from 'lucide-react';
import { useStore } from '../../store/store';
import type { ExportFormat } from '../../engine/design/export';
import { newBlankDoc, redoDoc, undoDoc } from '../../engine/design/actions';
import { DOC_PRESETS } from '../../engine/design/doc';
import { canRedo, canUndo, historyDepth, subscribeHistory } from '../../engine/design/history';
import { designerKey } from './designerKeys';
import { designerClipboard } from './designerClipboard';
import { EXPORT_FORMATS, IMPORT_ACCEPT, importDesignFiles, runDesignOutput } from './designerFile';
import { TopbarActions } from '../shell/TopBar';
import { Button, IconButton, MenuItem } from '../ui/primitives';
import { Popover, usePopover } from '../ui/Popover';
import { Stage } from './Stage';
import { ToolPalette } from './ToolPalette';
import { DocumentPicker } from './DocumentPicker';
import { EditOps, SelectionChip } from './ToolSettings';
import { LayersPanel } from './LayersPanel';

export function DesignerWorkspace() {
  const session = useStore((s) => s.sessions[s.activeSessionId]);
  const doc = session.docs.find((d) => d.id === session.activeDocId) ?? session.docs[0];
  const presets = usePopover();
  const exportMenu = usePopover();
  const saveConfirm = usePopover();
  const [zoom, setZoom] = useState(1);
  const [zoomDraft, setZoomDraft] = useState<string | null>(null);
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
  // Steps the byte limit dropped (Paso 9): a small note next to undo, only when there are some.
  const trimmed = useSyncExternalStore(subscribeHistory, () => (doc ? historyDepth(doc.id).dropped : 0));

  useEffect(() => designerClipboard(session.id, doc), [doc, session.id]);

  useEffect(() => {
    const view = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener('ogs:designer-view', view);
    return () => window.removeEventListener('ogs:designer-view', view);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => designerKey(e, session.id, doc);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, session.id]);

  const output = async (gallery: boolean, format: ExportFormat = 'png') => {
    if (!doc || busy) return;
    setBusy(true);
    try { await runDesignOutput(session.id, doc.id, gallery, format); } finally { setBusy(false); }
  };

  const importRef = useRef<HTMLInputElement>(null);
  const importFiles = async (files: File[]) => { if (doc) await importDesignFiles(session.id, doc.id, files); };
  useEffect(() => {
    const open = () => importRef.current?.click();
    window.addEventListener('ogs:upload', open);
    return () => window.removeEventListener('ogs:upload', open);
  }, []);

  return <div className="designer">
    <input ref={importRef} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { const files = [...(e.currentTarget.files ?? [])]; e.currentTarget.value = ''; void importFiles(files); }} />
    <TopbarActions>
      <IconButton ref={presets.ref} className="designer-new-document" icon={Plus} label="New document" size="sm" onClick={presets.toggle} />
      <Popover open={presets.open} anchor={presets.ref} onClose={presets.close} label="Document presets">
        {DOC_PRESETS.map((p) => <MenuItem key={p.id} label={<span className="preset-menu-label"><span className="preset-menu-glyph"><AspectGlyph value={`${p.width}:${p.height}`} size={16} /></span>{p.label}</span>} detail={`${p.width} × ${p.height}`} onClick={() => { newBlankDoc(session.id, p); presets.close(); }} />)}
      </Popover>
      {doc && <>
        <span className="topbar-sep" aria-hidden />
        <IconButton icon={Undo2} label="Undo" size="sm" disabled={!undoReady} onClick={() => undoDoc(session.id, doc.id)} />
        <IconButton icon={Redo2} label="Redo" size="sm" disabled={!redoReady} onClick={() => redoDoc(session.id, doc.id)} />
        {trimmed > 0 && <span className="muted" title="Older undo steps were dropped to keep the history within its memory limit" style={{ fontSize: 11, alignSelf: 'center' }}>History trimmed</span>}
        <span className="topbar-sep" aria-hidden />
        <IconButton icon={ImagePlus} label="Import image" size="sm" onClick={() => importRef.current?.click()} />
        <EditOps sessionId={session.id} doc={doc} turnOnly />
        <IconButton icon={PanelRight} label="Show or hide right panel" size="sm" onClick={() => window.dispatchEvent(new Event('ogs:layers-toggle'))} />
        <span className="topbar-sep" aria-hidden />
      </>}
      {doc && <SelectionChip docId={doc.id} />}
      {doc && <>
        <CanvasSize key={doc.id} sessionId={session.id} doc={doc} />
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
    {doc ? <>
      <DocumentPicker sessionId={session.id} docs={session.docs} active={doc} />
      <ToolPalette sessionId={session.id} doc={doc} selectedCurve={selectedCurve}
        history={null}
        view={<>
          <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 1.25 }))} />
          <label className="zoom-value num">
            <input aria-label="Zoom percent" inputMode="decimal" value={zoomDraft ?? Math.round(zoom * 100)} onFocus={() => setZoomDraft(String(Math.round(zoom * 100)))} onChange={(e) => setZoomDraft(e.target.value)} onBlur={(e) => {
              const raw = e.target.value.trim().replace(',', '.');
              const percent = Number(raw);
              setZoomDraft(null);
              if (raw && Number.isFinite(percent)) window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: Math.min(MAX_ZOOM * 100, Math.max(5, percent)) / (zoom * 100) }));
            }} onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') { e.currentTarget.value = String(Math.round(zoom * 100)); e.currentTarget.blur(); e.stopPropagation(); }
            }} /><span>%</span>
          </label>
          <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-zoom', { detail: 0.8 }))} />
          <IconButton icon={Maximize} label="Fit canvas" size="sm" onClick={() => window.dispatchEvent(new Event('ogs:designer-fit'))} />
          <ViewToggles />
        </>} />
      <ToolHelpLine />
      <Stage key={doc.id} sessionId={session.id} doc={doc} selectedCurve={selectedCurve} setSelectedCurve={setSelectedCurve} />
      <DrawingChoicePrompt sessionId={session.id} doc={doc} />
      <LayersPanel sessionId={session.id} doc={doc} selectedCurve={selectedCurve} />
    </> :
      <div className="designer-empty"><h1>Start a design</h1><p className="muted">Choose a canvas, or open an image from the gallery.</p><div className="preset-grid">{DOC_PRESETS.map((p) => <button className="preset" key={p.id} onClick={() => newBlankDoc(session.id, p)}><span className="preset-glyph"><AspectGlyph value={`${p.width}:${p.height}`} size={30} /></span><span className="preset-text"><strong>{p.label}</strong><span className="muted num">{p.width} × {p.height}</span></span></button>)}</div></div>}
  </div>;
}
