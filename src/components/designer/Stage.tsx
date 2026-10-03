import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DesignDoc, Layer, RasterLayer, RasterStroke, Stroke, TextLayer } from '../../engine/types';
import { bendStroke, nearestPoint, newStroke, nearStroke, strokeHandles } from '../../engine/design/strokes';
import { moveRasterStroke, rasterStrokeBox } from '../../engine/design/rasterStrokes';
import { brushPoint } from '../../engine/design/brushControl';
import { fillRegion } from '../../engine/design/fill';
import { drawStroke } from '../../engine/design/brushTextures';
import { drawDoc, layerBox, layoutText, hitTest, hitTestPixel } from '../../engine/design/render';
import { activeLayer, fontStack, scaleLayer, translateLayer, newVectorLayer, insertLayer, unionBox } from '../../engine/design/doc';
import { SNAP_DEFAULT, snapBox, snapTargets } from '../../engine/design/snap';
import { layerSelection, pickLayer, useLayerSelection } from '../../engine/design/selection';
import { composeRaster, withPaintBase, beginEdit, commitEdit, ensureBuffers, getBuffer, rasterVersion, strokeSegment, subscribeRaster } from '../../engine/design/raster';
import { record } from '../../engine/design/history';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { addTextLayer, ensurePaintLayer, getDoc, patchLayer, rebasePaintLayer, placeAsset, setActiveLayer } from '../../engine/design/actions';
import { setDoc, setUi, toast, useStore } from '../../store/store';
import { rememberColor, sampleColor } from '../../engine/design/swatches';
import { clearGuides, placeGuide, removeGuide, rulerStep, type GuideAxis } from '../../engine/design/guides';
import { applyGradient, paintGradient, type GradientSpec } from '../../engine/design/gradient';
import { getSelection, rectPoints, selectionPath, setSelection, useSelectionVersion } from '../../engine/design/pixelSelection';
import { uid } from '../../lib/id';

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; layerId: string; startX: number; startY: number; base: Layer; others?: Layer[] }
  | { kind: 'scale'; layerId: string; ax: number; ay: number; startDist: number; base: Layer }
  | { kind: 'rasterMove'; layerId: string; strokeIds: string[]; startX: number; startY: number; base: RasterLayer }
  | { kind: 'paint'; stroke: RasterStroke; layerId: string; last: { x: number; y: number }; control: { x: number; y: number }; time: number; erase: boolean }
  | { kind: 'guide'; axis: GuideAxis; index?: number; at: number }
  | { kind: 'gradient'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'select'; lasso: boolean; points: Array<[number, number]> }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'line'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'stroke'; layerId: string | null; points: Array<[number, number, number]>; pen: boolean }
  | { kind: 'bend'; layerId: string; stroke: number; point: number; startX: number; startY: number; base: Stroke[]; influence?: number; recorded?: boolean };

const HANDLE = 8;
const RULER = 18;
const GRADIENT_DEFAULT = { shape: 'linear' as const, mode: 'two' as const, color2: '#000000', opacity: 1 };
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' } as const;

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

let tile: HTMLCanvasElement | null = null;
/** The transparency checkerboard: two 12 px cells of each tone. */
function checkerTile(): HTMLCanvasElement {
  if (tile) return tile;
  tile = document.createElement('canvas');
  tile.width = tile.height = 24;
  const c = tile.getContext('2d')!;
  c.fillStyle = '#26262b';
  c.fillRect(0, 0, 24, 24);
  c.fillStyle = '#303036';
  c.fillRect(0, 0, 12, 12); // the page corner starts with the light cell, as before
  c.fillRect(12, 12, 12, 12);
  return tile;
}

