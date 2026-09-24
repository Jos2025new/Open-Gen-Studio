import { uid } from '../../lib/id';
import type { DesignDoc, Layer, RasterLayer, TextLayer, TextStyle, VectorLayer, VectorShape, ShapeSpec } from '../types';

/* Pure document/layer operations for the Designer. Layers are ordered bottom → top. */

export const FONT_STACKS: Record<string, string> = {
  Inter: "'Inter Variable', Inter, system-ui, sans-serif",
  Grotesk: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  Serif: "Georgia, 'Times New Roman', serif",
  Display: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
  Condensed: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', sans-serif",
  Mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
};

export const FONT_NAMES = Object.keys(FONT_STACKS);

export function fontStack(name: string): string {
  return FONT_STACKS[name] ?? FONT_STACKS.Inter;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Inter',
  fontSize: 96,
  fontWeight: 700,
  color: '#ffffff',
  align: 'left',
  lineHeight: 1.1,
  letterSpacing: 0,
};

export const DOC_PRESETS: Array<{ id: string; label: string; width: number; height: number }> = [
  { id: 'square', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait 4:5', width: 1080, height: 1350 },
  { id: 'story', label: 'Story 9:16', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Landscape 16:9', width: 1920, height: 1080 },
  { id: 'poster', label: 'Poster 2:3', width: 1200, height: 1800 },
  { id: 'a4', label: 'A4 portrait', width: 1240, height: 1754 },
];

export function createDoc(name: string, width: number, height: number, background: string | null = '#101012'): DesignDoc {
  const now = Date.now();
  return { id: uid('doc'), name, width, height, background, layers: [], activeLayerId: null, createdAt: now, updatedAt: now };
}

const base = (name: string) => ({ id: uid('lyr'), name, visible: true, locked: false, opacity: 1, blend: 'normal' as const });

export function newRasterLayer(name: string, rect: { x: number; y: number; width: number; height: number }, px: { width: number; height: number }, sourceAssetId?: string): RasterLayer {
  return {
    ...base(name),
    type: 'raster',
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    pxWidth: Math.max(1, Math.round(px.width)),
    pxHeight: Math.max(1, Math.round(px.height)),
    rev: 0,
    sourceAssetId,
  };
}

export function newVectorLayer(name: string, shapes: ShapeSpec[] = []): VectorLayer {
  return { ...base(name), type: 'vector', shapes: shapes.map((s) => ({ ...s, id: uid('shp') })) };
}

export function newTextLayer(name: string, text: string, pos: { x: number; y: number; width: number }, style: Partial<TextStyle> = {}): TextLayer {
  return { ...base(name), type: 'text', ...DEFAULT_TEXT_STYLE, ...style, fontFamily: style.fontFamily && FONT_STACKS[style.fontFamily] ? style.fontFamily : DEFAULT_TEXT_STYLE.fontFamily, text, x: pos.x, y: pos.y, width: pos.width };
}

export function touch(doc: DesignDoc): DesignDoc {
  return { ...doc, updatedAt: Date.now() };
}

export function activeLayer(doc: DesignDoc | null | undefined): Layer | null {
  if (!doc) return null;
  return doc.layers.find((l) => l.id === doc.activeLayerId) ?? null;
}

/** Insert a layer. 'base' = position 0 (layer 1), 'above' = right above the active layer, 'top' = last. */
export function insertLayer(doc: DesignDoc, layer: Layer, where: 'base' | 'above' | 'top' = 'above'): DesignDoc {
  const layers = [...doc.layers];
  let idx = layers.length;
  if (where === 'base') idx = 0;
  else if (where === 'above') {
    const a = layers.findIndex((l) => l.id === doc.activeLayerId);
    idx = a >= 0 ? a + 1 : layers.length;
  }
  layers.splice(idx, 0, layer);
  return touch({ ...doc, layers, activeLayerId: layer.id });
}

export function updateLayer<T extends Layer>(doc: DesignDoc, id: string, patch: Partial<T>): DesignDoc {
  return touch({ ...doc, layers: doc.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) });
}

export function removeLayer(doc: DesignDoc, id: string): DesignDoc {
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx < 0) return doc;
  const layers = doc.layers.filter((l) => l.id !== id);
  const next = layers[Math.min(idx, layers.length - 1)] ?? null;
  return touch({ ...doc, layers, activeLayerId: doc.activeLayerId === id ? next?.id ?? null : doc.activeLayerId });
}

