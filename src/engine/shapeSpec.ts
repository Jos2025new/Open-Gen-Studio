import type { PrimSpec } from './design/primitives';
import type { MarkerKind } from './design/markers';

/** A vector shape. Look fields are optional: shapes saved before them keep their look (design/shapeLook.ts). */
export interface ShapeSpec {
  type: 'rect' | 'ellipse' | 'line' | 'path';
  /** path: SVG path data in absolute commands, in its own coordinates (`box0`), mapped onto x/y/w/h. */
  d?: string;
  box0?: { x: number; y: number; w: number; h: number };
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  /** fill-opacity / stroke-opacity (0–1) as in SVG; absent = 1, so older documents are unchanged. */
  fillOpacity?: number;
  strokeOpacity?: number;
  /** Legacy single corner radius; `rx`/`ry` win when set (one set copies to the other, as in SVG). */
  radius: number;
  rx?: number;
  ry?: number;
  join?: 'miter' | 'round' | 'bevel';
  cap?: 'butt' | 'round' | 'square';
  miter?: number;
  /** Dash pattern and offset in stroke widths. */
  dash?: number[];
  dashOffset?: number;
  /** Even-odd fill rule (SVG fill-rule); absent = nonzero. */
  fillRule?: 'evenodd';
  /** 'stroke': stroke painted under the fill. */
  paintOrder?: 'stroke';
  /** Gaussian blur σ in page px (Inkscape's stdDeviation); the panel shows it as Inkscape's blur %. */
  blur?: number;
  /** Rectangle/ellipse turned or skewed: the linear part [a, b, c, d] about the shape's centre (design/shapeTransform.ts). */
  rot?: [number, number, number, number];
  /** Path node types as Inkscape's sodipodi:nodetypes (c cusp, s smooth, z symmetric; design/pathNodes.ts). */
  nodeTypes?: string;
  /** Parametric primitive (design/primitives.ts): its parameters; `d` is rebuilt from them. Absent = plain path. */
  prim?: PrimSpec;
  /** Arrowheads at the first and last point of a line or path (design/markers.ts). Absent = none. */
  markerStart?: MarkerKind;
  markerEnd?: MarkerKind;
  /** Stroke width follows the shape's scale (paths); absent = the stroke keeps its width when scaled. */
  scaleStroke?: boolean;
}
