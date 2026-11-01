import { Settings2 } from 'lucide-react';
import { useStore } from '../../store/store';
import type { DesignDoc } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { isProtectedImage } from '../../engine/design/rules';
import { TOOL_NAMES } from '../../engine/shortcuts';
import { setRuler } from '../../engine/design/strokeRuler';
import { EditOps, TextStyleFields, ToolSettings } from './ToolSettings';
import { useEditCount } from './EditCard';
import { patchLayer } from '../../engine/design/actions';
import type { Layer, VectorShape } from '../../engine/types';
import { InlineToggle } from './InlineControls';
import { NodeDoneButton, NodeModeButtons, NodeMoreMenu } from './NodeEditBar';
import { patchShape, ShapeLookFields, usePickedShape } from './ShapeLookFields';
import { PaintSwatch, ShapeParams } from './ShapePaint';
import { ShapeMoreMenu } from './ShapeMoreMenu';
import { editShape, setShapeEdit, useObjectSelection, useShapeEdit } from '../../engine/design/objectSelection';
import { useLayerSelection } from '../../engine/design/selection';
import { multiLayerRectangles } from '../../engine/design/multiRectEdit';
import { multiPathTargets } from '../../engine/design/multiPathEdit';
import { layerSelection } from '../../engine/design/selection';
import { MultiRectangleRadii } from './MultiRectangleRadii';
import { useEffect } from 'react';
import { usePickedStrokes } from '../../engine/design/strokeEdit';
import { STROKE_MODES, StrokeStripFields } from './StrokeEditBar';

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

/**
 * `variant="strip"`: the selection strip above the toolbox, one compact row of object actions (name, Fill, Stroke, Edit
 * nodes, Align when several); the tool's own settings stay in the Edit card. `variant="card"` (default): the Edit card's
 * bar. In node editing both show the same single row: name, the five modes, More, Done.
 */
