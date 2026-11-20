import { canDragGuides } from './drawGuides';
import { useEffect } from 'react';
import type { Layer, TextLayer } from '../../engine/types';
import { endDragPreview } from '../../engine/design/render';
import { activeLayer } from '../../engine/design/doc';
import { snapIdleStop } from './snapIdle';
import { SnapIndicator } from './SnapIndicator';
import { AgentGlow } from './AgentGlow';
import { StageEditHint, StageHint } from './StageEditHint';
import { StrokeRulerOverlay } from './StrokeRulerOverlay';
import { ShapeKnots } from './ShapeKnots';
import { handleCursor } from './stageSprites';
import { GradientKnots } from './ShapeHandles';
import { TextEditor } from './TextEditor';
import type { DesignTool } from '../../engine/design/rules';
import { getDoc, patchLayer, placeAsset } from '../../engine/design/actions';
import { toast, useStore } from '../../store/store';
import { SampleLoupe } from './SampleLoupe';
import { clearGuides, type GuideAxis } from '../../engine/design/guides';
import { getSelection } from '../../engine/design/pixelSelection';
import { SelectCursor } from './SelectCursor';
import { markDown } from '../../engine/design/modifierGate';
import { BrushCursor } from './BrushCursor';
import { useStageState, type StageProps } from './stageState';
import { useStageCanvas } from './stageCanvas';
import { getDesignerTool, moveGesture, releaseGesture } from './tools/registry';
import { beginPan } from './tools/hand';
import { trySample } from './tools/eyedropper';
import { Ruler } from './StageRuler';

