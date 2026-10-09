import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * The performance trace (ADR 0012): off costs nothing and records nothing; a session records only its domains,
 * the user's markers, and the latency from an action to the frame that shows it; the local server appends it to
 * logs/trace-<id>.jsonl; trace-report summarizes it, also between markers.
 */
const posts: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { posts.push({ url, body: String(init.body), headers: init.headers as Record<string, string> }); return new Response(null, { status: 204 }); });
import { awaitFrame, frameShown, mark, note, span, startTrace, stopTrace, takeCanvasCount, canvasMade, traceFromUrl, traceStatus, tracing } from '../src/lib/trace';
import { parseTrace, report, reportText, stats } from '../scripts/trace-report.mjs';
import { localStore } from '../server/local-store.js';

const lines = () => posts.flatMap((p) => p.body.split('\n')).filter(Boolean).map((l) => JSON.parse(l));
afterEach(() => { stopTrace(); posts.length = 0; });

describe('the trace in the app', () => {
  it('off: nothing is recorded and a probe is a no-op', () => {
    expect(tracing('fx')).toBe(false);
    expect(span('fx', 'pass')()).toBe(0);
    note('fx', 'x');
    mark('ignored');
    canvasMade(10, 10);
    expect(takeCanvasCount()).toEqual({ canvases: 0, px: 0 });
    expect(posts).toEqual([]);
  });
  it('a session records its domains, the markers and the canvases made; stop writes it to the session file', () => {
    const id = startTrace({ label: 'Cien capas de desenfoque', domains: ['fx'] });
    expect(id).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-cien-capas-de-desenfoque$/);
    expect(tracing('fx')).toBe(true);
    expect(tracing('render')).toBe(false);
    span('fx', 'pass', { kind: 'blur' })({ extra: 1 });
    span('render', 'frame')();
    mark('ahora arrastro la capa');
    canvasMade(100, 50);
    expect(takeCanvasCount()).toEqual({ canvases: 1, px: 5000 });
    expect(traceStatus()).toMatchObject({ label: 'Cien capas de desenfoque', domains: ['fx'] });
    stopTrace();
    expect(posts[0].url).toBe(`/x/store/trace?id=${id}`);
    expect(posts[0].headers['X-OGS']).toBe('1');
    const ev = lines();
    expect(ev.map((e) => `${e.d}.${e.n}`)).toEqual(['session.start', 'fx.pass', 'mark.ahora arrastro la capa', 'session.stop']);
    expect(ev[1]).toMatchObject({ data: { kind: 'blur', extra: 1 } });
    expect(typeof ev[1].ms).toBe('number');
    expect(traceStatus()).toBeNull();
  });
  it('the latency of an action ends at the next frame shown', () => {
    startTrace({ label: 'latency' });
    awaitFrame('fx', 'apply', { commands: 'add' });
    frameShown();
    stopTrace();
    expect(lines().find((e) => e.n === 'apply')).toMatchObject({ d: 'fx', data: { commands: 'add' } });
  });
  it('?trace=<label>&domains=…&deep=1 starts one session, even when the app mounts twice', () => {
    traceFromUrl('?trace=bench&domains=fx,render&deep=1');
    const first = traceStatus()!.id;
    traceFromUrl('?trace=bench&domains=fx,render&deep=1');
    expect(traceStatus()).toMatchObject({ id: first, domains: ['fx', 'render'], deep: true });
    expect(lines().filter((e) => e.n === 'start')).toHaveLength(0);
    stopTrace();
    expect(lines().filter((e) => e.n === 'start')).toHaveLength(1);
  });
});

