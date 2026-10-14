// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { importSvg } from '../src/engine/design/svgImport';
import type { Rasterizer } from '../src/engine/design/svgImport/rasterize';
import { gradientStyle, elementMatrix } from '../src/engine/design/gradientPaint';
import { shapeSvg } from '../src/engine/design/export';
import { shapeMatrix } from '../src/engine/design/shapeTransform';
import type { GradientPaint, ShapeSpec } from '../src/engine/shapeSpec';
import type { VectorShape } from '../src/engine/types';

const noRaster: Rasterizer = async (item, page) => {
  const box = { x: Math.max(0, item.hint.x), y: Math.max(0, item.hint.y), w: Math.min(item.hint.w, page.width), h: item.hint.h };
  return { box, canvas: { width: Math.ceil(box.w), height: Math.ceil(box.h) } as HTMLCanvasElement, engine: 'browser' };
};
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-3);
const svgOf = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200" viewBox="0 0 200 200">${body}</svg>`;

const linear: GradientPaint = { kind: 'linear', x1: 10, y1: 20, x2: 110, y2: 20, stops: [{ offset: 0, color: '#ff0000', alpha: 1 }, { offset: 1, color: '#0000ff', alpha: 0.5 }] };
const rect = (over: Partial<VectorShape> = {}): VectorShape => ({ id: 'r1', type: 'rect', x: 10, y: 20, w: 100, h: 50, fill: null, stroke: null, strokeWidth: 0, radius: 0, fillGradient: linear, ...over });

describe('gradients: import', () => {
  it('a userSpaceOnUse linear gradient becomes an editable paint in page coordinates, with its alpha stops', async () => {
    const svg = svgOf(`<defs><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="110" y2="20"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/></linearGradient></defs><rect x="10" y="20" width="100" height="50" fill="url(#g)"/>`);
    const res = await importSvg(svg, 't', noRaster);
    if ('error' in res) throw new Error(res.error);
    expect(res.report).toMatchObject({ editable: 1, rasterized: 0 });
    const s = (res.doc.layers[0] as { shapes: ShapeSpec[] }).shapes[0];
    expect(s.fillGradient?.kind).toBe('linear');
    near(s.fillGradient!.x1, 10); near(s.fillGradient!.x2, 110);
    expect(s.fillGradient!.stops[1]).toMatchObject({ offset: 1, color: '#0000ff', alpha: 0.5 });
  });

  it('a group transform moves the gradient with the shape, and a radial reads its radius from the centre', async () => {
    const svg = svgOf(`<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><g transform="translate(20 0)"><circle cx="50" cy="50" r="40" fill="url(#g)"/></g>`);
    const res = await importSvg(svg, 't', noRaster);
    if ('error' in res) throw new Error(res.error);
    const s = (res.doc.layers[0] as { shapes: ShapeSpec[] }).shapes[0];
    expect(s.fillGradient?.kind).toBe('radial');
    near(s.fillGradient!.x1, 70); near(s.fillGradient!.y1, 50);
    near(s.fillGradient!.x2, 110);
  });

  it('a gradient that inherits its stops by xlink:href is read; objectBoundingBox is rasterized as before', async () => {
    const inherit = svgOf(`<defs><linearGradient id="base"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#abcdef"/></linearGradient><linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="0" xlink:href="#base"/></defs><rect width="200" height="200" fill="url(#g)"/>`);
    const a = await importSvg(inherit, 't', noRaster);
    if ('error' in a) throw new Error(a.error);
    expect(a.report).toMatchObject({ editable: 1, rasterized: 0 });
    const bbox = svgOf(`<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="50" height="50" fill="url(#g)"/>`);
    const b = await importSvg(bbox, 't', noRaster);
    if ('error' in b) throw new Error(b.error);
    expect(b.report).toMatchObject({ editable: 0, rasterized: 1, reasons: { gradient: 1 } });
  });

  it('a radial with a moved focus is rasterized', async () => {
    const svg = svgOf(`<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="40" fx="30"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><circle cx="50" cy="50" r="40" fill="url(#g)"/>`);
    const res = await importSvg(svg, 't', noRaster);
    if ('error' in res) throw new Error(res.error);
    expect(res.report).toMatchObject({ editable: 0, rasterized: 1 });
  });
});

describe('gradients: SVG export and round trip', () => {
  it('a gradient fill is written as a linearGradient in the shape\'s coordinates and referenced by the fill', () => {
    const svg = shapeSvg(rect());
    expect(svg).toContain('<linearGradient id="g-r1-f" gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="110" y2="20">');
    expect(svg).toContain('fill="url(#g-r1-f)"');
    expect(svg).toContain('stop-opacity="0.5"');
  });

  it('a radial is written with its centre and a radius from the centre to the radius point', () => {
    const svg = shapeSvg(rect({ fillGradient: { kind: 'radial', x1: 60, y1: 45, x2: 90, y2: 45, stops: linear.stops } }));
    expect(svg).toContain('<radialGradient id="g-r1-f" gradientUnits="userSpaceOnUse" cx="60" cy="45" r="30">');
  });

  it('a turned rectangle writes the gradient in its own (turned) coordinates', () => {
    const s = rect({ rot: [0, 1, -1, 0] as [number, number, number, number] });
    const m = shapeMatrix(s);
    const svg = shapeSvg(s);
    // The start point in page space must map back to the exported local start.
    const local = svg.match(/x1="([-\d.]+)" y1="([-\d.]+)"/)!;
    const det = m[0] * m[3] - m[1] * m[2];
    const px = m[0] * +local[1] + m[2] * +local[2] + m[4], py = m[1] * +local[1] + m[3] * +local[2] + m[5];
    near(px, 10); near(py, 20); expect(Math.abs(det)).toBeGreaterThan(0);
  });

  it('export, then import again: the same gradient comes back in page coordinates', async () => {
    const back = await importSvg(svgOf(shapeSvg(rect())), 't', noRaster);
    if ('error' in back) throw new Error(back.error);
    const g = ((back.doc.layers[0] as { shapes: ShapeSpec[] }).shapes[0]).fillGradient!;
    near(g.x1, 10); near(g.y1, 20); near(g.x2, 110); near(g.y2, 20);
    expect(g.stops.map((s) => s.color)).toEqual(['#ff0000', '#0000ff']);
  });
});

describe('gradients: canvas', () => {
  it('the canvas gradient uses the shape\'s own coordinates (inverse of its turn), so it lands where the export puts it', () => {
    const calls: number[][] = [];
    const ctx = {
      createLinearGradient: (...a: number[]) => { calls.push(a); return { addColorStop: () => undefined } as unknown as CanvasGradient; },
    } as unknown as CanvasRenderingContext2D;
    const s = rect({ rot: [0, 1, -1, 0] as [number, number, number, number] });
    gradientStyle(ctx, linear, s);
    const [lx1, ly1] = calls[0];
    const m = elementMatrix(s);
    // Back to page space through the element's matrix must give the page start point.
    near(m[0] * lx1 + m[2] * ly1 + m[4], 10);
    near(m[1] * lx1 + m[3] * ly1 + m[5], 20);
  });
});
