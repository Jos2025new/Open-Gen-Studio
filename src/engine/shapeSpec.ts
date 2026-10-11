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
  /** 'stroke': stroke painted under the fill. */
  paintOrder?: 'stroke';
  /** Gaussian blur σ in page px (Inkscape's stdDeviation); the panel shows it as Inkscape's blur %. */
  blur?: number;
  /** Rectangle/ellipse turned or skewed: the linear part [a, b, c, d] about the shape's centre (design/shapeTransform.ts). */
  rot?: [number, number, number, number];
  /** Path node types as Inkscape's sodipodi:nodetypes (c cusp, s smooth, z symmetric; design/pathNodes.ts). */
  nodeTypes?: string;
}