describe('the local server', () => {
  function call(mw: (req: unknown, res: unknown, next: () => void) => void, url: string, body: string, headers: Record<string, string>): Promise<number> {
    return new Promise((resolve) => {
      const req = { method: 'POST', url, headers, socket: { remoteAddress: '127.0.0.1' }, async *[Symbol.asyncIterator]() { yield new TextEncoder().encode(body); } };
      const res = { statusCode: 0, setHeader: () => undefined, end: () => resolve(res.statusCode) };
      mw(req, res, () => resolve(404));
    });
  }
  it('appends JSON lines to logs/trace-<id>.jsonl, only from the app and with a plain id', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ogs-'));
    mkdirSync(join(root, 'data'));
    writeFileSync(join(root, 'data', 'state.json'), '{"savedAt":1}');
    let mw: (req: unknown, res: unknown, next: () => void) => void = () => undefined;
    (localStore(root).configureServer as unknown as (s: unknown) => void)({ middlewares: { use: (fn: typeof mw) => (mw = fn) } });
    const app = { 'x-ogs': '1', host: 'localhost:5173' };
    expect(await call(mw, '/x/store/trace?id=a-1', '{"t":0}\nnot json\n{"t":1}', app)).toBe(204);
    expect(await call(mw, '/x/store/trace?id=a-1', '{"t":2}', app)).toBe(204);
    expect(readFileSync(join(root, 'data', 'logs', 'trace-a-1.jsonl'), 'utf8')).toBe('{"t":0}\n{"t":1}\n{"t":2}\n');
    expect(await call(mw, '/x/store/trace?id=../state', '{"t":0}', app)).toBe(400);
    expect(await call(mw, '/x/store/trace?id=a-1', '{"t":0}', { host: 'localhost:5173' })).toBe(403);
  });
});

describe('trace-report', () => {
  it('counts only FX time inside its editor frame and reports other origins separately', () => {
    const data = (renderId: number, origin: string) => ({ renderId, origin, kind: 'blur' });
    const events = [
      { t: 0, d: 'render', n: 'frame', ms: 10, data: data(1, 'editor') },
      { t: 1, d: 'fx', n: 'pass', ms: 8, data: data(1, 'editor') },
      { t: 8, d: 'fx', n: 'pass-gpu', ms: 3, data: data(1, 'editor') },
      { t: 20, d: 'render', n: 'offscreen', ms: 40, data: data(2, 'export') },
      { t: 20, d: 'fx', n: 'pass', ms: 35, data: data(2, 'export') },
      { t: 70, d: 'render', n: 'offscreen', ms: 50, data: data(3, 'fill') },
      { t: 70, d: 'fx', n: 'pass', ms: 45, data: data(3, 'fill') },
    ];
    const r = report(events);
    expect(r.overall.fxShareOfFrames).toBe(90);
    expect(r.overall.fxByOrigin).toMatchObject({ editor: { passes: { total: 8 } }, export: { passes: { total: 35 } }, fill: { passes: { total: 45 } } });
    expect(reportText(r, 'origins')).toContain('FX origin export');
    expect(report(events.filter((e) => e.d === 'fx')).overall.fxShareOfFrames).toBeNull();
    expect(report(events.map((e) => ({ ...e, data: undefined }))).overall.fxShareOfFrames).toBeNull();
  });
  const ev = [
    { t: 0, d: 'session', n: 'start', data: { label: 'bench', cores: 8 } },
    { t: 10, d: 'render', n: 'frame', ms: 10, data: { fx: 1, canvases: 3, px: 3e6 } },
    { t: 30, d: 'render', n: 'frame', ms: 12, data: { fx: 1, canvases: 3, px: 3e6 } },
    { t: 30, d: 'fx', n: 'pass', ms: 8, data: { kind: 'blur' } },
    { t: 40, d: 'fx', n: 'apply', ms: 60 },
    { t: 100, d: 'mark', n: '10 capas' },
    { t: 110, d: 'render', n: 'frame', ms: 90, data: { fx: 10, canvases: 13, px: 7e6 } },
    { t: 120, d: 'browser', n: 'longtask', data: { ms: 95 } },
  ];
  it('percentiles, frames by FX layers, latency and long tasks, overall and between markers', () => {
    expect(stats([5, 1, 3, 2, 4])).toMatchObject({ n: 5, p50: 3, max: 5, total: 15 });
    const r = report(parseTrace(ev.map((e) => JSON.stringify(e)).join('\n') + '\nbroken line'));
    expect(r.overall.framesByFxLayers).toMatchObject({ 1: { n: 2, p50: 12 }, 10: { n: 1, p50: 90 } });
    expect(r.overall.frames.over16ms).toBe(1);
    expect(r.overall.latency['fx.apply']).toMatchObject({ n: 1, p50: 60 });
    expect(r.overall.longTasks).toMatchObject({ n: 1, max: 95 });
    expect(r.segments.map((s: { marker: string }) => s.marker)).toEqual(['(start)', '10 capas']);
    expect(r.segments[1].frames).toMatchObject({ n: 1, p50: 90 });
    expect(reportText(r, 'x.jsonl')).toContain('### 0.1 s — 10 capas');
  });
});
