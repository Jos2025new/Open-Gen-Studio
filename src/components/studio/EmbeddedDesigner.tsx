import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Eye, EyeOff, Hand, Lock, Maximize, Minus, MousePointer2, Plus, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { Stage } from '../designer/Stage';
import { designerKey } from '../designer/designerKeys';
import { patchLayer, redoDoc, selectDoc, setActiveLayer, undoDoc } from '../../engine/design/actions';
import { canRedo, canUndo, subscribeHistory } from '../../engine/design/history';
import { layerSelection, pickLayer, pickLayerRange, useLayerSelection } from '../../engine/design/selection';
import type { DesignTool } from '../../engine/design/rules';
import type { DesignDoc } from '../../engine/types';
import { setUi, useStore } from '../../store/store';
import { useBoardFocus } from './useBoardFocus';

/** The tools Studio's board offers: pick and move, and pan. The rest stay in the full Designer. */
export const EMBEDDED_TOOLS: ReadonlySet<DesignTool> = new Set<DesignTool>(['move', 'hand']);
/** Room the fit leaves under the picture: no composer is drawn over the board. */
export const EMBEDDED_FIT_BOTTOM = 12;
const win = (name: string, detail?: number) => window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));

function Layers({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = new Set(layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id)));
  if (!doc.layers.length) return <p className="studio-layers muted">No layers yet.</p>;
  return <ul className="studio-layers" aria-label="Layers">
    {[...doc.layers].reverse().map((l) => <li key={l.id} className={`studio-layer ${picked.has(l.id) ? 'is-active' : ''} ${l.visible ? '' : 'is-hidden'}`}>
      <IconButton icon={l.visible ? Eye : EyeOff} label={`${l.visible ? 'Hide' : 'Show'} ${l.name}`} size="sm" onClick={() => patchLayer(sessionId, doc.id, l.id, { visible: !l.visible })} />
      <button type="button" className="studio-layer-name" aria-pressed={l.id === doc.activeLayerId} onClick={(e) => {
        if (e.shiftKey && !(e.ctrlKey || e.metaKey)) { pickLayerRange(doc.id, doc.activeLayerId, l.id, doc.layers.map((x) => x.id)); return; }
        pickLayer(doc.id, l.id, e.ctrlKey || e.metaKey, [...picked]); setActiveLayer(sessionId, doc.id, l.id);
      }}>{l.name}</button>
      {l.locked ? <Lock size={12} className="faint" aria-label="Locked" /> : null}
    </li>)}
  </ul>;
}

/** The Designer inside Studio's board: the stage, a compact layers list and pick/pan, zoom and undo. One instance (the full workspace is not mounted). */
export function EmbeddedDesigner() {
  const session = useStore((s) => s.sessions[s.activeSessionId]);
  const tool = useStore((s) => s.ui.tool);
  const doc = session.docs.find((d) => d.id === session.activeDocId) ?? session.docs[0];
  const root = useRef<HTMLDivElement>(null);
  const inside = useBoardFocus(root);
  const [zoom, setZoom] = useState(1);
  const undoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canUndo(doc.id));
  const redoReady = useSyncExternalStore(subscribeHistory, () => !!doc && canRedo(doc.id));
  useEffect(() => { if (!EMBEDDED_TOOLS.has(tool)) setUi({ tool: 'move' }); }, [tool]);
  useEffect(() => {
    const view = (e: Event) => setZoom((e as CustomEvent<number>).detail);
    window.addEventListener('ogs:designer-view', view);
    return () => window.removeEventListener('ogs:designer-view', view);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (inside.current) designerKey(e, session.id, doc, EMBEDDED_TOOLS); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doc, session.id, inside]);
  if (!doc) return <div className="studio-designer is-empty" ref={root} tabIndex={-1}><p className="muted">No design in this session yet. Ask the agent to send the chat images to the Designer, or to start a design.</p></div>;
  return <div ref={root} tabIndex={-1} className="designer studio-designer">
    <div className="studio-designer-bar">
      {session.docs.length > 1 ? <select aria-label="Design" value={doc.id} onChange={(e) => selectDoc(session.id, e.target.value)}>{session.docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select> : <span className="studio-designer-name" title={doc.name}>{doc.name}</span>}
      <span className="studio-designer-tools">
        <IconButton icon={MousePointer2} label="Select and move" size="sm" active={tool === 'move'} onClick={() => setUi({ tool: 'move' })} />
        <IconButton icon={Hand} label="Pan" size="sm" active={tool === 'hand'} onClick={() => setUi({ tool: 'hand' })} />
        <IconButton icon={Undo2} label="Undo" size="sm" disabled={!undoReady} onClick={() => undoDoc(session.id, doc.id)} />
        <IconButton icon={Redo2} label="Redo" size="sm" disabled={!redoReady} onClick={() => redoDoc(session.id, doc.id)} />
        <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => win('ogs:designer-zoom', 0.8)} />
        <span className="num studio-designer-zoom">{Math.round(zoom * 100)}%</span>
        <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => win('ogs:designer-zoom', 1.25)} />
        <IconButton icon={Maximize} label="Fit canvas" size="sm" onClick={() => win('ogs:designer-fit')} />
      </span>
    </div>
    <Stage key={doc.id} sessionId={session.id} doc={doc} selectedCurve={null} setSelectedCurve={() => undefined} board={{ scope: root, bottom: EMBEDDED_FIT_BOTTOM }} />
    <Layers sessionId={session.id} doc={doc} />
  </div>;
}
