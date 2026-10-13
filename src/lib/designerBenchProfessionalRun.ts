import { createSession, newSession, patchSession, selectSession, setUi, useStore } from '../store/store';
import { deleteSession } from '../engine/actions';
import { activeDoc, setActiveLayer } from '../engine/design/actions';
import {setBuffer} from '../engine/design/raster';
import {composeRaster} from '../engine/design/rasterCompose';
import { hitTestPixel } from '../engine/design/render';
import { objectPick } from '../engine/design/objectSelection';
import { runFx } from '../engine/design/fx';
import type { DesignDoc, RasterLayer, VectorLayer } from '../engine/types';
import { intervalWork } from './designerBenchFixtures';
import { PROFESSIONAL_IDS, PROFESSIONAL_SIZE, longStrokes, professionalDocument, professionalSessionIds } from './designerBenchProfessional';

/*
 * Gestures on the professional document (docs/render-baseline.md). Same probe as designerBench.ts: synthetic pointer
 * events at 60 Hz deadlines, RAF work as a lower bound of main-thread work, and long tasks. Each gesture runs three
 * repetitions; a repetition's frame work covers its active frames, and its long tasks cover that plus the second after.
 */

const PERIOD = 1000 / 60;
const TAIL_ACTIVE_MS = 300;
const TAIL_LONG_MS = 1000;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const percentile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0;
const round = (n: number) => Math.round(n * 100) / 100;

let running = false;
/** Moves of the drag gestures (b, c); the profiling rule caps a gesture at 5 s, so the Etapa A runs use 10. */
let dragMoves = 60;
const work: Array<[number, number]> = [];
const frames: number[] = [];
const longTasks: Array<{ start: number; duration: number }> = [];

interface Event { type: string; planned: number; queueMs: number; handlerMs: number; nextRafMs: number }

function stage(doc: DesignDoc) {
  const canvas = document.querySelector<HTMLCanvasElement>('.stage-canvas');
  if (!canvas) throw new Error('Designer stage not mounted');
  const box = canvas.getBoundingClientRect(), pad = box.width < 500 ? 12 : 24, bottom = innerWidth < 768 ? 12 : 120;
  const zoom = Math.max(0.05, Math.min((box.width - pad * 2) / doc.width, (box.height - pad - bottom) / doc.height, 4));
  const ox = box.left + (box.width - doc.width * zoom) / 2, oy = box.top + Math.max(pad / 2, (box.height - bottom - doc.height * zoom) / 2);
  return { canvas, zoom, point: (x: number, y: number) => ({ x: ox + x * zoom, y: oy + y * zoom }) };
}

/** One repetition: runs `body` (measured), then records frame work over the active frames (body + 300 ms) and long tasks over the body + 1 s. */
async function repetition(name: string, rep: number, body: (ctx: Ctx) => Promise<void>, canvas: HTMLCanvasElement) {
  const events: Event[] = [];
  const capture = canvas.setPointerCapture, release = canvas.releasePointerCapture;
  let syntheticDispatch = false;
  canvas.setPointerCapture = function (id) { if (!syntheticDispatch) capture.call(this, id); };
  canvas.releasePointerCapture = function (id) { if (!syntheticDispatch) release.call(this, id); };
  const nativeRAF = window.requestAnimationFrame.bind(window);
  const record = (type: string, planned: number, a: number, b: number) => {
    const e: Event = { type, planned, queueMs: Math.max(0, a - planned), handlerMs: b - a, nextRafMs: -1 };
    events.push(e); nativeRAF(() => { e.nextRafMs = performance.now() - planned; });
    work.push([a, b]);
  };
  const ctx: Ctx = {
    send: async (type, p, planned) => {
      await delay(Math.max(0, planned - performance.now()));
      const a = performance.now();
      syntheticDispatch = true;
      try { canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, clientX: p.x, clientY: p.y })); } finally { syntheticDispatch = false; }
      record(type, planned, a, performance.now());
    },
    timed: (type, fn) => { const a = performance.now(); fn(); record(type, a, a, performance.now()); },
  };
  try {
    const t0 = performance.now();
    await body(ctx);
    const bodyEnd = performance.now();
    await delay(TAIL_LONG_MS);
    const activeFrames = frames.slice(0, -1).flatMap((time, i) => (time >= t0 && frames[i + 1] <= bodyEnd + TAIL_ACTIVE_MS ? [intervalWork(work, time, frames[i + 1])] : []));
    const longs = longTasks.filter((t) => t.start + t.duration > t0 && t.start < bodyEnd + TAIL_LONG_MS);
    return {
      rep, name, durationMs: round(bodyEnd - t0), frames: activeFrames.length,
      frameWorkP50Ms: round(percentile(activeFrames, 0.5)), frameWorkP95Ms: round(percentile(activeFrames, 0.95)), frameWorkMaxMs: round(Math.max(0, ...activeFrames)),
      framesOver8ms: activeFrames.filter((w) => w > 8).length,
      longTasks: longs.length, longTaskMaxMs: round(Math.max(0, ...longs.map((t) => t.duration))),
      eventQueueP95Ms: round(percentile(events.map((e) => e.queueMs), 0.95)),
      eventNextRafP95Ms: round(percentile(events.map((e) => e.nextRafMs).filter((n) => n >= 0), 0.95)),
      events: events.length,
    };
  } finally {
    canvas.setPointerCapture = capture; canvas.releasePointerCapture = release;
  }
}

