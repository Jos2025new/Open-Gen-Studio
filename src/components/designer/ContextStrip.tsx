import { Settings2 } from '../ui/icons';
import { useStore } from '../../store/store';
import type { DesignDoc, VectorShape } from '../../engine/types';
import { activeLayer } from '../../engine/design/doc';
import { TOOL_NAMES } from '../../engine/shortcuts';
import { EditOps, ToolSettings } from './ToolSettings';
import { useEditCount } from './EditCard';
import { NodeDoneButton, NodeModeButtons, NodeMoreMenu } from './NodeEditBar';
import { SelectModeButtons } from './SelectModeButtons';
import { patchShape, ShapeLookFields, usePickedShape } from './ShapeLookFields';
import { PaintSwatch, ShapeParams } from './ShapePaint';
import { ShapeMoreMenu } from './ShapeMoreMenu';
import { editShape, setShapeEdit, useObjectSelection, useShapeEdit } from '../../engine/design/objectSelection';
import { useLayerSelection, layerSelection } from '../../engine/design/selection';
import { multiLayerRectangles } from '../../engine/design/multiRectEdit';
import { multiPathTargets } from '../../engine/design/multiPathEdit';
import { BooleanOps } from './BooleanOps';
import { StackOrder } from './StackOrder';
import { MultiShapeLook } from './MultiShapeLook';
import { SelectSameLook } from './SelectSameLook';
import { pickGroups } from '../../engine/design/multiObjectOps';
import { MultiRectangleRadii } from './MultiRectangleRadii';
import { useEffect } from 'react';
import { usePickedStrokes } from '../../engine/design/strokeEdit';
import { STROKE_MODES, StrokeStripFields } from './StrokeEditBar';
import { getDesignerTool } from './tools/registry';

/*
 * The contextual strip above the tool box (docs/plan-designer-ux.md, step 1): the active tool's essential controls,
 * close to the tool, never behind a horizontal scroll (lines wrap), with what they change named first ("Brush → Layer
 * 3", "New text"). The rest of the tool's settings open with "Settings…" in the right panel.
 */

/** What the next gesture of the tool changes, in words. */
export function editTarget(doc: DesignDoc, tool: string): string | null {
  return getDesignerTool(tool).contextTarget?.(activeLayer(doc)) ?? null;
}

/**
 * `variant="strip"`: the selection strip above the toolbox, one compact row of object actions (name, Fill, Stroke, Edit
 * nodes, Align when several); the tool's own settings stay in the Edit card. `variant="card"` (default): the Edit card's
 * bar. In node editing both show the same single row: name, the five modes, More, Done.
 */
