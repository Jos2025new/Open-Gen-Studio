import { parseTokenAlias } from '../libraryTokens';
import { parsePath } from '../design/path';
import { tokenChoices, tokenProblem, writtenStyle } from '../design/tokenBind';
import type { LayerStep, LayerType, ShapeSpec, StrokeSpec, TextStyle } from '../types';
import { num } from './shared';
import type { RawStep, StepEnv } from './env';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function color(v: unknown, fallback: string | null): string | null {
  if (v === null || v === 'none' || v === 'transparent') return null;
  return typeof v === 'string' && (HEX.test(v.trim()) || parseTokenAlias(v) !== null) ? v.trim() : fallback;
}

function normalizeTextStyle(s: Record<string, unknown> | undefined, own?: string): Partial<TextStyle> {
  if (!s) return {};
  const out: Partial<TextStyle> = {};
  const g = (a: string, b: string) => s[a] ?? s[b];
  if (g('font_family', 'fontFamily') != null) out.fontFamily = String(g('font_family', 'fontFamily'));
  const size = g('font_size', 'fontSize');
  if (parseTokenAlias(size) !== null) { if (!tokenProblem({ fontSize: size }, own)) Object.assign(out, writtenStyle({ fontSize: size as string }, own)); }
  else if (size != null) out.fontSize = Math.max(6, Math.min(800, num(g('font_size', 'fontSize'), 64)));
  if (g('font_weight', 'fontWeight') != null) out.fontWeight = Math.max(100, Math.min(900, Math.round(num(g('font_weight', 'fontWeight'), 600) / 100) * 100));
  if (typeof s.italic === 'boolean') out.italic = s.italic || undefined;
  const c = color(s.color, null);
  if (c) out.color = c;
  if (s.align === 'left' || s.align === 'center' || s.align === 'right') out.align = s.align;
  if (g('line_height', 'lineHeight') != null) out.lineHeight = Math.max(0.7, Math.min(3, num(g('line_height', 'lineHeight'), 1.15)));
  if (g('letter_spacing', 'letterSpacing') != null) out.letterSpacing = Math.max(-20, Math.min(80, num(g('letter_spacing', 'letterSpacing'), 0)));
  return out;
}

const MAX_AGENT_STROKES = 200;
const MAX_STROKE_POINTS = 2000;

