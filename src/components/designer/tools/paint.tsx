import type { Layer } from '../../../engine/types';
import { brushPoint } from '../../../engine/design/brushControl';
import { beginLiveStroke, withPaintBase, beginEdit, getRasterSurface } from '../../../engine/design/raster';
import { addBrushSegment, brushSegment, newBrushStroke, penPressure } from '../../../engine/design/brushStroke';
import { rulerPoint, setRuler } from '../../../engine/design/strokeRuler';
import { record, unrecord } from '../../../engine/design/history';
import { ensurePaintLayer, getDoc } from '../../../engine/design/actions';
import { setDoc, toast, useStore } from '../../../store/store';
import { selectionClipFor } from '../../../engine/design/pixelSelection';
import { commitStagePaintGesture, drawingChoiceFirst, paintStart, pixelsNotReady, prepareStagePaint } from '../StagePaintCommit';
import { paintsPixelsDirectly } from '../../../engine/design/paintMode';
import { InlineToggle } from '../InlineControls';
import { BrushSettings } from '../BrushSettings';
import { PaintModeToggle } from '../PaintModeToggle';
import type { GestureMap, PointerPress, ToolDescriptor } from './types';
import type { StageState } from '../stageState';
import { isProtectedImage } from '../../../engine/design/rules';

function paintSegment({ drag, brush, doc }: StageState, layer: Layer, a: { x: number; y: number }, b: { x: number; y: number }, pressure: number) {
  const d = drag.current, buf = layer.type === 'raster' && getRasterSurface(layer.id)?.canvas;
  if (buf && layer.type === 'raster' && d?.kind === 'paint') addBrushSegment(d.stroke, d.live, buf, brushSegment(layer, a, b, brush, pressure, doc.width));
}

function beginPaint(erase: boolean, { state, current, act, p, e }: PointerPress) {
  const { sessionId, doc, blocked, drag, brush } = state;
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
    toast(pixelsNotReady([target.id, target.paintBaseId]), 'error');
    if (getDoc(sessionId, doc.id)?.layers === current.layers) unrecord(current);
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
  const { p0, p1 } = paintStart(doc, target.id, erase, e.shiftKey, p);
  drag.current = { stroke, live: beginLiveStroke(before, brush.color, brush.opacity, erase, clip, stroke.tip), kind: 'paint', layerId: target.id, last: p1, control: p1, time: e.timeStamp, erase, direct };
  paintSegment(state, target, p0, p0, penPressure(e));
  if (p1 !== p0) paintSegment(state, target, p0, p1, penPressure(e));
}

const gestures = {
  paint: {
    move({ state, d, e }) {
      const { doc, sessionId, toDoc, brush, view, paintRaf, flushPaintFrame } = state;
      const layer = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === d.layerId);
      const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [e.nativeEvent]) {
        const point = toDoc(sample.clientX, sample.clientY);
        const next = brushPoint(d.last, d.control, point, brush.smoothing ?? 0, brush.stabilization ?? 0, view.zoom, sample.timeStamp - d.time);
        next.paint = rulerPoint(doc.id, next.paint);
        if (layer && (next.paint.x !== d.last.x || next.paint.y !== d.last.y)) paintSegment(state, layer, d.last, next.paint, penPressure(sample));
        d.last = next.paint;
        d.control = next.control;
        d.time = sample.timeStamp;
      }
      // Pointer events can come faster than the screen: show the stroke once per frame.
      paintRaf.current ??= requestAnimationFrame(flushPaintFrame);
      window.dispatchEvent(new Event('ogs:paint'));
    },
    up({ state: { sessionId, doc, brush, flushPaintFrame }, d }) {
      commitStagePaintGesture({ sessionId, docId: doc.id, gesture: d, brush, clipped: !!d.live.clip, flushFrame: flushPaintFrame });
    },
  },
} satisfies Partial<GestureMap>;

function FollowStrokeRuler({ docId }: { docId: string }) {
  const ruler = useStore((s) => s.ui.strokeRuler);
  if (ruler?.docId !== docId) return null;
  return <InlineToggle label="Follow stroke ruler" tip="Strokes follow the guide placed with the Ruler tool (K)" checked={ruler.on} onChange={(on) => setRuler({ ...ruler, on })} />;
}

function paintTool(erase: boolean) {
  return {
    down: (args: PointerPress) => beginPaint(erase, args),
    gestures,
    showBlockReason: true,
    cursor: (blocked) => blocked ? 'not-allowed' : 'none',
    quick: erase ? ['size', 'opacity'] : ['size', 'opacity', 'flow', 'colorPair'],
    settings: ({ card, modeToggle, sessionId, doc, compact }) => card
      ? <BrushSettings erase={erase} card head={modeToggle ? <PaintModeToggle sessionId={sessionId} doc={doc} /> : null} />
      : <>{modeToggle ? <PaintModeToggle sessionId={sessionId} doc={doc} /> : null}<BrushSettings erase={erase} compact={compact} /></>,
    contextTail: FollowStrokeRuler,
    contextTarget: erase
      ? (l) => l?.name ?? null
      : (l) => l?.type === 'raster' && !l.locked && l.visible && !isProtectedImage(l) ? l.name : 'new layer',
  } satisfies ToolDescriptor;
}

export const brush = paintTool(false);

export const eraser = paintTool(true);
