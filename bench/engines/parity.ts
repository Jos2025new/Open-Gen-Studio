import { BLEND_MODES, composeFrame, drawDoc, resetRetainedPage, retainedStats } from '../../src/engine/design/render';
import { cloneCanvas, composeRaster, getBuffer, setBuffer } from '../../src/engine/design/raster';
import { moveRasterStroke } from '../../src/engine/design/rasterStrokes';
import type { DesignDoc, Layer, RasterLayer } from '../../src/engine/types';
import { PARITY_SIZE, parityDocument } from './parity-docs';

/*
 * Parity oracle (Paso 2). Two paths over the same document, compared pixel by pixel:
 *  - export: drawDoc at document resolution, no editor caches (the reference: what exports produce);
 *  - editor: drawDoc on a Stage canvas at zoom 1 with the editor caches on, drawn twice so the second frame reads them.
 * Every optimized path added later is compared with the export path. Runs in the browser (Canvas2D pixels).
 */

export interface ParityResult { pass: boolean; size: number; maxChannelDiff: number; differingChannels: number; totalChannels: number; features: string[]; runs: number }

const FEATURES = ['blend modes (multiply, screen, overlay, difference)', 'opacity', 'layer FX (shadow, glow)', 'below FX (blur, curves, hue)', 'tip strokes (hardness, multiply, keep opacity)', 'eraser', 'hidden folder', 'vector shapes (rect with stroke, ellipse)'];

function blank(): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = PARITY_SIZE; c.height = PARITY_SIZE; return c;
}

function composeAll(doc: DesignDoc, rasters: ReturnType<typeof parityDocument>['rasters']) {
  for (const l of rasters) {
    setBuffer(l.paintBaseId!, blank(), false);
    composeRaster(l, false);
  }
  void doc;
}

export function compareArrays(a: Uint8ClampedArray, b: Uint8ClampedArray): { maxChannelDiff: number; differingChannels: number; totalChannels: number } {
  let max = 0, diff = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
    if (d !== 0) diff++;
  }
  return { maxChannelDiff: max, differingChannels: diff, totalChannels: a.length };
}

export async function runParity(): Promise<ParityResult> {
  const { doc, rasters } = parityDocument();
  composeAll(doc, rasters);
  // Export path: no Stage class, document resolution.
  const ex = document.createElement('canvas'); ex.width = doc.width; ex.height = doc.height;
  const exCtx = ex.getContext('2d')!;
  drawDoc(exCtx, doc, { resolution: 'document' });
  const reference = exCtx.getImageData(0, 0, doc.width, doc.height).data;
  // Editor path: Stage canvas, identity transform (zoom 1), caches on; two frames, the second reads the caches.
  const ed = document.createElement('canvas'); ed.width = doc.width; ed.height = doc.height; ed.className = 'stage-canvas';
  const edCtx = ed.getContext('2d')!;
  let last: Uint8ClampedArray = new Uint8ClampedArray(0);
  for (let frame = 0; frame < 2; frame++) {
    edCtx.setTransform(1, 0, 0, 1, 0, 0);
    edCtx.clearRect(0, 0, ed.width, ed.height);
    drawDoc(edCtx, doc);
    last = edCtx.getImageData(0, 0, doc.width, doc.height).data;
  }
  const cmp = compareArrays(new Uint8ClampedArray(reference), new Uint8ClampedArray(last));
  return { pass: cmp.maxChannelDiff === 0, size: doc.width, ...cmp, features: FEATURES, runs: 2 };
}

/*
 * Paso 3 oracle: random changes, one at a time. After each, the editor frame through the retained page is compared with
 * a whole composition made by the same editor path (same caches, reset first): that is what the page must equal. A
 * frame over the tolerance (1/255) counts as a failure and the next frame is whole. Separately, the whole composition
 * is compared with one made without any cache (composeFrame): a difference there is a cache issue, reported on its own.
 */
export interface SequenceResult {
  pass: boolean; seed: number; ops: number; maxRetainedDiff: number; fallbacks: number;
  frames: { same: number; region: number; full: number }; kinds: Record<string, number>; failKinds: Record<string, number>;
  cacheVsUncached: { differingOps: number; maxChannelDiff: number };
  firstFailure: { op: number; kind: string; diff: number } | null;
}

function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
}

type Mut = { kind: string; next: DesignDoc };
const withLayer = (doc: DesignDoc, id: string, f: (l: Layer) => Layer): DesignDoc => ({ ...doc, layers: doc.layers.map((l) => (l.id === id ? f(l) : l)) });

