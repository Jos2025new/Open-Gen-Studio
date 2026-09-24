import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DesignDoc, Layer, TextLayer } from '../../engine/types';
import { drawDoc, layerBox, layoutText, hitTest } from '../../engine/design/render';
import { activeLayer, fontStack, scaleLayer, translateLayer, newVectorLayer, insertLayer } from '../../engine/design/doc';
import { beginEdit, commitEdit, ensureBuffers, getBuffer, rasterVersion, strokeSegment, subscribeRaster } from '../../engine/design/raster';
import { record } from '../../engine/design/history';
import { toolBlockReason, type DesignTool } from '../../engine/design/rules';
import { addTextLayer, ensurePaintLayer, getDoc, patchLayer, placeAsset, setActiveLayer } from '../../engine/design/actions';
import { setDoc, toast, useStore } from '../../store/store';
import { uid } from '../../lib/id';

interface View {
  zoom: number;
  x: number;
  y: number;
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'move'; layerId: string; startX: number; startY: number; base: Layer }
  | { kind: 'scale'; layerId: string; ax: number; ay: number; startDist: number; base: Layer }
  | { kind: 'paint'; layerId: string; last: { x: number; y: number }; erase: boolean }
  | { kind: 'shape'; tool: 'rect' | 'ellipse' | 'line'; x0: number; y0: number; x1: number; y1: number };

const HANDLE = 8;
const SHAPE_NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' } as const;

export function Stage({ sessionId, doc }: { sessionId: string; doc: DesignDoc }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [editingText, setEditingText] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const drag = useRef<Drag | null>(null);
  const tool = useStore((s) => s.ui.tool);
  const brush = useStore((s) => s.ui.brush);
  const shapeStyle = useStore((s) => s.ui.shape);
  const textStyle = useStore((s) => s.ui.text);
  const rv = useSyncExternalStore(subscribeRaster, rasterVersion);
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
      const cell = 12 / view.zoom;
      ctx.fillStyle = '#1b1b1f';
      ctx.fillRect(0, 0, doc.width, doc.height);
      ctx.fillStyle = '#24242a';
      for (let y = 0; y < doc.height; y += cell) for (let x = (Math.floor(y / cell) % 2) * cell; x < doc.width; x += cell * 2) ctx.fillRect(x, y, cell, cell);
      ctx.restore();
    }
    drawDoc(ctx, doc, { hideLayerId: editingText ?? undefined });
    ctx.restore();

    // Overlays in screen space.
    const sx = (x: number) => view.x + x * view.zoom;
    const sy = (y: number) => view.y + y * view.zoom;
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(sx(0)) + 0.5, Math.round(sy(0)) + 0.5, Math.round(doc.width * view.zoom), Math.round(doc.height * view.zoom));
    if (active && active.visible && !editingText) {
      const b = layerBox(active);
      if (b) {
        ctx.strokeStyle = '#d4f25a';
        ctx.lineWidth = 1;
        ctx.strokeRect(sx(b.x) + 0.5, sy(b.y) + 0.5, b.w * view.zoom, b.h * view.zoom);
        if (tool === 'move' && !active.locked) {
          ctx.fillStyle = '#0a0a0b';
          for (const [hx, hy] of corners(b)) {
            ctx.fillRect(sx(hx) - HANDLE / 2, sy(hy) - HANDLE / 2, HANDLE, HANDLE);
            ctx.strokeRect(sx(hx) - HANDLE / 2 + 0.5, sy(hy) - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
          }
        }
      }
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
    if (cursor && (tool === 'brush' || tool === 'eraser')) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(sx(cursor.x), sy(cursor.y), Math.max(2, (brush.size / 2) * view.zoom), 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [doc, size, view, active, tool, preview, cursor, brush.size, shapeStyle, editingText, rv]);

  // ---------------------------------------------------------------------------
  // Keyboard

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
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

    if (tool === 'move') {
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
            drag.current = { kind: 'move', layerId: act.id, startX: p.x, startY: p.y, base: act };
            return;
          }
        }
      }
      const hit = hitTest(current, p.x, p.y);
      setActiveLayer(sessionId, doc.id, hit?.id ?? null);
      if (hit && !hit.locked) {
        record(current);
        drag.current = { kind: 'move', layerId: hit.id, startX: p.x, startY: p.y, base: hit };
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
      beginEdit(target);
      drag.current = { kind: 'paint', layerId: target.id, last: p, erase };
      paintSegment(target, p, p, erase);
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
    strokeSegment(ctx, { x: (a.x - layer.x) * kx, y: (a.y - layer.y) * ky }, { x: (b.x - layer.x) * kx, y: (b.y - layer.y) * ky }, {
      width: (brush.size * (kx + ky)) / 2,
      color: brush.color,
      opacity: brush.opacity,
      erase,
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toDoc(e.clientX, e.clientY);
    if (tool === 'brush' || tool === 'eraser') setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, x: d.vx + (e.clientX - d.sx), y: d.vy + (e.clientY - d.sy) }));
    } else if (d.kind === 'move') {
      const moved = translateLayer(d.base, p.x - d.startX, p.y - d.startY);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => (l.id === d.layerId ? moved : l)) }));
    } else if (d.kind === 'scale') {
      const k = Math.max(0.02, Math.hypot(p.x - d.ax, p.y - d.ay) / d.startDist);
      const scaled = scaleLayer(d.base, k, k, d.ax, d.ay);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, layers: dd.layers.map((l) => (l.id === d.layerId ? scaled : l)) }));
    } else if (d.kind === 'paint') {
      const layer = getDoc(sessionId, doc.id)?.layers.find((l) => l.id === d.layerId);
      if (layer) paintSegment(layer, d.last, p, d.erase);
      d.last = p;
      window.dispatchEvent(new Event('ogs:paint'));
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

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'paint') {
      commitEdit(d.layerId);
      setDoc(sessionId, doc.id, (dd) => ({ ...dd, updatedAt: Date.now(), layers: dd.layers.map((l) => (l.id === d.layerId && l.type === 'raster' ? { ...l, rev: l.rev + 1 } : l)) }));
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
