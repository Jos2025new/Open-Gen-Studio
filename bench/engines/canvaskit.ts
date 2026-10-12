import CanvasKitInit from 'canvaskit-wasm/full';
import wasmUrl from 'canvaskit-wasm/bin/full/canvaskit.wasm?url';
import { fxPlan } from '../../src/engine/fx/plan';
import type { DesignDoc, Layer, RasterLayer, RasterStroke } from '../../src/engine/types';
import type { FxLayer } from '../../src/engine/fx/types';
import type { Engine, View } from './types';
import type { Scene } from './scene';

/*
 * CanvasKit (Skia in wasm, canvaskit-wasm 0.42, Tarea 2). Layers are images, strokes are round-capped paths (the tip
 * hardness is not reproduced: hard strokes only), vectors use Skia primitives, and FX are image/colour filters: blur
 * and drop shadow are real image filters; saturation and hue are exact colour matrices; levels and curves are
 * approximated by one linear map (0.42 has no table filter or runtime effects). Glow is a screened blur.
 */

const FX_MAX_PX = 16_000_000;
const hexColor = (hex: string) => { const n = parseInt(hex.replace('#', ''), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const saturateM = (a: number) => [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a, 0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a];
const hueM = (deg: number) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283, 0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072]; };
/** A 4x5 colour matrix from a 3x3 one (row-major) with an offset column. */
const matrix20 = (m3: number[], off = [0, 0, 0]) => [m3[0], m3[1], m3[2], 0, off[0], m3[3], m3[4], m3[5], 0, off[1], m3[6], m3[7], m3[8], 0, off[2], 0, 0, 0, 1, 0];

