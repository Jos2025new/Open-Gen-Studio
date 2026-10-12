import { createSession, DEFAULT_UI, newSession, patchSession, setUi, useStore } from '../store/store';
import { createDoc, newRasterLayer } from '../engine/design/doc';
import { composeRaster, ensureBuffers, getBuffer, setBuffer } from '../engine/design/raster';
import { activeDoc } from '../engine/design/actions';
import { objectPick } from '../engine/design/objectSelection';
import { appendBenchSessions, intervalWork, longBenchStrokes, sandboxBenchAllowed } from './designerBenchFixtures';
import { prepareProfessional, rendererInfo, runProfessional } from './designerBenchProfessionalRun';

const PERIOD = 1000 / 60;
const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const percentile = (values: number[], q: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * q) - 1)] ?? 0;


let running = false;
async function prepare(kind: 'habitual' | 'exigente') {
  if (running) throw new Error('Benchmark already running');
  const st = useStore.getState();
  if (!st.hydrated) throw new Error('Wait for hydration');
  const source = activeDoc(st.activeSessionId);
  if (kind === 'habitual' && !source) throw new Error('Choose the usual document first');
  const id = newSession();
  let doc;
  if (kind === 'habitual') {
    // A separate document preserves the user's original. Base/media ids remain shared read-only.
    await ensureBuffers(source!.layers);
    doc = { ...source!, id: `bench-doc-${id}`, name: 'Fluidity habitual', layers: source!.layers.map((l) => ({ ...l, id: `bench-${id}-${l.id}` })) };
    for (let i = 0; i < source!.layers.length; i++) {
      const old = source!.layers[i], layer = doc.layers[i];
      const buf = getBuffer(old.id);
      if (buf) { const copy = document.createElement('canvas'); copy.width = buf.width; copy.height = buf.height; copy.getContext('2d')!.drawImage(buf, 0, 0); setBuffer(layer.id, copy); }
    }
    doc.activeLayerId = doc.layers.find((l) => l.type === 'raster' && l.paintStrokes?.length)?.id ?? doc.layers[0]?.id ?? null;
  } else {
    useStore.setState((s) => ({ sessions: appendBenchSessions(s.sessions, createSession) }));
    doc = createDoc('Fluidity demanding: 300 × 120 segments', 1920, 1080);
    const layer = newRasterLayer('300 long editable strokes', { x: 0, y: 0, width: 1920, height: 1080 }, { width: 1920, height: 1080 });
    const base = document.createElement('canvas'); base.width = 1920; base.height = 1080;
    layer.paintBaseId = `${layer.id}-base`; layer.paintStrokes = longBenchStrokes();
    setBuffer(layer.paintBaseId, base); composeRaster(layer);
    doc.layers = [layer]; doc.activeLayerId = layer.id;
  }
  patchSession(id, (s) => ({ ...s, title: `Benchmark ${kind}`, docs: [doc], activeDocId: doc.id }));
  setUi({ ...(kind === 'exigente' ? DEFAULT_UI : {}), workspace: 'designer', tool: 'brush', selectMode: 'objects' });
  await delay(3000);
  window.dispatchEvent(new Event('ogs:designer-fit'));
  await delay(200);
  return { kind, sessionId: id, documentId: doc.id, sessions: Object.keys(useStore.getState().sessions).length, width: doc.width, height: doc.height };
}

