// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as resvg from '@resvg/resvg-wasm';
import type { DesignDoc, Layer, VectorLayer, VectorShape } from '../src/engine/types';
import { docToSvg, type SvgDeps } from '../src/engine/design/export';
import { groupAcrossLayers } from '../src/engine/design/groupAcross';

/*
 * Grouping across layers keeps the picture. The exported SVG of the document before and after is rasterized with the
 * real vector rasterizer (resvg) and compared pixel by pixel; the canvas painter is checked by what it composes.
 */
const scratch: Array<{ ops: string[] }> = [];
vi.mock('../src/lib/media', async (original) => ({
  ...await original<typeof import('../src/lib/media')>(),
  createCanvas: (w: number, h: number) => { const c = { width: w, height: h, ops: [] as string[] }; scratch.push(c); return c; },
  ctx2d: (c: { ops: string[] }) => recorder(c.ops, c),
}));
function recorder(ops: string[], canvas: unknown) {
  const state = { globalAlpha: 1, globalCompositeOperation: 'source-over' }, stack: Array<typeof state> = [];
  return new Proxy(state as Record<string, unknown>, {
    get: (t, k: string) => k in t ? t[k] : k === 'canvas' ? canvas : k === 'getTransform' ? () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })
      : k === 'save' ? () => stack.push({ ...state }) : k === 'restore' ? () => Object.assign(state, stack.pop())
      : k === 'drawImage' ? (src: unknown) => ops.push(`image#${scratch.indexOf(src as never)}@${state.globalAlpha}/${state.globalCompositeOperation}`)
      : () => undefined,
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
}
import { paintShapeTree, hasGroupLook } from '../src/engine/design/groupPaint';

const rect = (id: string, x: number, y: number, fill: string, extra: Partial<VectorShape> = {}): VectorShape => ({ id, type: 'rect', x, y, w: 40, h: 40, radius: 0, fill, stroke: null, strokeWidth: 0, ...extra } as VectorShape);
const vec = (id: string, shapes: VectorShape[], extra: Partial<VectorLayer> = {}): VectorLayer => ({ id, name: id, type: 'vector', visible: true, locked: false, opacity: 1, blend: 'normal', shapes, ...extra } as unknown as VectorLayer);
const docOf = (layers: Layer[]): DesignDoc => ({ id: 'D', name: 'D', width: 100, height: 100, background: null, activeLayerId: layers[0].id, createdAt: 0, updatedAt: 0, layers } as unknown as DesignDoc);
const deps: SvgDeps = { rasterHref: async () => null, layout: () => ({ lines: [], width: 0, lineHeightPx: 0 }), ascent: () => 0 };
const pixels = async (d: DesignDoc) => new resvg.Resvg(await docToSvg(d, deps)).render().pixels;
const worst = (a: Uint8Array, b: Uint8Array) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const grouped = (d: DesignDoc, picks: Array<{ layerId: string; ids: string[] }>) => { const r = groupAcrossLayers(d, picks); if (!r || 'error' in r) throw new Error(r?.error ?? 'not grouped'); return r.doc; };
/** The same grouping with the subgroups' opacity and blend thrown away: what "not keeping the look" would draw. */
const stripped = (d: DesignDoc): DesignDoc => ({ ...d, layers: d.layers.map((l) => (l.type === 'vector' ? { ...l, objectGroups: l.objectGroups?.map(({ opacity: _o, blend: _b, ...g }) => g) } : l)) });

beforeAll(async () => { await resvg.initWasm(readFileSync('node_modules/@resvg/resvg-wasm/index_bg.wasm')); });

