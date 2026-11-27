import { hexShown } from '../../../lib/color';
import { cornerRadii, paintOpacity, paintOpacityPatch, traceRoundRect } from '../../../engine/design/shapeLook';
import { CornerToolFields, EllipseToolFields, LineToolFields } from '../ShapeKindFields';
import { drawShape } from '../../../engine/design/drawShape';
import type { DesignTool } from '../../../engine/design/rules';
import { useStore, setUi, type UiState } from '../../../store/store';
import { pathBox, toolPath, type PathTool } from '../../../engine/design/shapeTools';
import { PRIM_TOOLS, placedPath, primFromUi, primShape } from '../../../engine/design/primitives';
import { boxShape } from '../../../engine/design/shapeDraw';
import { snapAngle } from '../../../engine/design/selectGeometry';
import type { View } from '../../../engine/design/viewCoordinates';
import { uid } from '../../../lib/id';
import { ShapeLookFields } from '../ShapeLookFields';
import { tokenPatch, tokenOf } from '../../../engine/design/tokenBind';
import { InlineColor, InlineSlider } from '../InlineControls';
import type { ComponentType } from 'react';
import type { GestureMap, ToolDescriptor } from './types';

export type ShapeDrag = {
  kind: 'shape';
  tool: ShapeTool;
  strokeOnly: boolean;
  customPath?: PathTool;
  trace?: ShapeOptions['trace'];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type ShapeTool = Extract<DesignTool,
  'rect' | 'ellipse' | 'polygon' | 'star' | 'sector' | 'arc' | 'chord' | 'line' | 'curve' | 'arrow'>;

type ShapeOptions = {
  strokeOnly?: boolean;
  customPath?: PathTool;
  trace?: (path: Path2D, drag: ShapeDrag, style: UiState['shape'], box: { x: number; y: number; w: number; h: number }) => void;
  fields?: ComponentType;
  fill?: boolean;
  corners?: boolean;
};

function shapeTool(tool: ShapeTool, { strokeOnly = false, customPath, trace, fields: Fields, fill = true, corners = false }: ShapeOptions = {}): ToolDescriptor {
  return {
    quick: fill ? ['strokeWidth', 'stroke', 'fill'] : ['strokeWidth', 'stroke'],
    down({ state: { drag, setPreview }, p }) {
      drag.current = { kind: 'shape', tool, strokeOnly, customPath, trace, x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      setPreview(drag.current);
    },
    settings: ({ compact }) => <ShapeSettings compact={compact} fill={fill} corners={corners} fields={Fields} />,
  };
}

export function ShapeSettings({ compact, fill = true, corners = false, fields: Fields }: { compact?: boolean; fill?: boolean; corners?: boolean; fields?: ComponentType }) {
  const shape = useStore((s) => s.ui.shape);
  return <>
    {fill && <InlineColor label={shape.fill === null ? "Fill · none" : "Fill"} value={shape.fill ?? '#d4f25a'} showValue alpha={{ value: paintOpacity(shape, 'fill'), onChange: (o) => setUi({ shape: { ...shape, ...paintOpacityPatch('fill', o) } }) }} token={tokenOf(shape, 'fill')} onChange={(c, t, p) => setUi({ shape: { ...shape, ...tokenPatch('fill', c, t, p) } })}><label className="check-row"><input type="checkbox" checked={shape.fill === null} onChange={(e) => setUi({ shape: { ...shape, fill: e.target.checked ? null : '#d4f25a' } })} />No fill</label></InlineColor>}
    <InlineColor label={shape.stroke === null ? "Stroke · none" : "Stroke"} value={shape.stroke ?? '#ffffff'} showValue alpha={{ value: paintOpacity(shape, 'stroke'), onChange: (o) => setUi({ shape: { ...shape, ...paintOpacityPatch('stroke', o) } }) }} token={tokenOf(shape, 'stroke')} onChange={(c, t, p) => setUi({ shape: { ...shape, ...tokenPatch('stroke', c, t, p) } })}><label className="check-row"><input type="checkbox" checked={shape.stroke === null} onChange={(e) => setUi({ shape: { ...shape, stroke: e.target.checked ? null : '#ffffff' } })} />No stroke</label></InlineColor>
    <InlineSlider label="Width" unit="px" min={1} max={40} value={shape.strokeWidth} onChange={(v) => setUi({ shape: { ...shape, strokeWidth: v } })} />
    {Fields && <Fields />}
    <ShapeLookFields value={shape} corners={corners} compact={compact} onChange={(p) => setUi({ shape: { ...shape, ...p } })} />
  </>;
}

export const shapeGestures = {
  shape: {
    move({ state, d, p, e }) {
      const { setPreview } = state;
      let x1 = p.x;
      let y1 = p.y;
      if (e.shiftKey) {
        if (d.strokeOnly) {
          ({ x: x1, y: y1 } = snapAngle({ x: d.x0, y: d.y0 }, p));
        } else {
          const s = Math.max(Math.abs(x1 - d.x0), Math.abs(y1 - d.y0));
          x1 = d.x0 + Math.sign(x1 - d.x0 || 1) * s;
          y1 = d.y0 + Math.sign(y1 - d.y0 || 1) * s;
        }
      }
      d.x1 = x1;
      d.y1 = y1;
      setPreview({ ...d });
    },
    up({ state, d }) {
      const { doc, sessionId, view, setPreview, shapeStyle } = state;
      setPreview(null);
      const w = d.x1 - d.x0;
      const h = d.y1 - d.y0;
      if (Math.hypot(w, h) * view.zoom < 4) return;
      const lineLike = d.strokeOnly;
      const pfit = PRIM_TOOLS.has(d.tool) ? primShape(d.x0, d.y0, d.x1, d.y1, primFromUi(d.tool, shapeStyle)) : null;
      const d0 = !pfit && d.customPath ? toolPath(d.customPath, d.x0, d.y0, d.x1, d.y1, { sides: shapeStyle.sides ?? 5, bend: (shapeStyle.bend ?? 30) / 100, strokeWidth: Math.max(1, shapeStyle.strokeWidth) }) : null;
      const pbox = d0 ? pathBox(d0) : null;
      if (d0 && !pbox) return;
      // Stroke style of the next shape (ShapeLookFields); corners only for rectangles.
      const { join, cap, miter, dash, dashOffset, paintOrder } = shapeStyle;
      const look = { join, cap, miter, dash, dashOffset, paintOrder, fillToken: lineLike ? undefined : shapeStyle.fillToken, fillOpacity: lineLike ? undefined : shapeStyle.fillOpacity, strokeToken: lineLike && !shapeStyle.stroke ? shapeStyle.fillToken : shapeStyle.strokeToken, strokeOpacity: lineLike && !shapeStyle.stroke ? shapeStyle.fillOpacity : shapeStyle.strokeOpacity, ...(d.tool === 'rect' ? { radiusToken: shapeStyle.radiusToken } : {}) };
      const shape = pfit || pbox ? {
        id: uid('shp'),
        ...(pfit ?? { type: 'path' as const, d: d0!, box0: pbox!, ...pbox! }),
        fill: lineLike ? null : shapeStyle.fill,
        stroke: lineLike ? shapeStyle.stroke ?? shapeStyle.fill ?? '#ffffff' : shapeStyle.stroke,
        strokeWidth: lineLike ? Math.max(1, shapeStyle.strokeWidth) : shapeStyle.stroke ? shapeStyle.strokeWidth : 0,
        radius: 0,
        ...look,
      } : boxShape(uid('shp'), d.tool as 'rect' | 'ellipse' | 'line', d.x0, d.y0, d.x1, d.y1, shapeStyle, look);
      // Inside the active layer, or a new one when that cannot take it; the shape stays picked (drawShape.ts).
      drawShape(sessionId, doc.id, shape);
    },
  },
} satisfies Partial<GestureMap>;

export function drawShapePreview(ctx: CanvasRenderingContext2D, view: View, preview: ShapeDrag, shapeStyle: UiState['shape']) {
  const { strokeOnly, customPath, trace } = preview;
  const x = Math.min(preview.x0, preview.x1);
  const y = Math.min(preview.y0, preview.y1);
  const w = Math.abs(preview.x1 - preview.x0);
  const h = Math.abs(preview.y1 - preview.y0);
  ctx.save();
  ctx.translate(view.x, view.y);
  ctx.scale(view.zoom, view.zoom);
  ctx.globalAlpha = 0.85;
  const lineLike = strokeOnly;
  const previewFit = PRIM_TOOLS.has(preview.tool) ? primShape(preview.x0, preview.y0, preview.x1, preview.y1, primFromUi(preview.tool, shapeStyle)) : null;
  const path = previewFit ? placedPath(previewFit) : customPath
    ? new Path2D(toolPath(customPath, preview.x0, preview.y0, preview.x1, preview.y1, { sides: shapeStyle.sides ?? 5, bend: (shapeStyle.bend ?? 30) / 100, strokeWidth: shapeStyle.strokeWidth }))
    : new Path2D();
  trace?.(path, preview, shapeStyle, { x, y, w, h });
  if (!lineLike && shapeStyle.fill) {
    ctx.fillStyle = hexShown(shapeStyle.fill, shapeStyle.fillOpacity);
    ctx.fill(path);
  }
  ctx.strokeStyle = shapeStyle.stroke ? hexShown(shapeStyle.stroke, shapeStyle.strokeOpacity) : lineLike ? hexShown(shapeStyle.fill ?? '#ffffff', shapeStyle.fillOpacity) : 'rgba(212,242,90,0.6)';
  ctx.lineWidth = (lineLike || shapeStyle.stroke ? shapeStyle.strokeWidth : 1) || 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

export const rect = shapeTool('rect', {
  corners: true,
  trace(path, _drag, style, box) {
    const r = cornerRadii({ ...style, w: box.w, h: box.h });
    traceRoundRect(path, box, r.rx, r.ry);
  },
});

export const ellipse = shapeTool('ellipse', {
  trace(path, _drag, _style, { x, y, w, h }) {
    path.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  },
  fields: () => <EllipseToolFields tool="ellipse" />,
});

export const polygon = shapeTool('polygon', {
  fields: () => <CornerToolFields tool="polygon" />,
});

export const star = shapeTool('star', {
  fields: () => <CornerToolFields tool="star" />,
});

export const sector = shapeTool('sector', {
  fields: () => <EllipseToolFields tool="sector" />,
});

export const arc = shapeTool('arc', {
  strokeOnly: true,
  fields: () => <EllipseToolFields tool="arc" />,
});

export const chord = shapeTool('chord', {
  fields: () => <EllipseToolFields tool="chord" />,
});

export const line = shapeTool('line', {
  trace(path, { x0, y0, x1, y1 }) {
    path.moveTo(x0, y0);
    path.lineTo(x1, y1);
  },
  strokeOnly: true,
  fill: false,
  fields: () => <LineToolFields tool="line" />,
});

function BendField() {
  const shape = useStore((s) => s.ui.shape);
  return <span data-tip="How far the curve bows from the straight line; negative bows to the other side"><InlineSlider label="Bend" unit="%" min={-100} max={100} value={shape.bend ?? 30} onChange={(v) => setUi({ shape: { ...shape, bend: v } })} /></span>;
}

export const curve = shapeTool('curve', {
  strokeOnly: true,
  fill: false,
  customPath: 'curve',
  fields: BendField,
});

export const arrow = shapeTool('arrow', {
  strokeOnly: true,
  fill: false,
  customPath: 'arrow',
  fields: () => <LineToolFields tool="arrow" />,
});
