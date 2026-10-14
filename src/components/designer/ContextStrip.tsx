import { Settings2 } from 'lucide-react';
import { setUi, useStore } from '../../store/store';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { isProtectedImage } from '../../engine/design/rules';
import { TOOL_NAMES } from '../../engine/shortcuts';
import { setRuler } from '../../engine/design/strokeRuler';
import { TextStyleFields, ToolSettings } from './ToolSettings';
import { patchLayer } from '../../engine/design/actions';
import type { Layer } from '../../engine/types';
import { InlineChoice, InlineToggle } from './InlineControls';
import { deletePickedNode, setBreakNodes, setDeleteSegments, setJoinEnds, setPathNodeType, setSegmentsTo } from './PathNodes';
import { pageSegs, readTypes } from '../../engine/design/pathNodes';
import { convertToPath, patchShape, ShapeLookFields, ShapeSizeFields, usePickedShape } from './ShapeLookFields';
import { PrimFields } from './PrimFields';
import { editShape, setShapeEdit, useShapeEdit } from '../../engine/design/objectSelection';
import { useEffect } from 'react';

/*
 * The contextual strip above the tool box (docs/plan-designer-ux.md, step 1): the active tool's essential controls,
 * close to the tool, never behind a horizontal scroll (lines wrap), with what they change named first ("Brush → Layer
 * 3", "New text"). The rest of the tool's settings open with "Settings…" in the right panel.
 */

/** What the next gesture of the tool changes, in words. */
export function editTarget(doc: DesignDoc, tool: string): string | null {
  const l = activeLayer(doc);
  if (tool === 'brush') return l?.type === 'raster' && !l.locked && l.visible && !isProtectedImage(l) ? l.name : 'new layer';
  if (tool === 'eraser') return l ? l.name : null;
  // Fill and gradient always lay their result on a new layer (fill.ts, gradient.ts).
  if (tool === 'fill' || tool === 'gradient') return 'new layer';
  if (tool === 'text') return l?.type === 'text' ? `${l.name} (selected)` : 'new text';
  if (tool === 'move' || tool === 'select') return l ? l.name : null;
  return null;
}