export function Stage({ sessionId, doc, selectedCurve, setSelectedCurve }: { sessionId: string; doc: DesignDoc; selectedCurve: CurveSelection; setSelectedCurve: (value: CurveSelection) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  // Layers picked with Ctrl/Shift (panel) or Ctrl (canvas): their boxes show and they move together.
  useLayerSelection((st) => st.byDoc[doc.id]);
  const picked = layerSelection(doc.id, doc.activeLayerId, doc.layers.map((l) => l.id));
  const pickedOthers = (d0: DesignDoc, id: string) => layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id)).includes(id) ? layerSelection(d0.id, d0.activeLayerId, d0.layers.map((l) => l.id)).filter((x) => x !== id).map((x) => d0.layers.find((l) => l.id === x)).filter((l): l is Layer => Boolean(l && !l.locked && l.visible)) : [];
  // Snap guides while moving (screen overlay only).
  const [guideLines, setGuideLines] = useState<{ x?: number; y?: number }>({});
  const showGuides = (g: { x?: number; y?: number }) => setGuideLines((cur) => (cur.x === g.x && cur.y === g.y ? cur : g));
  const [editingText, setEditingText] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  // Picked strokes of one raster layer (Ctrl-click adds more of the same layer in Objects mode).
  const [selectedRaster, setSelectedRaster] = useState<{ layerId: string; strokeIds: string[] } | null>(null);
  const selectMode = useStore((s) => s.ui.selectMode ?? 'objects');
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
  const [guidePreview, setGuidePreview] = useState<{ axis: GuideAxis; at: number; index?: number } | null>(null);
  const selectShape = useStore((s) => s.ui.selectShape ?? 'rect');
  const gradientUi = useStore((s) => s.ui.gradient) ?? GRADIENT_DEFAULT;
  const gradientSpec: GradientSpec = { ...gradientUi, color: brush.color };
  // The selection being drawn (page coordinates), shown until pointer up.
  const [selDraft, setSelDraft] = useState<Array<[number, number]> | null>(null);
  const fitted = useRef<string | null>(null);

  const active = activeLayer(doc);

  // Load pixels of raster layers after a reload.
  useEffect(() => {
    void ensureBuffers(doc.layers.filter((l): l is Extract<Layer, { type: 'raster' }> => l.type === 'raster'));
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
    const pad = size.w < 500 ? 24 : 72;
    const bottom = window.innerWidth < 768 ? 24 : 150; // composer is below the canvas on narrow screens
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
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
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
    if (sel && sel.points.length > 1) {
      ctx.save();
      selectionPath(ctx, doc, { points: sel.points });
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
    if (active && active.visible && !editingText) {
      const strokes = active.type === 'raster' ? active.paintStrokes?.filter((s) => !s.erase) ?? [] : [];
      const chosen = strokes.filter((s) => selectedRaster?.layerId === active.id && selectedRaster.strokeIds.includes(s.id));
      const selected = chosen[0];
      if (active.type === 'raster' && tool === 'move' && !shiftDown) {
        ctx.strokeStyle = 'rgba(212,242,90,0.3)';
        for (const stroke of strokes) {
          const box = rasterStrokeBox(active, stroke);
          if (box) ctx.strokeRect(sx(box.x) + 0.5, sy(box.y) + 0.5, box.w * view.zoom, box.h * view.zoom);
        }
      }
      if (chosen.length > 1 && active.type === 'raster' && !shiftDown) {
        ctx.save();
        ctx.strokeStyle = '#d4f25a';
        ctx.setLineDash([5, 4]);
        for (const st of chosen) { const bx = rasterStrokeBox(active, st); if (bx) ctx.strokeRect(sx(bx.x) + 0.5, sy(bx.y) + 0.5, bx.w * view.zoom, bx.h * view.zoom); }
        ctx.restore();
      }
      const b = selected && active.type === 'raster' && !shiftDown ? unionBox(chosen.map((st) => rasterStrokeBox(active, st)).filter((x): x is NonNullable<typeof x> => Boolean(x))) : layerBox(active);
      if (b) {
        ctx.strokeStyle = '#d4f25a';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
        if (tool === 'move' && !active.locked && (!selected || shiftDown)) {
          ctx.fillStyle = '#0a0a0b';
          for (const [hx, hy] of corners(b)) {
            ctx.fillRect(sx(hx) - HANDLE / 2, sy(hy) - HANDLE / 2, HANDLE, HANDLE);
            ctx.strokeRect(sx(hx) - HANDLE / 2 + 0.5, sy(hy) - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
          }
        }
      }
    }
    if ((tool === 'move' || (tool === 'lineart' && lineartMode === 'edit')) && active?.type === 'vector' && active.visible && !active.locked && selectedCurve?.layerId === active.id) {
      const stroke = active.strokes?.find((s) => s.id === selectedCurve.strokeId);
      if (stroke) {
        ctx.strokeStyle = '#d4f25a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        stroke.points.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y)));
        ctx.stroke();
        for (const i of selectedCurve.handles) {
          const point = stroke.points[i];
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
      ctx.beginPath();
      if (preview.tool === 'rect') ctx.roundRect(x, y, w, h, Math.min(shapeStyle.radius, w / 2, h / 2));
      else if (preview.tool === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(preview.x0, preview.y0);
        ctx.lineTo(preview.x1, preview.y1);
      }
      if (preview.tool !== 'line' && shapeStyle.fill) {
        ctx.fillStyle = shapeStyle.fill;
        ctx.fill();
      }
      ctx.strokeStyle = preview.tool === 'line' ? shapeStyle.stroke ?? shapeStyle.fill ?? '#ffffff' : shapeStyle.stroke ?? 'rgba(212,242,90,0.6)';
      ctx.lineWidth = (preview.tool === 'line' || shapeStyle.stroke ? shapeStyle.strokeWidth : 1) || 1;
      ctx.stroke();
      ctx.restore();
    }
  }, [doc, size, view, active, tool, preview, brush.size, shapeStyle, editingText, rv, live, selectedRaster, shiftDown, lineartMode, selectedCurve, picked.join(), guideLines, selectMode, selVersion, selDraft, rulers, guidePreview, gradientSpec.shape, gradientSpec.mode, gradientSpec.color, gradientSpec.color2, gradientSpec.reverse, gradientSpec.opacity]);

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
      drag.current = { kind: 'select', lasso: selectShape === 'lasso', points: [[p.x, p.y]] };
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
      // Ctrl/Cmd-click: add the layer under the pointer to the selection (or take it out). Shift stays "whole layer".
      if (e.ctrlKey || e.metaKey) {
        if (selectMode === 'layers') {
          // Layers mode: add the layer under the pointer to the selection (or take it out).
          const hit = hitTestPixel(current, p.x, p.y);
          if (hit) {
            pickLayer(doc.id, hit.id, true, layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id)));
            setActiveLayer(sessionId, doc.id, hit.id);
          }
          return;
        }
        // Objects mode: add a stroke of the active layer (or take it out); other layers are left alone.
        if (act?.type === 'raster' && act.visible && !act.locked) {
          const stroke = [...(act.paintStrokes ?? [])].reverse().find((st) => {
            if (st.erase) return false;
            const bx = rasterStrokeBox(act, st);
            return bx && p.x >= bx.x && p.x <= bx.x + bx.w && p.y >= bx.y && p.y <= bx.y + bx.h;
          });
          if (stroke) {
            const cur = selectedRaster?.layerId === act.id ? selectedRaster.strokeIds : [];
            setSelectedRaster({ layerId: act.id, strokeIds: cur.includes(stroke.id) ? cur.filter((x) => x !== stroke.id) : [...cur, stroke.id] });
          }
        }
        return;
      }
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
      if (!e.shiftKey) {
        const layer = act?.type === 'raster' && act.visible ? act : hitTest(current, p.x, p.y);
        if (layer?.type === 'raster' && !layer.locked && layer.visible && (!layer.paintBaseId || getBuffer(layer.paintBaseId))) {
          const stroke = [...(layer.paintStrokes ?? [])].reverse().find((s) => {
            if (s.erase) return false;
            const b = rasterStrokeBox(layer, s);
            return b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
          });
          if (stroke) {
            setActiveLayer(sessionId, doc.id, layer.id);
            // Dragging one of several picked strokes moves them all; another stroke starts a new pick.
            const keep = selectedRaster?.layerId === layer.id && selectedRaster.strokeIds.includes(stroke.id) ? selectedRaster.strokeIds : [stroke.id];
            setSelectedRaster({ layerId: layer.id, strokeIds: keep });
            record(current);
            drag.current = { kind: 'rasterMove', layerId: layer.id, strokeIds: keep, startX: p.x, startY: p.y, base: layer };
            return;
          }
        }
      }
      setSelectedRaster(null);
      if (act && !act.locked && act.visible) {
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
            record(current);
            drag.current = { kind: 'move', layerId: act.id, startX: p.x, startY: p.y, base: act, others: pickedOthers(current, act.id) };
            return;
          }
        }
      }
      const hit = hitTest(current, p.x, p.y);
      const sel = layerSelection(doc.id, current.activeLayerId, current.layers.map((l) => l.id));
      // A plain click on a layer outside the selection starts a new selection; inside it, the group moves together.
      if (!hit || !sel.includes(hit.id)) pickLayer(doc.id, hit?.id ?? '', false, sel);
      setActiveLayer(sessionId, doc.id, hit?.id ?? null);
      if (hit && !hit.locked) {
        record(current);
        drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit, others: pickedOthers(current, hit.id) };
      }
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      const erase = tool === 'eraser';
      if (erase && (blocked || !act || act.type !== 'raster')) {
        toast(blocked ?? 'Select a raster layer to erase.', 'error');
        return;
      }
      record(current);
      // Brush never touches protected images: it paints on its own layer.
      const target = erase ? act : ensurePaintLayer(sessionId, doc.id);
      if (!target || target.type !== 'raster') return;
      if (!getBuffer(target.id) || (target.paintBaseId && !getBuffer(target.paintBaseId))) {
        toast('Layer pixels are still loading. Try again in a moment.', 'error');
        return;
      }
      const prepared = withPaintBase(target);
      if (prepared !== target) setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => l.id === target.id ? prepared : l) }));
      beginEdit(prepared);
      const stroke: RasterStroke = { id: uid('rst'), x: 0, y: 0, segments: [], color: brush.color, opacity: brush.opacity, erase };
      drag.current = { stroke, kind: 'paint', layerId: target.id, last: p, control: p, time: e.timeStamp, erase };
      paintSegment(target, p, p, erase);
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

    if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      drag.current = { kind: 'shape', tool, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
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
      const id = addTextLayer(sessionId, doc.id, 'Text', { x: p.x, y: p.y, width: 0 }, { ...textStyle, fontSize: Math.max(12, Math.round(current.width / 14)) });
      if (id) setEditingText(id);
    }
  };

  const paintSegment = (layer: Layer, a: { x: number; y: number }, b: { x: number; y: number }, erase: boolean) => {
    if (layer.type !== 'raster') return;
    const buf = beginEditCurrent(layer.id);
    if (!buf) return;
    const ctx = buf.getContext('2d');
    if (!ctx) return;
    const kx = layer.pxWidth / layer.width;
    const ky = layer.pxHeight / layer.height;
    const segment: [number, number, number, number, number] = [(a.x - layer.x) * kx, (a.y - layer.y) * ky, (b.x - layer.x) * kx, (b.y - layer.y) * ky, (brush.size * (kx + ky)) / 2];
    const d = drag.current;
    if (d?.kind !== 'paint') return;
    d.stroke.segments.push(segment);
    strokeSegment(ctx, { x: segment[0], y: segment[1] }, { x: segment[2], y: segment[3] }, { width: segment[4], color: d.stroke.color, opacity: d.stroke.opacity, erase });
  };

  const rasterMoveAt = useRef<{ d: Extract<Drag, { kind: 'rasterMove' }>; x: number; y: number } | null>(null);
  const rasterMoveFrame = useRef<number | null>(null);
  const applyRasterMove = () => {
    if (rasterMoveFrame.current != null) cancelAnimationFrame(rasterMoveFrame.current);
    rasterMoveFrame.current = null;
    const at = rasterMoveAt.current;
    rasterMoveAt.current = null;
    if (!at) return;
    const { d } = at;
    const moved = d.strokeIds.reduce((l, id) => moveRasterStroke(l, id, at.x - d.startX, at.y - d.startY), d.base);
    if (composeRaster(moved, false)) setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => l.id === d.layerId ? moved : l) }));
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    if (tool === 'brush' || tool === 'eraser') setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
    } else if (d.kind === 'rasterMove') {
      // Pointer events can come faster than frames: keep the latest position and compose the layer at most once a
      // frame (each compose copies the whole layer). Pointer up applies the latest one before closing the step.
      rasterMoveAt.current = { d, x: p.x, y: p.y };
      rasterMoveFrame.current ??= requestAnimationFrame(applyRasterMove);
    } else if (d.kind === 'move') {
      // The dragged layer and the other picked ones move together; the group's box snaps (Alt held: free move).
      const group = [d.base, ...(d.others ?? [])];
      let dx = p.x - d.startX, dy = p.y - d.startY;
      const snap = useStore.getState().ui.snap ?? SNAP_DEFAULT;
      const box = snap.on && !e.altKey ? unionBox(group.map((l) => layerBox(translateLayer(l, dx, dy))).filter((b): b is NonNullable<typeof b> => Boolean(b))) : null;
      if (box) {
        const ids = new Set(group.map((l) => l.id));
        const s = snapBox(box, snapTargets({ ...doc, layers: doc.layers.filter((l) => !ids.has(l.id)) }, d.layerId, snap), 6 / view.zoom);
        dx += s.dx;
        dy += s.dy;
        showGuides({ x: s.gx, y: s.gy });
      } else showGuides({});
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
        if (layer && (next.paint.x !== d.last.x || next.paint.y !== d.last.y)) paintSegment(layer, d.last, next.paint, d.erase);
        d.last = next.paint;
        d.control = next.control;
        d.time = sample.timeStamp;
      }
      setCursor(d.last);
      window.dispatchEvent(new Event('ogs:paint'));
    } else if (d.kind === 'stroke') {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const q = toDoc(ev.clientX, ev.clientY);
        d.points.push([q.x, q.y, d.pen ? ev.pressure || 0.5 : 0.5]);
      }
      setLive(newStroke([...d.points], lineart, !d.pen));
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
        if (d.tool === 'line') {
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

  const onPointerUp = (e?: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    // A guide lands where the pointer is released (a quick drag may send no move in between).
    if (d.kind === 'guide' && e) { const p = toDoc(e.clientX, e.clientY); d.at = d.axis === 'x' ? p.x : p.y; }
    showGuides({});
    if (d.kind === 'move' || d.kind === 'scale') rebasePaintLayer(sessionId, doc.id, d.layerId);
    if (d.kind === 'move') for (const o of d.others ?? []) rebasePaintLayer(sessionId, doc.id, o.id);
    if (d.kind === 'rasterMove') {
      applyRasterMove();
      commitEdit(d.layerId);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => l.id === d.layerId && l.type === 'raster' ? { ...l, rev: l.rev + 1 } : l) }));
    }
    if (d.kind === 'paint') {
      if (!d.erase) setSelectedRaster({ layerId: d.layerId, strokeIds: [d.stroke.id] });
      commitEdit(d.layerId);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (l.id === d.layerId && l.type === 'raster' ? { ...l, rev: l.rev + 1, paintStrokes: [...(l.paintStrokes ?? []), d.stroke] } : l)) }));
    }
    if (d.kind === 'stroke') {
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
        setDoc(sessionId, doc.id, (dd) => insertLayer(dd, layer, 'above'));
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
      setSelection(doc.id, tiny ? null : { points: pts });
      return;
    }
    if (d.kind === 'shape') {
      setPreview(null);
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (Math.hypot(w, h) * view.zoom < 4) return;
      const shape = {
        id: uid('shp'),
        type: d.tool,
        x: d.tool === 'line' ? d.x0 : Math.min(d.x0, d.x1),
        y: d.tool === 'line' ? d.y0 : Math.min(d.y0, d.y1),
        w: d.tool === 'line' ? w : Math.abs(w),
        h: d.tool === 'line' ? h : Math.abs(h),
        fill: d.tool === 'line' ? null : shapeStyle.fill,
        stroke: d.tool === 'line' ? shapeStyle.stroke ?? shapeStyle.fill ?? '#ffffff' : shapeStyle.stroke,
        strokeWidth: d.tool === 'line' ? Math.max(1, shapeStyle.strokeWidth) : shapeStyle.stroke ? shapeStyle.strokeWidth : 0,
        radius: d.tool === 'rect' ? shapeStyle.radius : 0,
      };
      const current = getDoc(sessionId, doc.id);
      if (!current) return;
      const act = activeLayer(current);
      record(current);
      // Each shape gets its own layer; only an empty vector layer is filled in place.
      if (act && act.type === 'vector' && !act.locked && !act.shapes.length) {
        setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => (l.id === act.id && l.type === 'vector' ? { ...l, shapes: [...l.shapes, shape] } : l)) }));
      } else {
        const layer = newVectorLayer(`${SHAPE_NAMES[d.tool]} ${current.layers.length + 1}`);
        layer.shapes = [shape];
        setDoc(sessionId, doc.id, (dd) => insertLayer(dd, layer, 'above'));
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
      return;
    }
    const hit = hitTest(doc, p.x, p.y);
    if (hit?.type === 'text' && !hit.locked) {
      setActiveLayer(sessionId, doc.id, hit.id);
      setEditingText(hit.id);
    }
  };

  const cursorStyle =
    tool === 'hand' || spaceDown ? 'grab' : tool === 'brush' || tool === 'eraser' ? (blocked ? 'not-allowed' : 'none') : tool === 'text' ? 'text' : tool === 'move' ? 'default' : 'crosshair';

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
        onPointerLeave={() => setCursor(null)}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
      />
      {cursor && (tool === 'brush' || tool === 'eraser') ? (
        // The brush ring is an element, not part of the canvas: moving the pointer never redraws the document.
        <div
          aria-hidden
          style={{
            position: 'absolute', left: 0, top: 0, pointerEvents: 'none', borderRadius: '50%',
            width: 2 * Math.max(2, (brush.size / 2) * view.zoom), height: 2 * Math.max(2, (brush.size / 2) * view.zoom),
            transform: `translate(${view.x + cursor.x * view.zoom - Math.max(2, (brush.size / 2) * view.zoom)}px, ${view.y + cursor.y * view.zoom - Math.max(2, (brush.size / 2) * view.zoom)}px)`,
            boxSizing: 'border-box', border: '1px solid #ffffff', boxShadow: '0 0 0 1px #16161a, inset 0 0 0 1px #16161a',
          }}
        />
      ) : null}
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
      {tool === 'move' && selectedCurve ? <div className="stage-hint">Drag points to edit · Click away to move again</div> : tool === 'lineart' && lineartMode === 'edit' ? <div className="stage-hint">Select a stroke · Drag its points · Influence controls the bend</div> : null}
      {tool === 'move' && active?.type === 'raster' && active.paintStrokes?.length ? <div className="stage-hint">Drag a stroke · Ctrl-click to pick more · Shift-drag to move the whole layer</div> : null}
      {blocked && (tool === 'brush' || tool === 'eraser') ? <div className="stage-hint">{blocked}</div> : null}
    </div>
  );
}