export function canvaskitEngine(): Engine {
  let CK: any, surface: any, stage: any, bytes = 0;
  /** Objects that own memory (surfaces, snapshots, paints, images, paths): deleted after each frame or on dispose. */
  let garbage: Array<{ delete(): void }> = [];
  let longLived: Array<{ delete(): void }> = [];
  const t = <T extends { delete(): void }>(x: T): T => { garbage.push(x); return x; };
  const freeGarbage = () => { for (const g of garbage) g.delete(); garbage = []; };
  const images = new WeakMap<HTMLCanvasElement, any>();
  const paths = new WeakMap<RasterStroke, any>();
  let scene: Scene;
  const info = (w: number, h: number) => ({ width: w, height: h, colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Premul, colorSpace: CK.ColorSpace.SRGB });
  const imageOf = (c: HTMLCanvasElement) => {
    let img = images.get(c);
    if (!img) { img = CK.MakeImageFromCanvasImageSource(c); images.set(c, img); longLived.push(img); bytes += c.width * c.height * 4; }
    return img;
  };
  const pathOf = (s: RasterStroke) => {
    let p = paths.get(s);
    if (!p) {
      // 0.42 builds paths with PathBuilder (moveTo/lineTo) and detaches the finished Path.
      const pb = new CK.PathBuilder();
      for (const [ax, ay, bx, by] of s.segments) { pb.moveTo(ax + s.x, ay + s.y); pb.lineTo(bx + s.x, by + s.y); }
      p = pb.detach(); pb.delete();
      paths.set(s, p); longLived.push(p);
    }
    return p;
  };
  const colorPaint = (hex: string, alpha: number, width?: number) => {
    const paint = t(new CK.Paint()); const [r, g, b] = hexColor(hex);
    paint.setColor(CK.Color4f(r, g, b, alpha)); paint.setAntiAlias(true);
    if (width !== undefined) { paint.setStyle(CK.PaintStyle.Stroke); paint.setStrokeWidth(width); paint.setStrokeCap(CK.StrokeCap.Round); paint.setStrokeJoin(CK.StrokeJoin.Round); }
    return paint;
  };
  /** One filter op applied to a surface's content, into a new surface (the source is kept by the caller). */
  const filterOp = (src: any, op: { kind: string; enabled: boolean; params: Record<string, number | string> }, scale: number, W: number, H: number) => {
    if (!op.enabled) return src;
    const num = (k: string, d: number) => Number(op.params[k] ?? d);
    const dst = t(src.makeSurface(info(W, H))); const c = dst.getCanvas();
    const snap = t(src.makeImageSnapshot());
    const paint = t(new CK.Paint());
    if (op.kind === 'blur') {
      const s = Math.max(0.01, num('radius', 4) * scale);
      paint.setImageFilter(CK.ImageFilter.MakeBlur(s, s, CK.TileMode.Clamp, null));
    } else if (op.kind === 'shadow') {
      const [r, g, b] = hexColor(String(op.params.color ?? '#000000'));
      const sg = Math.max(0.01, (num('blur', 12) * scale) / 2);
      paint.setImageFilter(CK.ImageFilter.MakeDropShadow(num('x', 8) * scale, num('y', 8) * scale, sg, sg, CK.Color4f(r, g, b, num('opacity', 0.6)), null));
    } else if (op.kind === 'saturation') {
      paint.setColorFilter(CK.ColorFilter.MakeMatrix(matrix20(saturateM(num('amount', 1)))));
    } else if (op.kind === 'hue') {
      paint.setColorFilter(CK.ColorFilter.MakeMatrix(matrix20(hueM(num('degrees', 0)))));
    } else if (op.kind === 'levels' || op.kind === 'curves') {
      // One linear map through the tone points: a stand-in for OGS's table (not reproduced exactly).
      let a: number, b: number;
      if (op.kind === 'levels') { const lo = num('inBlack', 0), hi = Math.max(lo + 1e-3, num('inWhite', 1)); a = 1 / (hi - lo); b = -lo * a; }
      else { const ys = num('shadows', 0.25), ym = num('midtones', 0.5), yh = num('highlights', 0.75); a = (yh - ys) / 0.5; b = ym - a * 0.5; }
      paint.setColorFilter(CK.ColorFilter.MakeMatrix(matrix20([a, 0, 0, 0, a, 0, 0, 0, a], [b, b, b])));
    } else if (op.kind === 'glow') {
      const sg = Math.max(0.01, num('radius', 12) * scale), glow = t(new CK.Paint());
      c.drawImage(snap, 0, 0, t(new CK.Paint()));
      glow.setImageFilter(CK.ImageFilter.MakeBlur(sg, sg, CK.TileMode.Clamp, null));
      glow.setAlphaf(num('strength', 0.8)); glow.setBlendMode(CK.BlendMode.Screen);
      c.drawImage(snap, 0, 0, glow);
      return dst;
    }
    c.drawImage(snap, 0, 0, paint);
    return dst;
  };
  const chain = (src: any, ops: Array<{ kind: string; enabled: boolean; params: Record<string, number | string> }>, scale: number, W: number, H: number) => {
    let cur = src;
    for (const op of ops) cur = filterOp(cur, op, scale, W, H);
    return cur;
  };
  const drawLayerContent = (c: any, l: RasterLayer, scale: number, opacity: number) => {
    const base = scene.bases.get(l.id);
    if (base) {
      const paint = t(new CK.Paint()); paint.setAlphaf(opacity);
      c.drawImageRect(imageOf(base), CK.LTRBRect(0, 0, base.width, base.height), CK.LTRBRect(l.x * scale, l.y * scale, (l.x + l.width) * scale, (l.y + l.height) * scale), paint);
    }
    for (const s of l.paintStrokes ?? []) {
      // The path is drawn in document px under c.scale(scale): its width stays in document px too.
      const paint = colorPaint(s.color, s.opacity * opacity, s.segments[0]?.[4] ?? 1);
      if (s.tip?.blend === 'multiply') paint.setBlendMode(CK.BlendMode.Multiply);
      c.save(); c.scale(scale, scale); c.drawPath(pathOf(s), paint); c.restore();
    }
  };
  const drawVector = (c: any, l: Extract<Layer, { type: 'vector' }>, scale: number, opacity: number) => {
    for (const sh of l.shapes) {
      const x0 = Math.min(sh.x, sh.x + sh.w) * scale, y0 = Math.min(sh.y, sh.y + sh.h) * scale, x1 = Math.max(sh.x, sh.x + sh.w) * scale, y1 = Math.max(sh.y, sh.y + sh.h) * scale;
      const r = CK.LTRBRect(x0, y0, x1, y1);
      if (sh.fill) { const p = colorPaint(sh.fill, opacity); if (sh.type === 'ellipse') c.drawOval(r, p); else c.drawRect(r, p); }
      if (sh.stroke) {
        const p = colorPaint(sh.stroke, opacity, Math.max(1, sh.strokeWidth * scale));
        if (sh.type === 'ellipse') c.drawOval(r, p); else if (sh.type === 'line') c.drawLine(x0, y0, x1, y1, p); else c.drawRect(r, p);
      }
    }
  };
  const pageInto = (doc: DesignDoc, scale: number) => {
    const W = Math.max(1, Math.floor(doc.width * scale)), H = Math.max(1, Math.floor(doc.height * scale));
    const acc = t(surface.makeSurface(info(W, H))); const c = acc.getCanvas();
    c.clear(doc.background ? CK.Color4f(...hexColor(doc.background), 1) : CK.Color4f(0, 0, 0, 0));
    for (const s of fxPlan(doc.layers)) {
      if (s.t === 'draw') {
        if (s.layer.type === 'raster') drawLayerContent(c, s.layer, scale, s.layer.opacity);
        else drawVector(c, s.layer, scale, s.layer.opacity);
      } else if (s.t === 'below') {
        const next = chain(acc, (s.fx as FxLayer).ops, scale, W, H);
        if (next !== acc) { c.clear(CK.Color4f(0, 0, 0, 0)); c.drawImage(t(next.makeImageSnapshot()), 0, 0); }
      } else {
        const own = t(surface.makeSurface(info(W, H))); const oc = own.getCanvas();
        oc.clear(CK.Color4f(0, 0, 0, 0));
        if (s.layer.type === 'raster') drawLayerContent(oc, s.layer, scale, 1);
        let cur = own;
        for (const fx of s.fx) cur = chain(cur, fx.ops, scale, W, H);
        const paint = t(new CK.Paint()); paint.setAlphaf(s.layer.opacity);
        c.drawImage(t(cur.makeImageSnapshot()), 0, 0, paint);
      }
    }
    return { acc, W, H };
  };
  const scaleOf = (doc: DesignDoc, zoom: number) => Math.min(zoom, Math.sqrt(FX_MAX_PX / Math.max(1, doc.width * doc.height)));

  return {
    name: 'canvaskit',
    async init(sc, cv) {
      scene = sc;
      CK = await CanvasKitInit({ locateFile: () => wasmUrl });
      surface = CK.MakeWebGLCanvasSurface(cv);
      if (!surface) throw new Error('CanvasKit WebGL surface unavailable');
      stage = surface;
      for (const [, base] of sc.bases) imageOf(base);
    },
    layerChanged() { /* images and paths are keyed by canvas and stroke objects: changes create new keys */ },
    render(doc, view: View) {
      const scale = scaleOf(doc, view.zoom);
      const { acc, W, H } = pageInto(doc, scale);
      const c = stage.getCanvas();
      c.clear(CK.Color4f(0, 0, 0, 0));
      const paint = t(new CK.Paint());
      c.drawImageRect(t(acc.makeImageSnapshot()), CK.LTRBRect(0, 0, W, H), CK.LTRBRect(view.x, view.y, view.x + doc.width * view.zoom, view.y + doc.height * view.zoom), paint);
      stage.flush();
      freeGarbage();
    },
    sync() { stage.flush(); const img = stage.makeImageSnapshot(CK.LTRBRect(0, 0, 1, 1)); img.readPixels(0, 0, info(1, 1)); img.delete(); },
    fullPage(doc) {
      const { acc, W, H } = pageInto(doc, 1);
      const img = t(acc.makeImageSnapshot());
      const px = img.readPixels(0, 0, info(W, H));
      const out = new Uint8ClampedArray(px.buffer ?? px);
      freeGarbage();
      return out;
    },
    dispose() {
      freeGarbage();
      for (const o of longLived) o.delete();
      longLived = [];
      stage?.delete?.();
    },
    textureBytes: () => bytes,
  };
}