interface Ctx {
  send: (type: string, p: { x: number; y: number }, planned: number) => Promise<void>;
  timed: (type: string, fn: () => void) => void;
}

function current(): DesignDoc {
  const doc = activeDoc(useStore.getState().activeSessionId);
  if (!doc) throw new Error('Professional document is not active');
  return doc;
}

/** Brush: a stroke across the paint layer, the same gesture as the habitual case. */
async function paint(rep: number, canvasInfo: ReturnType<typeof stage>, doc: DesignDoc, ctx: Ctx) {
  const W = doc.width, H = doc.height, { point } = canvasInfo;
  const y = H * (0.25 + 0.2 * rep);
  let at = performance.now();
  await ctx.send('pointerdown', point(W * 0.2, y), at);
  for (let i = 1; i <= 60; i++) await ctx.send('pointermove', point(W * (0.2 + 0.5 * i / 60), y), at + PERIOD * i);
  await ctx.send('pointerup', point(W * 0.7, y), at + PERIOD * 61);
}

/** Edit (objects): press one early stroke of the 300-stroke layer, drag it, release. Checks the press picked it. */
async function moveEarlyStroke(rep: number, canvasInfo: ReturnType<typeof stage>, ctx: Ctx) {
  const k = 40 + rep, strokeId = `prof-long-${k}`;
  const seg = longStrokes()[k].segments[60];
  const hit = canvasInfo.point(seg[0], seg[1]);
  const doc = current();
  if (hitTestPixel(doc, seg[0], seg[1])?.id !== PROFESSIONAL_IDS.longLayer) throw new Error(`Point of ${strokeId} is not on top; invalid benchmark`);
  const at = performance.now();
  await ctx.send('pointerdown', hit, at);
  if (!objectPick(doc.id)?.ids.includes(strokeId)) throw new Error(`Press did not pick ${strokeId}; invalid benchmark`);
  for (let i = 1; i <= dragMoves; i++) await ctx.send('pointermove', { x: hit.x + i, y: hit.y + i / 2 }, at + PERIOD * i);
  await ctx.send('pointerup', { x: hit.x + dragMoves, y: hit.y + dragMoves / 2 }, at + PERIOD * (dragMoves + 1));
}

/** Edit (layers): drag a whole vector layer by pressing inside its box. */
async function moveWholeLayer(canvasInfo: ReturnType<typeof stage>, ctx: Ctx) {
  const doc = current();
  const layer = doc.layers.find((l) => l.id === PROFESSIONAL_IDS.wholeLayer) as VectorLayer | undefined;
  const first = layer?.shapes[0];
  if (!first) throw new Error('Whole-layer target missing');
  const p0 = { x: first.x + first.w / 2, y: first.y + first.h / 2 };
  if (hitTestPixel(doc, p0.x, p0.y)?.id !== PROFESSIONAL_IDS.wholeLayer) throw new Error('Press point is not on the target layer; invalid benchmark');
  const at = performance.now();
  await ctx.send('pointerdown', canvasInfo.point(p0.x, p0.y), at);
  for (let i = 1; i <= dragMoves; i++) await ctx.send('pointermove', canvasInfo.point(p0.x - 2 * i, p0.y), at + PERIOD * i);
  await ctx.send('pointerup', canvasInfo.point(p0.x - 2 * dragMoves, p0.y), at + PERIOD * (dragMoves + 1));
}

/** Layers panel: hide the folder, then show it again (the eye button of the folder). */
async function toggleFolder(ctx: Ctx) {
  const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label);
  const hide = button('Hide Personajes');
  if (!hide) throw new Error('Folder eye button not found (is the layers panel open?)');
  ctx.timed('click-hide', () => hide.click());
  await delay(TAIL_ACTIVE_MS);
  const show = button('Show Personajes');
  if (!show) throw new Error('Folder did not hide');
  ctx.timed('click-show', () => show.click());
}