export function ContextStrip({ sessionId, doc, variant = 'card' }: { sessionId: string; doc: DesignDoc; variant?: 'strip' | 'card' }) {
  const tool = useStore((s) => s.ui.tool);
  const descriptor = getDesignerTool(tool);
  const { textContext: TextContext, contextTail: ContextTail } = descriptor;
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
  useEffect(() => { if (!descriptor.selectionContext) setShapeEdit(doc.id, null); }, [descriptor, doc.id]);
  const strokePick = usePickedStrokes(doc);
  if (descriptor.hideContext) return null;
  const target = editTarget(doc, tool);
  const active = activeLayer(doc);
  const selectedText = TextContext && active?.type === 'text' ? active : null;
  const selectedShape = descriptor.selectionContext && mode === 'objects' && !selectedText ? picked : null;
  const editing = !!selectedShape && edit?.shapeId === selectedShape.shape.id;
  const strokes = descriptor.selectionContext && mode === 'objects' && !selectedText && !selectedShape && strokePick && (variant === 'strip' || edit?.strokes) ? strokePick : null, strokeEditing = !!strokes && !!edit?.strokes;
  const isPath = selectedShape?.shape.type === 'path';
  // Several picked shapes, in one layer or many: their look is edited together (MultiShapeLook).
  const pickedShapes = descriptor.selectionContext && mode === 'objects' && !selectedText && !selectedShape ? pickGroups(doc, objectSelection ?? []).flatMap((g) => g.layer.type === 'vector' ? g.layer.shapes.filter((s) => g.ids.includes(s.id)) : []) : [];
  const multiShapes = pickedShapes.length > 1 ? pickedShapes : null;
  const editShapeButton = selectedShape && (selectedShape.shape.type === 'rect' || selectedShape.shape.type === 'ellipse' || isPath) ? <button type="button" className="opt" data-tip={isPath ? 'Its nodes and curve handles (or double-click the path)' : 'Corner radius and blur handles (or double-click the shape)'} onClick={() => editShape(doc.id, selectedShape.layerId, selectedShape.shape.id)}>{isPath ? 'Edit nodes' : 'Edit shape'}</button> : null;
  const row = variant === 'strip' || strokeEditing || (editing && !multiNodeEdit);
  const objectName = ((selectedShape || strokes) && doc.layers.find((l) => l.id === (selectedShape?.layerId ?? strokes!.layerId))?.name) || target || 'Selection';
  return <div className={`context-strip${row ? ' context-row' : ''}`} role="toolbar" aria-label={editing || strokeEditing ? 'Node editing' : variant === 'strip' ? 'Selection controls' : `${TOOL_NAMES[tool]} quick settings`}>
    {row
      ? <span className="context-target" data-tip="The selected object"><strong>{objectName}</strong></span>
      : <span className="context-target" data-tip="What the next action changes"><strong>{TOOL_NAMES[tool]}</strong>{target && <> → <span>{target}</span></>}</span>}
    {descriptor.selectionContext && (multiNodeEdit || (!picked && nodeTargets.length > 1)) ? <div className="tool-settings" role="group" aria-label="Multiple path nodes">
      <span className="context-mode" data-tip="Click nodes; Shift-click adds or removes. Drag a selected node to move the group; drag empty space to select nodes. Multi-path topology edits remain per path.">{multiNodeEdit ? `Editing nodes · ${edit!.paths!.length} paths` : `${nodeTargets.length} paths selected`}</span>
      {multiNodeEdit
        ? <button type="button" className="opt node-done is-primary" onClick={() => setShapeEdit(doc.id, null)}>Done</button>
        : <button type="button" className="opt" onClick={() => setShapeEdit(doc.id, { layerId: nodeTargets[0].layerId, shapeId: nodeTargets[0].shapeId, paths: nodeTargets.map((t) => ({ layerId: t.layerId, shapeId: t.shapeId, nodes: [] })) })}>Edit nodes</button>}
    </div> : selectedText && TextContext ? <TextContext sessionId={sessionId} docId={doc.id} layer={selectedText} /> : selectedShape ? <div className="tool-settings" role="group" aria-label={editing ? 'Editing shape' : 'Selected shape'}>
      {/* One click transforms; double-click or «Edit shape» edits (docs/plan-edicion-formas.md). */}
      {editing ? <>
        <NodeModeButtons target={{ sessionId, docId: doc.id, layerId: selectedShape.layerId, shape: selectedShape.shape }} />
        {isPath && !selectedShape.shape.prim && <SelectModeButtons docId={doc.id} shape={selectedShape.shape as VectorShape} />}
        {isPath && !selectedShape.shape.prim && <NodeMoreMenu sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape as VectorShape} />}
        <NodeDoneButton docId={doc.id} />
      </> : variant === 'strip' ? <>
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="fill" />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="stroke" />
        {editShapeButton}
        <SelectSameLook doc={doc} />
        <ShapeMoreMenu sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape as VectorShape} />
      </> : <>
        <ShapeParams sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="fill" />
        <PaintSwatch sessionId={sessionId} docId={doc.id} layerId={selectedShape.layerId} shape={selectedShape.shape} side="stroke" />
        <ShapeLookFields value={selectedShape.shape} blur compact onChange={(p) => patchShape(sessionId, doc.id, selectedShape.layerId, selectedShape.shape.id, p)} />
        {editShapeButton}
        <SelectSameLook doc={doc} />
      </>}
    </div> : multiShapes ? <div className="tool-settings" role="group" aria-label="Selected shapes">
      <MultiShapeLook sessionId={sessionId} doc={doc} first={multiShapes[0]} count={multiShapes.length} />
      {variant === 'strip' && <EditOps sessionId={sessionId} doc={doc} alignOnly />}
    </div> : strokes ? <div className="tool-settings" role="group" aria-label={strokeEditing ? 'Editing strokes' : 'Selected strokes'}>
      {strokeEditing ? <><NodeModeButtons modes={[...STROKE_MODES]} /><NodeDoneButton docId={doc.id} /></> : <StrokeStripFields sessionId={sessionId} doc={doc} layerId={strokes.layerId} strokes={strokes.strokes} />}
    </div> : variant === 'strip' ? (editCount > 1 ? <EditOps sessionId={sessionId} doc={doc} alignOnly /> : null) : <ToolSettings sessionId={sessionId} doc={doc} selectedCurve={null} compact />}
    {variant === 'strip' && !multiNodeEdit && <BooleanOps sessionId={sessionId} doc={doc} />}
    {descriptor.selectionContext && !editing && !strokeEditing && !multiNodeEdit && <StackOrder sessionId={sessionId} doc={doc} />}
    {descriptor.selectionContext && roundTargets.length > 1 && <MultiRectangleRadii sessionId={sessionId} doc={doc} targets={roundTargets} />}
    {ContextTail && <ContextTail docId={doc.id} />}
    {variant === 'card' && !editing && <button type="button" className="opt context-more" onClick={() => window.dispatchEvent(new CustomEvent('ogs:designer-panel', { detail: selectedText || selectedShape ? 'props' : 'tool' }))} data-tip={selectedText ? 'All the properties of the selected text, in the right panel' : 'All the settings of this tool, in the right panel'}><Settings2 size={13} />Settings…</button>}
  </div>;
}
