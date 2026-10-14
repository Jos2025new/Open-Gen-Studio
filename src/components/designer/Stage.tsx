import { X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DesignDoc, Layer, RasterLayer, Stroke, TextLayer } from '../../engine/types';
import { bendStroke, nearestPoint, newStroke, nearStroke, strokeHandles } from '../../engine/design/strokes';
import { brushPoint } from '../../engine/design/brushControl';
import { fillRegion } from '../../engine/design/fill';
import { drawStroke } from '../../engine/design/brushTextures';
import { drawDoc, layerBox, hitTest, hitTestPixel, endDragPreview, startDragPreview } from '../../engine/design/render';
import { activeLayer, scaleLayer, translateLayer, newVectorLayer, insertLayer, unionBox } from '../../engine/design/doc';
import { SNAP_DEFAULT, SNAP_PX } from '../../engine/design/snap';
import { SnapSession, snapSessionFor, visibleDocRect } from '../../engine/design/snapSession';
import { layerSelection, pickLayer, useLayerSelection, otherPickedLayers } from '../../engine/design/selection';
import { beginLiveStroke } from '../../engine/design/raster';
import { addBrushSegment, brushSegment, newBrushStroke, penPressure } from '../../engine/design/brushStroke';
import { beginRulerStroke, rulerPoint } from '../../engine/design/strokeRuler';
import { StrokeRulerOverlay } from './StrokeRulerOverlay';
import { ShapeKnots, shapeEditHint } from './ShapeKnots';
import { worldPoints } from '../../engine/design/strokes';
import { checkerTile, drawArrowHandle } from './stageSprites';
import { GradientKnots } from './ShapeHandles';
import { cornerRadii, editableShapeAt, traceRoundRect } from '../../engine/design/shapeLook';
import { TextEditor } from './TextEditor';
import {withPaintBase, beginEdit, commitEdit, ensureBuffers, rasterVersion, subscribeRaster, getRasterSurface} from '../../engine/design/raster';
import {composeMoving} from '../../engine/design/rasterCompose';
import { record } from '../../engine/design/history';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { addTextLayer, ensurePaintLayer, getDoc, patchLayer, rebasePaintLayer, placeAsset, setActiveLayer } from '../../engine/design/actions';
import { setDoc, setUi, toast, useStore } from '../../store/store';
import { rememberColor, sampleColor } from '../../engine/design/swatches';
import { clearGuides, placeGuide, removeGuide, rulerStep, type GuideAxis } from '../../engine/design/guides';
import { pathBox, toolPath } from '../../engine/design/shapeTools';
import { PRIM_TOOLS, placedPath, primFromUi, primShape } from '../../engine/design/primitives';
import { boxShape } from '../../engine/design/shapeDraw';
import { gestureBuffers, transformLayer } from '../../engine/design/affine';
import { rotateAbout, scaleAbout, skewAbout, type Mat } from '../../engine/design/matrix';
import { applyGradient, paintGradient, type GradientSpec } from '../../engine/design/gradient';
import { editShape, objectPick, pickObject, setObjectPick, useObjectSelection, useShapeEdit } from '../../engine/design/objectSelection';
import { layerObjects, objectAt, objectsBox, translateObjects } from '../../engine/design/objectOps';
import { combineSelection, getSelection, selectionClipFor, rectPoints, selectionPath, setSelection, useSelectionVersion, wandSelection, type SelectCombine } from '../../engine/design/pixelSelection';
import { startPixelMove, type PixelMove } from '../../engine/design/pixelMove';
import { screenToDocument, zoomAt, type View } from '../../engine/design/viewCoordinates';
import { useCursorPreview } from '../../engine/design/useCursorPreview';
import { BrushCursor } from './BrushCursor';
import { uid } from '../../lib/id';
import { clickCandidate } from '../../engine/design/autoSelect';
import { usePanRequest } from './usePanRequest';
import { commitStagePaintGesture, drawingChoiceFirst, prepareStagePaint, type StagePaintGesture } from './StagePaintCommit';
import { paintsPixelsDirectly } from '../../engine/design/paintMode';


type Drag =
  | { kind: 'pixelMove'; move: PixelMove }
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; layerId: string; startX: number; startY: number; base: Layer; others?: Layer[]; again?: boolean; moved?: boolean; ctrlToggle?: string; pre?: DesignDoc; solo?: string }
  | { kind: 'xform'; pre?: DesignDoc; moved?: boolean; op: XformOp; h: Handle; startX: number; startY: number; cx: number; cy: number; box: { x: number; y: number; w: number; h: number }; bases: Array<{ layer: Layer; ids: string[] | null; buffers: ReturnType<typeof gestureBuffers> }> }
  | { kind: 'scale'; layerId: string; ax: number; ay: number; startDist: number; base: Layer }
  | { kind: 'objMove'; layerId: string; ids: string[]; startX: number; startY: number; base: Layer; again?: boolean; moved?: boolean; ctrlToggle?: string; pre?: DesignDoc; compose?: (moved: RasterLayer) => void }
  | StagePaintGesture
  | { kind: 'guide'; axis: GuideAxis; index?: number; at: number }
  | { kind: 'gradient'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'select'; lasso: boolean; points: Array<[number, number]>; combine: SelectCombine }
  | { kind: 'shape'; tool: ShapeTool; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'stroke'; layerId: string | null; points: Array<[number, number, number]>; pen: boolean }
  | { kind: 'bend'; layerId: string; stroke: number; point: number; startX: number; startY: number; base: Stroke[]; influence?: number; recorded?: boolean };

const HANDLE = 8;
type XformOp = 'scale' | 'rotate' | 'skew' | 'pivot';
/** A transform handle on the selection box: where it sits, what it does, and (for scale) which axes it moves. */

interface Handle { op: XformOp; x: number; y: number; fx: number; fy: number }
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
const RULER = 18;
const GRADIENT_DEFAULT = { shape: 'linear' as const, mode: 'two' as const, color2: '#000000', opacity: 1 };
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', sector: 'Sector', arc: 'Arc', chord: 'Chord', line: 'Line', curve: 'Curve', arrow: 'Arrow' } as const;
type ShapeTool = keyof typeof SHAPE_NAMES;
/** Drawn between two points (stroke only), not inside a box. */
const STROKE_ONLY = (t: ShapeTool) => t === 'line' || t === 'curve' || t === 'arrow' || t === 'arc';

type CurveSelection = { layerId: string; strokeId: string; handles: number[] } | null;

/** A ruler along the top or left edge of the stage: page units, ticks that follow the zoom. Drag from it to make a guide. */
function Ruler({ side, view, size, guides, ...handlers }: { side: 'top' | 'left'; view: View; size: { w: number; h: number }; guides?: DesignDoc['guides'] } & Pick<React.HTMLAttributes<HTMLCanvasElement>, 'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onContextMenu'>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const len = side === 'top' ? size.w : size.h;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = side === 'top' ? len : RULER, h = side === 'top' ? RULER : len;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#18181c';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8e8e98';
    ctx.strokeStyle = '#55555e';
    ctx.font = '9px system-ui, sans-serif';
    const step = rulerStep(view.zoom);
    const origin = side === 'top' ? view.x : view.y;
    const first = Math.floor(-origin / view.zoom / step) * step;
    ctx.beginPath();
    for (let v = first; origin + v * view.zoom < len; v += step / 5) {
      const at = Math.round(origin + v * view.zoom) + 0.5;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      const tick = major ? RULER : RULER / 3;
      if (side === 'top') { ctx.moveTo(at, RULER); ctx.lineTo(at, RULER - tick); }
      else { ctx.moveTo(RULER, at); ctx.lineTo(RULER - tick, at); }
      if (major) {
        const label = String(Math.round(v));
        if (side === 'top') ctx.fillText(label, at + 2, 9);
        else { ctx.save(); ctx.translate(9, at + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(label, 0, 0); ctx.restore(); }
      }
    }
    ctx.stroke();
    // Guide marks on the ruler.
    ctx.fillStyle = '#2fb8ff';
    for (const g of (side === 'top' ? guides?.x : guides?.y) ?? []) {
      const at = origin + g * view.zoom;
      if (side === 'top') ctx.fillRect(at - 1, RULER - 5, 3, 5);
      else ctx.fillRect(RULER - 5, at - 1, 5, 3);
    }
  }, [side, len, view, guides]);
  const style: React.CSSProperties = side === 'top'
    ? { position: 'absolute', left: 0, top: 0, width: len, height: RULER, cursor: 'row-resize' }
    : { position: 'absolute', left: 0, top: 0, width: RULER, height: len, cursor: 'col-resize' };
  return <canvas ref={ref} className="stage-ruler" style={style} data-tip={side === 'top' ? 'Drag down for a guide · right-click clears guides' : 'Drag right for a guide · right-click clears guides'} {...handlers} />;
}