/** Below-scoped adjustment: change one parameter through the same command the layers panel runs (runFx). */
async function changeBelowFx(rep: number, ctx: Ctx) {
  const values = [0.45, 0.55, 0.4];
  const sessionId = useStore.getState().activeSessionId;
  ctx.timed('fx-set', () => {
    runFx(sessionId, current().id, [{ do: 'set_op', layer: PROFESSIONAL_IDS.curvesFx, op: `${PROFESSIONAL_IDS.curvesFx}-op`, params: { midtones: values[rep] } }]);
  });
}

/**
 * Prepares the professional document. Reuses the bench session that already holds it (same id, same title) and restores
 * its pristine content; creates a session only when none exists. Never deletes anything.
 */
export async function prepareProfessional() {
  if (running) throw new Error('Benchmark already running');
  const st = useStore.getState();
  if (!st.hydrated) throw new Error('Wait for hydration');
  const existing = professionalSessionIds(st.sessions)[0];
  const { doc, rasterLayers } = professionalDocument();
  const id = existing ?? newSession();
  // One shared blank base: composeRaster only reads it (clones it), so no layer paints into it.
  const blank = document.createElement('canvas'); blank.width = PROFESSIONAL_SIZE; blank.height = PROFESSIONAL_SIZE;
  for (const layer of rasterLayers as RasterLayer[]) {
    setBuffer(layer.paintBaseId!, blank, false);
    composeRaster(layer, false);
  }
  patchSession(id, (s) => ({ ...s, title: 'Benchmark profesional', docs: [doc], activeDocId: doc.id }));
  selectSession(id);
  setUi({ workspace: 'designer', tool: 'brush', selectMode: 'objects' });
  await delay(3000);
  window.dispatchEvent(new Event('ogs:designer-fit'));
  await delay(200);
  return {
    sessionId: id, reused: Boolean(existing), documentId: doc.id, layers: doc.layers.length,
    rasterStrokes: rasterLayers.reduce((n, l) => n + (l.paintStrokes?.length ?? 0), 0),
    activeLayer: PROFESSIONAL_IDS.paintLayer, folders: doc.groups?.map((g) => g.name),
  };
}

/**
 * Deletes every bench session of the professional document except `keep`, through the app's own deleteSession.
 * Only sessions titled 'Benchmark profesional' that hold the bench document are touched.
 */
export function pruneProfessionalSessions(keep: string) {
  if (running) throw new Error('Benchmark already running');
  const ids = professionalSessionIds(useStore.getState().sessions);
  if (!ids.includes(keep)) throw new Error('keep must be a bench session of the professional document');
  const removed = ids.filter((id) => id !== keep);
  for (const id of removed) deleteSession(id);
  return { found: ids.length, removed: removed.length, kept: keep };
}

