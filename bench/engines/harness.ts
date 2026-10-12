import { buildScene, addStroke, moveEditableStroke, moveWholeLayer, setFolderVisible, setFxParam, GESTURE_IDS, type Scene } from './scene';
import type { Engine, View } from './types';
import type { DesignDoc } from '../../src/engine/types';
import { canvas2dEngine } from './canvas2d';

/*
 * Runs one engine through the same gestures at one zoom. Each event mutates the shared model, then the engine draws
 * the page and waits for the GPU (sync). A frame's time runs from the mutation to the sync. Three repetitions per
 * gesture, ten events each, each repetition from a fresh scene and a fresh engine (not timed).
 */

const EVENTS = 10, REPS = 3, VIEW_W = 1500, VIEW_H = 940;
const pct = (v: number[], q: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(s.length * q) - 1)] ?? 0; };
const r2 = (n: number) => Math.round(n * 100) / 100;

type Step = (doc: DesignDoc, i: number) => { doc: DesignDoc; layerId: string };
const GESTURES: Record<string, { label: string; step: Step }> = {
  pintar: { label: 'pintar un trazo (Personaje 2)', step: (d, i) => ({ doc: addStroke(d, GESTURE_IDS.paintLayer, [[200 + i * 40, 300], [240 + i * 40, 340], [280 + i * 40, 320]], `h-${i}`), layerId: GESTURE_IDS.paintLayer }) },
  mover_trazo: { label: 'mover un trazo editable de la capa limitada (300)', step: (d, i) => {
    const layer = d.layers.find((l) => l.id === GESTURE_IDS.limitedLayer) as { paintStrokes?: Array<{ id: string }> };
    return { doc: moveEditableStroke(d, GESTURE_IDS.limitedLayer, layer.paintStrokes![0].id, 2, 1), layerId: GESTURE_IDS.limitedLayer };
  } },
  mover_capa: { label: 'mover una capa raster entera (Personaje 9)', step: (d) => ({ doc: moveWholeLayer(d, 'prof-lyr-personaje-9', 3, 0), layerId: 'prof-lyr-personaje-9' }) },
  ocultar_carpeta: { label: 'ocultar y mostrar la carpeta Personajes', step: (d, i) => ({ doc: setFolderVisible(d, GESTURE_IDS.folder, i % 2 === 1), layerId: '' }) },
  fx_below: { label: 'cambiar un FX below (curvas, punto medio)', step: (d, i) => ({ doc: setFxParam(d, GESTURE_IDS.curvesFx, GESTURE_IDS.curvesOp, 'midtones', 0.4 + 0.02 * i), layerId: GESTURE_IDS.curvesFx }) },
};

async function makeEngine(): Promise<Engine> {
  if (__ENGINE__ === 'webgl2') return (await import('./webgl2')).webgl2Engine();
  if (__ENGINE__ === 'canvaskit') return (await import('./canvaskit')).canvaskitEngine();
  return canvas2dEngine();
}

function longTasks() {
  const list: number[] = [];
  const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) list.push(e.duration); });
  try { obs.observe({ type: 'longtask', buffered: false }); } catch { /* unsupported */ }
  return { list, stop: () => obs.disconnect() };
}

export async function runEngine(zoom: number, only?: string[]) {
  const renderer = (() => {
    const c = document.createElement('canvas'); const g = (c.getContext('webgl2') || c.getContext('webgl')) as WebGL2RenderingContext | null;
    if (!g) return { renderer: 'none' };
    const e = g.getExtension('WEBGL_debug_renderer_info');
    return { renderer: String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER)), software: /swiftshader|llvmpipe|software/i.test(String(e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : '')) };
  })();
  const view = (scene: Scene): View => ({ zoom, x: (VIEW_W - scene.doc.width * zoom) / 2, y: (VIEW_H - scene.doc.height * zoom) / 2, width: VIEW_W, height: VIEW_H });
  const out: Record<string, unknown> = { engine: __ENGINE__, zoom, renderer, gestures: {} as Record<string, unknown> };
  // Reference: OGS's own full-resolution page (the export path), from the pristine scene.
  const ref = canvas2dEngine();
  const pristine = buildScene();
  const refCanvas = document.createElement('canvas'); refCanvas.width = VIEW_W; refCanvas.height = VIEW_H;
  await ref.init(pristine, refCanvas);
  const refPage = ref.fullPage(pristine.doc);
  const engine = await makeEngine();
  const probe = buildScene();
  const cv = document.createElement('canvas'); cv.width = VIEW_W; cv.height = VIEW_H;
  cv.style.width = `${VIEW_W}px`; cv.style.height = `${VIEW_H}px`; cv.className = 'stage-canvas';
  document.body.appendChild(cv);
  await engine.init(probe, cv);
  const page = engine.fullPage(probe.doc);
  let maxD = 0, sum = 0, over2 = 0;
  for (let i = 0; i < page.length; i += 4) for (let k = 0; k < 4; k++) { const d = Math.abs(page[i + k] - refPage[i + k]); if (d > maxD) maxD = d; sum += d; if (d > 2) over2++; }
  const at = (arr: Uint8ClampedArray, x: number, y: number) => Array.from(arr.subarray((y * pristine.doc.width + x) * 4, (y * pristine.doc.width + x) * 4 + 4));
  const samples = [[0, 0], [1000, 1000], [600, 300], [1500, 40]].map(([x, y]) => ({ x, y, ref: at(refPage, x, y), engine: at(page, x, y) }));
  out.pixels = { samples, maxChannelDiff: maxD, meanChannelDiff: r2(sum / page.length), pctOver2of255: r2((100 * over2) / (page.length / 4 * 4)), reference: 'OGS Canvas2D full-resolution page (drawDoc, resolution document)' };
  for (const [name, g] of Object.entries(GESTURES)) {
    if (only && !only.includes(name)) continue;
    const reps: unknown[] = [];
    for (let rep = 0; rep < REPS; rep++) {
      const scene = buildScene();
      const eng = await makeEngine();
      await eng.init(scene, cv);
      let doc = scene.doc;
      const v = view(scene);
      eng.render(doc, v); eng.sync(); eng.render(doc, v); eng.sync(); // warm-up, not timed
      const lt = longTasks();
      const times: number[] = [];
      for (let i = 0; i < EVENTS; i++) {
        const t0 = performance.now();
        const next = g.step(doc, i);
        doc = next.doc;
        if (next.layerId) eng.layerChanged(doc, next.layerId);
        eng.render(doc, v); eng.sync();
        times.push(performance.now() - t0);
      }
      lt.stop();
      reps.push({ rep, frameMs: times.map(r2), p50: r2(pct(times, 0.5)), p95: r2(pct(times, 0.95)), max: r2(Math.max(...times)), over8ms: times.filter((t) => t > 8).length, longTasks: lt.list.length, longTaskMaxMs: r2(Math.max(0, ...lt.list)), textureBytes: eng.textureBytes() });
    }
    out.gestures = { ...(out.gestures as object), [name]: { label: g.label, reps } };
  }
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  out.memory = { jsHeapBytes: mem?.usedJSHeapSize ?? null };
  return out;
}

declare global { const __ENGINE__: string; }
export { EVENTS, REPS };