/**
 * Inkscape-style arrows for the rotate set: at a corner a curved two-headed arrow bowing out of the box (turn), on a
 * side a straight two-headed arrow along it (slide = skew). Drawn twice: a dark outline, then the accent.
 */
export function Stage({ sessionId, doc, selectedCurve, setSelectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: CurveSelection; setSelectedCurve: (value: CurveSelection) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  usePanRequest(setView);
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));

  // Snap guides while moving (screen overlay only).
  const [guideLines, setGuideLines] = useState<{ x?: number; y?: number }>({});
  const showGuides = (g: { x?: number; y?: number }) => setGuideLines((cur) => (cur.x === g.x && cur.y === g.y ? cur : g));
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
  // Objects picked inside a layer (Edit, Objects mode): shared, so Align and Transform in the bar act on them.
  const objPick = useObjectSelection((st) => st.byDoc[doc.id]);
  // Shape edit mode (ShapeKnots): the shape's own knots instead of the transform handles.
  const shapeEditing = !!useShapeEdit((st) => st.byDoc[doc.id]);
  const selectMode = useStore((s) => s.ui.selectMode ?? 'objects');
  /** Edit acts on whole layers (Layer mode) instead of the objects inside them. */
  const editLayers = selectMode === 'layers';
  // Transform handles (Inkscape): scale by default; clicking the selection again switches to rotate/skew and back.
  const [handleMode, setHandleMode] = useState<'scale' | 'rotate'>('scale');
  const [pivot, setPivot] = useState<{ x: number; y: number } | null>(null);
  const [hoverHandle, setHoverHandle] = useState<string | null>(null);
  const xformRaf = useRef<number | null>(null);
  const xformAt = useRef<{ d: Extract<Drag, { kind: 'xform' }>; m: Mat } | null>(null);
  const [shiftDown, setShiftDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const tool = useStore((s) => s.ui.tool);
  const brush = useStore((s) => s.ui.brush);
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  // The stroke being drawn lives here until pointer up: one document change (and one undo step) per gesture.
  const [live, setLive] = useState<Stroke | null>(null);
  const shapeStyle = useStore((s) => s.ui.shape);
  const textStyle = useStore((s) => s.ui.text);
  const rv = useSyncExternalStore(subscribeRaster, rasterVersion);
  const selVersion = useSelectionVersion();
  const rulers = useStore((s) => s.ui.rulers ?? false);
  // A guide being dragged (from a ruler or an existing guide), shown until pointer up.
  // Edit tool over a guide: the cursor says it can be dragged.
  const [guideHover, setGuideHover] = useState<GuideAxis | null>(null);
  const [guidePreview, setGuidePreview] = useState<{ axis: GuideAxis; at: number; index?: number } | null>(null);
  const selectShape = useStore((s) => s.ui.selectShape ?? 'rect');
  const gradientUi = useStore((s) => s.ui.gradient) ?? GRADIENT_DEFAULT;
  const gradientSpec: GradientSpec = { ...gradientUi, color: brush.color };
  // The selection being drawn (page coordinates), shown until pointer up.
  const [selDraft, setSelDraft] = useState<Array<[number, number]> | null>(null);
  const fitted = useRef<string | null>(null);

  const active = activeLayer(doc);
  const cursor = useCursorPreview(view, canvasRef, { tool, brushSize: brush.size, lineartSize: lineart.size, lineartMode, influence, active, curveSelected: Boolean(selectedCurve) }, drag.current?.kind === 'bend' ? drag.current : null);

  /** What the transform handles act on: the picked objects (Objects mode; an image or text is its own object) or
      picked layers (Layer mode). Locked, hidden and FX (no geometry) layers are out. */
  const xformTargets = (d0: DesignDoc): Array<{ layer: Layer; ids: string[] | null }> => {
    const ok = (l: Layer | undefined | null): l is Layer => Boolean(l?.visible && !l.locked && l.type !== 'fx');
    if (!editLayers) {
      const pk = objectPick(d0.id);
      const pl = pk ? d0.layers.find((l) => l.id === pk.layerId) : null;
      if (ok(pl) && pk!.ids.length) return [{ layer: pl, ids: pk!.ids }];
      // Several layers picked in the panel (Ctrl/Shift-click) and no objects picked: transform them together.
      const picked = layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id));
      if (picked.length > 1) return picked.map((id) => d0.layers.find((l) => l.id === id)).filter(ok).map((l) => ({ layer: l, ids: null }));
      const a = activeLayer(d0);
      return ok(a) && a.type !== 'vector' && !layerObjects(a).length ? [{ layer: a, ids: null }] : [];
    }
    return layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id)).map((id) => d0.layers.find((l) => l.id === id)).filter(ok).map((l) => ({ layer: l, ids: null }));
  };
  const targetsBox = (ts: Array<{ layer: Layer; ids: string[] | null }>) => unionBox(ts.map((t) => (t.ids ? objectsBox(t.layer, t.ids) : layerBox(t.layer))).filter((b): b is NonNullable<typeof b> => Boolean(b)));
  const targets = tool === 'move' && !editingText ? xformTargets(doc) : [];
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
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    // Thin margin, as Photoshop or Krita; the bottom clears the toolbar.
    const pad = size.w < 500 ? 12 : 24;
    const bottom = window.innerWidth < 768 ? 12 : 120; // composer is below the canvas on narrow screens
    const zoom = Math.min((size.w - pad * 2) / doc.width, (size.h - pad - bottom) / doc.height, 4);
    const z = Math.max(0.05, zoom);
    setView({ zoom: z, x: (size.w - doc.width * z) / 2, y: Math.max(pad / 2, (size.h - bottom - doc.height * z) / 2) });
  }, [size, doc.width, doc.height]);

  useEffect(() => {
    const key = `${doc.id}:${doc.width}x${doc.height}:${size.w}x${size.h}`;
    if (fitted.current !== key && size.w > 0) {
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

  // ---------------------------------------------------------------------------
  // Rendering

  useEffect(() => {
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
    // Pixel selection: a dashed two-tone outline (dark under light) that reads on any artwork.
    const sel = selDraft ? { points: selDraft } : getSelection(doc.id);
    // A pixel mask (magic wand, combined selections): its precomputed dashed outline.
    if (!selDraft && sel && 'edge' in sel && sel.edge) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sel.edge, 0, 0);
      ctx.restore();
    }
    if (sel && sel.points.length > 1) {
      ctx.save();
      // Inverted: the page edge is part of the outline too, so it reads as "everything but this".
      if ('inverted' in sel && sel.inverted) {
        ctx.beginPath();
        ctx.rect(0, 0, doc.width, doc.height);
        sel.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      } else selectionPath(ctx, doc, { points: sel.points });
      ctx.lineWidth = 1 / view.zoom;
      ctx.strokeStyle = '#000000';
      ctx.stroke();
      ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.restore();
    }
    // The page edge, lighter than the workspace, so an empty or dark page still reads as a page.
    ctx.strokeStyle = '#55555e';
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeRect(0, 0, doc.width, doc.height);
    if (live) drawStroke(ctx, live);
    ctx.restore();

    // Overlays in screen space.
    const sx = (x: number) => view.x + x * view.zoom;
    const sy = (y: number) => view.y + y * view.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sx(0)) + 0.5, Math.round(sy(0)) + 0.5, Math.round(doc.width * view.zoom), Math.round(doc.height * view.zoom));
    // Ruler guides across the whole view (the one being dragged replaces its saved position).
    if (rulers) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#2fb8ff';
      const line = (axis: GuideAxis, at: number) => {
        ctx.beginPath();
        if (axis === 'x') { const x = Math.round(sx(at)) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, size.h); }
        else { const y = Math.round(sy(at)) + 0.5; ctx.moveTo(0, y); ctx.lineTo(size.w, y); }
        ctx.stroke();
      };
      for (const axis of ['x', 'y'] as const) (doc.guides?.[axis] ?? []).forEach((at, i) => { if (!(guidePreview?.axis === axis && guidePreview.index === i)) line(axis, at); });
      if (guidePreview) { ctx.setLineDash([5, 4]); line(guidePreview.axis, guidePreview.at); }
      ctx.restore();
    }
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
      ctx.strokeStyle = 'rgba(212,242,90,0.75)';
      ctx.setLineDash([5, 4]);
      for (const b of boxes) ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
      const all = unionBox(boxes);
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(212,242,90,0.35)';
      if (all) ctx.strokeRect(sx(all.x) - 3.5, sy(all.y) - 3.5, all.w * view.zoom + 7, all.h * view.zoom + 7);
      ctx.restore();
    }
    if (active && active.visible && !editingText && drag.current?.kind !== 'xform') {
      const objectsMode = tool === 'move' && !editLayers && !shiftDown;
      const objects = objectsMode ? layerObjects(active) : [];
      if (objectsMode && objects.length) {
        // Objects mode: every object of the active layer faintly, the picked ones in the accent; no layer handles.
        const ids = objPick?.layerId === active.id ? objPick.ids : [];
        ctx.save();
        ctx.lineWidth = 1;
        for (const o of objects) {
          const on = ids.includes(o.id);
          ctx.strokeStyle = on ? '#d4f25a' : 'rgba(212,242,90,0.28)';
          ctx.strokeRect(sx(o.box.x) + 0.5, sy(o.box.y) + 0.5, o.box.w * view.zoom, o.box.h * view.zoom);
        }
        const all = ids.length > 1 ? objectsBox(active, ids) : null;
        if (all) {
          ctx.setLineDash([5, 4]);
          ctx.strokeStyle = 'rgba(212,242,90,0.55)';
          ctx.strokeRect(sx(all.x) - 3.5, sy(all.y) - 3.5, all.w * view.zoom + 7, all.h * view.zoom + 7);
        }
        ctx.restore();
      } else {
        const b = layerBox(active);
        if (b) {
          ctx.strokeStyle = '#d4f25a';
          ctx.lineWidth = 1;
          ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
        }
      }
    }
    // Transform handles around what Edit acts on: squares to scale; in rotate mode, round corners to rotate,
    // diamonds on the sides to skew, and the rotation center (drag it to move it).
    const xformLive = drag.current?.kind === 'xform' && drag.current.op !== 'pivot' ? drag.current : null;
    if (tBox && xformLive) {
      // While a handle is held (as in Inkscape): no handles in the way, only a thin dashed box around the shape as
      // it turns, and the center it turns about.
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = 'rgba(236,236,239,0.6)';
      ctx.strokeRect(Math.round(sx(tBox.x)) + 0.5, Math.round(sy(tBox.y)) + 0.5, Math.round(tBox.w * view.zoom), Math.round(tBox.h * view.zoom));
      ctx.setLineDash([]);
      if (xformLive.op !== 'scale') {
        const px = Math.round(sx(xformLive.cx)) + 0.5, py = Math.round(sy(xformLive.cy)) + 0.5;
        ctx.strokeStyle = '#0a0a0b';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py); ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6); ctx.stroke();
        ctx.strokeStyle = '#ececef';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    } else if (tBox && handles.length && !editingText) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(212,242,90,0.7)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx(tBox.x) - 0.5, sy(tBox.y) - 0.5, tBox.w * view.zoom + 1, tBox.h * view.zoom + 1);
      ctx.setLineDash([]);
      for (const h of handles) {
        const hx = sx(h.x), hy = sy(h.y);
        ctx.fillStyle = '#0a0a0b';
        ctx.strokeStyle = '#d4f25a';
        ctx.beginPath();
        if (h.op === 'rotate' || h.op === 'skew') { drawArrowHandle(ctx, h, hx, hy); continue; }
        if (h.op === 'scale') ctx.rect(hx - HANDLE / 2, hy - HANDLE / 2, HANDLE, HANDLE);
        else { ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.moveTo(hx - 9, hy); ctx.lineTo(hx + 9, hy); ctx.moveTo(hx, hy - 9); ctx.lineTo(hx, hy + 9); }
        if (h.op !== 'pivot') ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    if ((tool === 'move' || (tool === 'lineart' && lineartMode === 'edit')) && active?.type === 'vector' && active.visible && !active.locked && selectedCurve?.layerId === active.id) {
      const stroke = active.strokes?.find((s) => s.id === selectedCurve.strokeId);
      if (stroke) {
        ctx.strokeStyle = '#d4f25a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        worldPoints(stroke).forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)));
        ctx.stroke();
        for (const i of selectedCurve.handles) {
          const point = worldPoints(stroke)[i];
          if (!point) continue;
          ctx.beginPath();
          ctx.arc(sx(point[0]), sy(point[1]), 4, 0, Math.PI * 2);
          ctx.fillStyle = i === 0 || i === stroke.points.length - 1 ? '#d4f25a' : '#18181c';
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
    if (preview?.kind === 'shape') {
      const x = Math.min(preview.x0, preview.x1);
      const y = Math.min(preview.y0, preview.y1);
      const w = Math.abs(preview.x1 - preview.x0);
      const h = Math.abs(preview.y1 - preview.y0);
      ctx.save();
      ctx.translate(view.x, view.y);
      ctx.scale(view.zoom, view.zoom);
      ctx.globalAlpha = 0.85;
      const lineLike = STROKE_ONLY(preview.tool);
      const previewFit = PRIM_TOOLS.has(preview.tool) ? primShape(preview.x0, preview.y0, preview.x1, preview.y1, primFromUi(preview.tool, shapeStyle)) : null;
      const path = previewFit ? placedPath(previewFit) : preview.tool === 'curve' || preview.tool === 'arrow'
        ? new Path2D(toolPath(preview.tool, preview.x0, preview.y0, preview.x1, preview.y1, { sides: shapeStyle.sides ?? 5, bend: (shapeStyle.bend ?? 30) / 100, strokeWidth: shapeStyle.strokeWidth }))
        : new Path2D();
      if (preview.tool === 'rect') { const r = cornerRadii({ ...shapeStyle, w, h }); traceRoundRect(path, { x, y, w, h }, r.rx, r.ry); }
      else if (preview.tool === 'ellipse') path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (preview.tool === 'line') { path.moveTo(preview.x0, preview.y0); path.lineTo(preview.x1, preview.y1); }
      if (!lineLike && shapeStyle.fill) {
        ctx.fillStyle = shapeStyle.fill;
        ctx.fill(path);
      }
      ctx.strokeStyle = lineLike ? shapeStyle.stroke ?? shapeStyle.fill ?? '#ffffff' : shapeStyle.stroke ?? 'rgba(212,242,90,0.6)';
      ctx.lineWidth = (lineLike || shapeStyle.stroke ? shapeStyle.strokeWidth : 1) || 1;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke(path);
      ctx.restore();
    }
  }, [doc, size, view, active, tool, preview, brush.size, shapeStyle, editingText, rv, live, objPick, editLayers, shiftDown, lineartMode, selectedCurve, picked.join(), guideLines, selectMode, selVersion, selDraft, rulers, guidePreview, paintFrame, targetSig, handleMode, pivot, shapeEditing, gradientSpec.shape, gradientSpec.mode, gradientSpec.color, gradientSpec.color2, gradientSpec.reverse, gradientSpec.opacity]);

  // ---------------------------------------------------------------------------
  // Keyboard

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftDown(true);
      if (e.code === 'Space' && !isTyping(e)) {
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftDown(false);
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
  // Pointer interactions

  const blocked = toolBlockReason(tool, active);

  const onPointerDown = (e: React.PointerEvent) => {
    if (editingText) return;
    cursor.move(e);
    const p = toDoc(e.clientX, e.clientY);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === 'hand' || spaceDown || e.button === 1) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    if (e.button !== 0) return;
    const current = getDoc(sessionId, doc.id);
    if (!current) return;
    const act = activeLayer(current);

    if (tool === 'gradient') {
      drag.current = { kind: 'gradient', x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setPreview(drag.current);
      return;
    }

    if (tool === 'select') {
      // Shift adds to the selection, Alt cuts out of it (any shape); the wand also has its own default mode.
      const wand = useStore.getState().ui.wand;
      const combine: SelectCombine = e.altKey ? 'subtract' : e.shiftKey ? 'add' : selectShape === 'wand' ? wand?.mode ?? 'replace' : 'replace';
      if (selectShape === 'wand') {
        const next = wandSelection(current, p.x, p.y, wand ?? {});
        if (typeof next === 'string') return void toast(next, 'error');
        record(current);
        combineSelection(current, next, combine);
        return;
      }
      drag.current = { kind: 'select', lasso: selectShape === 'lasso', points: [[p.x, p.y]], combine };
      setSelDraft([[p.x, p.y]]);
      return;
    }

    // Eyedropper, or Alt-click with the brush or the fill: the visible color under the pointer becomes the color.
    if (tool === 'eyedropper' || (e.altKey && (tool === 'brush' || tool === 'fill'))) {
      const color = sampleColor(current, p.x, p.y);
      if (!color) return void toast('Nothing to pick here: the page is transparent at this point.', 'info');
      setUi({ brush: { ...useStore.getState().ui.brush, color } });
      rememberColor(color);
      return;
    }

    if (tool === 'fill') {
      try { fillRegion(sessionId, current, p.x, p.y, brush.color, brush.opacity, { threshold: brush.fillThreshold, expand: brush.fillExpand, smooth: brush.fillSmooth }); }
      catch (error) { toast(error instanceof Error ? error.message : 'Could not fill this region.', 'error'); }
      return;
    }

    // Edit tool on a guide: drag it (back onto its ruler removes it).
    if (tool === 'move' && rulers) {
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

    if (tool === 'move') {
      const move = startPixelMove(sessionId, current, p, 3 / view.zoom);
      if (move) { if (move !== true) drag.current = { kind: 'pixelMove', move }; return; }
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

      // Objects mode: parts of one layer; Shift (below) selects layers.
      if (!editLayers && !e.shiftKey) {
        const ctrl = e.ctrlKey || e.metaKey;
        const owner = (l: Layer | null | undefined) => (l && l.visible && !l.locked ? l : null);
        // The top layer wins. Ctrl picks parts of one layer, or whole layers for a group.
        const top = clickCandidate(useStore.getState().ui.autoSelect ?? false, hitTestPixel(current, p.x, p.y), act ?? undefined, (l) => Boolean(objectAt(l, p.x, p.y))); 
        let layer: Layer | null = null;
        if (ctrl) layer = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id)).length === 1 && owner(act) && objectAt(act!, p.x, p.y) ? act! : null;
        else if (owner(top) && objectAt(top!, p.x, p.y)) layer = top;
        else if (!top && owner(act) && objectAt(act!, p.x, p.y)) layer = act!;
        const id = layer ? objectAt(layer, p.x, p.y) : null;
        if (layer && id) {
          if (layer.type === 'raster' && layer.paintBaseId && !getRasterSurface(layer.paintBaseId)) return void toast('Layer pixels are still loading. Try again in a moment.', 'error');
          const cur = objectPick(doc.id);
          if (ctrl) {
            // Ctrl held: press and drag moves everything picked (adding this one first if needed); a Ctrl-click
            // without dragging adds it, or takes it out if it was already picked.
            const had = cur?.layerId === layer.id && cur.ids.includes(id);
            if (!had) pickObject(doc.id, layer.id, id, true);
            const ids = objectPick(doc.id)?.ids ?? [id];
            drag.current = { kind: 'objMove', layerId: layer.id, ids, startX: p.x, startY: p.y, base: layer, ctrlToggle: had ? id : undefined, pre: current };
            return;
          }
          setActiveLayer(sessionId, doc.id, layer.id);
          // Pressing one of several picked layers drags them all; a click keeps just it (Inkscape).
          const grp = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
          if (grp.length > 1 && grp.includes(layer.id)) return void (drag.current = { kind: 'move', layerId: layer.id, startX: p.x, startY: p.y, base: layer, others: otherPickedLayers(current, layer.id), pre: current, solo: layer.id });
          pickLayer(doc.id, layer.id, false, []);
          // Dragging one of several picked objects moves them all; another object starts a new pick.
          const again = cur?.layerId === layer.id && cur.ids.includes(id);
          const ids = again ? cur!.ids : [id];
          setObjectPick(doc.id, { layerId: layer.id, ids });
          drag.current = { kind: 'objMove', layerId: layer.id, ids, startX: p.x, startY: p.y, base: layer, again, pre: current };
          return;
        }
        if (ctrl) {
          // Ctrl adds layers; releasing without dragging toggles a picked layer.
          const hit = hitTestPixel(current, p.x, p.y);
          if (!hit || hit.locked) return;
          setObjectPick(doc.id, null);
          const ids = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
          const had = ids.length > 1 && ids.includes(hit.id);
          if (!had) pickLayer(doc.id, hit.id, true, ids);
          setActiveLayer(sessionId, doc.id, hit.id);
          drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: otherPickedLayers(getDoc(sessionId, doc.id) ?? current, hit.id), ctrlToggle: had ? hit.id : undefined, pre: current };
          return;
        }
        // A layer with no parts (image, text, a painted layer without strokes): its content is the object.
        const whole = hitTestPixel(current, p.x, p.y);
        setObjectPick(doc.id, null);
        // Plain click outside the picked layers (or on empty canvas): start over with just what was clicked.
        const pickedNow = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
        if (!whole || !pickedNow.includes(whole.id)) pickLayer(doc.id, whole?.id ?? '', false, pickedNow);
        if (whole && !layerObjects(whole).length && whole.type !== 'vector') {
          const again = current.activeLayerId === whole.id;
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
            record(current);
            drag.current = { kind: 'scale', layerId: act.id, ax, ay, startDist: Math.hypot(p.x - ax, p.y - ay) || 1, base: act };
            return;
          }
          if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) {
            drag.current = { kind: 'move', layerId: act.id, startX: p.x, startY: p.y, base: act, others: otherPickedLayers(current, act.id), again: true, pre: current };
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
        drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: otherPickedLayers(current, hit.id), pre: current, again: sel.includes(hit.id) };
      }
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      const erase = tool === 'eraser';
      if (erase && (blocked || !act || act.type !== 'raster')) {
        toast(blocked ?? 'Select a raster layer to erase.', 'error');
        return;
      }
      if (drawingChoiceFirst(sessionId, doc.id, current, erase, { x: e.clientX, y: e.clientY })) return;
      if (!prepareStagePaint(current, erase)) return;
      record(current);
      // Brush never touches protected images: it paints on its own layer.
      const target = erase ? act : ensurePaintLayer(sessionId, doc.id);
      if (!target || target.type !== 'raster') return;
      if (!getRasterSurface(target.id) || (!target.paintFlattened && target.paintBaseId && !getRasterSurface(target.paintBaseId))) {
        toast('Layer pixels are still loading. Try again in a moment.', 'error');
        return;
      }
      const direct = paintsPixelsDirectly(current, target);
      const prepared = direct ? (target.paintBaseId ? { ...target, paintBaseId: undefined, paintStrokes: undefined } : target) : target.paintFlattened ? target : withPaintBase(target);
      if (prepared !== target) setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => l.id === target.id ? prepared : l) }));
      // The pixels before the stroke (kept by the undo step, so no copy is needed) are the base it is laid over.
      const before = getRasterSurface(target.id)!.canvas;
      beginEdit(prepared);
      const stroke = newBrushStroke(brush, erase);
      // With a pixel selection, the stroke lands only inside it.
      const clip = selectionClipFor(current, prepared);
      const p0 = beginRulerStroke(doc.id, p);
      drag.current = { stroke, live: beginLiveStroke(before, brush.color, brush.opacity, erase, clip, stroke.tip), kind: 'paint', layerId: target.id, last: p0, control: p0, time: e.timeStamp, erase, direct };
      paintSegment(target, p0, p0, penPressure(e));
      return;
    }

    if (tool === 'lineart') {
      if (lineartMode === 'edit') {
        if (act?.type === 'vector' && act.visible && !act.locked && selectedCurve?.layerId === act.id) {
          const index = act.strokes?.findIndex((s) => s.id === selectedCurve.strokeId) ?? -1;
          const stroke = act.strokes?.[index];
          if (stroke) {
            const point = selectedCurve.handles.find((i) => stroke.points[i] && Math.hypot(stroke.points[i][0] - p.x, stroke.points[i][1] - p.y) <= 8 / view.zoom);
            if (point !== undefined) {
              drag.current = { kind: 'bend', layerId: act.id, stroke: index, point, startX: p.x, startY: p.y, base: act.strokes!, influence };
              return;
            }
          }
        }
        for (const layer of [...current.layers].reverse()) {
          if (layer.type !== 'vector' || !layer.visible || layer.locked || layer.opacity === 0) continue;
          const stroke = [...(layer.strokes ?? [])].reverse().find((s) => s.opacity > 0 && nearStroke(s, p.x, p.y, 8 / view.zoom));
          if (!stroke) continue;
          setActiveLayer(sessionId, doc.id, layer.id);
          setSelectedCurve({ layerId: layer.id, strokeId: stroke.id, handles: strokeHandles(stroke) });
          // Editing a curve's points also picks it, so Properties styles just that stroke.
          setObjectPick(doc.id, { layerId: layer.id, ids: [stroke.id] });
          return;
        }
        setSelectedCurve(null);
        return;
      }
      // Strokes go to the active Lineart layer (a vector layer without shapes), else to a new one.
      const target = act && act.type === 'vector' && !act.locked && !act.shapes.length ? act : null;
      // Alt-drag near a point bends that stroke; its neighbours follow smoothly.
      if (e.altKey && target?.strokes?.length) {
        const hit = nearestPoint(target.strokes, p.x, p.y, 12 / view.zoom);
        if (hit) {
          record(current);
          drag.current = { kind: 'bend', layerId: target.id, ...hit, startX: p.x, startY: p.y, base: target.strokes, recorded: true };
          return;
        }
      }
      const pen = e.pointerType === 'pen';
      drag.current = { kind: 'stroke', layerId: target?.id ?? null, points: [[p.x, p.y, pen ? e.pressure || 0.5 : 0.5]], pen };
      setLive(newStroke(drag.current.points, lineart, !pen));
      return;
    }

    if (tool in SHAPE_NAMES) {
      drag.current = { kind: 'shape', tool: tool as ShapeTool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setPreview(drag.current);
      return;
    }

    if (tool === 'text') {
      const hit = hitTest(current, p.x, p.y);
      if (hit?.type === 'text' && !hit.locked) {
        setActiveLayer(sessionId, doc.id, hit.id);
        setEditingText(hit.id);
        return;
      }
      // width 0 = auto width: the box follows the text as it is typed.
      const id = addTextLayer(sessionId, doc.id, 'Text', { x: p.x, y: p.y, width: 0 }, textStyle);
      if (id) setEditingText(id);
    }
  };

  // Brush and eraser (design/brushStroke.ts): size and density follow the pen's pressure.
  const paintSegment = (layer: Layer, a: { x: number; y: number }, b: { x: number; y: number }, pressure: number) => {
    const d = drag.current, buf = layer.type === 'raster' && beginEditCurrent(layer.id);
    if (buf && layer.type === 'raster' && d?.kind === 'paint') addBrushSegment(d.stroke, d.live, buf, brushSegment(layer, a, b, brush, pressure, doc.width));
  };

  const rasterMoveAt = useRef<{ d: Extract<Drag, { kind: 'objMove' }>; x: number; y: number } | null>(null);
  const rasterMoveFrame = useRef<number | null>(null);
  const applyRasterMove = () => {
    if (rasterMoveFrame.current != null) cancelAnimationFrame(rasterMoveFrame.current);
    rasterMoveFrame.current = null;
    const at = rasterMoveAt.current;
    rasterMoveAt.current = null;
    if (!at) return;
    const { d } = at;
    const moved = translateObjects(d.base, d.ids, at.x - d.startX, at.y - d.startY);
    // A painted layer is recomposed once a frame, from the first moving stroke up.
    if (moved.type === 'raster' && d.base.type === 'raster') {
      if (!(d.compose ??= composeMoving(d.base, d.ids) ?? undefined)) return;
      d.compose(moved);
    }
    setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => l.id === d.layerId ? moved : l) }));
  };

  /** The transform a handle drag means, in page coordinates (Shift: keep proportions / 15° steps). */
  const xformMatrix = (d: Extract<Drag, { kind: 'xform' }>, p: { x: number; y: number }, shift: boolean): Mat => {
    const { box, h } = d;
    if (d.op === 'scale') {
      // The opposite side or corner stays put.
      const ax = box.x + box.w / 2 - (h.fx * box.w) / 2, ay = box.y + box.h / 2 - (h.fy * box.h) / 2;
      const clamp = (v: number) => (Math.abs(v) < 0.01 ? Math.sign(v || 1) * 0.01 : v);
      let sx = h.fx ? (p.x - ax) / (h.x - ax) : 1, sy = h.fy ? (p.y - ay) / (h.y - ay) : 1;
      // Ctrl or Shift (Inkscape's Ctrl): width and height keep their ratio. A side handle scales both axes,
      // about the opposite side's middle.
      if (shift && h.fx && h.fy) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; }
      else if (shift && h.fx) return scaleAbout(clamp(sx), clamp(Math.abs(sx)), ax, box.y + box.h / 2);
      else if (shift && h.fy) return scaleAbout(clamp(Math.abs(sy)), clamp(sy), box.x + box.w / 2, ay);
      return scaleAbout(clamp(sx), clamp(sy), ax, ay);
    }
    if (d.op === 'rotate') {
      let a = Math.atan2(p.y - d.cy, p.x - d.cx) - Math.atan2(d.startY - d.cy, d.startX - d.cx);
      if (shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      return rotateAbout(a, d.cx, d.cy);
    }
    if (d.op === 'skew') {
      // Top/bottom sides slide sideways (skew x); left/right sides slide up and down (skew y). About the center.
      if (h.fy) { let k = (p.x - d.startX) / (h.y - d.cy || 1); if (shift) k = Math.tan(Math.round(Math.atan(k) / (Math.PI / 12)) * (Math.PI / 12)); return skewAbout(k, 0, d.cx, d.cy); }
      let k = (p.y - d.startY) / (h.x - d.cx || 1); if (shift) k = Math.tan(Math.round(Math.atan(k) / (Math.PI / 12)) * (Math.PI / 12));
      return skewAbout(0, k, d.cx, d.cy);
    }
    return [1, 0, 0, 1, 0, 0];
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
  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    cursor.move(e);
    const d = drag.current;
    if (!d && tool === 'move') {
      // The cursor says what a handle does before it is pressed.
      const tol = (HANDLE + 4) / view.zoom;
      const h = [...handles].reverse().find((k) => Math.abs(p.x - k.x) <= tol && Math.abs(p.y - k.y) <= tol);
      const c = !h ? null : h.op === 'pivot' ? 'move' : h.op === 'rotate' ? 'grab'
        : h.op === 'skew' ? (h.fy ? 'ew-resize' : 'ns-resize')
          : h.fx && h.fy ? (h.fx === h.fy ? 'nwse-resize' : 'nesw-resize') : h.fx ? 'ew-resize' : 'ns-resize';
      if (c !== hoverHandle) setHoverHandle(c);
    }
    if (!d && tool === 'move' && rulers) {
      const near = (axis: GuideAxis) => (doc.guides?.[axis] ?? []).some((at) => Math.abs((axis === 'x' ? p.x : p.y) - at) * view.zoom <= 4);
      const over = near('x') ? 'x' : near('y') ? 'y' : null;
      if (over !== guideHover) setGuideHover(over);
    }
    if (!d) return;
    if (d.kind === 'pixelMove') { d.move.update(p);
    } else if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
    } else if (d.kind === 'xform' && d.op === 'pivot') {
      setPivot({ x: p.x, y: p.y });
    } else if (d.kind === 'xform') {
      if (!started(d, p)) return;
      // Scale handles snap too: the dragged side or corner meets page edges, guides and other layers (Alt: free).
      let q = p;
      const snap = useStore.getState().ui.snap ?? SNAP_DEFAULT;
      if (d.op === 'scale' && snap.on && !e.altKey) {
        const ids = new Set(d.bases.map((b) => b.layer.id));
        const t = snapSessionFor(d, () => new SnapSession({ ...doc, layers: doc.layers.filter((l) => !ids.has(l.id)) }, '', snap, view.zoom, visibleDocRect(view, size))).targets();
        const tol = SNAP_PX / view.zoom;
        const near = (v: number, lines: number[]) => lines.reduce<number | undefined>((best, l) => (Math.abs(l - v) <= tol && (best === undefined || Math.abs(l - v) < Math.abs(best - v)) ? l : best), undefined);
        const gx = d.h.fx ? near(p.x, t.xs) : undefined, gy = d.h.fy ? near(p.y, t.ys) : undefined;
        q = { x: gx ?? p.x, y: gy ?? p.y };
        showGuides({ x: gx, y: gy });
      }
      xformAt.current = { d, m: xformMatrix(d, q, e.shiftKey || e.ctrlKey || e.metaKey) };
      xformRaf.current ??= requestAnimationFrame(() => applyXform(false));
    } else if (d.kind === 'objMove') {
      if (!started(d, p)) return;
      // Pointer events can come faster than frames: keep the latest position and compose the layer at most once a
      // frame (each compose copies the whole layer). Pointer up applies the latest one before closing the step.
      // Picked objects snap like whole layers do (page, guides, other layers; Alt: free).
      let ox = p.x, oy = p.y;
      const snap = useStore.getState().ui.snap ?? SNAP_DEFAULT;
      const b0 = snap.on && !e.altKey ? objectsBox(d.base, d.ids) : null;
      if (b0) {
        const box = { ...b0, x: b0.x + p.x - d.startX, y: b0.y + p.y - d.startY };
        const s = snapSessionFor(d, () => new SnapSession({ ...doc, layers: doc.layers.filter((l) => l.id !== d.layerId) }, d.layerId, snap, view.zoom, visibleDocRect(view, size))).step(box, p, { x: e.clientX, y: e.clientY }, e.timeStamp);
        ox += s.dx; oy += s.dy;
        showGuides({ x: s.gx, y: s.gy });
      }
      rasterMoveAt.current = { d, x: ox, y: oy };
      rasterMoveFrame.current ??= requestAnimationFrame(applyRasterMove);
    } else if (d.kind === 'move') {
      if (!started(d, p)) return;
      // The dragged layer and the other picked ones move together; the group's box snaps (Alt held: free move).
      const group = [d.base, ...(d.others ?? [])];
      let dx = p.x - d.startX, dy = p.y - d.startY;
      const snap = useStore.getState().ui.snap ?? SNAP_DEFAULT;
      const box = snap.on && !e.altKey ? unionBox(group.map((l) => layerBox(translateLayer(l, dx, dy))).filter((b): b is NonNullable<typeof b> => Boolean(b))) : null;
      if (box) {
        const ids = new Set(group.map((l) => l.id));
        const s = snapSessionFor(d, () => new SnapSession({ ...doc, layers: doc.layers.filter((l) => !ids.has(l.id)) }, d.layerId, snap, view.zoom, visibleDocRect(view, size))).step(box, p, { x: e.clientX, y: e.clientY }, e.timeStamp);
        dx += s.dx;
        dy += s.dy;
        showGuides({ x: s.gx, y: s.gy });
      } else showGuides({});
      startDragPreview(doc);
      const moved = new Map(group.map((l) => [l.id, translateLayer(l, dx, dy)]));
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => moved.get(l.id) ?? l) }));
    } else if (d.kind === 'scale') {
      const k = Math.max(0.02, Math.hypot(p.x - d.ax, p.y - d.ay) / d.startDist);
      const scaled = scaleLayer(d.base, k, k, d.ax, d.ay);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => (l.id === d.layerId ? scaled : l)) }));
    } else if (d.kind === 'paint') {
      const layer = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === d.layerId);
      const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [e.nativeEvent]) {
        const point = toDoc(sample.clientX, sample.clientY);
        const next = brushPoint(d.last, d.control, point, brush.smoothing ?? 0, brush.stabilization ?? 0, view.zoom, sample.timeStamp - d.time);
        next.paint = rulerPoint(doc.id, next.paint);
        if (layer && (next.paint.x !== d.last.x || next.paint.y !== d.last.y)) paintSegment(layer, d.last, next.paint, penPressure(sample));
        d.last = next.paint;
        d.control = next.control;
        d.time = sample.timeStamp;
      }
      // Pointer events can come faster than the screen: show the stroke once per frame.
      paintRaf.current ??= requestAnimationFrame(flushPaintFrame);
      window.dispatchEvent(new Event('ogs:paint'));
    } else if (d.kind === 'stroke') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = toDoc(ev.clientX, ev.clientY);
        d.points.push([q.x, q.y, d.pen ? ev.pressure || 0.5 : 0.5]);
      }
      // Rebuilt and shown once per frame, however many pointer events come in between.
      liveRaf.current ??= requestAnimationFrame(() => {
        liveRaf.current = null;
        const cur = drag.current;
        if (cur?.kind === 'stroke') setLive(newStroke([...cur.points], lineart, !cur.pen));
      });
    } else if (d.kind === 'bend') {
      if (!d.recorded) {
        if (Math.hypot(p.x - d.startX, p.y - d.startY) * view.zoom < 2) return;
        const current = getDoc(sessionId, doc.id);
        if (!current) return;
        record(current);
        d.recorded = true;
      }
      const strokes = d.base.map((s, i) => (i === d.stroke ? bendStroke(s, d.point, p.x - d.startX, p.y - d.startY, d.influence ?? Math.max(24, s.size * 4)) : s));
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (l.id === d.layerId && l.type === 'vector' ? { ...l, strokes } : l)) }));
    } else if (d.kind === 'guide') {
      d.at = d.axis === 'x' ? p.x : p.y;
      setGuidePreview({ axis: d.axis, index: d.index, at: d.at });
    } else if (d.kind === 'gradient') {
      let x1 = p.x, y1 = p.y;
      // Shift: the line snaps to 45° steps, as in SAI.
      if (e.shiftKey) {
        const ang = Math.round(Math.atan2(y1 - d.y0, x1 - d.x0) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x1 - d.x0, y1 - d.y0);
        x1 = d.x0 + Math.cos(ang) * len;
        y1 = d.y0 + Math.sin(ang) * len;
      }
      d.x1 = x1;
      d.y1 = y1;
      setPreview({ ...d });
    } else if (d.kind === 'select') {
      if (d.lasso) {
        const last = d.points[d.points.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) * view.zoom >= 2) d.points.push([p.x, p.y]);
        setSelDraft([...d.points]);
      } else setSelDraft(rectPoints(d.points[0][0], d.points[0][1], p.x, p.y));
    } else if (d.kind === 'shape') {
      let x1 = p.x;
      let y1 = p.y;
      if (e.shiftKey) {
        if (STROKE_ONLY(d.tool)) {
          const ang = Math.round(Math.atan2(y1 - d.y0, x1 - d.x0) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(x1 - d.x0, y1 - d.y0);
          x1 = d.x0 + Math.cos(ang) * len;
          y1 = d.y0 + Math.sin(ang) * len;
        } else {
          const s = Math.max(Math.abs(x1 - d.x0), Math.abs(y1 - d.y0));
          x1 = d.x0 + Math.sign(x1 - d.x0 || 1) * s;
          y1 = d.y0 + Math.sign(y1 - d.y0 || 1) * s;
        }
      }
      d.x1 = x1;
      d.y1 = y1;
      setPreview({ ...d });
    }
  };

  /** A move starts past 3 screen px; only then is its undo step recorded. */
  const started = (d: { moved?: boolean; pre?: DesignDoc; startX: number; startY: number }, p: { x: number; y: number }) => {
    if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * view.zoom > 3) { d.moved = true; if (d.pre) record(d.pre); }
    return d.moved;
  };

  const onPointerUp = (e?: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    endDragPreview();
    if (!d) return;
    if (d.kind === 'pixelMove') { if (e) d.move.update(toDoc(e.clientX, e.clientY)); return; }
    // A guide lands where the pointer is released (a quick drag may send no move in between).
    if (d.kind === 'guide' && e) { const p = toDoc(e.clientX, e.clientY); d.at = d.axis === 'x' ? p.x : p.y; }
    showGuides({});
    // Clicking the selection again (no drag) switches between scale and rotate/skew handles, as in Inkscape.
    if ((d.kind === 'objMove' || d.kind === 'move') && d.again && !d.moved) setHandleMode((m) => (m === 'scale' ? 'rotate' : 'scale'));
    if (d.kind === 'xform') {
      if (d.op === 'pivot' || !d.moved) return;
      applyXform(true);
      for (const b of d.bases) if (b.layer.type === 'raster') commitEdit(b.layer.id);
      return;
    }
    if (d.kind === 'move' || d.kind === 'scale') rebasePaintLayer(sessionId, doc.id, d.layerId);
    if (d.kind === 'move') for (const o of d.others ?? []) rebasePaintLayer(sessionId, doc.id, o.id);
    // A Ctrl-click (no drag) on something already picked takes it out of the pick.
    if (d.kind === 'objMove' && d.ctrlToggle && !d.moved) pickObject(doc.id, d.layerId, d.ctrlToggle, true);
    if (d.kind === 'move' && d.solo && !d.moved) pickLayer(doc.id, d.solo, false, []);
    if (d.kind === 'move' && d.ctrlToggle && !d.moved) { const cur = getDoc(sessionId, doc.id) ?? doc; const ids = pickLayer(doc.id, d.ctrlToggle, true, layerSelection(doc.id, cur.activeLayerId, cur.layers.map((l) => l.id))); setActiveLayer(sessionId, doc.id, ids.at(-1) ?? null); }
    if (d.kind === 'objMove') {
      applyRasterMove();
      // A click without moving changes nothing.
      if (d.base.type !== 'raster' || !d.moved) return;
      commitEdit(d.layerId);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => l.id === d.layerId && l.type === 'raster' ? { ...l, rev: l.rev + 1 } : l) }));
    }
    if (d.kind === 'paint') commitStagePaintGesture({ sessionId, docId: doc.id, gesture: d, brush, clipped: !!d.live.clip, flushFrame: flushPaintFrame });
    if (d.kind === 'stroke') {
      if (liveRaf.current != null) cancelAnimationFrame(liveRaf.current);
      liveRaf.current = null;
      setLive(null);
      const current = getDoc(sessionId, doc.id);
      if (!current) return;
      const stroke = newStroke(d.points, lineart, !d.pen);
      record(current);
      const target = d.layerId ? current.layers.find((l) => l.id === d.layerId) : undefined;
      if (target && target.type === 'vector') {
        setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (l.id === target.id && l.type === 'vector' ? { ...l, strokes: [...(l.strokes ?? []), stroke] } : l)) }));
      } else {
        const layer = newVectorLayer(`Lineart ${current.layers.length + 1}`);
        layer.strokes = [stroke];
        setDoc(sessionId, doc.id, (dd) => insertLayer(dd, layer, 'top'));
      }
      return;
    }
    if (d.kind === 'guide') {
      setGuidePreview(null);
      // Dropped back on its ruler: a new guide is not made, an existing one is removed.
      const onRuler = (d.axis === 'x' ? view.x + d.at * view.zoom : view.y + d.at * view.zoom) < RULER;
      if (onRuler) { if (d.index != null) removeGuide(sessionId, doc.id, d.axis, d.index); }
      else placeGuide(sessionId, doc.id, d.axis, d.at, d.index);
      return;
    }
    if (d.kind === 'gradient') {
      setPreview(null);
      if (Math.hypot(d.x1 - d.x0, d.y1 - d.y0) * view.zoom < 4) return;
      const current = getDoc(sessionId, doc.id);
      if (current) applyGradient(sessionId, current, gradientSpec, d.x0, d.y0, d.x1, d.y1);
      return;
    }
    if (d.kind === 'select') {
      const pts = selDraft ?? [];
      setSelDraft(null);
      // A click without a drag clears the selection.
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const tiny = !pts.length || (Math.max(...xs) - Math.min(...xs)) * view.zoom < 3 || (Math.max(...ys) - Math.min(...ys)) * view.zoom < 3;
      // A selection change is an undo step of its own (as in GIMP and Krita), unless nothing changes.
      if (!(tiny && (d.combine !== 'replace' || !getSelection(doc.id)))) record(getDoc(sessionId, doc.id) ?? doc);
      if (d.combine === 'replace') setSelection(doc.id, tiny ? null : { points: pts });
      else if (!tiny) combineSelection(doc, { points: pts }, d.combine);
      return;
    }
    if (d.kind === 'shape') {
      setPreview(null);
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (Math.hypot(w, h) * view.zoom < 4) return;
      const lineLike = STROKE_ONLY(d.tool);
      const pfit = PRIM_TOOLS.has(d.tool) ? primShape(d.x0, d.y0, d.x1, d.y1, primFromUi(d.tool, shapeStyle)) : null;
      const d0 = !pfit && (d.tool === 'curve' || d.tool === 'arrow') ? toolPath(d.tool, d.x0, d.y0, d.x1, d.y1, { sides: shapeStyle.sides ?? 5, bend: (shapeStyle.bend ?? 30) / 100, strokeWidth: Math.max(1, shapeStyle.strokeWidth) }) : null;
      const pbox = d0 ? pathBox(d0) : null;
      if (d0 && !pbox) return;
      // Stroke style of the next shape (ShapeLookFields); corners only for rectangles.
      const { join, cap, miter, dash, dashOffset, paintOrder } = shapeStyle, look = { join, cap, miter, dash, dashOffset, paintOrder };
      const shape = pfit || pbox ? {
        id: uid('shp'),
        ...(pfit ?? { type: 'path' as const, d: d0!, box0: pbox!, ...pbox! }),
        fill: lineLike ? null : shapeStyle.fill,
        stroke: lineLike ? shapeStyle.stroke ?? shapeStyle.fill ?? '#ffffff' : shapeStyle.stroke,
        strokeWidth: lineLike ? Math.max(1, shapeStyle.strokeWidth) : shapeStyle.stroke ? shapeStyle.strokeWidth : 0,
        radius: 0,
        ...look,
      } : boxShape(uid('shp'), d.tool as 'rect' | 'ellipse' | 'line', d.x0, d.y0, d.x1, d.y1, shapeStyle, look);
      const current = getDoc(sessionId, doc.id);
      if (!current) return;
      const act = activeLayer(current);
      record(current);
      // Each shape gets its own layer; only an empty vector layer is filled in place.
      if (act && act.type === 'vector' && !act.locked && !act.shapes.length && !act.strokes?.length) {
        setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: [...dd.layers.filter((l) => l.id !== act.id), { ...act, shapes: [shape] }] }));
      } else {
        const layer = newVectorLayer(`${SHAPE_NAMES[d.tool]} ${current.layers.length + 1}`);
        layer.shapes = [shape];
        setDoc(sessionId, doc.id, (dd) => insertLayer(dd, layer, 'top'));
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.0022);
      setView((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, factor));
    } else {
      setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    }
  };

  // Native listener so preventDefault works (React wheel handlers are passive).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener('wheel', stop, { passive: false });
    return () => c.removeEventListener('wheel', stop);
  }, []);

  const onDoubleClick = (e: React.MouseEvent) => {
    if (tool !== 'move') return;
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
    const sh = hit?.type === 'vector' && !hit.locked && !editLayers ? editableShapeAt(hit.shapes, p.x, p.y) : null;
    if (sh) { setActiveLayer(sessionId, doc.id, hit!.id); editShape(doc.id, hit!.id, sh.id); return; }
    if (hit?.type === 'text' && !hit.locked) {
      setActiveLayer(sessionId, doc.id, hit.id);
      setEditingText(hit.id);
    }
  };

  const cursorStyle =
    drag.current?.kind === 'xform' && drag.current.op === 'rotate' ? 'grabbing' : hoverHandle && tool === 'move' ? hoverHandle : guidePreview || (guideHover && tool === 'move') ? ((guidePreview?.axis ?? guideHover) === 'x' ? 'col-resize' : 'row-resize') : tool === 'hand' || spaceDown ? 'grab' : tool === 'brush' || tool === 'eraser' ? (blocked ? 'not-allowed' : 'none') : tool === 'text' ? 'text' : tool === 'move' ? 'default' : 'crosshair';

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
        onPointerLeave={cursor.leave}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />
      <BrushCursor point={cursor.point} view={view} indicator={cursor.indicator} />
      <StrokeRulerOverlay view={view} docId={doc.id} tool={tool} />
      {tool === 'move' && !editLayers && <ShapeKnots view={view} sessionId={sessionId} doc={doc} />}
      {tool === 'move' && !editLayers && <GradientKnots view={view} sessionId={sessionId} doc={doc} />}
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
      {tool === 'move' && getSelection(doc.id) ? <StageHint id="move-region">Drag inside the pixel selection to extract and move it · vectors stay editable</StageHint> : tool === 'move' && selectedCurve ? <StageHint id="curve-points">Drag points to edit · Click away to move again</StageHint> : tool === 'lineart' && lineartMode === 'edit' ? <StageHint id="lineart-edit">Select a stroke · Drag its points · Influence controls the bend</StageHint> : null}
      {tool === 'move' && shapeEditing ? <StageHint id={shapeEditHint(doc).id} subtle>{shapeEditHint(doc).text}</StageHint>
        : tool === 'move' && !getSelection(doc.id) && !selectedCurve && tBox && drag.current?.kind !== 'xform' ? (handleMode === 'scale' ? <StageHint id="handles-scale" subtle>Drag the squares to resize (Ctrl or Shift keeps proportions) · click the selection again to rotate</StageHint> : <StageHint id="handles-rotate" subtle>Drag a corner to rotate, a side to skew (Ctrl or Shift: 15° steps) · move the center · click again to resize</StageHint>)
        : tool === 'move' && !getSelection(doc.id) && drag.current?.kind !== 'xform' && !editLayers && active && layerObjects(active).length ? <StageHint id="objects" subtle>Objects: click or drag an object · Shift- or Ctrl-click adds more · drag moves all picked</StageHint> : null}
      {blocked && (tool === 'brush' || tool === 'eraser') ? <div className="stage-hint">{blocked}</div> : null}
    </div>
  );
}


