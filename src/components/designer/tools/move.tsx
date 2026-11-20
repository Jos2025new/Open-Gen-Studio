import { clickPick, expandPicks } from '../../../engine/design/objectGroupTree';
import type { DesignDoc, Layer, VectorLayer } from '../../../engine/types';
import { nearStroke, strokeHandles } from '../../../engine/design/strokes';
import { layerBox, hitTest, hitTestPixel, startDragPreview } from '../../../engine/design/render';
import { scaleLayer, translateLayer, unionBox } from '../../../engine/design/doc';
import { SNAP_PX, snapOptsFor } from '../../../engine/design/snap';
import { snapSessionOf } from '../../../engine/design/snapSession';
import { moveMode, neighbourGaps } from '../../../engine/design/neighbourGaps';
import { layerSelection, pickedLayers, pickLayer, setLayerPicks, otherPickedLayers } from '../../../engine/design/selection';
import { beginEditMarquee, finishEditMarquee, updateEditMarquee } from '../StageEditMarquee';
import { sameHandle } from '../stageSprites';
import { editableShapeAt } from '../../../engine/design/shapeLook';
import { commitEdit, getRasterSurface } from '../../../engine/design/raster';
import { commitPaintedMove, dragGroups, otherGroups, snapBox, topObjectLayer } from '../stageObjMove';
import { record } from '../../../engine/design/history';
import { getDoc, rebasePaintLayer, setActiveLayer } from '../../../engine/design/actions';
import { setDoc, toast, useStore, setUi } from '../../../store/store';
import { gestureBuffers } from '../../../engine/design/affine';
import { editShape, isPicked, objectPicks, pickedIn, pickObject, setObjectPick, setObjectPicks } from '../../../engine/design/objectSelection';
import { layerObjects, objectAt } from '../../../engine/design/objectOps';
import { pickBelow } from '../../../engine/design/objectBelow';
import { getSelection } from '../../../engine/design/pixelSelection';
import { keepAxis, lockedAxis, lockedPoint } from '../../../engine/design/axisLock';
import { xformMatrix } from '../../../engine/design/xformMatrix';
import { startPixelMove } from '../../../engine/design/pixelMove';
import type { View } from '../../../engine/design/viewCoordinates';
import { clickCandidate, pixelTarget } from '../../../engine/design/autoSelect';
import { pixelsNotReady } from '../StagePaintCommit';
import { StrokeStyleFields } from '../StrokeStyleFields';
import { InlineSlider } from '../InlineControls';
import { SnapControl } from '../SnapControl';
import { HANDLE, type StageState } from '../stageState';
import type { Drag, GestureMap, PointerHover, PointerPress, ToolDescriptor, ToolSettingsProps } from './types';
import { AutoSelectToggle, EditModeToggle, EditOps, curveStyle } from '../ToolSettingsFields';