describe('grouping across layers keeps the picture (SVG, rasterized)', () => {
  const back = vec('B', [rect('bg', 0, 0, '#3070c0', { w: 100, h: 100 })]);
  it('a source layer at 50 % multiply with two overlapping shapes looks the same inside the group', async () => {
    const before = docOf([back, vec('L1', [rect('a', 10, 10, '#ff0000'), rect('a2', 30, 30, '#ffff00')], { opacity: 0.5, blend: 'multiply' }), vec('L3', [rect('c', 50, 50, '#00ff00')])]);
    const after = grouped(before, [{ layerId: 'L1', ids: ['a', 'a2'] }, { layerId: 'L3', ids: ['c'] }]);
    const p0 = await pixels(before);
    expect(worst(p0, await pixels(after))).toBeLessThanOrEqual(1);
    // The comparison can tell: without the subgroup's opacity and blend the picture is another one.
    expect(worst(p0, await pixels(stripped(after)))).toBeGreaterThan(40);
  });
  it('a translucent top layer keeps its look too: it moves to a subgroup and the layer becomes plain', async () => {
    const before = docOf([back, vec('L1', [rect('a', 10, 10, '#ff0000')], { opacity: 0.5 }), vec('L3', [rect('c', 30, 30, '#00ff00', { stroke: '#000000', strokeWidth: 8 })], { opacity: 0.4, blend: 'screen' })]);
    const after = grouped(before, [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L3', ids: ['c'] }]);
    const p0 = await pixels(before);
    expect(worst(p0, await pixels(after))).toBeLessThanOrEqual(1);
    expect(worst(p0, await pixels(stripped(after)))).toBeGreaterThan(40);
  });
  it('the shapes of a hidden source layer come in hidden, not visible', async () => {
    const before = docOf([back, vec('L1', [rect('a', 10, 10, '#ff0000')], { visible: false }), vec('L2', [rect('b', 20, 20, '#ffffff')]), vec('L3', [rect('c', 50, 50, '#00ff00')])]);
    const after = grouped(before, [{ layerId: 'L1', ids: ['a'] }, { layerId: 'L2', ids: ['b'] }, { layerId: 'L3', ids: ['c'] }]);
    expect(worst(await pixels(before), await pixels(after))).toBeLessThanOrEqual(1);
    // Kept in the file as hidden (display:none), and gone from a file without hidden parts.
    expect(await docToSvg(after, deps)).toMatch(/display="none"[^>]*>(<[^>]*>)*<rect[^>]*#ff0000|<rect[^>]*display="none"[^>]*#ff0000/);
    expect(await docToSvg(after, deps, undefined, { hidden: false })).not.toContain('#ff0000');
  });
});

describe('the canvas painter composes a group with a look apart', () => {
  it('draws the members on a scratch canvas and lays it once with the group opacity and blend; plain shapes go straight', () => {
    const l = vec('L', [rect('a', 0, 0, '#f00', { groupId: 'g' }), rect('b', 10, 10, '#0f0', { groupId: 'g' }), rect('c', 50, 50, '#00f')], { objectGroups: [{ id: 'g', name: 'G', opacity: 0.5, blend: 'multiply' }] } as never);
    expect(hasGroupLook(l)).toBe(true);
    expect(hasGroupLook(vec('P', [], { objectGroups: [{ id: 'g', name: 'G' }] } as never))).toBe(false);
    const ops: string[] = [], target = { width: 100, height: 100 };
    const ctx = recorder(ops, target) as unknown as CanvasRenderingContext2D;
    paintShapeTree(ctx, l, l.shapes, (c, s) => (c === ctx ? ops : scratch[0].ops).push(`shape ${s.id}`), () => 'multiply');
    expect(scratch.length).toBe(1);
    expect(scratch[0].ops).toEqual(['shape a', 'shape b']);
    expect(ops).toEqual(['image#0@0.5/multiply', 'shape c']);
    // The target's own state is back afterwards.
    expect((ctx as unknown as { globalAlpha: number }).globalAlpha).toBe(1);
  });
  it('a group inside a group is composed on its own canvas and laid on its parent\'s', () => {
    const l = vec('L', [rect('a', 0, 0, '#f00', { groupId: 'in' }), rect('b', 10, 10, '#0f0', { groupId: 'out' })], { objectGroups: [{ id: 'out', name: 'O', opacity: 0.5 }, { id: 'in', name: 'I', parentId: 'out', opacity: 0.25 }] } as never);
    // The painter keeps one scratch canvas per depth: the first is the one the test above used.
    scratch[0].ops.length = 0;
    const ops: string[] = [];
    const ctx = recorder(ops, { width: 100, height: 100 }) as unknown as CanvasRenderingContext2D;
    const byCtx = new Map<unknown, string[]>();
    paintShapeTree(ctx, l, l.shapes, (c, s) => { const list = byCtx.get(c) ?? []; list.push(s.id); byCtx.set(c, list); }, () => 'source-over');
    expect(scratch.length).toBe(2);
    expect(ops).toEqual(['image#0@0.5/source-over']);
    expect(scratch[0].ops).toEqual(['image#1@0.25/source-over']);
    expect([...byCtx.values()].sort()).toEqual([['a'], ['b']]);
  });
});
