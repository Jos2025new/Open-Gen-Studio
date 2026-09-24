import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Redo2, Undo2, X } from 'lucide-react';
import { assetCanvas, canvasToAsset } from '../../engine/design/actions';
import { strokeSegment } from '../../engine/design/raster';
import { applySketch } from '../../engine/flow/actions';
import { setUi, toast, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton } from '../ui/primitives';

type Pt = { x: number; y: number };
interface Stroke {
  points: Pt[];
  width: number;
  color: string;
  erase: boolean;
}

const SWATCHES = ['#ffffff', '#111111', '#ff4d4d', '#ffb020', '#d4f25a', '#3fd0a0', '#4d9bff', '#b57bff'];

/** Paint over an image without leaving the flow. Strokes stay vectors until saved, so undo is cheap. */
export function SketchEditor() {
  const target = useStore((s) => s.ui.sketch);
  const sessionId = useStore((s) => s.activeSessionId);
  const brush = useStore((s) => s.ui.brush);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const paintRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [erase, setErase] = useState(false);
  const [saving, setSaving] = useState(false);
  const drawing = useRef<Stroke | null>(null);
  const confirm = usePopover();

  // Load the image into the base canvas; reset the drawing for every new target.
  useEffect(() => {
    setStrokes([]);
    setRedo([]);
    setSize(null);
    if (!target) return;
    let alive = true;
    assetCanvas(target.assetId)
      .then((src) => {
        if (!alive || !baseRef.current || !paintRef.current) return;
        for (const c of [baseRef.current, paintRef.current]) {
          c.width = src.width;
          c.height = src.height;
        }
        baseRef.current.getContext('2d')?.drawImage(src, 0, 0);
        setSize({ w: src.width, h: src.height });
      })
      .catch((err: Error) => {
        toast(err.message, 'error');
        setUi({ sketch: null });
      });
    return () => {
      alive = false;
    };
  }, [target]);

  const redraw = useCallback((list: Stroke[]) => {
    const c = paintRef.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (const s of list) {
      for (let i = 0; i < s.points.length; i++) strokeSegment(ctx, s.points[Math.max(0, i - 1)], s.points[i], { width: s.width, color: s.color, opacity: 1, erase: s.erase });
    }
  }, []);

  const toImage = (e: React.PointerEvent): Pt => {
    const r = paintRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * paintRef.current!.width, y: ((e.clientY - r.top) / r.height) * paintRef.current!.height };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!size) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // Brush size is in screen pixels, so it feels the same at any image resolution.
    const scale = paintRef.current!.width / paintRef.current!.getBoundingClientRect().width;
    const p = toImage(e);
    drawing.current = { points: [p], width: brush.size * scale, color: brush.color, erase };
    strokeSegment(paintRef.current!.getContext('2d')!, p, p, { width: drawing.current.width, color: brush.color, opacity: 1, erase });
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = drawing.current;
    if (!s) return;
    const p = toImage(e);
    strokeSegment(paintRef.current!.getContext('2d')!, s.points[s.points.length - 1], p, { width: s.width, color: s.color, opacity: 1, erase: s.erase });
    s.points.push(p);
  };
  const onUp = () => {
    const s = drawing.current;
    drawing.current = null;
    if (!s) return;
    setStrokes((list) => [...list, s]);
    setRedo([]);
  };

  const undo = () => {
    if (!strokes.length) return;
    const next = strokes.slice(0, -1);
    setRedo([...redo, strokes[strokes.length - 1]]);
    setStrokes(next);
    redraw(next);
  };
  const redoOne = () => {
    if (!redo.length) return;
    const next = [...strokes, redo[redo.length - 1]];
    setRedo(redo.slice(0, -1));
    setStrokes(next);
    redraw(next);
  };

  const dirty = strokes.length > 0;
  const close = () => setUi({ sketch: null });
  const save = async () => {
    if (!target || !baseRef.current || !paintRef.current) return;
    setSaving(true);
    try {
      const out = document.createElement('canvas');
      out.width = baseRef.current.width;
      out.height = baseRef.current.height;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(baseRef.current, 0, 0);
      ctx.drawImage(paintRef.current, 0, 0);
      const asset = await canvasToAsset(sessionId, out);
      if (target.nodeId || target.edgeId) applySketch(sessionId, target, asset.id);
      toast('Sketch saved as a new image', 'success');
      close();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoOne();
        else undo();
      } else if (e.key === 'Escape' && !document.querySelector('.popover')) {
        e.stopPropagation();
        if (dirty) confirm.toggle();
        else close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!target) return null;
  const setBrush = (patch: Partial<typeof brush>) => setUi((u) => ({ brush: { ...u.brush, ...patch } }));

  return (
    <div className="sketch" role="dialog" aria-label="Sketch">
      <div className="sketch-bar">
        <div className="segmented">
          <button type="button" className={!erase ? 'is-active' : ''} aria-pressed={!erase} onClick={() => setErase(false)} data-tip="Brush">
            <Brush size={15} />
          </button>
          <button type="button" className={erase ? 'is-active' : ''} aria-pressed={erase} onClick={() => setErase(true)} data-tip="Eraser (only your strokes)">
            <Eraser size={15} />
          </button>
        </div>
        <div className="sketch-swatches">
          {SWATCHES.map((c) => (
            <button key={c} type="button" className={`sketch-swatch ${brush.color === c && !erase ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => (setBrush({ color: c }), setErase(false))} />
          ))}
          <label className="sketch-swatch sketch-custom" data-tip="Custom color">
            <input type="color" value={brush.color} onChange={(e) => (setBrush({ color: e.target.value }), setErase(false))} aria-label="Custom color" />
          </label>
        </div>
        <label className="sketch-size" data-tip="Brush size">
          <span className="sketch-dot" style={{ width: Math.min(22, Math.max(4, brush.size / 2)), height: Math.min(22, Math.max(4, brush.size / 2)) }} />
          <input type="range" min={2} max={120} value={brush.size} onChange={(e) => setBrush({ size: Number(e.target.value) })} aria-label="Brush size" />
        </label>
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" size="sm" disabled={!strokes.length} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" size="sm" disabled={!redo.length} onClick={redoOne} />
        <span className="spacer" />
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <IconButton ref={confirm.ref} icon={X} label="Close" size="sm" onClick={() => (dirty ? confirm.toggle() : close())} />
        <Popover open={confirm.open} anchor={confirm.ref} onClose={confirm.close} width={260} label="Unsaved sketch">
          <div className="confirm">
            <p>Save your changes before closing?</p>
            <div className="spend-actions">
              <Button variant="ghost" onClick={() => (confirm.close(), close())}>
                Discard
              </Button>
              <Button variant="primary" disabled={saving} onClick={() => (confirm.close(), void save())}>
                Save
              </Button>
            </div>
          </div>
        </Popover>
      </div>
      <div className="sketch-stage">
        <div className="sketch-frame" style={size ? { aspectRatio: `${size.w} / ${size.h}` } : undefined}>
          <canvas ref={baseRef} className="sketch-base" />
          <canvas ref={paintRef} className={`sketch-paint ${erase ? 'is-erase' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
      </div>
    </div>
  );
}