export function ContextStrip({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const tool = useStore((s) => s.ui.tool);
  const ruler = useStore((s) => s.ui.strokeRuler);
  const lockRadii = useStore((s) => !!s.ui.shapeLockRadii);
  const picked = usePickedShape(doc), edit = useShapeEdit((st) => st.byDoc[doc.id]);
  // Another tool leaves shape edit mode (docs/plan-edicion-formas.md).
  useEffect(() => { if (tool !== 'move') setShapeEdit(doc.id, null); }, [tool, doc.id]);
  if (tool === 'hand') return null;
  const target = editTarget(doc, tool);
  const active = activeLayer(doc);
  const selectedText = tool === 'text' && active?.type === 'text' ? active : null;
  const pageRuler = ruler && ruler.docId === doc.id ? ruler : null;
  const selectedShape = tool === 'move' && !selectedText ? picked : null;
  const editing = !!selectedShape && edit?.shapeId === selectedShape.shape.id;
  const isPath = selectedShape?.shape.type === 'path';
  return <div className="context-strip" role="toolbar" aria-label={`${TOOL_NAMES[tool]} quick settings`}>
    <span className="context-target" data-tip="What the next action changes">
      <strong>{TOOL_NAMES[tool]}</strong>{target && <> → <span>{target}</span></>}
    </span>
    {/* With a text layer selected, the fields change that text, not the settings for the next one. */}
    {selectedText ? <div className="tool-settings" role="group" aria-label="Selected text">
      <TextStyleFields value={selectedText} compact onChange={(p) => { if (!selectedText.locked) patchLayer(sessionId, doc.id, selectedText.id, p as Partial<Layer>); }} />
    </div> : selectedShape ? <div className="tool-settings" role="group" aria-label={editing ? 'Editing shape' : 'Selected shape'}>
      {/* One click transforms; double-click or «Edit shape» edits (docs/plan-edicion-formas.md). */}
      {editing ? <>
        <span className="context-mode" data-tip={isPath ? 'Shift-click to toggle nodes, drag a selected node to move the group; Esc clears selection, then exits' : 'Drag the round handles; Esc or Done to leave'}>{isPath ? 'Editing nodes' : 'Editing shape'}</span>
        <ShapeSizeFields sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} />
        <PrimFields sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} />
        <ShapeLookFields value={selectedShape.shape} corners={selectedShape.shape.type === 'rect'} blur compact onChange={(p) => patchShape(sessionId, doc.id, selectedShape.layerId, selectedShape.shape.id, p)} />
        {selectedShape.shape.type === 'rect' && <InlineToggle label="Lock radii" tip="Rx and Ry move together when you drag a corner handle · without the lock, hold Ctrl while dragging" checked={lockRadii} onChange={(v) => setUi({ shapeLockRadii: v })} />}
        {isPath && edit?.node != null && (() => { const t = readTypes(pageSegs(selectedShape.shape), selectedShape.shape.nodeTypes)[edit.node] ?? 'c'; return <InlineChoice label="Node" value={t} options={[{ value: 'c' as const, label: 'Cusp node (Shift+C): handles move apart' }, { value: 's' as const, label: 'Smooth node (Shift+S): handles stay in line' }, { value: 'z' as const, label: 'Symmetric node (Shift+Y): in line and the same length' }].map((o) => ({ ...o, render: <NodeTypeIcon t={o.value} /> }))} onChange={(v) => setPathNodeType(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit.node!, v)} />; })()}
        {isPath && (edit?.nodes?.length ?? 0) >= 1 && <button type="button" className="opt" data-tip="Break the path at the selected nodes into separate ends (Shift+B)" onClick={() => setBreakNodes(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!)}>Break</button>}
        {isPath && (edit?.nodes?.length ?? 0) >= 2 && <>
          <button type="button" className="opt" data-tip="Merge selected ends, or weld adjacent selected nodes if there are no end pairs (Shift+J)" onClick={() => setJoinEnds(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!, 'merge')}>Join</button>
          <button type="button" className="opt" data-tip="Join the selected end nodes with a straight segment (Alt+J)" onClick={() => setJoinEnds(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!, 'segment')}>Join with segment</button>
          <button type="button" className="opt" data-tip="Delete the segments between adjacent selected nodes; open or split the path" onClick={() => setDeleteSegments(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!)}>Delete segment</button>
          <button type="button" className="opt" data-tip="Segments between the selected nodes become straight (Shift+L)" onClick={() => setSegmentsTo(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!, 'line')}>Make line</button>
          <button type="button" className="opt" data-tip="Straight segments between the selected nodes become curves (Shift+U)" onClick={() => setSegmentsTo(sessionId, doc.id, selectedShape.layerId, selectedShape.shape, edit!.nodes!, 'curve')}>Make curve</button>
        </>}
        {isPath && edit?.node != null && <button type="button" className="opt" data-tip="Remove the picked node keeping the shape (Delete; Ctrl+Delete joins its neighbours straight)" onClick={() => deletePickedNode(sessionId, doc.id)}>Delete node</button>}
        {(!isPath || selectedShape.shape.prim) && <button type="button" className="opt" data-tip="Inkscape's Object to Path: the same outline as editable nodes; the corner and size handles are gone (Ctrl+Z undoes it)" onClick={() => convertToPath(sessionId, doc.id, selectedShape.layerId, selectedShape.shape)}>Convert to path</button>}
        <button type="button" className="opt" onClick={() => setShapeEdit(doc.id, null)}>Done</button>
      </> : <>
        <PrimFields sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} />
        <ShapeLookFields value={selectedShape.shape} blur compact onChange={(p) => patchShape(sessionId, doc.id, selectedShape.layerId, selectedShape.shape.id, p)} />
        {(selectedShape.shape.type === 'rect' || selectedShape.shape.type === 'ellipse' || isPath) && <button type="button" className="opt" data-tip={isPath ? 'Its nodes and curve handles (or double-click the path)' : 'Corner radius and blur handles (or double-click the shape)'} onClick={() => editShape(doc.id, selectedShape.layerId, selectedShape.shape.id)}>{isPath ? 'Edit nodes' : 'Edit shape'}</button>}
      </>}
    </div> : <ToolSettings sessionId={sessionId} doc={doc} selectedCurve={null} compact />}
    {(tool === 'brush' || tool === 'eraser') && pageRuler && <InlineToggle label="Follow stroke ruler" tip="Strokes follow the guide placed with the Ruler tool (K)" checked={pageRuler.on} onChange={(on) => setRuler({ ...pageRuler, on })} />}
    <button type="button" className="opt context-more" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-panel', { detail: selectedText || selectedShape ? 'props' : 'tool' }))} data-tip={selectedText ? 'All the properties of the selected text, in the right panel' : 'All the settings of this tool, in the right panel'}><Settings2 size={13} />Settings…</button>
  </div>;
}

/* Node types as Inkscape draws them: a node with its two handles. Cusp: the handles bend apart; smooth: in line,
   unequal lengths; symmetric: in line and equal. The name stays as the choice's label and tooltip. */
function NodeTypeIcon({ t }: { t: 'c' | 's' | 'z' }) {
  const handles = t === 'c' ? 'M4 15 L9 9 L15 15' : t === 's' ? 'M3 9 H9 H16' : 'M4 9 H9 H14';
  return <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d={handles} fill="none" stroke="currentColor" strokeWidth="1.5" /><rect x="7.5" y="7.5" width="3" height="3" fill="currentColor" /></svg>;
}
