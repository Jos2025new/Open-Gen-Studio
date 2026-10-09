import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * FX on the canvas (ADR 0011). A recording canvas double: it keeps the order of passes, the ctx.filter of each draw,
 * its blend and alpha. Real pixels are a browser matter (checked in the sandbox); this pins down the pipeline.
 */
type Call = { canvas: number; fn: string; src?: number; filter?: string; op?: string; alpha?: number; args?: unknown[]; scale?: number };
const calls: Call[] = [];
let made = 0;
let readPixel = () => {};
function recordingCanvas(width: number, height: number, editor = false) {
  const id = ++made;
  const canvas = { id, width, height, classList: { contains: (name: string) => editor && name === 'stage-canvas' }, getContext: () => ctx };
  let m = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const state = { filter: 'none', globalCompositeOperation: 'source-over', globalAlpha: 1 };
  const saved: Array<typeof state> = [];
  const ctx: Record<string, unknown> = new Proxy(state as Record<string, unknown>, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key === 'canvas') return canvas;
      if (key === 'getTransform') return () => m;
      if (key === 'getImageData') return () => readPixel();
      if (key === 'setTransform') return (a: number, b: number, c: number, d: number, e: number, f: number) => { m = { a, b, c, d, e, f }; };
      if (key === 'save') return () => saved.push({ ...state });
      if (key === 'restore') return () => Object.assign(state, saved.pop());
      if (key === 'createRadialGradient') return (...args: unknown[]) => { calls.push({ canvas: id, fn: 'gradient', args }); return { addColorStop: () => undefined }; };
      if (key === 'drawImage') return (src: { id: number }, ...args: unknown[]) => calls.push({ canvas: id, fn: 'drawImage', src: src.id, filter: state.filter, op: state.globalCompositeOperation, alpha: state.globalAlpha, args, scale: m.a });
      return (...args: unknown[]) => calls.push({ canvas: id, fn: key, args, op: state.globalCompositeOperation });
    },
    set(target, key: string, value) { target[key] = value; return true; },
  });
  return canvas;
}
vi.mock('../src/lib/media', () => ({ createCanvas: (w: number, h: number) => recordingCanvas(Math.round(w), Math.round(h)), ctx2d: (c: { getContext: () => unknown }) => c.getContext(), canvasToBlob: async () => new Blob() }));
vi.mock('../src/lib/idb', () => ({ stateDb: { get: async () => undefined, set: async () => undefined }, cacheDb: { get: async () => undefined }, blobDb: { set: async () => undefined } }));

import { drawDoc } from '../src/engine/design/render';
import { applyFx, cssFilter, glowPasses, mixFx } from '../src/engine/fx/canvas';
import { newFxLayer, newFxOp } from '../src/engine/fx/commands';
import { createDoc, newVectorLayer } from '../src/engine/design/doc';
import type { DesignDoc } from '../src/engine/types';
import { awaitFrame, startTrace, stopTrace, type TraceEvent } from '../src/lib/trace';

const events: TraceEvent[] = [];
function recordTrace(domains: string[], deep = false) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    events.push(...String(init?.body).split('\n').map((line) => JSON.parse(line) as TraceEvent));
    return new Response(null, { status: 204 });
  });
  startTrace({ label: 'FX regression', domains, deep });
}
afterEach(() => { stopTrace(); events.length = 0; readPixel = () => {}; vi.restoreAllMocks(); });

const rect = { id: 's', type: 'rect' as const, x: 0, y: 0, w: 10, h: 10, fill: '#f00', stroke: null, strokeWidth: 0, radius: 0 };
function page(fx: ReturnType<typeof newFxLayer>[] = [], at = 1): DesignDoc {
  const a = { ...newVectorLayer('A', [rect]), id: 'a' }, b = { ...newVectorLayer('B', [rect]), id: 'b', opacity: 0.4, blend: 'screen' as const };
  const layers = [a, b];
  layers.splice(at, 0, ...(fx as never[]));
  return { ...createDoc('p', 200, 100), layers };
}
const view = (scale = 1) => { const c = recordingCanvas(400, 200); const x = c.getContext() as unknown as CanvasRenderingContext2D; x.setTransform(scale, 0, 0, scale, 0, 0); return { c, x }; };
beforeEach(() => { calls.length = 0; made = 0; });