/** Dispatch at absolute 60 Hz deadlines; lateness is recorded rather than silently slowing the gesture. */
async function run() {
  if (running) throw new Error('Benchmark already running');
  const doc = activeDoc(useStore.getState().activeSessionId);
  const canvas = document.querySelector<HTMLCanvasElement>('.stage-canvas');
  if (!canvas || !doc) throw new Error('Designer document required');
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes.includes('longtask')) throw new Error('Long-task API required; unsupported browser cannot certify zero long tasks');
  running = true;
  const previousRAF = window.requestAnimationFrame, nativeRAF = previousRAF.bind(window);
  // Synthetic PointerEvents have no browser-active pointer: capture is irrelevant for this isolated dispatch.
  const capture = canvas.setPointerCapture, release = canvas.releasePointerCapture;
  let syntheticDispatch = false;
  canvas.setPointerCapture = function (id) { if (!syntheticDispatch) capture.call(this, id); };
  canvas.releasePointerCapture = function (id) { if (!syntheticDispatch) release.call(this, id); };
  const work: Array<[number, number]> = [], frames: number[] = [], events: Array<Record<string, number | string>> = [];
  const longTasks: Array<{ start: number; duration: number }> = [];
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push({ start: e.startTime, duration: e.duration });
  });
  if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask', buffered: false });
  window.requestAnimationFrame = (fn) => nativeRAF((time) => {
    const a = performance.now(); try { fn(time); } finally { work.push([a, performance.now()]); }
  });
  let tracking = true;
  const track = (time: number) => { if (tracking) { frames.push(time); nativeRAF(track); } };
  nativeRAF(track);
  const start = performance.now();
  const gestures: Array<{ phase: string; start: number; end: number }> = [];
  try {
    window.dispatchEvent(new Event('ogs:designer-fit')); await delay(100);
    const box = canvas.getBoundingClientRect(), pad = box.width < 500 ? 12 : 24, bottom = innerWidth < 768 ? 12 : 120;
    const zoom = Math.max(0.05, Math.min((box.width - pad * 2) / doc.width, (box.height - pad - bottom) / doc.height, 4));
    const ox = box.left + (box.width - doc.width * zoom) / 2, oy = box.top + Math.max(pad / 2, (box.height - bottom - doc.height * zoom) / 2);
    const point = (x: number, y: number) => ({ x: ox + x * zoom, y: oy + y * zoom });
    const send = async (type: string, p: { x: number; y: number }, planned: number, phase: string) => {
      await delay(Math.max(0, planned - performance.now()));
      const a = performance.now();
      syntheticDispatch = true;
      try { canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, clientX: p.x, clientY: p.y })); } finally { syntheticDispatch = false; }
      const b = performance.now(); work.push([a, b]);
      const record = { type, phase, planned, delivered: a, queueMs: Math.max(0, a - planned), handlerMs: b - a, nextRafMs: -1 };
      events.push(record); nativeRAF(() => { record.nextRafMs = performance.now() - planned; });
    };
    setUi({ tool: 'brush' }); await delay(200);
    let at = performance.now();
    await send('pointerdown', point(doc.width * .2, doc.height * .5), at, 'paint');
    for (let i = 1; i <= 60; i++) await send('pointermove', point(doc.width * (.2 + .5 * i / 60), doc.height * .5), at + PERIOD * i, 'paint');
    await send('pointerup', point(doc.width * .7, doc.height * .5), at + PERIOD * 61, 'paint');
    gestures.push({ phase: 'paint', start: at, end: performance.now() });
    await delay(1000);
    setUi({ tool: 'move', selectMode: 'objects' }); await delay(200);
    at = performance.now();
    const hit = point(doc.width * .4, doc.height * .5);
    await send('pointerdown', hit, at, 'select'); await send('pointerup', hit, at + PERIOD, 'select');
    gestures.push({ phase: 'select', start: at, end: performance.now() });
    const picked = objectPick(doc.id);
    if (!picked?.ids.length) throw new Error('Gesture did not hit an editable stroke; invalid benchmark');
    await delay(1000);
    at = performance.now(); await send('pointerdown', hit, at, 'drag');
    for (let i = 1; i <= 60; i++) await send('pointermove', { x: hit.x + i, y: hit.y + i / 2 }, at + PERIOD * i, 'drag');
    await send('pointerup', { x: hit.x + 60, y: hit.y + 30 }, at + PERIOD * 61, 'drag');
    gestures.push({ phase: 'drag', start: at, end: performance.now() });
    await delay(1000);
    const end = performance.now();
    observer.takeRecords().forEach((e) => longTasks.push({ start: e.startTime, duration: e.duration }));
    const frameWork = frames.slice(1).flatMap((time, i) => gestures.some((g) => g.phase !== 'select' && time >= g.start && frames[i] <= g.end) ? [intervalWork(work, frames[i], time)] : []);
    return { browser: navigator.userAgent, cores: navigator.hardwareConcurrency, dpr: devicePixelRatio, width: doc.width, height: doc.height, zoom,
      brush: useStore.getState().ui.brush, durationMs: end - start, gestures, samples: events.length, selectedStrokeIds: picked.ids,
      measuredMainWork: 'Union of synchronous dispatched handlers and RAF callbacks; LOWER BOUND, excludes uninstrumented tasks/native/GPU',
      frameWorkP95Ms: percentile(frameWork, .95), frameWorkMaxMs: Math.max(0, ...frameWork),
      eventQueueP95Ms: percentile(events.map((e) => e.queueMs as number), .95),
      eventNextRafP95Ms: percentile(events.map((e) => e.nextRafMs as number).filter((n) => n >= 0), .95),
      visibleLatency: 'NOT MEASURED: next RAF is a scheduling proxy, not displayed pixel',
      longTasks: longTasks.filter((t) => gestures.some((g) => t.start + t.duration > g.start && t.start < g.end + 1000)), events, frames, work };
  } finally { tracking = false; observer.disconnect(); window.requestAnimationFrame = previousRAF; canvas.setPointerCapture = capture; canvas.releasePointerCapture = release; running = false; }
}

if (sandboxBenchAllowed(location)) Object.assign(window, { __OGS_BENCH__: { prepare, run, prepareProfessional, runProfessional, rendererInfo } });