function corners(b: { x: number; y: number; w: number; h: number }): Array<[number, number]> {
  return [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x + b.w, b.y + b.h],
    [b.x, b.y + b.h],
  ];
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

// The stroke's working canvas (its box), read per segment.
function beginEditCurrent(layerId: string): HTMLCanvasElement | undefined {
  return getRasterSurface(layerId)?.canvas;
}

export type { DesignTool };


/** A how-to tip over the canvas with an × to close it; once closed it stays closed (this browser). */
const HINTS_KEY = 'ogs.designer.hintsClosed';
function closedHints(): string[] {
  try { return JSON.parse(localStorage.getItem(HINTS_KEY) ?? '[]'); } catch { return []; }
}
function StageHint({ id, subtle, children }: { id: string; subtle?: boolean; children: React.ReactNode }) {
  const [closed, setClosed] = useState(() => closedHints().includes(id));
  if (closed) return null;
  return <div className={`stage-hint has-close ${subtle ? 'subtle' : ''}`}>
    <span>{children}</span>
    <button type="button" className="stage-hint-close" aria-label="Close this tip" data-tip="Close this tip" onClick={() => {
      setClosed(true);
      try { localStorage.setItem(HINTS_KEY, JSON.stringify([...new Set([...closedHints(), id])])); } catch { /* storage blocked */ }
    }}><X size={12} /></button>
  </div>;
}