export function ContextStrip({ sessionId, doc, variant = 'card' }: { sessionId: string; doc: DesignDoc; variant?: 'strip' | 'card' }) {
  const tool = useStore((s) => s.ui.tool);
  const ruler = useStore((s) => s.ui.strokeRuler);
  const mode = useStore((s) => s.ui.selectMode ?? 'objects');
  const picked = usePickedShape(doc), edit = useShapeEdit((st) => st.byDoc[doc.id]);
  const editCount = useEditCount(doc);
  const objectSelection = useObjectSelection((st) => st.byDoc[doc.id] ?? null);
  const layerPicks = useLayerSelection((st) => st.byDoc[doc.id]);
  const layerGroup = mode === 'layers' || (!objectSelection && (layerPicks?.filter((id) => doc.layers.some((l) => l.id === id)).length ?? 0) > 1);
  const targetMode = layerGroup ? 'layers' : 'objects';
  const roundTargets = multiLayerRectangles(doc, targetMode, objectSelection, layerPicks ?? []);
  const nodeTargets = multiPathTargets(doc, targetMode, objectSelection, layerGroup ? layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id)) : []);
  const multiNodeEdit = (edit?.paths?.length ?? 0) > 1
    && nodeTargets.length === edit!.paths!.length
    && nodeTargets.every((target, index) => target.layerId === edit!.paths![index].layerId && target.shapeId === edit!.paths![index].shapeId);
  // Another tool leaves shape edit mode (docs/plan-edicion-formas.md).
  useEffect(() => { if (tool !== 'move') setShapeEdit(doc.id, null); }, [tool, doc.id]);
  if (tool === 'hand') return null;
  const target = editTarget(doc, tool);
  const active = activeLayer(doc);
  const selectedText = tool === 'text' && active?.type === 'text' ? active : null;
  const pageRuler = ruler && ruler.docId === doc.id ? ruler : null;
  const selectedShape = tool === 'move' && mode === 'objects' && !selectedText ? picked : null;
  const editing = !!selectedShape && edit?.shapeId === selectedShape.shape.id;
  const strokePick = usePickedStrokes(doc), strokes = tool === 'move' && mode === 'objects' && !selectedText && !selectedShape && strokePick && (variant === 'strip' || edit?.strokes) ? strokePick : null, strokeEditing = !!strokes && !!edit?.strokes;
  const isPath = selectedShape?.shape.type === 'path';
  const editShapeButton = selectedShape && (selectedShape.shape.type === 'rect' || selectedShape.shape.type === 'ellipse' || isPath) ? <button type="button" className="opt" data-tip={isPath ? 'Its nodes and curve handles (or double-click the path)' : 'Corner radius and blur handles (or double-click the shape)'} onClick={() => editShape(doc.id, selectedShape.layerId, selectedShape.shape.id)}>{isPath ? 'Edit nodes' : 'Edit shape'}</button> : null;
  const row = variant === 'strip' || strokeEditing || (editing && !multiNodeEdit);
  const objectName = ((selectedShape || strokes) && doc.layers.find((l) => l.id === (selectedShape?.layerId ?? strokes!.layerId))?.name) || target || 'Selection';
  return <div className={`context-strip${row ? ' context-row' : ''}`} role="toolbar" aria-label={editing || strokeEditing ? 'Node editing' : variant === 'strip' ? 'Selection controls' : `${TOOL_NAMES[tool]} quick settings`}>
    {row
      ? <span className="context-target" data-tip="The selected object"><strong>{objectName}</strong></span>
      : <span className="context-target" data-tip="What the next action changes"><strong>{TOOL_NAMES[tool]}</strong>{target && <> → <span>{target}</span></>}</span>}
    {/* With a text layer selected, the fields change that text, not the settings for the next one. */}
    {tool === 'move' && (multiNodeEdit || (!picked && nodeTargets.length > 1)) ? <div className="tool-settings" role="group" aria-label="Multiple path nodes">
      <span className="context-mode" data-tip="Click nodes; Shift-click adds or removes. Drag a selected node to move the group; drag empty space to select nodes. Multi-path topology edits remain per path.">{multiNodeEdit ? `Editing nodes · ${edit!.paths!.length} paths` : `${nodeTargets.length} paths selected`}</span>
      {multiNodeEdit
        ? <button type="button" className="opt node-done is-primary" onClick={() => setShapeEdit(doc.id, null)}>Done</button>
        : <button type="button" className="opt" onClick={() => setShapeEdit(doc.id, { layerId: nodeTargets[0].layerId, shapeId: nodeTargets[0].shapeId, paths: nodeTargets.map((t) => ({ layerId: t.layerId, shapeId: t.shapeId, nodes: [] })) })}>Edit nodes</button>}
    </div> : selectedText ? <div className="tool-settings" role="group" aria-label="Selected text">
      <TextStyleFields value={selectedText} compact onChange={(p) => { if (!selectedText.locked) patchLayer(sessionId, doc.id, selectedText.id, p as Partial<Layer>); }} />
    </div> : selectedShape ? <div className="tool-settings" role="group" aria-label={editing ? 'Editing shape' : 'Selected shape'}>
      {/* One click transforms; double-click or «Edit shape» edits (docs/plan-edicion-formas.md). */}
      {editing ? <>
        <NodeModeButtons target={{ sessionId, docId: doc.id, layerId: selectedShape.layerId, shape: selectedShape.shape }} />
        {isPath && !selectedShape.shape.prim && <NodeMoreMenu sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape as VectorShape} />}
        <NodeDoneButton docId={doc.id} />
      </> : variant === 'strip' ? <>
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="fill" />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="stroke" />
        {editShapeButton}
        <ShapeMoreMenu sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape as VectorShape} />
      </> : <>
        <ShapeParams sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="fill" />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="stroke" />
        <ShapeLookFields value={selectedShape.shape} blur compact onChange={(p) => patchShape(sessionId, doc.id, selectedShape.layerId, selectedShape.shape.id, p)} />
        {editShapeButton}
      </>}
    </div> : strokes ? <div className="tool-settings" role="group" aria-label={strokeEditing ? 'Editing strokes' : 'Selected strokes'}>
      {strokeEditing ? <><NodeModeButtons modes={[...STROKE_MODES]} /><NodeDoneButton docId={doc.id} /></> : <StrokeStripFields sessionId={sessionId} doc={doc} layerId={strokes.layerId} strokes={strokes.strokes} />}
    </div> : variant === 'strip' ? (editCount > 1 ? <EditOps sessionId={sessionId} doc={doc} alignOnly /> : null) : <ToolSettings sessionId={sessionId} doc={doc} selectedCurve={null} compact />}
    {tool === 'move' && roundTargets.length > 1 && <MultiRectangleRadii sessionId={sessionId} doc={doc} targets={roundTargets} />}
    {(tool === 'brush' || tool === 'eraser') && pageRuler && <InlineToggle label="Follow stroke ruler" tip="Strokes follow the guide placed with the Ruler tool (K)" checked={pageRuler.on} onChange={(on) => setRuler({ ...pageRuler, on })} />}
    {variant === 'card' && !editing && <button type="button" className="opt context-more" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-panel', { detail: selectedText || selectedShape ? 'props' : 'tool' }))} data-tip={selectedText ? 'All the properties of the selected text, in the right panel' : 'All the settings of this tool, in the right panel'}><Settings2 size={13} />Settings…</button>}
  </div>;
}
