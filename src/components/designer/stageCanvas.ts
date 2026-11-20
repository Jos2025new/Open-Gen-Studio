import { drawGuides } from './drawGuides';
import { useLayoutEffect } from 'react';
import type { Layer } from '../../engine/types';
import { drawStroke } from '../../engine/design/brushTextures';
import { drawDoc, layerBox } from '../../engine/design/render';
import { unionBox } from '../../engine/design/doc';
import { drawEditMarquee } from './StageEditMarquee';
import { worldPoints } from '../../engine/design/strokes';
import { checkerTile, drawTransformOverlay } from './stageSprites';
import { outlinePicked } from './stageObjMove';
import { paintGradient } from '../../engine/design/gradient';
import { pickedIn } from '../../engine/design/objectSelection';
import { layerObjects, objectsBox } from '../../engine/design/objectOps';
import { getSelection } from '../../engine/design/pixelSelection';
import { drawSelect } from './StageSelect';
import type { StageState } from './stageState';
import type { ToolDescriptor } from './tools/types';
import { drawShapePreview } from './tools/shape';
import { tok, accentA } from './stageTheme';

export function useStageCanvas(state: StageState, { objectEditing, curveHandles }: ToolDescriptor) {
  const {
    canvasRef, size, view, doc, active, tool, preview, brush, shapeStyle, editingText, rv, live, objPick,
    editLayers, shiftDown, lineartMode, selectedCurve, picked, guideLines, selectMode, selVersion, selDraft,
    editMarquee, rulers, guidesShown, guidesLocked, guidePreview, paintFrame, targetSig, dismissed,
    handleMode, pivot, hoverHandle, shapeEditing, gradientSpec, handles, tBox, drag, modsHeld,
  } = state;
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr) || canvas.height !== Math.round(size.h * dpr)) {
      canvas.width = Math.round(size.w * dpr);
      canvas.height = Math.round(size.h * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);
    // Checkerboard shows transparency.
    if (!doc.background) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, doc.width, doc.height);
      ctx.clip();
      // 12 px screen cells anchored at the page corner, as one repeated tile (one fill instead of a rect per cell,
      // which grew with the square of the zoom). Drawn in screen space; the clip above still holds.
      const pattern = ctx.createPattern(checkerTile(), 'repeat');
      if (pattern) {
        pattern.setTransform(new DOMMatrix().translate(view.x, view.y));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = pattern;
        ctx.fillRect(view.x, view.y, doc.width * view.zoom, doc.height * view.zoom);
      }
      ctx.restore();
    }
    drawDoc(ctx, doc, { hideLayerId: editingText ?? undefined });
    // Gradient being dragged: drawn live over the page, as it will land.
    if (preview?.kind === 'gradient') paintGradient(ctx, doc, gradientSpec, preview.x0, preview.y0, preview.x1, preview.y1, getSelection(doc.id));
    drawSelect(ctx, doc, view, selDraft, modsHeld.current);
    // The page edge, lighter than the workspace, so an empty or dark page still reads as a page.
    ctx.strokeStyle = tok('--border-strong', '#55555e');
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);
    if (live) drawStroke(ctx, live);
    ctx.restore();

    // Overlays in screen space.
    // The document context has been restored: draw the marquee in screen space here so its
    // view offset and zoom are applied exactly once, like the other screen-space overlays.
    if (editMarquee) drawEditMarquee(ctx, editMarquee, view);
    const sx = (x: number) => view.x + x * view.zoom;
    const sy = (y: number) => view.y + y * view.zoom;
    ctx.strokeStyle = tok('--border', 'rgba(255,255,255,0.08)');
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sx(0)) + 0.5, Math.round(sy(0)) + 0.5, Math.round(doc.width * view.zoom), Math.round(doc.height * view.zoom));
    // Ruler guides across the whole view (the one being dragged replaces its saved position).
    if (guidesShown) drawGuides(ctx, doc.guides, guidePreview, sx, sy, size);
    // Snap guides: the line the moving layer sticks to, across the view.
    const g = guideLines;
    if (g.x != null || g.y != null) {
      ctx.save();
      ctx.strokeStyle = '#ff4fd8';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      if (g.x != null) { ctx.beginPath(); ctx.moveTo(Math.round(sx(g.x)) + 0.5, 0); ctx.lineTo(Math.round(sx(g.x)) + 0.5, size.h); ctx.stroke(); }
      if (g.y != null) { ctx.beginPath(); ctx.moveTo(0, Math.round(sy(g.y)) + 0.5); ctx.lineTo(size.w, Math.round(sy(g.y)) + 0.5); ctx.stroke(); }
      ctx.restore();
    }
    // Several layers picked: each one's box (dashed) and the box around all of them.
    if (picked.length > 1 && !editingText) {
      const boxes = picked.map((id) => doc.layers.find((l) => l.id === id)).filter((l): l is Layer => Boolean(l && l.visible)).map((l) => layerBox(l)).filter((b): b is NonNullable<typeof b> => Boolean(b));
      ctx.save();
      ctx.strokeStyle = accentA(0.75);
      ctx.setLineDash([5, 4]);
      for (const b of boxes) ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
      const all = unionBox(boxes);
      ctx.setLineDash([]);
      ctx.strokeStyle = accentA(0.35);
      if (all) ctx.strokeRect(sx(all.x) - 3.5, sy(all.y) - 3.5, all.w * view.zoom + 7, all.h * view.zoom + 7);
      ctx.restore();
    }
    // Framed by the two-tone box: no accent outline on top.
    const framed = !!tBox && (handles.length > 0 || shapeEditing) && !editingText;
    if (active && active.visible && !editingText && drag.current?.kind !== 'xform') {
      const objectsMode = objectEditing && !editLayers && !shiftDown;
      const objects = objectsMode ? layerObjects(active) : [];
      if (objectsMode && objects.length && !dismissed) {
        // Objects mode: every object of the active layer faintly, the picked ones in the accent; no layer handles.
        const ids = pickedIn(objPick, active.id);
        ctx.save();
        ctx.lineWidth = 1;
        for (const o of objects) {
          const on = ids.includes(o.id);
          if (on && framed) continue;
          ctx.strokeStyle = on ? accentA() : accentA(0.28);
          ctx.strokeRect(sx(o.box.x) + 0.5, sy(o.box.y) + 0.5, o.box.w * view.zoom, o.box.h * view.zoom);
        }
        const all = ids.length > 1 ? objectsBox(active, ids) : null;
        if (all && !framed) {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = accentA(0.55);
          ctx.strokeRect(sx(all.x) - 3.5, sy(all.y) - 3.5, all.w * view.zoom + 7, all.h * view.zoom + 7);
        }
        ctx.restore();
      } else {
        const b = layerBox(active);
        if (b && !framed && !dismissed) {
          ctx.strokeStyle = accentA();
          ctx.lineWidth = 1;
          ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
        }
      }
    }
    if (objectEditing && !editLayers && !shiftDown && !editingText && !framed) outlinePicked(ctx, doc, objPick, active?.id, accentA(), (b) => [sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom]);
    // Transform handles and box (stageSprites.ts: drawTransformOverlay).
    const xformLive = drag.current?.kind === 'xform' && drag.current.op !== 'pivot' ? drag.current : null;
    if (tBox && (xformLive || ((handles.length || shapeEditing) && !editingText))) drawTransformOverlay(ctx, { x: sx(tBox.x), y: sy(tBox.y), w: tBox.w * view.zoom, h: tBox.h * view.zoom }, xformLive && { op: xformLive.op, x: sx(xformLive.cx), y: sy(xformLive.cy) }, handles.map((h) => ({ ...h, x: sx(h.x), y: sy(h.y) })), handleMode === 'scale', hoverHandle, accentA());
    if ((objectEditing || (curveHandles === 'edit' && lineartMode === 'edit')) && active?.type === 'vector' && active.visible && !active.locked && selectedCurve?.layerId === active.id) {
      const stroke = active.strokes?.find((s) => s.id === selectedCurve.strokeId);
      if (stroke) {
        ctx.strokeStyle = accentA();
        ctx.lineWidth = 1;
        ctx.beginPath();
        worldPoints(stroke).forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)));
        ctx.stroke();
        for (const i of selectedCurve.handles) {
          const point = worldPoints(stroke)[i];
          if (!point) continue;
          ctx.beginPath();
          ctx.arc(sx(point[0]), sy(point[1]), 4, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 || i === stroke.points.length - 1 ? accentA() : tok('--surface', '#18181c');
          ctx.fill(); ctx.stroke();
        }
      }
    }
    if (preview?.kind === 'gradient') {
      // The drag line with its two ends, so the direction and length read clearly.
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(sx(preview.x0), sy(preview.y0));
      ctx.lineTo(sx(preview.x1), sy(preview.y1));
      ctx.strokeStyle = '#16161a';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      for (const [x, y] of [[preview.x0, preview.y0], [preview.x1, preview.y1]]) {
        ctx.beginPath();
        ctx.arc(sx(x), sy(y), 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    if (preview?.kind === 'shape') drawShapePreview(ctx, view, preview, shapeStyle);
  }, [doc, size, view, active, tool, preview, brush.size, shapeStyle, editingText, rv, live, objPick, editLayers, shiftDown, lineartMode, selectedCurve, picked.join(), guideLines, selectMode, selVersion, selDraft, editMarquee, rulers, guidesShown, guidesLocked, guidePreview, paintFrame, objectEditing, curveHandles, targetSig, dismissed, handleMode, pivot, hoverHandle, shapeEditing, gradientSpec.shape, gradientSpec.mode, gradientSpec.color, gradientSpec.color2, gradientSpec.reverse, gradientSpec.opacity]);
}
