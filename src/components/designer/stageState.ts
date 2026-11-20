import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { useBoardFocus } from '../studio/useBoardFocus';
import { sameGuides, type GuideLines } from './guideLines';
import type { DesignDoc, Layer, Stroke } from '../../engine/types';
import { layerBox } from '../../engine/design/render';
import { activeLayer, unionBox } from '../../engine/design/doc';
import { stageWheel } from './wheelZoom';
import { fitView, useKeepCenter } from './fitView';
import { layerSelection, pickedLayers, useLayerSelection } from '../../engine/design/selection';
import { ensureBuffers, rasterVersion, subscribeRaster } from '../../engine/design/raster';
import { dragGroups, moveGroups, pickedTargets } from './stageObjMove';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { setDoc, useStore } from '../../store/store';
import { secondaryOf } from '../../engine/design/colorPair';
import type { SampleLoupeHandle } from './SampleLoupe';
import type { GuideAxis } from '../../engine/design/guides';
import { transformLayer } from '../../engine/design/affine';
import type { Mat } from '../../engine/design/matrix';
import { GRADIENT_DEFAULT, type GradientSpec } from '../../engine/design/gradient';
import { objectPicks, useObjectSelection, useShapeEdit } from '../../engine/design/objectSelection';
import { layerObjects, objectsBox } from '../../engine/design/objectOps';
import { useSelectionVersion } from '../../engine/design/pixelSelection';
import { useSelectSession } from './StageSelect';
import { useModifierKeys } from './useModifierKeys';
import { screenToDocument, zoomAt, type View } from '../../engine/design/viewCoordinates';
import { useCursorPreview } from '../../engine/design/useCursorPreview';
import { usePanRequest } from './usePanRequest';
import type { Drag } from './tools/types';

export type StageProps = { sessionId: string; doc: DesignDoc; selectedCurve: CurveSelection; setSelectedCurve: (value: CurveSelection) => void; board?: { scope: RefObject<HTMLElement | null>; bottom: number } };