function beginMove({ state, current, act, p, e }: PointerPress) {
  const { sessionId, doc, drag, view, handles, tBox, pivotAt, xformTargets, selectedCurve, influence, editLayers, setSelectedCurve, setEditMarquee, setDismissedFor, dismissed } = state;
  const move = startPixelMove(sessionId, current, p, 3 / view.zoom);
  if (move) { if (move !== true) drag.current = { kind: 'pixelMove', move, start: p }; return; }
  const tol = (HANDLE + 4) / view.zoom;
  const hHit = [...handles].reverse().find((h) => Math.abs(p.x - h.x) <= tol && Math.abs(p.y - h.y) <= tol);
  if (hHit && tBox && pivotAt) {
    const ts = xformTargets(current);
    drag.current = { kind: 'xform', pre: current, op: hHit.op, h: hHit, startX: p.x, startY: p.y, cx: pivotAt.x, cy: pivotAt.y, box: tBox, bases: ts.map((t) => ({ ...t, buffers: gestureBuffers(t.layer) })) };
    return;
  }
  // Point editing of a picked Lineart curve comes first, in either mode.
  if (act?.type === 'vector' && act.visible && !act.locked && selectedCurve?.layerId === act.id) {
    const index = act.strokes?.findIndex((s) => s.id === selectedCurve.strokeId) ?? -1;
    const stroke = act.strokes?.[index];
    const point = stroke ? selectedCurve.handles.find((i) => stroke.points[i] && Math.hypot(stroke.points[i][0] - p.x, stroke.points[i][1] - p.y) <= 8 / view.zoom) : undefined;
    if (point !== undefined) {
      drag.current = { kind: 'bend', layerId: act.id, stroke: index, point, startX: p.x, startY: p.y, base: act.strokes!, influence };
      return;
    }
  }
  setSelectedCurve(null);
  setDismissedFor(null);

  const marquee = beginEditMarquee({ doc: current, point: p, layersMode: editLayers, shift: e.shiftKey, alt: e.altKey, autoSelect: useStore.getState().ui.autoSelect ?? false });
  if (marquee) {
    drag.current = marquee;
    setEditMarquee({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    return;
  }

  if (!editLayers && (e.ctrlKey || e.metaKey) && e.altKey) return void pickBelow(sessionId, current, p.x, p.y);
  // Objects mode: modifiers pick parts, or whole layers across layers.
  if (!editLayers) {
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    const owner = (l: Layer | null | undefined) => (l && l.visible && !l.locked ? l : null);
    const top = clickCandidate(useStore.getState().ui.autoSelect ?? false, hitTestPixel(current, p.x, p.y), act ?? undefined, (l) => !!objectAt(l, p.x, p.y));
    let layer: Layer | null = null;
    const picks = objectPicks(doc.id);
    const pickedLayerIds = pickedLayers(doc.id, current.layers.map((l) => l.id));
    if (additive) {
      if (pickedLayerIds.length < 2) layer = topObjectLayer(current, p.x, p.y);
    } else if (owner(top) && objectAt(top!, p.x, p.y)) layer = top;
    const id = layer ? objectAt(layer, p.x, p.y) : null;
    if (layer && id) {
      if (layer.type === 'raster' && id !== layer.id && layer.paintBaseId && !getRasterSurface(layer.paintBaseId)) return void toast(pixelsNotReady([layer.paintBaseId]), 'error');
      if (additive) {
        const had = isPicked(picks, layer.id, id);
        if (!had) pickObject(doc.id, layer.id, id, true);
        setLayerPicks(doc.id, []);
        if (layer.type === 'vector' && !had) { const cur = objectPicks(doc.id); setObjectPicks(doc.id, cur.map((pk) => (pk.layerId === layer!.id ? { ...pk, ids: expandPicks(layer as VectorLayer, pk.ids) } : pk))); }
        const now = objectPicks(doc.id);
        drag.current = { kind: 'objMove', layerId: layer.id, ids: pickedIn(now, layer.id), startX: p.x, startY: p.y, base: layer, others: otherGroups(current, now, layer.id), ctrlToggle: had ? id : undefined, pre: current };
        return;
      }
      setActiveLayer(sessionId, doc.id, layer.id);
      const grp = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
      if (grp.length > 1 && grp.includes(layer.id)) return void (drag.current = { kind: 'move', layerId: layer.id, startX: p.x, startY: p.y, base: layer, others: otherPickedLayers(current, layer.id), pre: current });
      setLayerPicks(doc.id, []);
      // Dragging one of several picked objects moves them all; another object starts a new pick.
      const again = isPicked(picks, layer.id, id);
      const ids = again ? pickedIn(picks, layer.id) : layer.type === 'vector' ? clickPick(layer, id) : [id];
      if (!again) setObjectPick(doc.id, { layerId: layer.id, ids });
      drag.current = { kind: 'objMove', layerId: layer.id, ids, startX: p.x, startY: p.y, base: layer, others: again ? otherGroups(current, picks, layer.id) : undefined, again, pre: current };
      return;
    }
    if (additive) {
      const hit = hitTestPixel(current, p.x, p.y);
      if (hit && hit.visible && !hit.locked) {
        const cur = objectPicks(doc.id);
        const ids = cur.length ? cur.map((p) => p.layerId) : layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
        if (cur.length) setObjectPick(doc.id, null);
        const had = ids.length > 1 && ids.includes(hit.id);
        if (!had) pickLayer(doc.id, hit.id, true, ids);
        setActiveLayer(sessionId, doc.id, had ? ids.find((id) => id !== hit.id) ?? current.activeLayerId : hit.id);
        const next = getDoc(sessionId, doc.id) ?? current;
        drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: otherPickedLayers(next, hit.id), ctrlToggle: had ? hit.id : undefined, pre: current };
      }
      return;
    }
    // A layer with no parts (image, text, a painted layer without strokes): its content is the object.
    const auto = useStore.getState().ui.autoSelect ?? false;
    const whole = auto ? hitTestPixel(current, p.x, p.y) : pixelTarget(current, p.x, p.y, false);
    if (!whole && !auto && hitTestPixel(current, p.x, p.y)) return;
    setObjectPick(doc.id, null);
    // Plain click on empty canvas clears both stores; a hit replaces a different layer group.
    if (!whole) {
      setLayerPicks(doc.id, []);
      setDismissedFor(current.activeLayerId);
      return;
    }
    const pickedNow = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
    if (!pickedNow.includes(whole.id)) pickLayer(doc.id, whole.id, false, pickedNow);
    if (whole && !layerObjects(whole).length && whole.type !== 'vector') {
      const again = current.activeLayerId === whole.id && !dismissed;
      setActiveLayer(sessionId, doc.id, whole.id);
      if (!whole.locked) {
        // One of several picked layers: they all move together (as in Inkscape).
        drag.current = { kind: 'move', layerId: whole.id, startX: p.x, startY: p.y, base: whole, others: otherPickedLayers(current, whole.id), again, pre: current };
      }
    }
    return;
  }

  // Layer mode: Ctrl/Cmd-click adds the layer under the pointer to the selection (or takes it out).
  setObjectPick(doc.id, null);
  if (e.ctrlKey || e.metaKey || e.shiftKey) {
    // Ctrl- or Shift-press adds the layer; a drag moves all picked; a click on a picked one removes it.
    const hit = hitTestPixel(current, p.x, p.y);
    if (hit) {
      const ids = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
      const had = ids.length > 1 && ids.includes(hit.id);
      if (!had) pickLayer(doc.id, hit.id, true, ids);
      setActiveLayer(sessionId, doc.id, hit.id);
      if (!hit.locked) drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: otherPickedLayers(getDoc(sessionId, doc.id) ?? current, hit.id), ctrlToggle: had ? hit.id : undefined, pre: current };
    }
    return;
  }
  const onTop = hitTestPixel(current, p.x, p.y);
  const picks = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
  // Another layer drawn on top at this point, not picked: the click is for it, not the active layer's box.
  const otherOnTop = Boolean(onTop && onTop.id !== act?.id && !picks.includes(onTop.id));
  if (act && !act.locked && act.visible && !otherOnTop) {
    const b = layerBox(act);
    if (b) {
      const tol = HANDLE / view.zoom;
      const hit = corners(b).findIndex(([hx, hy]) => Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol);
      if (hit >= 0) {
        const [ax, ay] = corners(b)[(hit + 2) % 4];
        drag.current = { kind: 'scale', layerId: act.id, ax, ay, startDist: Math.hypot(p.x - ax, p.y - ay) || 1, base: act, startX: p.x, startY: p.y, pre: current };
        return;
      }
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
        drag.current = { kind: 'move', layerId: act.id, startX: p.x, startY: p.y, base: act, others: otherPickedLayers(current, act.id), again: !dismissed, pre: current };
        return;
      }
    }
  }
  const hit = hitTest(current, p.x, p.y);
  const sel = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
  // A click outside the selection starts a new one; inside, the group moves.
  if (!hit || !sel.includes(hit.id)) pickLayer(doc.id, hit?.id ?? '', false, sel);
  setActiveLayer(sessionId, doc.id, hit?.id ?? null);
  if (hit && !hit.locked) {
    drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: otherPickedLayers(current, hit.id), pre: current, again: sel.includes(hit.id) && !dismissed };
  }
  return;
}