/** `board`: Studio's embedded Designer: the box whose focus gates the keys, and the room the fit leaves at the bottom. */
export function Stage(props: StageProps) {
  const tool = useStore((s) => s.ui.tool);
  const descriptor = getDesignerTool(tool);
  const { objectEditing, overlay: ToolOverlay } = descriptor;
  const state = useStageState(props, tool, !!objectEditing);
  const {
    sessionId, doc, insideRef, wrapRef, canvasRef, view, size, wheel, cursor, drag, spaceDown, setSpaceDown,
    editingText, setEditingText, ctrlAtDown, rulers, guidesShown, guidesLocked, guideHover, setGuideHover,
    guidePreview, setGuidePreview, hoverHandle, setHoverHandle, loupe, guideLines, active, blocked, tBox,
    selectedCurve, shapeEditing, editLayers, editMarquee, handleMode, toDoc, lineartMode,
  } = state;
  useStageCanvas(state, descriptor);
  // ---------------------------------------------------------------------------
  // Keyboard

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!insideRef.current) return;
      if (e.code === 'Space' && !isTyping(e)) {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // ---------------------------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent) => {
    ctrlAtDown.current = e.ctrlKey || e.metaKey;
    markDown(e);
    if (editingText) return;
    cursor.move(e);
    const p = toDoc(e.clientX, e.clientY);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (descriptor.pan || spaceDown || e.button === 1) return beginPan(state, e);
    if (e.button !== 0) return;
    const current = getDoc(sessionId, doc.id);
    if (!current) return;

    if (trySample(state, current, p, e)) return;
    // Edit tool on a guide: drag it (back onto its ruler removes it).
    if (canDragGuides(tool, guidesShown, guidesLocked)) {
      const r = canvasRef.current!.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      for (const axis of ['x', 'y'] as const) {
        const index = (current.guides?.[axis] ?? []).findIndex((at) => Math.abs((axis === 'x' ? view.x + at * view.zoom - px : view.y + at * view.zoom - py)) <= 4);
        if (index >= 0) {
          drag.current = { kind: 'guide', axis, index, at: current.guides![axis][index] };
          setGuidePreview({ axis, index, at: current.guides![axis][index] });
          return;
        }
      }
    }

    descriptor.down?.({ state, current, act: activeLayer(current), p, e });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    cursor.move(e);
    const d = drag.current;
    if (!d) descriptor.hover?.({ state, p, e });
    if (!d && canDragGuides(tool, guidesShown, guidesLocked)) {
      const near = (axis: GuideAxis) => (doc.guides?.[axis] ?? []).some((at) => Math.abs((axis === 'x' ? p.x : p.y) - at) * view.zoom <= 4);
      const over = near('x') ? 'x' : near('y') ? 'y' : null;
      if (over !== guideHover) setGuideHover(over);
    }
    if (!d) return;
    moveGesture(state, d, p, e, onPointerMove);
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    snapIdleStop();
    endDragPreview();
    if (!d) return;

    releaseGesture(state, d, e);
  };

  const onWheel = (e: React.WheelEvent) => wheel.wheel(e, canvasRef.current!.getBoundingClientRect());

  // Native listener so preventDefault works (React wheel handlers are passive).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', stop, { passive: false });
    return () => c.removeEventListener('wheel', stop);
  }, []);


  const onDoubleClick = (e: React.MouseEvent) => descriptor.doubleClick?.(state, e);
  const cursorStyle = drag.current?.kind === 'xform' && drag.current.op === 'rotate' ? 'grabbing'
    : hoverHandle && objectEditing ? handleCursor(hoverHandle)
    : guidePreview || (guideHover && objectEditing) ? ((guidePreview?.axis ?? guideHover) === 'x' ? 'col-resize' : 'row-resize')
    : spaceDown ? 'grab' : descriptor.cursor?.(blocked) ?? 'crosshair';
  const editingLayer = editingText ? (doc.layers.find((l) => l.id === editingText) as TextLayer | undefined) : undefined;

  return (
    <div
      ref={wrapRef}
      className="stage"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-ogs-asset')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(e) => {
        const assetId = e.dataTransfer.getData('application/x-ogs-asset');
        if (!assetId) return;
        e.preventDefault();
        void placeAsset(sessionId, doc.id, assetId, doc.layers.length ? 'new' : 'base');
      }}
    >
      <canvas
        ref={canvasRef}
        className="stage-canvas"
        style={{ width: size.w, height: size.h, cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { cursor.leave(); setHoverHandle(null); }}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />
      <BrushCursor point={cursor.point} view={view} indicator={cursor.indicator} />
      <SelectCursor tool={tool} point={cursor.point} view={view} mods={cursor.mods} />
      <SampleLoupe ref={loupe} />
      <StrokeRulerOverlay view={view} docId={doc.id} placing={descriptor.placeStrokeRuler} />
      {objectEditing && (!editLayers || shapeEditing) && <ShapeKnots view={view} sessionId={sessionId} doc={doc} />}
      {ToolOverlay && <ToolOverlay view={view} sessionId={sessionId} doc={doc} />}
      {objectEditing && !editLayers && <GradientKnots view={view} sessionId={sessionId} doc={doc} />}
      <SnapIndicator view={view} measures={guideLines.m} alignments={guideLines.a} />
      <AgentGlow view={view} doc={doc} />
      {rulers && (['top', 'left'] as const).map((side) => (
        <Ruler key={side} side={side} view={view} size={size} guides={doc.guides}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = toDoc(e.clientX, e.clientY);
            // The top ruler makes horizontal guides (y), the left one vertical guides (x).
            const axis: GuideAxis = side === 'top' ? 'y' : 'x';
            drag.current = { kind: 'guide', axis, at: axis === 'x' ? p.x : p.y };
            setGuidePreview({ axis, at: drag.current.at });
          }}
          onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onContextMenu={(e) => { e.preventDefault(); if (doc.guides && (doc.guides.x.length || doc.guides.y.length)) { clearGuides(sessionId, doc.id); toast('Guides cleared', 'info'); } }}
        />
      ))}
      {editingLayer ? (
        <TextEditor
          layer={editingLayer}
          view={view}
          onDone={(text) => {
            setEditingText(null);
            if (text !== editingLayer.text) patchLayer(sessionId, doc.id, editingLayer.id, { text } as Partial<Layer>);
          }}
        />
      ) : null}
      {objectEditing && getSelection(doc.id) ? <StageHint id="move-region">Drag inside the pixel selection to extract and move it · vectors stay editable</StageHint> : objectEditing && selectedCurve ? <StageHint id="curve-points">Drag points to edit · Click away to move again</StageHint> : descriptor.curveHandles === 'edit' && lineartMode === 'edit' ? <StageHint id="lineart-edit">Select a stroke · Drag its points · Influence controls the bend</StageHint> : null}
      {objectEditing ? <StageEditHint doc={doc} shapeEditing={shapeEditing} marquee={Boolean(editMarquee)}
        layersEmpty={editLayers && !tBox} canShowHandles={!getSelection(doc.id) && !selectedCurve && Boolean(tBox) && drag.current?.kind !== 'xform'}
        handleMode={handleMode} canShowObjects={!getSelection(doc.id) && drag.current?.kind !== 'xform' && !editLayers} active={active} /> : null}
      {blocked && descriptor.showBlockReason ? <div className="stage-hint">{blocked}</div> : null}
    </div>
  );
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}
export type { DesignTool };
