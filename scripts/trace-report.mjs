import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Summary of a performance trace (ADR 0012): `npm run trace:report [file] [--json]`.
 * Without a file it reads the newest trace in .sandbox/data/logs (the sandbox). A trace from the real app is read
 * only when its path is given. What it answers: which events cost most, how a frame grows with FX layers, the
 * latency from an action to the frame that shows it, memory and long tasks, and the same between each marker.
 */

const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
export function stats(values) {
  const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return { n: 0, p50: null, p95: null, max: null, total: 0 };
  const at = (q) => v[Math.min(v.length - 1, Math.floor(q * (v.length - 1) + 0.5))];
  return { n: v.length, p50: round(at(0.5)), p95: round(at(0.95)), max: round(v[v.length - 1]), total: round(v.reduce((a, b) => a + b, 0)) };
}

export function parseTrace(text) {
  return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

/** Frame budget at 60 fps. */
const FRAME_MS = 1000 / 60;

function section(events) {
  const frames = events.filter((e) => e.d === 'render' && e.n === 'frame');
  const starts = frames.map((f) => f.t);
  // Gaps between frames drawn in a burst (an interaction); a pause over 1 s is idle time, not a slow frame.
  const gaps = starts.slice(1).map((t, i) => t - starts[i]).filter((g) => g < 1000);
  const byFx = {};
  for (const f of frames) (byFx[f.data?.fx ?? 0] ??= []).push(f.ms);
  const passes = events.filter((e) => e.d === 'fx' && e.n === 'pass');
  const byKind = {};
  for (const p of passes) (byKind[p.data?.kind ?? '?'] ??= []).push(p.ms);
  const gpu = events.filter((e) => e.d === 'fx' && e.n === 'pass-gpu');
  const fxTime = passes.reduce((a, p) => a + (p.ms ?? 0), 0) + gpu.reduce((a, p) => a + (p.ms ?? 0), 0);
  const frameTime = frames.reduce((a, f) => a + (f.ms ?? 0), 0);
  const heap = events.filter((e) => e.d === 'memory').map((e) => e.data?.usedMB);
  return {
    frames: { ...stats(frames.map((f) => f.ms)), over16ms: frames.filter((f) => f.ms > FRAME_MS).length },
    framesByFxLayers: Object.fromEntries(Object.entries(byFx).sort(([a], [b]) => a - b).map(([k, v]) => [k, stats(v)])),
    gaps: { ...stats(gaps), over16ms: gaps.filter((g) => g > FRAME_MS * 1.5).length },
    canvasesPerFrame: stats(frames.map((f) => f.data?.canvases)),
    megapixelsPerFrame: stats(frames.map((f) => (f.data?.px ?? 0) / 1e6)),
    fxPassByKind: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, stats(v)])),
    fxShareOfFrames: frameTime ? round((fxTime / frameTime) * 100) : null,
    gpuWait: gpu.length ? { ...stats(gpu.map((g) => g.ms)), scriptP50: stats(gpu.map((g) => g.data?.scriptMs)).p50 } : null,
    latency: Object.fromEntries(Object.entries(events.filter((e) => e.n === 'apply' || e.n === 'change').reduce((acc, e) => ((acc[`${e.d}.${e.n}`] ??= []).push(e.ms), acc), {})).map(([k, v]) => [k, stats(v)])),
    heapMB: heap.length ? { min: Math.min(...heap), max: Math.max(...heap) } : null,
    longTasks: stats(events.filter((e) => e.n === 'longtask').map((e) => e.data?.ms)),
  };
}

export function report(events) {
  const start = events.find((e) => e.d === 'session' && e.n === 'start');
  const marks = events.filter((e) => e.d === 'mark');
  const segments = [];
  const cuts = [{ t: 0, n: '(start)' }, ...marks];
  cuts.forEach((m, i) => {
    const end = cuts[i + 1]?.t ?? Infinity;
    segments.push({ marker: m.n, at: round(m.t / 1000), ...section(events.filter((e) => e.t >= m.t && e.t < end && e.d !== 'mark')) });
  });
  const all = {};
  for (const e of events) if (typeof e.ms === 'number') (all[`${e.d}.${e.n}`] ??= []).push(e.ms);
  return {
    session: start?.data ?? null,
    seconds: round((events[events.length - 1]?.t ?? 0) / 1000),
    events: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, stats(v)]).sort((a, b) => b[1].total - a[1].total)),
    overall: section(events),
    segments: marks.length ? segments : [],
  };
}