function hoverMove({ state: { view, handles, hoverHandle, setHoverHandle }, p }: PointerHover) {
  // The cursor says what a handle does before it is pressed.
  const tol = (HANDLE + 4) / view.zoom;
  const h = [...handles].reverse().find((k) => Math.abs(p.x - k.x) <= tol && Math.abs(p.y - k.y) <= tol);
  if (!sameHandle(h, hoverHandle)) setHoverHandle(h ?? null);
}

function editOnDoubleClick(state: StageState, e: React.MouseEvent) {
  const { doc, sessionId, view, toDoc, setSelectedCurve, editLayers, setEditingText } = state;
  const p = toDoc(e.clientX, e.clientY);
  for (const layer of [...doc.layers].reverse()) {
    if (layer.type !== 'vector' || !layer.visible || layer.locked || layer.opacity === 0) continue;
    const stroke = [...(layer.strokes ?? [])].reverse().find((s) => s.opacity > 0 && nearStroke(s, p.x, p.y, 8 / view.zoom));
    if (!stroke) continue;
    setActiveLayer(sessionId, doc.id, layer.id);
    setSelectedCurve({ layerId: layer.id, strokeId: stroke.id, handles: strokeHandles(stroke) });
    // Editing a curve's points also picks it, so Properties styles just that stroke.
    setObjectPick(doc.id, { layerId: layer.id, ids: [stroke.id] });
    return;
  }
  const hit = hitTest(doc, p.x, p.y);
  // A rectangle or ellipse: its edit mode (docs/plan-edicion-formas.md); Edit → Layer moves whole layers only.
  const sh = hit?.type === 'vector' && !hit.locked && !editLayers ? editableShapeAt(hit, p.x, p.y) : null;
  if (sh) { setActiveLayer(sessionId, doc.id, hit!.id); const ids = pickedIn(objectPicks(doc.id), hit!.id); if (sh.groupId && (ids.length !== 1 || ids[0] !== sh.id)) setObjectPick(doc.id, { layerId: hit!.id, ids: [sh.id] }); else editShape(doc.id, hit!.id, sh.id); return; }
  if (hit?.type === 'text' && !hit.locked) {
    setActiveLayer(sessionId, doc.id, hit.id);
    setEditingText(hit.id);
  }
}