export function useStageState({ sessionId, doc, selectedCurve, setSelectedCurve, board }: StageProps, tool: DesignTool, objectEditing: boolean) {
  const insideRef = useBoardFocus(board?.scope);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const wheel = useRef(stageWheel(setView)).current;
  wheel.sync(view);
  const ctrlAtDown = useRef(false);
  usePanRequest(setView);
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));

  // Snap guides while moving (screen overlay only).
  const [guideLines, setGuideLines] = useState<GuideLines>({});
  const showGuides = (g: GuideLines) => setGuideLines((cur) => sameGuides(cur, g) ? cur : g);
  const [editingText, setEditingText] = useState<string | null>(null);
  // Bumped on every brush move: the stroke is painted into the layer's buffer, and this redraws it live.
  const [paintFrame, setPaintFrame] = useState(0);
  const paintRaf = useRef<number | null>(null);
  const liveRaf = useRef<number | null>(null);
  const flushPaintFrame = () => {
    if (paintRaf.current != null) cancelAnimationFrame(paintRaf.current);
    paintRaf.current = null;
    setPaintFrame((f) => f + 1);
  };
  const [preview, setPreview] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  // Picked strokes of one raster layer (Ctrl-click adds more of the same layer in Objects mode).
  // Objects picked inside a layer (Edit, Objects mode), shared with the bar's Align and Transform.
  const objPick = useObjectSelection((st) => st.byDoc[doc.id]);
  // Shape edit mode (ShapeKnots): the shape's own knots instead of the transform handles.
  const shapeEditing = !!useShapeEdit((st) => st.byDoc[doc.id]);
  const selectMode = useStore((s) => s.ui.selectMode ?? 'objects');
  /** Edit acts on whole layers (Layer mode) instead of the objects inside them. */
  const editLayers = selectMode === 'layers';
  // Transform handles (Inkscape): scale by default; clicking the selection again toggles rotate/skew.
  const [handleMode, setHandleMode] = useState<'scale' | 'rotate'>('scale');
  const [pivot, setPivot] = useState<{ x: number; y: number } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<Handle | null>(null);
  const xformRaf = useRef<number | null>(null);
  const xformAt = useRef<{ d: Extract<Drag, { kind: 'xform' }>; m: Mat } | null>(null);
  const { shift: shiftDown, held: modsHeld } = useModifierKeys(insideRef);
  const drag = useRef<Drag | null>(null);
  const brush = useStore((s) => s.ui.brush);
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  // The stroke being drawn stays here until pointer up: one change and undo step per gesture.
  const [live, setLive] = useState<Stroke | null>(null);
  const shapeStyle = useStore((s) => s.ui.shape);
  const textStyle = useStore((s) => s.ui.text);
  const rv = useSyncExternalStore(subscribeRaster, rasterVersion);
  const selVersion = useSelectionVersion();
  const rulers = useStore((s) => s.ui.rulers ?? false) && !board;
  const guidesShown = useStore((s) => s.ui.showGuides ?? true) && !board, guidesLocked = useStore((s) => !!s.ui.lockGuides);
  // A guide being dragged (from a ruler or an existing guide), shown until pointer up.
  // Edit tool over a guide: the cursor says it can be dragged.
  const [guideHover, setGuideHover] = useState<GuideAxis | null>(null);
  const [guidePreview, setGuidePreview] = useState<{ axis: GuideAxis; at: number; index?: number } | null>(null);
  const selectShape = useStore((s) => s.ui.selectShape ?? 'rect');
  const gradientUi = useStore((s) => s.ui.gradient) ?? GRADIENT_DEFAULT;
  const gradientSpec: GradientSpec = { ...gradientUi, color: brush.color, color2: secondaryOf(brush, gradientUi) };
  // The selection being drawn (page coordinates), shown until pointer up.
  const [selDraft, setSelDraft] = useState<Array<[number, number]> | null>(null);
  const loupe = useRef<SampleLoupeHandle>(null);
  useSelectSession(doc.id, tool, selectShape, setSelDraft, doc.activeLayerId, drag, view.zoom);
  const [editMarquee, setEditMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const fitted = useRef<string | null>(null);

  const active = activeLayer(doc);
  const cursor = useCursorPreview(view, canvasRef, { tool, brushSize: brush.size, lineartSize: lineart.size, lineartMode, influence, active, curveSelected: Boolean(selectedCurve) }, drag.current?.kind === 'bend' ? drag.current : null);

  /** What the transform handles act on: the picked objects (Objects mode; an image or text is its own object) or
      picked layers (Layer mode). Locked, hidden and FX (no geometry) layers are out. */
  const xformTargets = (d0: DesignDoc): Array<{ layer: Layer; ids: string[] | null }> => {
    const ok = (l: Layer | undefined | null): l is Layer => Boolean(l?.visible && !l.locked && l.type !== 'fx');
    if (!editLayers) {
      const objs = pickedTargets(d0, objectPicks(d0.id), ok);
      if (objs.length) return objs;
      // Several layers picked (Ctrl/Shift-click), no objects: transform them all.
      const picked = layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id));
      if (picked.length > 1) return picked.map((id) => d0.layers.find((l) => l.id === id)).filter(ok).map((l) => ({ layer: l, ids: null }));
      const a = activeLayer(d0);
      return ok(a) && a.type !== 'vector' && !layerObjects(a).length ? [{ layer: a, ids: null }] : [];
    }
    return layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id)).map((id) => d0.layers.find((l) => l.id === id)).filter(ok).map((l) => ({ layer: l, ids: null }));
  };
  const targetsBox = (ts: Array<{ layer: Layer; ids: string[] | null }>) => unionBox(ts.map((t) => (t.ids ? objectsBox(t.layer, t.ids) : layerBox(t.layer))).filter((b): b is NonNullable<typeof b> => Boolean(b)));
  // Empty click: nothing shown selected; the layer stays active.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const nothingPicked = !objPick?.length && !pickedLayers(doc.id, doc.layers.map((l) => l.id)).length;
  const dismissed = nothingPicked && dismissedFor != null && dismissedFor === doc.activeLayerId;
  const targets = objectEditing && !editingText && !dismissed ? xformTargets(doc) : [];
  const tBox = targets.length ? targetsBox(targets) : null;
  const targetSig = targets.map((t) => `${t.layer.id}:${t.ids?.join(',') ?? '*'}`).join('|');
  // A new selection starts with the scale handles and its own center.
  useEffect(() => { setHandleMode('scale'); setPivot(null); }, [targetSig, shapeEditing]);
  const pivotAt = tBox ? pivot ?? { x: tBox.x + tBox.w / 2, y: tBox.y + tBox.h / 2 } : null;
  const handles = tBox && pivotAt && !shapeEditing ? boxHandles(tBox, handleMode, pivotAt) : [];

  // Load pixels of raster layers after a reload.
  useEffect(() => {
    void ensureBuffers(doc.layers);
  }, [doc.layers]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Synchronous refit and redraw: a folded or pinned panel never paints a stretched frame.
    const ro = new ResizeObserver(() => flushSync(() => setSize({ w: el.clientWidth, h: el.clientHeight })));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => setView((untouched.current = fitView(size, doc, board))), [size, doc.width, doc.height, board?.bottom]); // eslint-disable-line react-hooks/exhaustive-deps

  const untouched = useRef<View | null>(null);
  useKeepCenter(size, setView);
  useLayoutEffect(() => {
    const key = `${doc.id}:${doc.width}x${doc.height}`;
    if (size.w && (fitted.current !== key || view === untouched.current)) {
      fitted.current = key;
      fit();
    }
  }, [doc.id, doc.width, doc.height, size.w, size.h, fit]);

  // Expose view controls to the toolbar.
  useEffect(() => {
    const onFit = () => fit();
    const onZoom = (e: Event) => {
      const factor = (e as CustomEvent<number>).detail;
      setView((v) => zoomAt(v, size.w / 2, size.h / 2, factor));
    };
    window.addEventListener('ogs:designer-fit', onFit);
    window.addEventListener('ogs:designer-zoom', onZoom);
    return () => {
      window.removeEventListener('ogs:designer-fit', onFit);
      window.removeEventListener('ogs:designer-zoom', onZoom);
    };
  }, [fit, size]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('ogs:designer-view', { detail: view.zoom }));
  }, [view.zoom]);

  const toDoc = useCallback((clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return screenToDocument({ x: clientX, y: clientY }, view, r);
  }, [view]);

  const blocked = toolBlockReason(tool, active);

  const rasterMoveAt = useRef<{ d: Extract<Drag, { kind: 'objMove' }>; x: number; y: number } | null>(null);
  const rasterMoveFrame = useRef<number | null>(null);
  const applyRasterMove = () => {
    if (rasterMoveFrame.current != null) cancelAnimationFrame(rasterMoveFrame.current);
    rasterMoveFrame.current = null;
    const at = rasterMoveAt.current;
    rasterMoveAt.current = null;
    if (!at) return;
    const { d } = at;
    const moved = moveGroups(dragGroups(d), at.x - d.startX, at.y - d.startY);
    if (!moved) return;
    setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => moved.get(l.id) ?? l) }));
  };

  /** Lay the latest handle transform onto the layers as they were when the drag began (once a frame). */
  const applyXform = (persist: boolean) => {
    if (xformRaf.current != null) cancelAnimationFrame(xformRaf.current);
    xformRaf.current = null;
    const at = xformAt.current;
    if (!at) return;
    if (persist) xformAt.current = null;
    const { d, m } = at;
    if (d.op === 'pivot') return;
    const next = new Map(d.bases.map((b) => [b.layer.id, transformLayer(b.layer, b.ids, m, b.buffers, persist)] as const));
    setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => { const n = next.get(l.id); return n ? (n.type === 'raster' ? { ...n, rev: n.rev + 1 } : n) : l; }) }));
  };

  return {
    sessionId, doc, selectedCurve, setSelectedCurve, insideRef, wrapRef, canvasRef, size, view, setView,
    wheel, ctrlAtDown, picked, guideLines, showGuides, editingText, setEditingText, paintFrame, paintRaf,
    liveRaf, flushPaintFrame, preview, setPreview, spaceDown, setSpaceDown, objPick, shapeEditing,
    selectMode, editLayers, handleMode, setHandleMode, setPivot, hoverHandle, setHoverHandle, xformRaf,
    xformAt, shiftDown, modsHeld, drag, tool, brush, lineart, lineartMode, influence, live, setLive,
    shapeStyle, textStyle, rv, selVersion, rulers, guidesShown, guidesLocked, guideHover, setGuideHover,
    guidePreview, setGuidePreview, selectShape, gradientSpec, selDraft, setSelDraft, loupe, editMarquee,
    setEditMarquee, active, cursor, xformTargets, setDismissedFor, dismissed, tBox, targetSig, pivot,
    pivotAt, handles, toDoc, blocked, rasterMoveAt, rasterMoveFrame, applyRasterMove, applyXform,
  };
}