/** Runs the five gestures, three repetitions each, on the prepared document. Returns the JSON for the baseline. */
export async function runProfessional(only?: string[], reps = 3, moves = 60) {
  if (running) throw new Error('Benchmark already running');
  dragMoves = moves;
  const sessionId = useStore.getState().activeSessionId;
  const doc0 = activeDoc(sessionId);
  if (!doc0 || doc0.id !== 'bench-doc-profesional') throw new Error('Prepare the professional document first');
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('Long-task API required');
  running = true;
  const nativeRAF = window.requestAnimationFrame.bind(window), previousRAF = window.requestAnimationFrame;
  const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration }); });
  let tracking = true;
  const track = (time: number) => { if (tracking) { frames.push(time); nativeRAF(track); } };
  work.length = 0; frames.length = 0; longTasks.length = 0;
  window.requestAnimationFrame = (fn) => nativeRAF((time) => {
    const a = performance.now(); try { fn(time); } finally { work.push([a, performance.now()]); }
  });
  observer.observe({ type: 'longtask', buffered: false });
  nativeRAF(track);
  const gestures: Record<string, unknown[]> = {};
  try {
    window.dispatchEvent(new Event('ogs:designer-fit'));
    await delay(300);
    setUi({ tool: 'brush' });
    await delay(200);
    type Step = { setup: (rep: number, info: ReturnType<typeof stage>, doc: DesignDoc) => Promise<void>; act: (rep: number, info: ReturnType<typeof stage>, doc: DesignDoc, ctx: Ctx) => Promise<void> };
    const plan: Array<[string, Step]> = [
      ['a-pintar-trazo-personaje', {
        setup: async (_r, _i, doc) => { setUi({ tool: 'brush', selectMode: 'objects' }); setActiveLayer(sessionId, doc.id, PROFESSIONAL_IDS.paintLayer); },
        act: paint,
      }],
      ['b-mover-trazo-temprano-300', {
        setup: async () => { setUi({ tool: 'move', selectMode: 'objects' }); },
        act: async (rep, info, _doc, ctx) => moveEarlyStroke(rep, info, ctx),
      }],
      ['c-mover-capa-entera', {
        setup: async (_r, _i, doc) => { setUi({ tool: 'move', selectMode: 'layers' }); setActiveLayer(sessionId, doc.id, PROFESSIONAL_IDS.wholeLayer); },
        act: async (_r, info, _doc, ctx) => moveWholeLayer(info, ctx),
      }],
      ['d-ocultar-mostrar-carpeta', {
        setup: async () => { setUi({ tool: 'move', selectMode: 'objects' }); },
        act: async (_r, _i, _doc, ctx) => toggleFolder(ctx),
      }],
      ['e-parametro-ajuste-below', {
        setup: async () => {},
        act: async (rep, _i, _doc, ctx) => changeBelowFx(rep, ctx),
      }],
    ];
    for (const [name, step] of plan) {
      if (only && !only.some((o) => name.startsWith(o))) continue;
      gestures[name] = [];
      for (let rep = 0; rep < reps; rep++) {
        // Wait out the previous repetition's tail, then set the UI up outside the measured window.
        await delay(1000);
        const doc = current(), info = stage(doc);
        await step.setup(rep, info, doc);
        await delay(200);
        gestures[name].push(await repetition(name, rep, (ctx) => step.act(rep, info, doc, ctx), info.canvas));
      }
    }
    const env = {
      browser: navigator.userAgent, cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, viewport: [innerWidth, innerHeight],
      docSize: [doc0.width, doc0.height], zoom: stage(current()).zoom, renderer: rendererInfo(),
      measuredMainWork: 'RAF callbacks and synchronous dispatched handlers: LOWER BOUND of main-thread work (excludes native, GPU, uninstrumented tasks)',
      visibleLatency: 'NOT MEASURED: next RAF is a scheduling proxy, not the displayed pixel',
    };
    return { env, gestures, summary: summarize(gestures) };
  } finally {
    tracking = false; observer.disconnect(); window.requestAnimationFrame = previousRAF; running = false;
  }
}

function summarize(gestures: Record<string, unknown[]>) {
  const out: Record<string, unknown> = {};
  for (const [name, reps] of Object.entries(gestures)) {
    const rs = reps as Array<Record<string, number>>;
    out[name] = {
      frameWorkP50MsPooled: round(percentile(rs.map((r) => r.frameWorkP50Ms), 0.5)),
      frameWorkP95MsWorstRep: round(Math.max(...rs.map((r) => r.frameWorkP95Ms))),
      frameWorkMaxMsWorstRep: round(Math.max(...rs.map((r) => r.frameWorkMaxMs))),
      longTasksTotal: rs.reduce((n, r) => n + r.longTasks, 0),
      longTaskMaxMs: round(Math.max(...rs.map((r) => r.longTaskMaxMs))),
      eventQueueP95MsWorstRep: round(Math.max(...rs.map((r) => r.eventQueueP95Ms))),
      eventNextRafP95MsWorstRep: round(Math.max(...rs.map((r) => r.eventNextRafP95Ms))),
    };
  }
  return out;
}

/** The WebGL renderer behind this browser. SwiftShader or other software renderers make the measures unusable. */
export function rendererInfo() {
  const c = document.createElement('canvas');
  const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGL2RenderingContext | null;
  if (!gl) return { available: false };
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const vendor = String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
  return { available: true, renderer, vendor, version: String(gl.getParameter(gl.VERSION)), software: /swiftshader|llvmpipe|software/i.test(renderer) };
}

/** Adds `count` small synthetic sessions (the many-sessions case of ADR 0014). Bench sandbox only. */
export function addSyntheticSessions(count: number) {
  const st = useStore.getState();
  const sessions = { ...st.sessions };
  for (let i = 0; i < count; i++) {
    const id = `bench-many-${i}`;
    if (!sessions[id]) sessions[id] = { ...createSession(`Synthetic ${i}`), id };
  }
  useStore.setState({ sessions });
  return { sessions: Object.keys(sessions).length };
}
