import { bendStroke, nearestPoint, newStroke, nearStroke, strokeHandles } from '../../../engine/design/strokes';
import { activeLayer, newVectorLayer, insertLayer } from '../../../engine/design/doc';
import { record } from '../../../engine/design/history';
import { getDoc, noticeSkippedLayer, setActiveLayer } from '../../../engine/design/actions';
import { setDoc, useStore, setUi } from '../../../store/store';
import { setObjectPick } from '../../../engine/design/objectSelection';
import { StrokeStyleFields } from '../StrokeStyleFields';
import { InlineSelect, InlineSlider } from '../InlineControls';
import type { GestureMap, PointerPress, ToolDescriptor, ToolSettingsProps } from './types';
import { curveStyle } from '../ToolSettingsFields';

function beginLineart({ state, current, act, p, e }: PointerPress) {
  const { sessionId, doc, view, drag, lineartMode, selectedCurve, setSelectedCurve, influence, lineart, setLive } = state;
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
  // Strokes go to the active visible Lineart layer, else a new one (a hidden layer would hide them).
  const target = act && act.type === 'vector' && !act.locked && act.visible && !act.shapes.length ? act : null;
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
}
const gestures = {
  stroke: {
    move({ state, d, e }) {
      const { drag, toDoc, liveRaf, lineart, setLive } = state;
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
    },
    up({ state, d }) {
      const { sessionId, doc, liveRaf, lineart, setLive } = state;
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
        noticeSkippedLayer(sessionId, doc.id, activeLayer(current));
      }
    },
  },
  bend: {
    move({ state, d, p }) {
      const { sessionId, doc, view } = state;
      if (!d.recorded) {
        if (Math.hypot(p.x - d.startX, p.y - d.startY) * view.zoom < 2) return;
        const current = getDoc(sessionId, doc.id);
        if (!current) return;
        record(current);
        d.recorded = true;
      }
      const strokes = d.base.map((s, i) => (i === d.stroke ? bendStroke(s, d.point, p.x - d.startX, p.y - d.startY, d.influence ?? Math.max(24, s.size * 4)) : s));
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (l.id === d.layerId && l.type === 'vector' ? { ...l, strokes } : l)) }));
    },
  },
} satisfies Partial<GestureMap>;

function LineartSettings({ sessionId, doc, selectedCurve }: ToolSettingsProps) {
  const lineart = useStore((s) => s.ui.lineart);
  const lineartMode = useStore((s) => s.ui.lineartMode ?? 'draw');
  const influence = useStore((s) => s.ui.lineartInfluence ?? 80);
  const { curve, applyCurveStyle } = curveStyle(sessionId, doc, selectedCurve);
  return <>
    <InlineSelect label="Mode" value={lineartMode} options={[{ value: 'draw' as const, label: 'Draw' }, { value: 'edit' as const, label: 'Edit' }]} onChange={(v) => setUi({ lineartMode: v })} />
    {lineartMode === 'edit' ? <><InlineSlider label="Influence" unit="px" min={1} max={500} value={influence} onChange={(v) => setUi({ lineartInfluence: v })} />{curve && <StrokeStyleFields value={curve} onChange={applyCurveStyle} />}</> : <StrokeStyleFields value={lineart} onChange={(p) => setUi({ lineart: { ...lineart, ...p } })} />}
  </>;
}

export const lineart = {
  down: beginLineart,
  gestures,
  curveHandles: 'edit',
  quick: ['lineartSize', 'lineartOpacity', 'lineartColor'],
  settings: LineartSettings,
} satisfies ToolDescriptor;