/** Freehand strokes from the agent: points in document px, optional pressure 0–1. Invalid points are dropped. */
export function normalizeStrokes(raw: Array<Record<string, unknown>> | undefined, errors: string[] = [], where = 'layer'): StrokeSpec[] {
  const list = raw ?? [];
  if (list.length > MAX_AGENT_STROKES) errors.push(`${where}: at most ${MAX_AGENT_STROKES} strokes.`);
  return list.slice(0, MAX_AGENT_STROKES).flatMap((s, i) => {
    const pts = Array.isArray(s.points) ? s.points : [];
    if (pts.length > MAX_STROKE_POINTS) errors.push(`${where}: stroke ${i + 1} has more than ${MAX_STROKE_POINTS} points.`);
    const points = pts
      .slice(0, MAX_STROKE_POINTS)
      .filter((p): p is number[] => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map((p) => [Number(p[0]), Number(p[1]), p.length > 2 && Number.isFinite(Number(p[2])) ? Math.min(1, Math.max(0, Number(p[2]))) : 0.5] as [number, number, number]);
    if (!points.length) {
      errors.push(`${where}: stroke ${i + 1} needs "points" as [[x, y], …] or [[x, y, pressure], …].`);
      return [];
    }
    const pressure = pts.some((p) => Array.isArray(p) && p.length > 2);
    return [{ points, pressure, color: color(s.color, '#ffffff') ?? '#ffffff', size: Math.min(400, Math.max(0.5, num(s.size ?? s.width, 8))) }];
  });
}

export function normalizeShapes(raw: Array<Record<string, unknown>> | undefined, errors: string[] = [], where = 'layer', own?: string, mode?: string): ShapeSpec[] {
  const dimRef = (v: unknown) => {
    const alias = parseTokenAlias(v);
    if (alias === null) return null;
    const ref = tokenChoices('dimension', mode, own).find((c) => c.ref.token === alias)?.ref;
    return { alias, raw: String(v).trim(), ref };
  };
  return (raw ?? []).slice(0, 40).flatMap((s, i): ShapeSpec[] => {
    if (s.type === 'path') {
      const d = typeof s.d === 'string' ? s.d.trim() : '';
      const parsed = parsePath(d);
      if ('error' in parsed) {
        errors.push(`${where}: shape ${i + 1} path is invalid: ${parsed.error}.`);
        return [];
      }
      const b = parsed.box;
      return [{ type: 'path', d, box0: b, x: b.x, y: b.y, w: b.w, h: b.h, fill: color(s.fill, null), stroke: color(s.stroke, s.fill ? null : '#ffffff'), strokeWidth: Math.max(0, num(s.stroke_width ?? s.strokeWidth, s.fill ? 0 : 4)), radius: 0 }];
    }
    const type = s.type === 'ellipse' || s.type === 'line' ? s.type : 'rect';
    const rawW = s.w ?? s.width, wTok = dimRef(rawW);
    const rawR = s.radius ?? s.rx, rTok = dimRef(rawR);
    const w = wTok ? (wTok.ref ? Math.max(1, Number(wTok.ref.value)) : (wTok.raw as unknown as number)) : num(rawW, 100);
    const radius = rTok ? (rTok.ref ? Math.max(0, Number(rTok.ref.value)) : (rTok.raw as unknown as number)) : Math.max(0, num(rawR, 0));
    const rxPatch = rTok?.ref ? { rx: radius, ry: radius, radiusToken: rTok.ref } : (!rTok && s.rx != null ? { rx: Math.max(0, num(s.rx, 0)), ...(s.ry != null ? { ry: Math.max(0, num(s.ry, 0)) } : {}) } : {});
    return [{
      type,
      x: num(s.x, 0),
      y: num(s.y, 0),
      w,
      h: num(s.h ?? s.height, type === 'line' ? 0 : 100),
      fill: type === 'line' ? null : color(s.fill, '#ffffff'),
      stroke: color(s.stroke, type === 'line' ? '#ffffff' : null),
      strokeWidth: Math.max(0, num(s.stroke_width ?? s.strokeWidth, type === 'line' ? 4 : 0)),
      radius,
      ...rxPatch,
      ...(wTok?.ref ? { widthToken: wTok.ref } : {}),
    }];
  });
}

export async function normalizeLayer(s: RawStep, env: StepEnv): Promise<void> {
  const { ctx, errors, steps, expectImage } = env;
  const where = `Step ${s.id}`;
  const title = (s.title ?? '').trim() || s.id!;
  if (ctx.workspace !== 'designer') {
    errors.push(`${where}: layer steps are only valid in the Designer workspace.`);
    return;
  }
  const layerType = s.layer_type as LayerType;
  if (layerType !== 'raster' && layerType !== 'vector' && layerType !== 'text') {
    errors.push(`${where}: layer_type must be raster, vector or text.`);
    return;
  }
  const drawing = Boolean(s.strokes?.length);
  const target = s.target?.trim() || (layerType === 'raster' && !drawing ? 'base' : 'new');
  const strokes = drawing && layerType !== 'text' ? normalizeStrokes(s.strokes, errors, where) : undefined;
  if (drawing && layerType === 'text') errors.push(`${where}: text layers cannot take strokes; use a vector or raster layer.`);
  if (layerType === 'raster' && drawing) {
    // Painted strokes always go on a new layer: the user's own raster layers are never painted over.
    if (s.source) errors.push(`${where}: a raster layer takes either "source" or "strokes", not both.`);
    if (target !== 'new') errors.push(`${where}: painted strokes go on a new raster layer (target "new").`);
  } else if (layerType === 'raster') {
    if (!s.source) errors.push(`${where}: raster layers need "source" (an image step, asset:<id> or layer:<id>) or "strokes".`);
    else expectImage(s.source, where);
    if (target !== 'base' && target !== 'new') {
      const l = ctx.layer(target);
      if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
      else if (l.type !== 'raster') errors.push(`${where}: target layer "${target}" is ${l.type}; images can only be placed on raster layers.`);
    }
  } else {
    if (s.source) errors.push(`${where}: ${layerType} layers cannot take an image source; use a raster layer.`);
    if (target !== 'new') {
      const l = ctx.layer(target);
      if (!l) errors.push(`${where}: target layer "${target}" does not exist.`);
      else if (l.type !== layerType) errors.push(`${where}: target layer "${target}" is ${l.type}, not ${layerType}.`);
    }
    if (layerType === 'text' && !s.text?.trim()) errors.push(`${where}: text layers need "text".`);
    if (layerType === 'vector' && !s.shapes?.length && !drawing) errors.push(`${where}: vector layers need "shapes" or "strokes".`);
  }
  const tokens = tokenProblem([s.style, s.shapes, s.strokes], ctx.docKit?.());
  if (tokens) errors.push(`${where}: ${tokens}`);
  const step: LayerStep = {
    id: s.id!,
    kind: 'layer',
    title,
    layerType,
    source: layerType === 'raster' ? s.source : undefined,
    target,
    text: layerType === 'text' ? s.text?.trim() : undefined,
    style: layerType === 'text' ? normalizeTextStyle(s.style, ctx.docKit?.()) : undefined,
    box: s.box ? { x: num(s.box.x, 0), y: num(s.box.y, 0), width: num(s.box.width, 0) } : undefined,
    shapes: layerType === 'vector' ? normalizeShapes(s.shapes, errors, where, ctx.docKit?.()) : undefined,
    strokes,
  };
  steps.push(step);
}