export type StageState = ReturnType<typeof useStageState>;

export const HANDLE = 8;
export type XformOp = 'scale' | 'rotate' | 'skew' | 'pivot';
/** A transform handle on the selection box: where it sits, what it does, and (for scale) which axes it moves. */

export interface Handle { op: XformOp; x: number; y: number; fx: number; fy: number }
/** Inkscape's two sets: scale (corners and sides), or rotate (corners), skew (sides) and the rotation center. */
function boxHandles(b: { x: number; y: number; w: number; h: number }, mode: 'scale' | 'rotate', pivot: { x: number; y: number }): Handle[] {
  const xs = [b.x, b.x + b.w / 2, b.x + b.w], ys = [b.y, b.y + b.h / 2, b.y + b.h];
  const out: Handle[] = [];
  for (const iy of [0, 1, 2]) for (const ix of [0, 1, 2]) {
    if (ix === 1 && iy === 1) continue;
    const corner = ix !== 1 && iy !== 1;
    out.push({ op: mode === 'scale' ? 'scale' : corner ? 'rotate' : 'skew', x: xs[ix], y: ys[iy], fx: ix - 1, fy: iy - 1 });
  }
  if (mode === 'rotate') out.push({ op: 'pivot', x: pivot.x, y: pivot.y, fx: 0, fy: 0 });
  return out;
}
export type CurveSelection = { layerId: string; strokeId: string; handles: number[] } | null;