function mutate(doc: DesignDoc, rnd: (n: number) => number, raster = true, tone = true): Mut {
  const pick = <T,>(xs: T[]): T => xs[rnd(xs.length)];
  const rasters = doc.layers.filter((l): l is RasterLayer => l.type === 'raster');
  const fxs = doc.layers.filter((l) => l.type === 'fx');
  let pickCase = rnd(8);
  if (!raster && (pickCase === 6 || pickCase === 7)) pickCase = 3;
  switch (pickCase) {
    case 0: {
      const l = pick(rasters), dx = rnd(41) - 20, dy = rnd(41) - 20;
      return { kind: 'move layer', next: withLayer(doc, l.id, (x) => ({ ...(x as RasterLayer), x: (x as RasterLayer).x + dx, y: (x as RasterLayer).y + dy })) };
    }
    case 1: {
      const l = pick(doc.layers.filter((x) => x.type !== 'fx'));
      return { kind: 'show or hide layer', next: withLayer(doc, l.id, (x) => ({ ...x, visible: !x.visible })) as DesignDoc };
    }
    case 2: {
      const members = doc.layers.filter((l) => l.groupId === 'par-grp-hidden');
      const to = !members[0].visible;
      return { kind: 'show or hide folder', next: { ...doc, layers: doc.layers.map((l) => (l.groupId === 'par-grp-hidden' ? { ...l, visible: to } : l)) } };
    }
    case 3: {
      const l = pick(doc.layers.filter((x) => x.type !== 'fx'));
      return { kind: 'opacity', next: withLayer(doc, l.id, (x) => ({ ...x, opacity: 0.1 + rnd(90) / 100 })) };
    }
    case 4: {
      const l = pick(doc.layers.filter((x) => x.type !== 'fx'));
      return { kind: 'blend mode', next: withLayer(doc, l.id, (x) => ({ ...x, blend: pick(BLEND_MODES) })) };
    }
    case 5: {
      const f = pick(tone ? fxs : fxs.filter((x) => x.id !== 'par-fx-curves'));
      return { kind: `FX parameter (${f.scope})`, next: withLayer(doc, f.id, (x) => {
        const fx = x as Extract<Layer, { type: 'fx' }>;
        const ops = fx.ops.map((op, i) => {
          if (i !== 0) return op;
          const params = { ...op.params };
          for (const k of Object.keys(params)) if (typeof params[k] === 'number') { params[k] = Math.max(0, (params[k] as number) + rnd(7) - 3); break; }
          return { ...op, params };
        });
        return { ...fx, ops };
      }) };
    }
    case 6: {
      const l = pick(rasters), c = getBuffer(l.id);
      if (!c) return { kind: 'paint (skipped)', next: doc };
      const copy = cloneCanvas(c), x = copy.getContext('2d')!;
      x.fillStyle = `rgba(${rnd(256)},${rnd(256)},${rnd(256)},0.8)`;
      x.fillRect(rnd(copy.width - 20), rnd(copy.height - 20), 4 + rnd(16), 4 + rnd(16));
      setBuffer(l.id, copy, false);
      return { kind: 'paint', next: { ...doc, layers: doc.layers.slice() } };
    }
    default: {
      const withStrokes = rasters.filter((l) => (l.paintStrokes?.length ?? 0) > 0);
      if (!withStrokes.length) return { kind: 'move stroke (skipped)', next: doc };
      const l = pick(withStrokes), st = pick(l.paintStrokes!);
      const moved = moveRasterStroke(l, st.id, rnd(31) - 15, rnd(31) - 15);
      composeRaster(moved, false);
      return { kind: 'move stroke', next: withLayer(doc, l.id, () => moved) };
    }
  }
}

export async function runSequence(count = 200, seed = 20260412, raster = true, tone = true): Promise<SequenceResult> {
  const rnd = rng(seed);
  let { doc } = parityDocument();
  composeAll(doc, parityDocument().rasters);
  const ed = document.createElement('canvas'); ed.width = doc.width; ed.height = doc.height; ed.className = 'stage-canvas';
  const edCtx = ed.getContext('2d')!;
  const frame = (d: DesignDoc): Uint8ClampedArray => {
    edCtx.setTransform(1, 0, 0, 1, 0, 0);
    edCtx.clearRect(0, 0, ed.width, ed.height);
    drawDoc(edCtx, d);
    return edCtx.getImageData(0, 0, d.width, d.height).data;
  };
  const uncached = (d: DesignDoc): Uint8ClampedArray => composeFrame(d, 1, false).getContext('2d')!.getImageData(0, 0, d.width, d.height).data;
  resetRetainedPage();
  frame(doc);
  let maxRetainedDiff = 0, fallbacks = 0, cacheDiffOps = 0, maxCacheDiff = 0;
  const frames = { same: 0, region: 0, full: 0 };
  const kinds: Record<string, number> = {}, failKinds: Record<string, number> = {};
  let firstFailure: SequenceResult['firstFailure'] = null;
  for (let k = 0; k < count; k++) {
    const m = mutate(doc, rnd, raster, tone);
    kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    doc = m.next;
    // The pixel box is read back at most every 150 ms (render.ts): wait so both frames read the same, current box.
    await new Promise((r) => setTimeout(r, 170));
    const before = { ...retainedStats() };
    const got = frame(doc);
    const after = retainedStats();
    if (after.same > before.same) frames.same++; else if (after.region > before.region) frames.region++; else frames.full++;
    resetRetainedPage();
    const ref = frame(doc);
    const cmp = compareArrays(ref, got);
    maxRetainedDiff = Math.max(maxRetainedDiff, cmp.maxChannelDiff);
    if (cmp.maxChannelDiff > 1) {
      fallbacks++;
      failKinds[m.kind] = (failKinds[m.kind] ?? 0) + 1;
      if (!firstFailure) firstFailure = { op: k, kind: m.kind, diff: cmp.maxChannelDiff };
    }
    const cu = compareArrays(ref, uncached(doc));
    (globalThis as { gc?: () => void }).gc?.();
    if (cu.maxChannelDiff > 1) cacheDiffOps++;
    maxCacheDiff = Math.max(maxCacheDiff, cu.maxChannelDiff);
  }
  return {
    pass: maxRetainedDiff <= 1, seed, ops: count, maxRetainedDiff, fallbacks, frames, kinds, failKinds,
    cacheVsUncached: { differingOps: cacheDiffOps, maxChannelDiff: maxCacheDiff }, firstFailure,
  };
}