export function moveLayer(doc: DesignDoc, id: string, dir: 1 | -1): DesignDoc {
  const idx = doc.layers.findIndex((l) => l.id === id);
  const to = idx + dir;
  if (idx < 0 || to < 0 || to >= doc.layers.length) return doc;
  const layers = [...doc.layers];
  [layers[idx], layers[to]] = [layers[to], layers[idx]];
  return touch({ ...doc, layers });
}

export function reorderLayer(doc: DesignDoc, id: string, toIndex: number): DesignDoc {
  const idx = doc.layers.findIndex((l) => l.id === id);
  if (idx < 0) return doc;
  const layers = [...doc.layers];
  const [l] = layers.splice(idx, 1);
  layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, l);
  return touch({ ...doc, layers });
}

export function cloneLayer(layer: Layer): Layer {
  const id = uid('lyr');
  if (layer.type === 'vector') return { ...layer, id, name: `${layer.name} copy`, shapes: layer.shapes.map((s) => ({ ...s, id: uid('shp') })) };
  return { ...layer, id, name: `${layer.name} copy` };
}

export function translateLayer(layer: Layer, dx: number, dy: number): Layer {
  if (layer.type === 'vector') return { ...layer, shapes: layer.shapes.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })) };
  return { ...layer, x: layer.x + dx, y: layer.y + dy };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function shapeBox(s: ShapeSpec): Box {
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  const pad = s.type === 'line' ? Math.max(4, s.strokeWidth / 2) : 0;
  return { x: x - pad, y: y - pad, w: Math.abs(s.w) + pad * 2, h: Math.abs(s.h) + pad * 2 };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Scale a layer about an anchor point (used by the transform handles). */
export function scaleLayer(layer: Layer, sx: number, sy: number, ax: number, ay: number): Layer {
  const fx = (x: number) => ax + (x - ax) * sx;
  const fy = (y: number) => ay + (y - ay) * sy;
  if (layer.type === 'raster') {
    return { ...layer, x: fx(layer.x), y: fy(layer.y), width: Math.max(1, layer.width * sx), height: Math.max(1, layer.height * sy) };
  }
  if (layer.type === 'vector') {
    const k = Math.sqrt(Math.abs(sx * sy));
    return {
      ...layer,
      shapes: layer.shapes.map((s: VectorShape) => ({ ...s, x: fx(s.x), y: fy(s.y), w: s.w * sx, h: s.h * sy, strokeWidth: s.strokeWidth * k, radius: s.radius * k })),
    };
  }
  const k = Math.max(0.05, Math.sqrt(Math.abs(sx * sy)));
  // width 0 = auto width (the box follows the text).
  return { ...layer, x: fx(layer.x), y: fy(layer.y), width: layer.width > 0 ? Math.max(20, layer.width * sx) : 0, fontSize: Math.max(4, layer.fontSize * k) };
}

/** Fit an image of w×h into the doc: 'cover' fills, 'contain' fits inside, both centered. */
export function fitRect(docW: number, docH: number, w: number, h: number, mode: 'cover' | 'contain'): { x: number; y: number; width: number; height: number } {
  const s = mode === 'cover' ? Math.max(docW / w, docH / h) : Math.min(docW / w, docH / h);
  const width = w * s;
  const height = h * s;
  return { x: (docW - width) / 2, y: (docH - height) / 2, width, height };
}