describe('drawDoc with FX layers', () => {
  it.each([['fx', 'apply'], ['designer', 'change']])('records %s latency without the render domain', (domain, name) => {
    recordTrace([domain]);
    awaitFrame(domain, name);
    drawDoc(recordingCanvas(200, 100, true).getContext() as unknown as CanvasRenderingContext2D, page());
    stopTrace();
    expect(events).toContainEqual(expect.objectContaining({ d: domain, n: name, ms: expect.any(Number) }));
    expect(events.some((e) => e.d === 'render')).toBe(false);
  });
  it('without FX the page is drawn straight into the view (no off-screen canvas)', () => {
    const { x } = view();
    drawDoc(x, page());
    expect(made).toBe(1);
    expect(calls.some((c) => c.fn === 'drawImage')).toBe(false);
  });
  it('a "layer" FX filters only its layer, before that layer\'s own opacity and blend; lengths follow the view scale', () => {
    const blur = newFxLayer('filter', { scope: 'layer', ops: [newFxOp('blur', { radius: 3 })] });
    const { c, x } = view(2);
    drawDoc(x, page([blur], 2));
    // Canvases: view, page composite at 2× (400×200), B alone, B blurred.
    const filtered = calls.find((k) => k.fn === 'drawImage' && k.filter === 'blur(6px)')!;
    expect(filtered).toBeDefined();
    const onPage = calls.find((k) => k.fn === 'drawImage' && k.src === filtered.canvas)!;
    // Already at the composite's scale: drawn 1:1 (a scaled draw shrank the layer by the zoom, seen in the sandbox).
    expect(onPage).toMatchObject({ op: 'screen', alpha: 0.4, filter: 'none', scale: 1 });
    const last = calls.filter((k) => k.canvas === c.id && k.fn === 'drawImage').pop()!;
    expect(last.src).toBe(onPage.canvas);
    expect(last.args).toEqual([0, 0, 200, 100]);
    expect(last.scale).toBe(2);
  });
  it('a "below" FX filters everything under it, background included, and nothing above it', () => {
    const sepia = newFxLayer('filter', { scope: 'below', ops: [newFxOp('sepia')] });
    const { x } = view();
    drawDoc(x, page([sepia], 1));
    const pass = calls.find((k) => k.fn === 'drawImage' && k.filter === 'sepia(1)')!;
    // The background was filled on the composite the sepia pass reads.
    expect(calls.find((k) => k.fn === 'fillRect' && k.canvas === pass.src)).toBeDefined();
    // Layer B is drawn after, onto the sepia result, not before it.
    const after = calls.slice(calls.indexOf(pass) + 1);
    expect(after.some((k) => k.canvas === pass.canvas && k.fn !== 'drawImage')).toBe(true);
  });
  it('hidden, transparent or empty FX change nothing', () => {
    const idle = [newFxLayer('filter', { ops: [newFxOp('invert')] }), newFxLayer('filter', { ops: [] })];
    idle[0].visible = false;
    const { x } = view();
    drawDoc(x, page(idle, 1));
    expect(made).toBe(1);
  });
});

describe('passes', () => {
  it('deep trace includes the synchronized pixel read in pass-gpu', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    readPixel = () => { now += 25; };
    recordTrace(['fx'], true);
    applyFx(recordingCanvas(10, 10) as unknown as HTMLCanvasElement, [newFxOp('blur')], { scale: 1, clip: false });
    stopTrace();
    expect(events.find((e) => e.n === 'pass-gpu')?.ms).toBeGreaterThanOrEqual(25);
  });
  it('maps every filter to ctx.filter; the shadow keeps its colour and opacity', () => {
    expect(cssFilter(newFxOp('hue', { degrees: -45 }), 1)).toBe('hue-rotate(-45deg)');
    expect(cssFilter(newFxOp('saturation', { amount: 0 }), 1)).toBe('saturate(0)');
    expect(cssFilter(newFxOp('shadow', { x: 4, y: -2, blur: 10, color: '#112233', opacity: 0.5 }), 2)).toBe('drop-shadow(8px -4px 20px rgba(17, 34, 51, 0.5))');
    expect(cssFilter(newFxOp('glow'), 1)).toBeNull();
  });
  it('glow screens the blurred source once per unit of strength', () => {
    expect(glowPasses(1.5)).toEqual([1, 0.5]);
    expect(glowPasses(0)).toEqual([]);
    const src = recordingCanvas(10, 10) as unknown as HTMLCanvasElement;
    applyFx(src, [newFxOp('glow', { strength: 1.5, radius: 4 })], { scale: 1, clip: false });
    expect(calls.filter((k) => k.fn === 'drawImage' && k.op === 'screen').map((k) => [k.filter, k.alpha])).toEqual([['blur(4px)', 1], ['blur(4px)', 0.5]]);
  });
  it('a flare on one layer stays inside its pixels; over everything it does not', () => {
    const src = recordingCanvas(10, 10) as unknown as HTMLCanvasElement;
    applyFx(src, [newFxOp('flare')], { scale: 1, clip: true });
    expect(calls.some((k) => k.fn === 'drawImage' && k.op === 'destination-in')).toBe(true);
    calls.length = 0;
    applyFx(src, [newFxOp('flare')], { scale: 1, clip: false });
    expect(calls.some((k) => k.fn === 'drawImage' && k.op === 'destination-in')).toBe(false);
  });
  it('disabled ops are skipped; opacity interpolates with the source; another blend paints over it', () => {
    const src = recordingCanvas(10, 10) as unknown as HTMLCanvasElement;
    const off = newFxOp('invert'); off.enabled = false;
    expect(applyFx(src, [off], { scale: 1, clip: false })).toBe(src);
    const half = { ...newFxLayer('filter', { ops: [newFxOp('invert')] }), opacity: 0.25 };
    calls.length = 0;
    mixFx(src, half, { scale: 1, clip: false });
    const mix = calls.filter((k) => k.fn === 'drawImage').slice(-2);
    expect(mix.map((k) => [k.op, k.alpha])).toEqual([['source-over', 0.75], ['lighter', 0.25]]);
    calls.length = 0;
    mixFx(src, { ...half, blend: 'multiply' }, { scale: 1, clip: false });
    expect(calls.filter((k) => k.fn === 'drawImage').slice(-2).map((k) => [k.op, k.alpha])).toEqual([['source-over', 1], ['multiply', 0.25]]);
  });
});