/** A move starts past three screen pixels. Record the undo step when that threshold is crossed. */
function started(d: { moved?: boolean; pre?: DesignDoc; startX: number; startY: number }, p: { x: number; y: number }, view: View) {
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * view.zoom > 3) { d.moved = true; if (d.pre) record(d.pre); }
    return d.moved;
}

function toggleHandles({ setHandleMode }: StageState, d: Extract<Drag, { kind: 'move' | 'objMove' }>) {
  if (d.again && !d.moved) setHandleMode((mode) => mode === 'scale' ? 'rotate' : 'scale');
}

const gestures = {
  pixelMove: {
    skipReleaseGuides: true,
    move({ d, p, e }) {
      d.move.update(lockedPoint(p, d.start, e));
    },
    up({ state, d, e }) {
      const { toDoc } = state;
      if (e) d.move.update(lockedPoint(toDoc(e.clientX, e.clientY), d.start, e));
    },
  },
  editMarquee: {
    skipReleaseGuides: true,
    move({ state, d, p }) {
      const { setEditMarquee } = state;
      setEditMarquee(updateEditMarquee(d, p));
    },
    up({ state, d, e }) {
      const { setEditMarquee, sessionId, doc, view, toDoc, setDismissedFor } = state;
      setEditMarquee(null);
      finishEditMarquee({ drag: d, sessionId, doc, zoom: view.zoom, release: e ? toDoc(e.clientX, e.clientY) : undefined, cancelled: e?.type === 'pointercancel' });
      const after = getDoc(sessionId, doc.id) ?? doc;
      if (!objectPicks(doc.id).length && !pickedLayers(doc.id, after.layers.map((l) => l.id)).length) setDismissedFor(after.activeLayerId);
    },
  },
  xform: {
    move({ state, d, p, e }) {
      const { setPivot, doc, view, size, showGuides, xformAt, xformRaf, applyXform } = state;
      if (d.op === 'pivot') {
        setPivot({ x: p.x, y: p.y });
        return;
      }
      if (!started(d, p, view)) return;
      // Scale handles snap too: the dragged side or corner meets page edges, guides and other layers (Alt: free).
      let q = p;
      const snap = snapOptsFor(doc, useStore.getState().ui.snapByMode);
      if (d.op === 'scale' && snap.on && !e.altKey) {
        const ids = new Set(d.bases.map((b) => b.layer.id));
        const t = snapSessionOf(d, doc, ids, '', snap, view, size).targets();
        const tol = SNAP_PX / view.zoom;
        const near = (v: number, lines: number[]) => lines.reduce<number | undefined>((best, l) => (Math.abs(l - v) <= tol && (best === undefined || Math.abs(l - v) < Math.abs(best - v)) ? l : best), undefined);
        const gx = d.h.fx ? near(p.x, t.xs) : undefined, gy = d.h.fy ? near(p.y, t.ys) : undefined;
        q = { x: gx ?? p.x, y: gy ?? p.y };
        showGuides({ x: gx, y: gy });
      }
      xformAt.current = { d, m: xformMatrix(d, q, { shift: e.shiftKey || e.ctrlKey || e.metaKey, alt: e.altKey }) };
      xformRaf.current ??= requestAnimationFrame(() => applyXform(false));
    },
    up({ state: { applyXform }, d }) {
      if (d.op === 'pivot' || !d.moved) return;
      applyXform(true);
      for (const b of d.bases) if (b.layer.type === 'raster') commitEdit(b.layer.id);
    },
  },
  objMove: {
    move({ state, d, p, e }) {
      const { doc, view, size, showGuides, rasterMoveAt, rasterMoveFrame, applyRasterMove } = state;
      if (!started(d, p, view)) return;
      // Pointer events can come faster than frames: keep the latest position and compose the layer at most once a
      // frame (each compose copies the whole layer). Pointer up applies the latest one before closing the step.
      // Picked objects snap like whole layers do (page, guides, other layers; Alt: free).
      const ax = lockedAxis(p.x - d.startX, p.y - d.startY, e);
      let { x: ox, y: oy } = lockedPoint(p, { x: d.startX, y: d.startY }, e);
      const snap = snapOptsFor(doc, useStore.getState().ui.snapByMode);
      // Raster strokes are painted, never snapped (Drawing); the switch applies to vector objects and layers.
      const groups = dragGroups(d), b0 = snap.on && !e.altKey ? snapBox(groups) : null;
      if (b0) {
        const box = { ...b0, x: b0.x + p.x - d.startX, y: b0.y + p.y - d.startY };
        const s = snapSessionOf(d, doc, new Set(groups.map((g) => g.layerId)), d.layerId, snap, view, size).step(box, p, { x: e.clientX, y: e.clientY }, e.timeStamp);
        ox += s.dx; oy += s.dy;
        const k = keepAxis({ dx: ox - d.startX, dy: oy - d.startY }, ax);
        ox = d.startX + k.dx; oy = d.startY + k.dy;
        showGuides({ x: s.viewGuides?.x, y: s.viewGuides?.y, m: s.measures, a: s.alignments });
      } else {
        snapSessionOf(d, doc, new Set(groups.map((g) => g.layerId)), d.layerId, snap, view, size).clear();
        showGuides({});
      }
      rasterMoveAt.current = { d, x: ox, y: oy };
      rasterMoveFrame.current ??= requestAnimationFrame(applyRasterMove);
    },
    up({ state, d }) {
      const { sessionId, doc, applyRasterMove } = state;
      toggleHandles(state, d);
      // A Ctrl-click (no drag) on something already picked takes it out of the pick.
      if (d.ctrlToggle && !d.moved) {
        // Ctrl-click (no drag) on a picked group takes the whole group out; other objects toggle alone.
        const l = (getDoc(sessionId, doc.id) ?? doc).layers.find((x) => x.id === d.layerId);
        if (l?.type === 'vector') { const out = clickPick(l, d.ctrlToggle); setObjectPicks(doc.id, objectPicks(doc.id).map((pk) => (pk.layerId === l.id ? { ...pk, ids: pk.ids.filter((x) => !out.includes(x)) } : pk))); }
        else pickObject(doc.id, d.layerId, d.ctrlToggle, true);
      }
      applyRasterMove();
      // A click without moving changes nothing.
      if (d.moved) commitPaintedMove(sessionId, doc.id, dragGroups(d));
    },
  },
  move: {
    move({ state, d, p, e }) {
      const { sessionId, doc, view, size, ctrlAtDown, showGuides } = state;
      if (!started(d, p, view)) return;
      // The dragged layer and the other picked ones move together; the group's box snaps (Alt held: free move).
      const group = [d.base, ...(d.others ?? [])];
      const ax = lockedAxis(p.x - d.startX, p.y - d.startY, e);
      let { dx, dy } = keepAxis({ dx: p.x - d.startX, dy: p.y - d.startY }, ax);
      const snap = snapOptsFor(doc, useStore.getState().ui.snapByMode);
      // Ctrl/Meta pressed in the drag: no snap, still measured (neighbourGaps.ts).
      const mode = moveMode(snap.on, e.altKey, e.ctrlKey || e.metaKey, ctrlAtDown.current);
      const box = mode.measure ? unionBox(group.map((l) => layerBox(translateLayer(l, dx, dy))).filter((b): b is NonNullable<typeof b> => Boolean(b))) : null;
      if (box) {
        const ids = new Set(group.map((l) => l.id));
        const session = snapSessionOf(d, doc, ids, d.layerId, snap, view, size);
        const s = mode.snap ? session.step(box, p, { x: e.clientX, y: e.clientY }, e.timeStamp) : (session.clear(), null);
        dx += s?.dx ?? 0; dy += s?.dy ?? 0;
        ({ dx, dy } = keepAxis({ dx, dy }, ax));
        showGuides({ x: s?.viewGuides?.x, y: s?.viewGuides?.y, m: [...(s?.measures ?? []), ...neighbourGaps(box, doc.layers, ids, s)], a: s?.alignments });
      } else {
        snapSessionOf(d, doc, new Set(group.map((l) => l.id)), d.layerId, snap, view, size).clear();
        showGuides({});
      }
      startDragPreview(doc);
      const moved = new Map(group.map((l) => [l.id, translateLayer(l, dx, dy)]));
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => moved.get(l.id) ?? l) }));
    },
    up({ state, d }) {
      const { sessionId, doc } = state;
        toggleHandles(state, d);
        rebasePaintLayer(sessionId, doc.id, d.layerId);
      for (const o of d.others ?? []) rebasePaintLayer(sessionId, doc.id, o.id);
      if (d.ctrlToggle && !d.moved) { const cur = getDoc(sessionId, doc.id) ?? doc; const ids = pickLayer(doc.id, d.ctrlToggle, true, layerSelection(doc.id, cur.activeLayerId, cur.layers.map((l) => l.id))); setActiveLayer(sessionId, doc.id, ids.at(-1) ?? null); }
    },
  },
  scale: {
    move({ state, d, p }) {
      const { doc, sessionId, view } = state;
      if (!started(d, p, view)) return;
      const k = Math.max(0.02, Math.hypot(p.x - d.ax, p.y - d.ay) / d.startDist);
      const scaled = scaleLayer(d.base, k, k, d.ax, d.ay);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => (l.id === d.layerId ? scaled : l)) }));
    },
    up({ state: { sessionId, doc }, d }) {
      rebasePaintLayer(sessionId, doc.id, d.layerId);
    },
  },
} satisfies Partial<GestureMap>;

function MoveSettings({ sessionId, doc, selectedCurve }: ToolSettingsProps) {
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const { curve, applyCurveStyle } = curveStyle(sessionId, doc, selectedCurve);
  return <div className="tool-settings" role="toolbar" aria-label="Edit settings"><EditModeToggle /><AutoSelectToggle />{getSelection(doc.id) && <span className="tool-setting" title="Drag inside the selection to cut it into a movable layer; vectors stay editable">Move selection · drag inside</span>}<SnapControl /><EditOps sessionId={sessionId} doc={doc} /><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields value={curve} onChange={applyCurveStyle} />}</div>;
}

function corners(b: { x: number; y: number; w: number; h: number }): Array<[number, number]> {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

export const move = {
  down: beginMove,
  hover: hoverMove,
  doubleClick: editOnDoubleClick,
  gestures,
  objectEditing: true,
  curveHandles: 'always',
  cursor: () => 'default',
  quick: ['editMode', 'autoSelect'],
  settings: MoveSettings,
  bareSettings: true,
  selectionContext: true,
  contextTarget: (layer) => layer?.name ?? null,
} satisfies ToolDescriptor;