function TextEditor({ layer, view, onDone }: { layer: TextLayer; view: View; onDone: (text: string) => void }) {
  const [text, setText] = useState(layer.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // Focus after the canvas mousedown has moved focus to <body>, or it would blur us at once.
    const t = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(t);
  }, []);
  const lay = layoutText({ ...layer, text });
  const z = view.zoom;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onDone(text)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        e.stopPropagation();
      }}
      style={{
        left: view.x + layer.x * z,
        top: view.y + layer.y * z,
        width: Math.max(8, lay.width * z) + layer.fontSize * 0.3 * z,
        height: lay.height * z + 2,
        whiteSpace: layer.width > 0 ? 'pre-wrap' : 'pre',
        font: `${layer.fontWeight} ${layer.fontSize * z}px ${fontStack(layer.fontFamily)}`,
        lineHeight: `${layer.lineHeight}`,
        letterSpacing: `${layer.letterSpacing * z}px`,
        color: layer.color,
        textAlign: layer.align,
        paddingTop: ((layer.fontSize * layer.lineHeight - layer.fontSize) / 2) * z,
      }}
      aria-label="Edit text"
    />
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

function zoomAt(v: View, px: number, py: number, factor: number): View {
  const zoom = Math.min(8, Math.max(0.05, v.zoom * factor));
  const k = zoom / v.zoom;
  return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
}

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

// The paint stroke edits the buffer cloned at pointer-down; fetch it lazily.
function beginEditCurrent(layerId: string): HTMLCanvasElement | undefined {
  return getBuffer(layerId);
}

export type { DesignTool };
