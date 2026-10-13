import { BLEND_MODES, drawDoc } from '../../src/engine/design/render';
import { setCpuCanvases } from '../../src/lib/media';
import { cloneCanvas, composeRaster, getBuffer, setBuffer } from '../../src/engine/design/raster';
import { moveRasterStroke } from '../../src/engine/design/rasterStrokes';
import type { DesignDoc, Layer, RasterLayer } from '../../src/engine/types';
import { PARITY_SIZE, parityDocument } from './parity-docs';

/*
 * Cache bisection oracle (self-contained, so it runs at any commit): the same random changes as parity.ts, each
 * compared as the editor draws it (stage canvas, caches on) with a plain canvas (no stage class, so no caches).
 * Both at scale 1. Only drawDoc is used, so older commits can run it too.
 */
export interface CacheOracleResult { seed: number; ops: number; differingOps: number; maxChannelDiff: number; firstDiff: { op: number; kind: string; diff: number } | null; kinds: Record<string, number> }

function blank(): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = PARITY_SIZE; c.height = PARITY_SIZE; return c; }
function rng(seed: number): (n: number) => number {
  let s = seed >>> 0 || 1;
  return (n) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return Math.floor((s / 4294967296) * n); };
}
function maxDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}
type Mut = { kind: string; next: DesignDoc };
const withLayer = (doc: DesignDoc, id: string, f: (l: Layer) => Layer): DesignDoc => ({ ...doc, layers: doc.layers.map((l) => (l.id === id ? f(l) : l)) });

function mutate(doc: DesignDoc, rnd: (n: number) => number, raster = true, tone = true, nofx = false): Mut {
  const pick = <T,>(xs: T[]): T => xs[rnd(xs.length)];
  const rasters = doc.layers.filter((l): l is RasterLayer => l.type === 'raster');
  const fxs = doc.layers.filter((l) => l.type === 'fx');
  let pickCase = rnd(8);
  if (!raster && (pickCase === 6 || pickCase === 7)) pickCase = 3;
  if (nofx && pickCase === 5) pickCase = 3;
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

export async function runCacheOracle(count = 200, seed = 20260412, raster = true, tone = true, nofx = false): Promise<CacheOracleResult> {
  setCpuCanvases(true);
  const rnd = rng(seed);
  let { doc } = parityDocument();
  if (nofx) doc = { ...doc, layers: doc.layers.filter((l) => l.type !== 'fx') };
  if (!tone) doc = { ...doc, layers: doc.layers.filter((l) => l.id !== 'par-fx-curves') };
  for (const l of doc.layers) if (l.type === 'raster' && l.paintBaseId) { setBuffer(l.paintBaseId, blank(), false); composeRaster(l, false); }
  const stage = document.createElement('canvas'); stage.width = doc.width; stage.height = doc.height; stage.className = 'stage-canvas';
  const plain = document.createElement('canvas'); plain.width = doc.width; plain.height = doc.height;
  const read = (c: HTMLCanvasElement, d: DesignDoc) => {
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
    drawDoc(x, d);
    return x.getImageData(0, 0, d.width, d.height).data;
  };
  let differing = 0, maxAll = 0, firstDiff: CacheOracleResult['firstDiff'] = null;
  const kinds: Record<string, number> = {};
  for (let k = 0; k < count; k++) {
    const m = mutate(doc, rnd, raster, tone, nofx);
    kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
    doc = m.next;
    await new Promise((r) => setTimeout(r, 170));
    const cached = read(stage, doc).slice();
    const uncached = read(plain, doc);
    const d = maxDiff(cached, uncached);
    if (d > 1) { differing++; if (!firstDiff) firstDiff = { op: k, kind: m.kind, diff: d }; }
    maxAll = Math.max(maxAll, d);
  }
  return { seed, ops: count, differingOps: differing, maxChannelDiff: maxAll, firstDiff, kinds };
}