const row = (name, s) => `| ${name} | ${s.n} | ${s.p50 ?? '—'} | ${s.p95 ?? '—'} | ${s.max ?? '—'} | ${s.total ?? '—'} |`;
function sectionText(s) {
  const out = [];
  out.push(`- Frames: ${s.frames.n}, p50 ${s.frames.p50} ms, p95 ${s.frames.p95} ms, max ${s.frames.max} ms; ${s.frames.over16ms} over 16.7 ms.`);
  if (s.gaps.n) out.push(`- Between frames while interacting: p50 ${s.gaps.p50} ms, p95 ${s.gaps.p95} ms; ${s.gaps.over16ms} gaps over 25 ms (visible stutter).`);
  const fx = Object.entries(s.framesByFxLayers);
  if (fx.length > 1 || fx[0]?.[0] !== '0') out.push(`- Frame time by active FX layers: ${fx.map(([k, v]) => `${k} → p50 ${v.p50} / p95 ${v.p95} ms (${v.n})`).join('; ')}.`);
  if (s.canvasesPerFrame.n) out.push(`- Off-screen canvases per frame: p50 ${s.canvasesPerFrame.p50}, max ${s.canvasesPerFrame.max}; megapixels per frame: p50 ${s.megapixelsPerFrame.p50}, max ${s.megapixelsPerFrame.max}.`);
  if (s.fxShareOfFrames != null) out.push(`- FX passes are ${s.fxShareOfFrames}% of frame time${s.gpuWait ? ` (deep: synchronized read p50 ${s.gpuWait.p50} ms vs script p50 ${s.gpuWait.scriptP50} ms per pass)` : ''}.`);
  for (const [k, v] of Object.entries(s.fxPassByKind)) out.push(`- FX pass ${k}: p50 ${v.p50} ms, p95 ${v.p95} ms (${v.n}).`);
  for (const [k, v] of Object.entries(s.latency)) out.push(`- Latency ${k} (action → frame shown): p50 ${v.p50} ms, p95 ${v.p95} ms, max ${v.max} ms (${v.n}).`);
  if (s.heapMB) out.push(`- JS heap: ${s.heapMB.min}–${s.heapMB.max} MB.`);
  if (s.longTasks.n) out.push(`- Long tasks (>50 ms, the page could not respond): ${s.longTasks.n}, max ${s.longTasks.max} ms.`);
  return out.join('\n');
}

export function reportText(r, file) {
  const lines = [`# Trace ${file}`, '', `${r.session?.label ?? '?'} · ${r.seconds} s · ${r.session?.userAgent ?? ''} · ${r.session?.cores ?? '?'} cores · dpr ${r.session?.dpr ?? '?'}${r.session?.deep ? ' · deep' : ''}${r.session?.domains?.length ? ` · domains ${r.session.domains.join(', ')}` : ''}`, '', '## Overall', '', sectionText(r.overall), '', '## Events (ms)', '', '| Event | n | p50 | p95 | max | total |', '| --- | --- | --- | --- | --- | --- |', ...Object.entries(r.events).map(([k, v]) => row(k, v))];
  if (r.segments.length) {
    lines.push('', '## Between markers');
    for (const s of r.segments) lines.push('', `### ${s.at} s — ${s.marker}`, '', sectionText(s));
  }
  return lines.join('\n');
}

async function newest(dir) {
  const files = (await readdir(dir).catch(() => [])).filter((f) => /^trace-.*\.jsonl$/.test(f));
  const dated = await Promise.all(files.map(async (f) => ({ f, m: (await stat(join(dir, f))).mtimeMs })));
  return dated.sort((a, b) => b.m - a.m)[0]?.f ? join(dir, dated.sort((a, b) => b.m - a.m)[0].f) : null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--')) ?? (await newest(resolve('.sandbox/data/logs')));
  if (!file) {
    console.error('No trace found in .sandbox/data/logs. Start one with Ctrl+Alt+P (or ?trace=<label>) and pass its path to read another.');
    process.exitCode = 1;
  } else {
    const r = report(parseTrace(await readFile(file, 'utf8')));
    console.log(json ? JSON.stringify(r, null, 2) : reportText(r, file));
  }
}
