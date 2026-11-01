import { Hand, Spline, Scissors, Eraser, Lasso, MoreHorizontal, X } from 'lucide-react';
import type { VectorShape } from '../../engine/types';
import { setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { NODE_EDIT_MODES, NODE_EDIT_MODES_READY, setEraseRadius, setNodeEditMode, useNodeEditMode, type NodeEditMode } from '../../engine/design/nodeEditMode';
import { pageSegs, readTypes } from '../../engine/design/pathNodes';
import { deletePickedNode, setBreakNodes, setDeleteSegments, setJoinEnds, setPathNodeType, setSegmentsTo } from './PathNodes';
import { InlineChoice, InlineSlider } from './InlineControls';
import { Popover, usePopover } from '../ui/Popover';

/* Labelled mode bar of the node editor: icon + word, one mode active, then «More» (the node operations) and Done. */
const MODES: Record<NodeEditMode, { label: string; icon: typeof Hand; tip: string }> = {
  move: { label: 'Move', icon: Hand, tip: 'Move: drag nodes and handles, drag a segment to bend it, double-click to add a node' },
  bend: { label: 'Bend', icon: Spline, tip: 'Bend: drag a segment so the curve passes through the pointer; nodes stay put' },
  cut: { label: 'Cut', icon: Scissors, tip: 'Cut: click the path to cut it there, or drag a line across it' },
  erase: { label: 'Erase', icon: Eraser, tip: 'Erase: drag over the path to rub part of it out' },
  lasso: { label: 'Lasso', icon: Lasso, tip: 'Lasso: drag a free-form loop to select the nodes inside (Shift adds)' },
};

export function NodeModeButtons() {
  const mode = useNodeEditMode((s) => s.mode);
  const radius = useNodeEditMode((s) => s.eraseRadius);
  return <><div className="node-modes" role="radiogroup" aria-label="Node editing mode">
    {NODE_EDIT_MODES.map((m) => {
      const { label, icon: Icon, tip } = MODES[m], ready = NODE_EDIT_MODES_READY.includes(m);
      return <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!ready} className={`opt node-mode${mode === m ? ' is-on' : ''}`} data-tip={tip} onClick={() => setNodeEditMode(m)}><Icon size={13} />{label}</button>;
    })}
  </div>{mode === 'erase' && <InlineSlider label="Eraser" unit="px" min={2} max={100} allowManualOverflow value={radius} onChange={setEraseRadius} />}</>;
}

export function NodeMoreMenu({ sessionId, docId, layerId, shape }: { sessionId: string; docId: string; layerId: string; shape: VectorShape }) {
  const pop = usePopover(), edit = useShapeEdit((st) => st.byDoc[docId]);
  const nodes = edit?.nodes ?? [], one = edit?.node;
  return <>
    <button type="button" ref={pop.ref} className="opt context-more" aria-haspopup="menu" aria-expanded={pop.open} data-tip="Node operations: type, break, join, segments, delete" onClick={pop.toggle}><MoreHorizontal size={13} />More</button>
    <Popover open={pop.open} anchor={pop.ref} onClose={pop.close} placement="top-start" width={240} label="Node operations">
      <div className="node-more">
        {one != null && (() => { const t = readTypes(pageSegs(shape), shape.nodeTypes)[one] ?? 'c'; return <InlineChoice label="Node" value={t} options={[{ value: 'c' as const, label: 'Cusp node (Shift+C): handles move apart' }, { value: 's' as const, label: 'Smooth node (Shift+S): handles stay in line' }, { value: 'z' as const, label: 'Symmetric node (Shift+Y): in line and the same length' }].map((o) => ({ ...o, render: <NodeTypeIcon t={o.value} /> }))} onChange={(v) => setPathNodeType(sessionId, docId, layerId, shape, one, v)} />; })()}
        {nodes.length >= 1 && <button type="button" className="opt" data-tip="Break the path at the selected nodes into separate ends (Shift+B)" onClick={() => setBreakNodes(sessionId, docId, layerId, shape, nodes)}>Break</button>}
        {nodes.length >= 2 && <>
          <button type="button" className="opt" data-tip="Merge selected ends, or weld adjacent selected nodes if there are no end pairs (Shift+J)" onClick={() => setJoinEnds(sessionId, docId, layerId, shape, nodes, 'merge')}>Join</button>
          <button type="button" className="opt" data-tip="Join the selected end nodes with a straight segment (Alt+J)" onClick={() => setJoinEnds(sessionId, docId, layerId, shape, nodes, 'segment')}>Join with segment</button>
          <button type="button" className="opt" data-tip="Delete the segments between adjacent selected nodes; open or split the path" onClick={() => setDeleteSegments(sessionId, docId, layerId, shape, nodes)}>Delete segment</button>
          <button type="button" className="opt" data-tip="Segments between the selected nodes become straight (Shift+L)" onClick={() => setSegmentsTo(sessionId, docId, layerId, shape, nodes, 'line')}>Make line</button>
          <button type="button" className="opt" data-tip="Straight segments between the selected nodes become curves (Shift+U)" onClick={() => setSegmentsTo(sessionId, docId, layerId, shape, nodes, 'curve')}>Make curve</button>
        </>}
        {one != null && <button type="button" className="opt" data-tip="Remove the picked node keeping the shape (Delete; Ctrl+Delete joins its neighbours straight)" onClick={() => deletePickedNode(sessionId, docId)}>Delete node</button>}
        {nodes.length === 0 && one == null && <span className="context-help">Pick nodes to see their operations.</span>}
      </div>
    </Popover>
  </>;
}

export function NodeDoneButton({ docId }: { docId: string }) {
  return <button type="button" className="opt node-done" data-tip="Leave node editing (Esc)" onClick={() => setShapeEdit(docId, null)}><X size={13} />Done</button>;
}

/* Node types as Inkscape draws them: a node with its two handles. Cusp: the handles bend apart; smooth: in line,
   unequal lengths; symmetric: in line and equal. The name stays as the choice's label and tooltip. */
function NodeTypeIcon({ t }: { t: 'c' | 's' | 'z' }) {
  const handles = t === 'c' ? 'M4 15 L9 9 L15 15' : t === 's' ? 'M3 9 H9 H16' : 'M4 9 H9 H14';
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d={handles} fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="7.5" y="7.5" width="3" height="3" fill="currentColor" /></svg>;
}
