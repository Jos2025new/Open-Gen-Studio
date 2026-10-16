import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Maximize, Minus, Plus, Redo2, Undo2 } from 'lucide-react';
import { IconButton } from '../ui/primitives';
import { Stage } from '../designer/Stage';
import { designerKey } from '../designer/designerKeys';
import { designerClipboard } from '../designer/designerClipboard';
import { redoDoc, undoDoc } from '../../engine/design/actions';
import { canRedo, canUndo, subscribeHistory } from '../../engine/design/history';
import { setUi, useStore } from '../../store/store';
import { useBoardFocus } from './useBoardFocus';
import { EmbeddedDesignerBar, EMBEDDED_TOOLS } from './EmbeddedDesignerBar';
import { EmbeddedFileMenu } from './EmbeddedFileMenu';

export { EMBEDDED_TOOLS };
/** Room the fit leaves under the picture: the bottom bar floats over the stage's lower edge. */
export const EMBEDDED_FIT_BOTTOM = 64;
const win = (name: string, detail?: number) => window.dispatchEvent(detail === undefined ? new Event(name) : new CustomEvent(name, { detail }));

/**
 * The Designer inside Studio's board: a top bar (file menu, design, undo, zoom), the stage and a bottom bar with the tools.
 * Keys and image paste/copy/cut act only while focus is inside the board. One instance (the full workspace is not mounted).
 */
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
  useEffect(() => designerClipboard(session.id, doc, () => inside.current), [doc, session.id, inside]);
  return <div ref={root} tabIndex={-1} className={`designer studio-designer ${doc ? '' : 'is-empty'}`}>
    <div className="studio-designer-bar">
      <EmbeddedFileMenu sessionId={session.id} docs={session.docs} doc={doc} />
      {doc ? <>
        <span className="studio-designer-name" title={doc.name}>{doc.name}</span>
        <span className="studio-designer-tools">
          <IconButton icon={Undo2} label="Undo" size="sm" disabled={!undoReady} onClick={() => undoDoc(session.id, doc.id)} />
          <IconButton icon={Redo2} label="Redo" size="sm" disabled={!redoReady} onClick={() => redoDoc(session.id, doc.id)} />
          <IconButton icon={Minus} label="Zoom out" size="sm" onClick={() => win('ogs:designer-zoom', 0.8)} />
          <span className="num studio-designer-zoom">{Math.round(zoom * 100)}%</span>
          <IconButton icon={Plus} label="Zoom in" size="sm" onClick={() => win('ogs:designer-zoom', 1.25)} />
          <IconButton icon={Maximize} label="Fit canvas" size="sm" onClick={() => win('ogs:designer-fit')} />
        </span>
      </> : null}
    </div>
    {doc ? <>
      <Stage key={doc.id} sessionId={session.id} doc={doc} selectedCurve={null} setSelectedCurve={() => undefined} board={{ scope: root, bottom: EMBEDDED_FIT_BOTTOM }} />
      <EmbeddedDesignerBar sessionId={session.id} doc={doc} />
    </> : <p className="muted studio-designer-none">No design in this session yet. Use File → New, or ask the agent to send the chat images to the Designer.</p>}
  </div>;
}
