import { useCallback, useEffect, useRef, useState } from 'react';
import { Brush, Eraser, Redo2, Undo2, WandSparkles, X } from 'lucide-react';
import { opEstimate, runAssetOp } from '../../engine/actions';
import { opModelFor } from '../../engine/catalog';
import { assetCanvas, canvasToAsset } from '../../engine/design/actions';
import { strokeSegment } from '../../engine/design/raster';
import { setSketch } from '../../engine/flow/actions';
import { setUi, toast, useStore } from '../../store/store';
import { Popover, usePopover } from '../ui/Popover';
import { Button, IconButton } from '../ui/primitives';
import { SpendConfirm } from '../ui/SpendConfirm';
import type { Estimate } from '../../engine/types';

type Pt = { x: number; y: number };
interface Stroke {
  points: Pt[];
  width: number;
  color: string;
  erase: boolean;
}

/** Mask strokes: white, shown translucent with a dark outline so they read on any image. */
const MASK_COLOR = '#ffffff';

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
  // Mask mode: paint the area, then Edit region (with a description) or Remove object (without one).
  const [mode, setMode] = useState<'paint' | 'mask'>('paint');
  const [change, setChange] = useState('');
  const [quote, setQuote] = useState<{ estimate: Estimate; modelName: string } | null>(null);
  const apply = usePopover();
  const maskOp = change.trim() ? 'edit_region' : 'remove_object';
  const maskModel = opModelFor(maskOp === 'edit_region' ? 'inpaint' : 'remove_object').ref;

  // Load the image into the base canvas; reset the drawing for every new target.
  useEffect(() => {
    setStrokes([]);
    setRedo([]);
    setSize(null);
    setChange('');
    setMode(target?.mode === 'mask' || !target?.nodeId ? 'mask' : 'paint');
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
    const color = mode === 'mask' ? MASK_COLOR : brush.color;
    drawing.current = { points: [p], width: brush.size * scale, color, erase };
    strokeSegment(paintRef.current!.getContext('2d')!, p, p, { width: drawing.current.width, color, opacity: 1, erase });
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

  /** The painted area as a white-on-black mask at the image's size. */
  const maskCanvas = (): HTMLCanvasElement => {
    const paint = paintRef.current!;
    const white = document.createElement('canvas');
    white.width = paint.width;
    white.height = paint.height;
    const wctx = white.getContext('2d')!;
    wctx.drawImage(paint, 0, 0);
    wctx.globalCompositeOperation = 'source-in';
    wctx.fillStyle = '#ffffff';
    wctx.fillRect(0, 0, white.width, white.height);
    const out = document.createElement('canvas');
    out.width = paint.width;
    out.height = paint.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(white, 0, 0);
    return out;
  };
  const quoteMask = async () => {
    if (!target) return;
    try {
      setQuote(await opEstimate(target.assetId, maskOp, { instruction: change.trim() }));
      apply.toggle();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const runMask = async () => {
    if (!target) return;
    setSaving(true);
    try {
      const mask = await canvasToAsset(sessionId, maskCanvas(), 'mask');
      const source = target.assetId;
      close();
      await runAssetOp(source, maskOp, { mask: mask.id, instruction: change.trim() });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };
  const save = async () => {
    // Painting is saved on the node it came from; mask mode has its own actions.
    if (!target?.nodeId || !baseRef.current || !paintRef.current) return;
    const nodeId = target.nodeId;
    setSaving(true);
    try {
      const out = document.createElement('canvas');
      out.width = baseRef.current.width;
      out.height = baseRef.current.height;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(baseRef.current, 0, 0);
      ctx.drawImage(paintRef.current, 0, 0);
      const asset = await canvasToAsset(sessionId, out, 'sketch');
      setSketch(sessionId, nodeId, asset.id);
      toast('Sketch applied · Reset image restores the original', 'success');
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
        <div className="segmented" aria-label="Mode">
          <button type="button" className={mode === 'paint' ? 'is-active' : ''} disabled={!target.nodeId} onClick={() => setMode('paint')} data-tip={target.nodeId ? 'Paint over the image' : 'Painting is saved on nodes; open Sketch from a node'}>
            Paint
          </button>
          <button type="button" className={mode === 'mask' ? 'is-active' : ''} onClick={() => setMode('mask')} data-tip="Mark an area to change or remove">
            Mask
          </button>
        </div>
        <div className="segmented">
          <button type="button" className={!erase ? 'is-active' : ''} aria-pressed={!erase} onClick={() => setErase(false)} data-tip="Brush">
            <Brush size={15} />
          </button>
          <button type="button" className={erase ? 'is-active' : ''} aria-pressed={erase} onClick={() => setErase(true)} data-tip="Eraser (only your strokes)">
            <Eraser size={15} />
          </button>
        </div>
        {mode === 'paint' ? (
          <div className="sketch-swatches">
            {SWATCHES.map((c) => (
              <button key={c} type="button" className={`sketch-swatch ${brush.color === c && !erase ? 'is-active' : ''}`} style={{ background: c }} aria-label={`Color ${c}`} onClick={() => (setBrush({ color: c }), setErase(false))} />
            ))}
            <label className="sketch-swatch sketch-custom" data-tip="Custom color">
              <input type="color" value={brush.color} onChange={(e) => (setBrush({ color: e.target.value }), setErase(false))} aria-label="Custom color" />
            </label>
          </div>
        ) : null}
        <label className="sketch-size" data-tip="Brush size">
          <span className="sketch-dot" style={{ width: Math.min(22, Math.max(4, brush.size / 2)), height: Math.min(22, Math.max(4, brush.size / 2)) }} />
          <input type="range" min={2} max={120} value={brush.size} onChange={(e) => setBrush({ size: Number(e.target.value) })} aria-label="Brush size" />
        </label>
        <IconButton icon={Undo2} label="Undo (Ctrl+Z)" size="sm" disabled={!strokes.length} onClick={undo} />
        <IconButton icon={Redo2} label="Redo (Ctrl+Shift+Z)" size="sm" disabled={!redo.length} onClick={redoOne} />
        <span className="spacer" />
        {mode === 'mask' ? (
          <>
            <input className="sketch-change" placeholder="Describe the change (empty = remove the object)" value={change} onChange={(e) => setChange(e.target.value)} aria-label="Change for the masked area" />
            <Button
              ref={apply.ref}
              size="sm"
              variant="primary"
              icon={WandSparkles}
              disabled={!dirty || saving || !maskModel}
              data-tip={maskModel ? undefined : 'No connected model takes masks (fal.ai or Atlas GPT Image)'}
              onClick={() => void quoteMask()}
            >
              {change.trim() ? 'Edit region' : 'Remove object'}
            </Button>
            <Popover open={apply.open} anchor={apply.ref} onClose={apply.close} width={300} label="Apply mask">
              {quote ? (
                <SpendConfirm
                  title={change.trim() ? 'Edit the painted area' : 'Remove the painted object'}
                  lines={[quote.modelName, change.trim() || 'Fill with the surrounding background']}
                  estimate={quote.estimate}
                  confirmLabel={change.trim() ? 'Edit region' : 'Remove object'}
                  onConfirm={() => (apply.close(), void runMask())}
                  onCancel={apply.close}
                />
              ) : null}
            </Popover>
          </>
        ) : (
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )}
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
          <canvas ref={paintRef} className={`sketch-paint ${erase ? 'is-erase' : ''} ${mode === 'mask' ? 'is-mask' : ''}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        </div>
      </div>
    </div>
  );
}
